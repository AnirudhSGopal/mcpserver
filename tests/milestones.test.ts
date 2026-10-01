import { describe, it, expect } from 'vitest';
import { MilestoneManager, Milestone } from '../src/builder/milestones.js';
import { BuilderProgressEvent } from '../src/builder/progress-pipeline.js';

describe('Milestone State Model & Dependency Invalidation (PART A)', () => {
  it('test 1: failed source marks data=problem and keeps all later milestones as not_started', () => {
    const manager = new MilestoneManager();
    const project = manager.createProject('proj-1', 'Invoice Assistant', 'invoiceapp');

    // Builder emits source_connected failed
    const failedEvent: BuilderProgressEvent = {
      stage: 'source_connected',
      status: 'failed',
      plain_message: 'We could not reach your service address. Please check the URL.',
      detail: { reason: 'Network failure', next_step: 'Verify URL is accessible.' }
    };

    manager.applyBuilderEvent(project.id, failedEvent);

    const milestones = manager.getMilestones(project.id);
    const dataM = milestones.find((m) => m.id === 'data');
    expect(dataM?.status).toBe('problem');
    expect(dataM?.message).toContain('could not reach your service');
    expect(dataM?.next_step).toContain('Verify URL');

    // All later milestones MUST remain not_started
    const laterIds = ['actions', 'coverage', 'tested', 'live'];
    for (const id of laterIds) {
      const m = milestones.find((item) => item.id === id);
      expect(m?.status).toBe('not_started');
    }
  });

  it('test 2: toggling a tool after tests makes coverage, tested, and live become stale and clears tested/live flags', () => {
    const manager = new MilestoneManager();
    const project = manager.createProject('proj-2', 'Store Assistant', 'store');
    project.tools = [
      { name: 'list_products', description: 'List products', mode: 'read', enabled: true },
      { name: 'delete_product', description: 'Delete product', mode: 'write', enabled: false }
    ];

    // Complete pipeline up to tested
    manager.applyBuilderEvent(project.id, {
      stage: 'source_connected',
      status: 'done',
      plain_message: 'Connected.'
    });
    manager.applyBuilderEvent(project.id, {
      stage: 'schema_read',
      status: 'done',
      plain_message: 'Endpoints found.',
      detail: { operationsCount: 2 }
    });
    manager.applyBuilderEvent(project.id, {
      stage: 'tools_drafted',
      status: 'done',
      plain_message: 'Actions drafted.',
      detail: { toolsCount: 2 }
    });
    manager.applyBuilderEvent(project.id, {
      stage: 'coverage_checked',
      status: 'done',
      plain_message: 'Coverage 100%.',
      detail: { coveragePercent: 100 }
    });
    manager.applyBuilderEvent(project.id, {
      stage: 'tests_done',
      status: 'done',
      plain_message: '2 tests passed.',
      detail: { passed: 2, total: 2 }
    });

    // Check pre-condition: tested is done, live is waiting_on_user
    let milestones = manager.getMilestones(project.id);
    expect(milestones.find((m) => m.id === 'tested')?.status).toBe('done');
    expect(milestones.find((m) => m.id === 'live')?.status).toBe('waiting_on_user');
    expect(project.testResults).toEqual({ passed: 2, total: 2 });

    // USER ACTION: toggle a tool in actions milestone
    manager.toggleTool(project.id, 'delete_product', true);

    milestones = manager.getMilestones(project.id);
    const coverageM = milestones.find((m) => m.id === 'coverage');
    const testedM = milestones.find((m) => m.id === 'tested');
    const liveM = milestones.find((m) => m.id === 'live');

    // Coverage, tested, and live must become stale
    expect(coverageM?.status).toBe('stale');
    expect(testedM?.status).toBe('stale');
    expect(liveM?.status).toBe('stale');

    // Tested and live flags MUST be cleared
    expect(project.testResults).toBeUndefined();
    expect(project.isPublished).toBe(false);
  });

  it('test 3: publish is strictly impossible unless coverage and tested are done and not stale', () => {
    const manager = new MilestoneManager();
    const project = manager.createProject('proj-3', 'Billing Assistant', 'billing');

    // 1. Trying to publish at start -> rejected
    expect(() => manager.publish(project.id)).toThrowError(/coverage milestone is not_started/i);

    // 2. Set coverage to done, but tested is still not done -> rejected
    project.milestones.coverage.status = 'done';
    expect(() => manager.publish(project.id)).toThrowError(/tested milestone is not_started/i);

    // 3. Set tested to stale -> rejected
    project.milestones.tested.status = 'stale';
    expect(() => manager.publish(project.id)).toThrowError(/tested milestone is stale/i);

    // 4. Set coverage to stale, tested to done -> rejected
    project.milestones.coverage.status = 'stale';
    project.milestones.tested.status = 'done';
    expect(() => manager.publish(project.id)).toThrowError(/coverage milestone is stale/i);

    // 5. Both coverage and tested are done and NOT stale -> publish succeeds
    project.milestones.coverage.status = 'done';
    project.milestones.tested.status = 'done';

    const published = manager.publish(project.id);
    expect(published.isPublished).toBe(true);
    expect(published.publishedUrl).toBe('/s/billing/mcp');

    const milestones = manager.getMilestones(project.id);
    expect(milestones.find((m) => m.id === 'live')?.status).toBe('done');
  });

  it('test 4: an event stream never marks a milestone done without the backing event', () => {
    const manager = new MilestoneManager();
    const project = manager.createProject('proj-4', 'CRM Assistant', 'crm');
    const emitter = manager.getEmitter(project.id);

    const emittedSnapshots: Milestone[][] = [];
    emitter.on('milestones', (ms) => {
      emittedSnapshots.push(JSON.parse(JSON.stringify(ms)));
    });

    // Event 1: tests_running (1 of 3)
    manager.applyBuilderEvent(project.id, {
      stage: 'tests_running',
      status: 'started',
      plain_message: 'Testing action reliability (1 of 3 running).',
      detail: { current: 1, total: 3 }
    });

    // Tested must be current with subtask count 1/3, NEVER done
    let currentTested = manager.getMilestones(project.id).find((m) => m.id === 'tested');
    expect(currentTested?.status).toBe('current');
    expect(currentTested?.subtasks?.[0]?.completed).toBe(false);
    expect(currentTested?.subtasks?.[0]?.count).toEqual({ current: 1, total: 3 });

    // Event 2: tests_running (2 of 3)
    manager.applyBuilderEvent(project.id, {
      stage: 'tests_running',
      status: 'started',
      plain_message: 'Testing action reliability (2 of 3 running).',
      detail: { current: 2, total: 3 }
    });

    currentTested = manager.getMilestones(project.id).find((m) => m.id === 'tested');
    expect(currentTested?.status).toBe('current');
    expect(currentTested?.subtasks?.[0]?.count).toEqual({ current: 2, total: 3 });

    // All emitted snapshots so far must NOT have tested=done
    for (const snap of emittedSnapshots) {
      const snapTested = snap.find((m) => m.id === 'tested');
      expect(snapTested?.status).not.toBe('done');
    }

    // Event 3: Backing event arrives: tests_done
    manager.applyBuilderEvent(project.id, {
      stage: 'tests_done',
      status: 'done',
      plain_message: 'All 3 tests passed.',
      detail: { passed: 3, total: 3 }
    });

    // Only NOW is tested marked done
    currentTested = manager.getMilestones(project.id).find((m) => m.id === 'tested');
    expect(currentTested?.status).toBe('done');
    expect(currentTested?.subtasks?.[0]?.completed).toBe(true);

    const lastSnap = emittedSnapshots[emittedSnapshots.length - 1];
    expect(lastSnap.find((m) => m.id === 'tested')?.status).toBe('done');
  });
});
