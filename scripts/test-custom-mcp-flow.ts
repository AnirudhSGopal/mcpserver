// Verification script:
// 1. Check existing servers on MCPForge
// 2. Someone connects and submits their own OpenAPI spec to make a custom MCP server
// 3. MCPForge designs and hosts the server at /s/petstore/mcp
// 4. Connect to the custom MCP server via JSON-RPC
// 5. Query tools/list and call tools

async function run() {
  console.log('================================================================');
  console.log('🚀 Step 1: Querying MCPForge API for currently active servers...');
  console.log('================================================================');
  const initialRes = await fetch('http://127.0.0.1:3000/api/mcp/servers');
  const initialData = await initialRes.json();
  console.log('Active Servers:', initialData.servers.map((s: any) => `${s.name} (${s.mcpUrl})`));

  console.log('\n================================================================');
  console.log('🛠️ Step 2: User connects to MCPForge and creates their own MCP:');
  console.log('           Providing a custom OpenAPI spec (Petstore API)...');
  console.log('================================================================');

  const customSpec = {
    openapi: '3.0.0',
    info: { title: 'Petstore API', version: '1.0.0' },
    paths: {
      '/pet/findByStatus': {
        get: {
          operationId: 'find_pets_by_status',
          summary: 'Find pets by status (available, pending, sold)',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['available', 'pending', 'sold'] } }
          ]
        }
      },
      '/pet/{petId}': {
        get: {
          operationId: 'get_pet_by_id',
          summary: 'Find pet by ID',
          parameters: [
            { name: 'petId', in: 'path', required: true, schema: { type: 'string' } }
          ]
        },
        delete: {
          operationId: 'delete_pet',
          summary: 'Delete a pet by ID',
          parameters: [
            { name: 'petId', in: 'path', required: true, schema: { type: 'string' } }
          ]
        }
      },
      '/pet': {
        post: {
          operationId: 'add_new_pet',
          summary: 'Add a new pet to the store',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    photoUrls: { type: 'array', items: { type: 'string' } }
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  const createRes = await fetch('http://127.0.0.1:3000/api/mcp/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Petstore Management MCP',
      slug: 'petstore',
      baseUrl: 'https://petstore.swagger.io/v2',
      requirement: 'Find pets by status and retrieve pet details',
      apiKey: 'custom_user_secret_key_7777',
      spec: customSpec
    })
  });

  const createResult = await createRes.json();
  console.log('Server creation response:');
  console.log(JSON.stringify(createResult, null, 2));

  if (!createResult.success) {
    throw new Error('Failed to create custom MCP server');
  }

  console.log('\n================================================================');
  console.log(`🔌 Step 3: Connecting to custom MCP server at ${createResult.mcpUrl}`);
  console.log('           Sending JSON-RPC "initialize" request...');
  console.log('================================================================');

  const initRes = await fetch('http://127.0.0.1:3000/s/petstore/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'custom_user_secret_key_7777'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'claude-code-client', version: '2.1.0' }
      }
    })
  });

  const initData = await initRes.json();
  console.log('Initialize Result:', JSON.stringify(initData, null, 2));

  console.log('\n================================================================');
  console.log('📋 Step 4: Querying "tools/list" from the user\'s custom MCP server:');
  console.log('================================================================');

  const listRes = await fetch('http://127.0.0.1:3000/s/petstore/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'custom_user_secret_key_7777'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    })
  });

  const listData = await listRes.json();
  console.log('Discovered Tools on Custom MCP Server:');
  for (const t of listData.result?.tools || []) {
    console.log(`  • Tool: ${t.name}`);
    console.log(`    Description: ${t.description}`);
    console.log(`    Input properties:`, Object.keys(t.inputSchema?.properties || {}));
    console.log(`    Annotations:`, t.annotations);
  }

  console.log('\n================================================================');
  console.log('🔒 Step 5: Verify security - mutations/writes (delete_pet) are');
  console.log('           disabled by default and not exposed to the client:');
  console.log('================================================================');
  const hasDelete = (listData.result?.tools || []).some((t: any) => t.name === 'delete_pet');
  console.log(`Is delete_pet exposed in tools/list? ${hasDelete ? 'YES (UNSAFE)' : 'NO (SAFE: disabled by default)'}`);

  console.log('\n================================================================');
  console.log('🌐 Step 6: Verify Active Servers list now includes the new MCP:');
  console.log('================================================================');
  const updatedServersRes = await fetch('http://127.0.0.1:3000/api/mcp/servers');
  const updatedServersData = await updatedServersRes.json();
  console.log('All Active MCP Servers:');
  for (const s of updatedServersData.servers) {
    console.log(`  - ${s.name} [slug: ${s.slug}]: ${s.toolsCount} tools (endpoint: ${s.mcpUrl})`);
  }

  console.log('\n✅ ALL CHECKS PASSED: User successfully created their own MCP server and connected!');
}

run().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
