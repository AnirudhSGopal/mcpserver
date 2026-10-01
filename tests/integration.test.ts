import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpRuntimeServer } from '../src/protocol/server.js';
import { ServerConfig } from '../src/schema.js';

describe('MCP Runtime Integration', () => {
  const testConfig: ServerConfig = {
    name: 'test-mcp-server',
    version: '1.0.0',
    inbound_auth: { type: 'none', warning_accepted: true },
    sources: [
      {
        type: 'openapi',
        id: 'json_source',
        base_url: 'https://jsonplaceholder.typicode.com',
        allowed_hosts: ['jsonplaceholder.typicode.com']
      }
    ],
    tools: [
      {
        name: 'get_demo_post',
        description: 'Get post 1 from JSONPlaceholder',
        enabled: true,
        mode: 'read',
        input_schema: {
          type: 'object',
          properties: {
            postId: {
              type: 'string',
              description: 'The post ID'
            }
          }
        },
        executor: {
          type: 'http',
          source_id: 'json_source',
          steps: [
            {
              method: 'GET',
              path: '/posts/{{input.postId}}',
              timeout_ms: 8000,
              response_shaping: {
                pick: ['id', 'title']
              }
            }
          ]
        }
      }
    ]
  };

  it('lists tools and executes tool via MCP SDK Client', async () => {
    const runtime = new McpRuntimeServer(testConfig);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await runtime.getServer().connect(serverTransport);

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );
    await client.connect(clientTransport);

    // 1. Test tools/list
    const toolsResult = await client.listTools();
    expect(toolsResult.tools).toHaveLength(1);
    expect(toolsResult.tools[0].name).toBe('get_demo_post');

    // 2. Test tools/call
    const callResult: any = await client.callTool({
      name: 'get_demo_post',
      arguments: { postId: '1' }
    });

    expect(callResult.isError).toBeFalsy();
    expect(callResult.content).toBeDefined();
    expect(callResult.content[0].type).toBe('text');

    const parsed = JSON.parse(callResult.content[0].text);
    expect(parsed.id).toBe(1);
    expect(parsed.title).toBeDefined();
    // Verify response shaping stripped other fields like body
    expect(parsed.body).toBeUndefined();

    await client.close();
  });
});
