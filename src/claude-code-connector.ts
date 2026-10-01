import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpRuntimeServer } from './protocol/server.js';
import { ServerConfig } from './schema.js';
import { Vault } from './vault.js';

export async function runClaudeCodeSession(): Promise<string[]> {
  const transcript: string[] = [];

  const config: ServerConfig = {
    name: 'invoiceapp-mcp',
    version: '1.0.0',
    inbound_auth: {
      type: 'api_key',
      key_header: 'X-API-Key'
    },
    sources: [
      {
        type: 'openapi',
        id: 'invoice_source',
        base_url: 'https://jsonplaceholder.typicode.com',
        allowed_hosts: ['jsonplaceholder.typicode.com']
      }
    ],
    tools: [
      {
        name: 'list_invoices',
        description: 'List recent customer invoices with pagination and summary shaping',
        enabled: true,
        mode: 'read',
        pagination: { limit_param: 'limit' },
        input_schema: {
          type: 'object',
          properties: {
            limit: { type: 'string', description: 'Maximum invoices to return' }
          }
        },
        executor: {
          type: 'http',
          source_id: 'invoice_source',
          steps: [
            {
              method: 'GET',
              path: '/posts',
              query: { _limit: '{{input.limit}}' },
              timeout_ms: 5000,
              response_shaping: {
                pick: ['id', 'title'],
                max_items: 2
              }
            }
          ]
        }
      },
      {
        name: 'get_invoice',
        description: 'Get single invoice by invoice ID',
        enabled: true,
        mode: 'read',
        input_schema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Invoice ID' }
          },
          required: ['id']
        },
        executor: {
          type: 'http',
          source_id: 'invoice_source',
          steps: [
            {
              method: 'GET',
              path: '/posts/{{input.id}}',
              timeout_ms: 5000,
              response_shaping: {
                pick: ['id', 'title']
              }
            }
          ]
        }
      }
    ]
  };

  const vault = new Vault();
  const runtime = new McpRuntimeServer(config, vault);
  const API_KEY = 'mcp_live_claude_connector_key_8888';
  runtime.registerApiKey(API_KEY, 'tenant-acme');

  // Verify inbound authentication via X-API-Key header
  const auth = runtime.authenticateInbound({ 'x-api-key': API_KEY });
  transcript.push(`[INBOUND AUTH] Header verified. Authenticated tenant: ${auth.tenantId}`);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await runtime.getServer().connect(serverTransport);

  const client = new Client(
    { name: 'claude-code-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(clientTransport);
  transcript.push(`[CLIENT] Connected to MCP runtime server '${config.name}' v${config.version}`);

  // 1. List tools
  const listToolsRes = await client.listTools();
  transcript.push(`--> {"jsonrpc":"2.0","id":1,"method":"tools/list"}`);
  transcript.push(`<-- {"jsonrpc":"2.0","id":1,"result":{"tools":[${listToolsRes.tools.map(t => `{"name":"${t.name}"}`).join(',')}]}}`);

  // 2. Call list_invoices
  transcript.push(`--> {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_invoices","arguments":{"limit":"2"}}}`);
  const call1: any = await client.callTool({
    name: 'list_invoices',
    arguments: { limit: '2' }
  });
  transcript.push(`<-- {"jsonrpc":"2.0","id":2,"result":${JSON.stringify(call1)}}`);

  // 3. Call get_invoice
  transcript.push(`--> {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_invoice","arguments":{"id":"1"}}}`);
  const call2: any = await client.callTool({
    name: 'get_invoice',
    arguments: { id: '1' }
  });
  transcript.push(`<-- {"jsonrpc":"2.0","id":3,"result":${JSON.stringify(call2)}}`);

  await client.close();
  return transcript;
}

if (process.argv[1]?.includes('claude-code-connector')) {
  runClaudeCodeSession().then(lines => {
    lines.forEach(l => console.log(l));
  });
}
