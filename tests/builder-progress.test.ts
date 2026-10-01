import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runBuilderPipeline, BuilderProgressEvent } from '../src/builder/progress-pipeline.js';
import { createMcpHttpServer } from '../src/protocol/http-server.js';
import { McpRuntimeServer } from '../src/protocol/server.js';
import { ServerConfig } from '../src/schema.js';

describe('Builder Progress Events & SSE Pipeline (STEP A)', () => {
  const validSpec = {
    openapi: '3.0.0',
    info: { title: 'Test API', version: '1.0.0' },
    paths: {
      '/items': {
        get: {
          operationId: 'list_items',
          summary: 'List all items in the inventory',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }]
        }
      },
      '/items/{id}': {
        get: {
          operationId: 'get_item',
          summary: 'Get item by identifier',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]
        },
        delete: {
          operationId: 'delete_item',
          summary: 'Permanently remove an item',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]
        }
      }
    }
  };

  beforeAll(() => {
    process.env.ALLOW_LOOPBACK_DEV = '1';
  });

  it('emits typed progress events in order for valid pipeline run with counts only in schema_read', async () => {
    const events: BuilderProgressEvent[] = [];
    const generator = runBuilderPipeline({
      name: 'Inventory Assistant',
      slug: 'inventory',
      baseUrl: 'http://127.0.0.1:3000',
      spec: validSpec,
      requirement: 'List items and view item details'
    });

    for await (const ev of generator) {
      events.push(ev);
    }

    // Verify stages reached
    const stages = events.map((e) => e.stage);
    expect(stages).toContain('source_connected');
    expect(stages).toContain('schema_read');
    expect(stages).toContain('needs_found');
    expect(stages).toContain('tools_drafted');
    expect(stages).toContain('coverage_checked');
    expect(stages).toContain('tests_running');
    expect(stages).toContain('tests_done');
    expect(stages).toContain('published');

    // schema_read MUST contain counts only, NEVER data
    const schemaDone = events.find((e) => e.stage === 'schema_read' && e.status === 'done');
    expect(schemaDone).toBeDefined();
    expect(schemaDone?.detail).toBeDefined();
    expect(schemaDone?.detail?.operationsCount).toBe(3);
    expect(schemaDone?.detail?.pathsCount).toBe(2);
    // Assert no data/schema leaks
    expect((schemaDone?.detail as any).paths).toBeUndefined();
    expect((schemaDone?.detail as any).data).toBeUndefined();
    expect((schemaDone?.detail as any).schema).toBeUndefined();

    // Plain message is plain business language without secrets or stack traces
    for (const ev of events) {
      expect(typeof ev.plain_message).toBe('string');
      expect(ev.plain_message.length).toBeGreaterThan(10);
      expect(ev.plain_message).not.toContain('Error:');
      expect(ev.plain_message).not.toMatch(/^\s+at\s+/m);
    }
  });

  it('stream for a failed source shows failed and terminates with NO later stages', async () => {
    const events: BuilderProgressEvent[] = [];

    // Provide an invalid / malformed URL
    const generator = runBuilderPipeline({
      name: 'Bad Source Assistant',
      slug: 'bad-source',
      baseUrl: 'not-a-valid-url',
      spec: validSpec
    });

    for await (const ev of generator) {
      events.push(ev);
    }

    // Must show failed for source_connected
    const failedEvent = events.find((e) => e.stage === 'source_connected' && e.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.plain_message).toMatch(/could not connect/i);
    expect(failedEvent?.detail?.reason).toBeDefined();
    expect(failedEvent?.detail?.next_step).toBeDefined();

    // MUST NOT have any later stages!
    const laterStages = ['schema_read', 'needs_found', 'tools_drafted', 'coverage_checked', 'tests_running', 'tests_done', 'published'];
    for (const later of laterStages) {
      expect(events.some((e) => e.stage === later)).toBe(false);
    }
  });

  it('stream for an SSRF-blocked source shows failed and terminates immediately', async () => {
    const events: BuilderProgressEvent[] = [];

    // AWS metadata link-local address (SSRF blocked)
    const generator = runBuilderPipeline({
      name: 'SSRF Attack Assistant',
      slug: 'ssrf-test',
      baseUrl: 'http://169.254.169.254/latest/meta-data',
      spec: validSpec
    });

    for await (const ev of generator) {
      events.push(ev);
    }

    const failedEvent = events.find((e) => e.stage === 'source_connected' && e.status === 'failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.plain_message).toMatch(/security/i);

    // No subsequent stages should run
    expect(events.some((e) => e.stage === 'schema_read')).toBe(false);
    expect(events.some((e) => e.stage === 'tools_drafted')).toBe(false);
    expect(events.some((e) => e.stage === 'published')).toBe(false);
  });

  it('POST /api/builder/events streams SSE chunks over HTTP and terminates on failed source', async () => {
    const dummyConfig: ServerConfig = {
      name: 'test-server',
      version: '1.0.0',
      inbound_auth: { type: 'none', warning_accepted: true },
      tools: []
    };
    const runtime = new McpRuntimeServer(dummyConfig);
    const server = createMcpHttpServer(runtime);

    let port: number = 0;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/builder/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'HTTP Stream Bad Source',
          baseUrl: 'invalid-http-address',
          spec: validSpec
        })
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const text = await res.text();
      const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
      const parsedEvents: BuilderProgressEvent[] = lines.map((l) => JSON.parse(l.replace('data: ', '')));

      expect(parsedEvents.length).toBeGreaterThan(0);
      const lastEvent = parsedEvents[parsedEvents.length - 1];
      expect(lastEvent.stage).toBe('source_connected');
      expect(lastEvent.status).toBe('failed');

      // Verify no later stages exist in the stream
      expect(parsedEvents.some((e) => e.stage === 'schema_read')).toBe(false);
      expect(parsedEvents.some((e) => e.stage === 'published')).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
