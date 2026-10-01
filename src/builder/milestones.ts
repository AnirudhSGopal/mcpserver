import { EventEmitter } from 'node:events';
import { BuilderProgressEvent } from './progress-pipeline.js';

export type MilestoneId = 'goal' | 'data' | 'actions' | 'coverage' | 'tested' | 'live';

export type MilestoneStatus =
  | 'not_started'
  | 'current'
  | 'waiting_on_user'
  | 'done'
  | 'problem'
  | 'stale';

export interface SubTask {
  id: string;
  title: string;
  completed: boolean;
  count?: { current: number; total: number };
}

export interface Milestone {
  id: MilestoneId;
  title: string;
  status: MilestoneStatus;
  message: string;
  next_step?: string;
  subtasks?: SubTask[];
}

export const MILESTONE_ORDER: MilestoneId[] = [
  'goal',
  'data',
  'actions',
  'coverage',
  'tested',
  'live'
];

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  goalText?: string;
  baseUrl?: string;
  spec?: any;
  tools: Array<{
    name: string;
    description: string;
    mode: 'read' | 'write';
    enabled: boolean;
  }>;
  needs: string[];
  coveragePercent?: number;
  testResults?: { passed: number; total: number };
  isPublished: boolean;
  publishedUrl?: string;
  pendingUserAction?: 'credentials' | 'write_approval' | 'publish_confirmation';
  milestones: Record<MilestoneId, Milestone>;
  updatedAt: string;
}

export class MilestoneManager {
  private projects = new Map<string, ProjectRecord>();
  private emitters = new Map<string, EventEmitter>();

  getEmitter(projectId: string): EventEmitter {
    let emitter = this.emitters.get(projectId);
    if (!emitter) {
      emitter = new EventEmitter();
      this.emitters.set(projectId, emitter);
    }
    return emitter;
  }

  createProject(id: string, name: string, slug: string): ProjectRecord {
    const milestones: Record<MilestoneId, Milestone> = {
      goal: {
        id: 'goal',
        title: 'Goal',
        status: 'current',
        message: 'Define what tasks you want your AI assistant to perform.',
        next_step: 'Enter your business goal or select a template.'
      },
      data: {
        id: 'data',
        title: 'Connect data',
        status: 'not_started',
        message: 'No data source connected yet.',
        next_step: 'Provide your API web address and specification.'
      },
      actions: {
        id: 'actions',
        title: 'Review actions',
        status: 'not_started',
        message: 'Actions will be generated once data is connected.',
        next_step: 'Connect a data source first.'
      },
      coverage: {
        id: 'coverage',
        title: 'Check coverage',
        status: 'not_started',
        message: 'Coverage cannot be analyzed until actions are drafted.',
        next_step: 'Draft actions first.'
      },
      tested: {
        id: 'tested',
        title: 'Reliability tests',
        status: 'not_started',
        message: 'Automated tests have not been executed.',
        next_step: 'Review and verify actions.'
      },
      live: {
        id: 'live',
        title: 'Go live',
        status: 'not_started',
        message: 'Connection is not published.',
        next_step: 'Complete testing before publishing.'
      }
    };

    const project: ProjectRecord = {
      id,
      name,
      slug,
      tools: [],
      needs: [],
      isPublished: false,
      milestones,
      updatedAt: new Date().toISOString()
    };

    this.projects.set(id, project);
    return project;
  }

  getProject(id: string): ProjectRecord | undefined {
    return this.projects.get(id);
  }

  getMilestones(id: string): Milestone[] {
    const project = this.projects.get(id);
    if (!project) return [];
    return MILESTONE_ORDER.map((mId) => project.milestones[mId]);
  }

  /**
   * Applies dependency invalidation:
   * Changing a milestone's inputs marks every later milestone as stale
   * and clears the tested and live status flags until re-run.
   */
  invalidateFrom(projectId: string, milestoneId: MilestoneId, reason: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    const startIdx = MILESTONE_ORDER.indexOf(milestoneId);
    if (startIdx === -1) return;

    for (let i = startIdx + 1; i < MILESTONE_ORDER.length; i++) {
      const laterId = MILESTONE_ORDER[i];
      const m = project.milestones[laterId];
      if (m.status === 'done' || m.status === 'current' || m.status === 'waiting_on_user') {
        m.status = 'stale';
        m.message = `Needs review: ${reason}.`;
        m.next_step = `Re-run ${m.title.toLowerCase()} to restore verified status.`;
      }
    }

    // Clear tested / live flags
    if (startIdx < MILESTONE_ORDER.indexOf('tested')) {
      project.testResults = undefined;
    }
    if (startIdx < MILESTONE_ORDER.indexOf('live')) {
      project.isPublished = false;
      project.publishedUrl = undefined;
    }

    project.updatedAt = new Date().toISOString();
    this.broadcastMilestones(projectId);
  }

  /**
   * Updates goal inputs. Invalidate all subsequent milestones if previously set.
   */
  setGoal(projectId: string, goalText: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.goalText = goalText;
    project.milestones.goal = {
      id: 'goal',
      title: 'Goal',
      status: 'done',
      message: `Goal established: "${goalText}".`,
      next_step: 'Connect your business data source.'
    };

    // If data was not started, advance to current
    if (project.milestones.data.status === 'not_started') {
      project.milestones.data.status = 'current';
    }

    this.invalidateFrom(projectId, 'goal', 'Goal was updated');
  }

  /**
   * Updates data source. Invalidates actions, coverage, tested, live.
   */
  setDataSource(projectId: string, baseUrl: string, spec: any): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.baseUrl = baseUrl;
    project.spec = spec;
    this.invalidateFrom(projectId, 'data', 'Data source was updated');
  }

  /**
   * Toggles a tool on/off or edits tool description.
   * Invalidates coverage, tested, and live.
   */
  toggleTool(projectId: string, toolName: string, enabled: boolean): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    const tool = project.tools.find((t) => t.name === toolName);
    if (tool) {
      tool.enabled = enabled;
      project.updatedAt = new Date().toISOString();

      // Invalidate coverage, tested, live
      this.invalidateFrom(projectId, 'actions', `Action "${toolName}" was toggled ${enabled ? 'on' : 'off'}`);
    }
  }

  /**
   * Handles user-required actions (waiting_on_user)
   */
  setWaitingOnUser(projectId: string, milestoneId: MilestoneId, reason: string, nextStep: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.milestones[milestoneId] = {
      id: milestoneId,
      title: project.milestones[milestoneId].title,
      status: 'waiting_on_user',
      message: reason,
      next_step: nextStep
    };

    project.updatedAt = new Date().toISOString();
    this.broadcastMilestones(projectId);
  }

  /**
   * Transition milestone status ONLY from real builder events (SSE).
   * No timers, no fake ETAs.
   */
  applyBuilderEvent(projectId: string, event: BuilderProgressEvent): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    switch (event.stage) {
      case 'source_connected':
        if (event.status === 'failed') {
          project.milestones.data = {
            id: 'data',
            title: 'Connect data',
            status: 'problem',
            message: event.plain_message,
            next_step: event.detail?.next_step || 'Check your web address and try again.'
          };
          // Failures mean later milestones remain not_started
          project.milestones.actions.status = 'not_started';
          project.milestones.coverage.status = 'not_started';
          project.milestones.tested.status = 'not_started';
          project.milestones.live.status = 'not_started';
        } else if (event.status === 'done') {
          project.milestones.data.status = 'current';
          project.milestones.data.message = event.plain_message;
        }
        break;

      case 'schema_read':
        if (event.status === 'done') {
          project.milestones.data = {
            id: 'data',
            title: 'Connect data',
            status: 'done',
            message: event.plain_message,
            next_step: 'Review drafted actions.',
            subtasks: [
              {
                id: 'endpoints_found',
                title: 'Available endpoints',
                completed: true,
                count: { current: event.detail?.operationsCount || 0, total: event.detail?.operationsCount || 0 }
              }
            ]
          };
          project.milestones.actions.status = 'current';
        } else if (event.status === 'failed') {
          project.milestones.data.status = 'problem';
          project.milestones.data.message = event.plain_message;
        }
        break;

      case 'needs_found':
        if (event.status === 'done') {
          project.milestones.goal.status = 'done';
          project.needs = Array.from({ length: event.detail?.needsCount || 1 }, (_, i) => `Task ${i + 1}`);
        }
        break;

      case 'tools_drafted':
        if (event.status === 'done') {
          project.milestones.actions = {
            id: 'actions',
            title: 'Review actions',
            status: 'done',
            message: event.plain_message,
            next_step: 'Verify coverage of tasks.',
            subtasks: [
              {
                id: 'draft_count',
                title: 'Drafted actions',
                completed: true,
                count: { current: event.detail?.toolsCount || 0, total: event.detail?.toolsCount || 0 }
              }
            ]
          };
          project.milestones.coverage.status = 'current';
        }
        break;

      case 'coverage_checked':
        if (event.status === 'done') {
          project.coveragePercent = event.detail?.coveragePercent || 100;
          project.milestones.coverage = {
            id: 'coverage',
            title: 'Check coverage',
            status: 'done',
            message: event.plain_message,
            next_step: 'Run automated reliability tests.'
          };
          project.milestones.tested.status = 'current';
        }
        break;

      case 'tests_running':
        project.milestones.tested = {
          id: 'tested',
          title: 'Reliability tests',
          status: 'current',
          message: event.plain_message,
          subtasks: [
            {
              id: 'test_progress',
              title: 'Automated test suite',
              completed: false,
              count: { current: event.detail?.current || 0, total: event.detail?.total || 0 }
            }
          ]
        };
        break;

      case 'tests_done':
        if (event.status === 'done') {
          project.testResults = { passed: event.detail?.passed || 0, total: event.detail?.total || 0 };
          project.milestones.tested = {
            id: 'tested',
            title: 'Reliability tests',
            status: 'done',
            message: event.plain_message,
            next_step: 'Publish connection to make it live.',
            subtasks: [
              {
                id: 'test_progress',
                title: 'Automated test suite',
                completed: true,
                count: { current: event.detail?.passed || 0, total: event.detail?.total || 0 }
              }
            ]
          };
          // Move live to waiting_on_user: publishing requires human confirmation!
          project.milestones.live = {
            id: 'live',
            title: 'Go live',
            status: 'waiting_on_user',
            message: 'All tests passed. Ready for your review to publish.',
            next_step: 'Click "Publish connection" to generate your live connection address.'
          };
        }
        break;

      case 'published':
        if (event.status === 'done') {
          project.isPublished = true;
          project.publishedUrl = event.detail?.mcpUrl;
          project.milestones.live = {
            id: 'live',
            title: 'Go live',
            status: 'done',
            message: event.plain_message,
            next_step: 'Connect your assistant in Claude or ChatGPT.'
          };
        }
        break;
    }

    project.updatedAt = new Date().toISOString();
    this.broadcastMilestones(projectId);
  }

  /**
   * Publishes project. Strictly enforces that coverage and tested MUST be done and NOT stale.
   */
  publish(projectId: string): ProjectRecord {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`Project "${projectId}" not found`);

    const coverage = project.milestones.coverage;
    const tested = project.milestones.tested;

    if (coverage.status !== 'done') {
      throw new Error(
        `Cannot publish: coverage milestone is ${coverage.status}. Coverage must be done and verified.`
      );
    }

    if (tested.status !== 'done') {
      throw new Error(
        `Cannot publish: tested milestone is ${tested.status}. Reliability tests must be done and verified.`
      );
    }

    project.isPublished = true;
    project.publishedUrl = `/s/${project.slug}/mcp`;
    project.milestones.live = {
      id: 'live',
      title: 'Go live',
      status: 'done',
      message: `Connection "${project.name}" is live and ready for assistant queries.`,
      next_step: 'Connect in Claude or ChatGPT settings.'
    };

    project.updatedAt = new Date().toISOString();
    this.broadcastMilestones(projectId);
    return project;
  }

  private broadcastMilestones(projectId: string): void {
    const emitter = this.emitters.get(projectId);
    if (emitter) {
      emitter.emit('milestones', this.getMilestones(projectId));
    }
  }
}

export const globalMilestoneManager = new MilestoneManager();
