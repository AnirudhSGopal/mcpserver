import { describe, it, expect } from 'vitest';
import { ServerConfigSchema, HEADER_DENYLIST } from '../src/schema.js';
import { lintConfig } from '../src/lint.js';
import { resolveExpression, resolveUrlTemplate, ExpressionSecurityError } from '../src/expr.js';

describe('Config Schema & Security Checks (Module 1)', () => {
  it('validates a valid configuration matching all doc rules', () => {
    const validConfig = {
      name: 'doc-example-server',
      version: '1.0.0',
      inbound_auth: { type: 'api_key', key_header: 'X-API-Key' },
      sources: [
        {
          type: 'openapi',
          id: 'main_api',
          base_url: 'https://api.example.com',
          allowed_hosts: ['api.example.com']
        }
      ],
      tools: [
        {
          name: 'get_status',
          description: 'Get service status',
          enabled: true,
          mode: 'read',
          input_schema: { type: 'object', properties: {} },
          executor: {
            type: 'http',
            source_id: 'main_api',
            steps: [{ method: 'GET', path: '/status' }]
          }
        },
        {
          name: 'query_db',
          description: 'Run read-only SQL query against database',
          enabled: true,
          mode: 'read',
          annotations: { readOnlyHint: true }, // F2: SQL tool annotations
          input_schema: { type: 'object', properties: {} },
          executor: {
            type: 'sql',
            source_id: 'main_api',
            query: 'SELECT id, name FROM items WHERE active = $1 LIMIT 50'
          }
        }
      ]
    };

    expect(() => ServerConfigSchema.parse(validConfig)).not.toThrow();
  });

  // F3: Rejects unknown auth type, missing base_url, bad headers, non-existent source_id
  it('F3: rejects configs referencing non-existent source_id', () => {
    const invalidConfig = {
      name: 'broken-server',
      tools: [
        {
          name: 'bad_tool',
          description: 'References non-existent source',
          enabled: true,
          mode: 'read',
          input_schema: { type: 'object', properties: {} },
          executor: {
            type: 'http',
            source_id: 'missing_source_id',
            steps: [{ method: 'GET', path: '/data' }]
          }
        }
      ]
    };
    expect(() => ServerConfigSchema.parse(invalidConfig)).toThrow();
  });

  it('F3: rejects forbidden headers from denylist in step headers', () => {
    const configWithBadHeader = {
      name: 'bad-header-server',
      sources: [{ type: 'openapi', id: 's1', base_url: 'https://api.com', allowed_hosts: ['api.com'] }],
      tools: [
        {
          name: 'tool_one',
          description: 'Tries to override authorization header directly',
          input_schema: { type: 'object', properties: {} },
          executor: {
            type: 'http',
            source_id: 's1',
            steps: [
              {
                method: 'GET',
                path: '/test',
                headers: { 'Authorization': 'Bearer bad' }
              }
            ]
          }
        }
      ]
    };
    expect(() => ServerConfigSchema.parse(configWithBadHeader)).toThrow(/reserved headers/);
  });

  // Expression resolver security: prototype pollution
  it('expression resolver rejects __proto__ and constructor access', () => {
    const context = { input: { test: 1 } };
    expect(() => resolveExpression('{{input.__proto__.polluted}}', context)).toThrow(ExpressionSecurityError);
    expect(() => resolveExpression('{{input.constructor.name}}', context)).toThrow(ExpressionSecurityError);
  });

  // Lint rules test: pass and fail
  it('lintConfig flags list tools without pagination (F10)', () => {
    const unpaginated = {
      name: 'test-server',
      tools: [
        {
          name: 'list_customers',
          description: 'Lists all customers without pagination',
          enabled: true,
          mode: 'read' as const,
          input_schema: { type: 'object' as const, properties: {} },
          executor: { type: 'http' as const, source_id: 's1', steps: [] }
        }
      ]
    };
    const issues = lintConfig(unpaginated as any);
    expect(issues.some((i) => i.message.includes('pagination'))).toBe(true);

    // With pagination
    const paginated = {
      ...unpaginated,
      tools: [
        {
          ...unpaginated.tools[0],
          pagination: { limit_param: 'limit', cursor_param: 'cursor' }
        }
      ]
    };
    const cleanIssues = lintConfig(paginated as any);
    expect(cleanIssues.some((i) => i.message.includes('pagination'))).toBe(false);
  });
});
