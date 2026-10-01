import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerConfigSchema } from './schema.js';
import { McpRuntimeServer } from './protocol/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runDemo() {
  console.log('====================================================');
  console.log('🚀 MCPForge Runtime: Interactive Execution Demo');
  console.log('====================================================\n');

  const configPath = path.resolve(__dirname, '../examples/demo.config.json');
  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const config = ServerConfigSchema.parse(rawConfig);

  console.log(`[1] Loaded config: "${config.name}" v${config.version}`);
  console.log(`[2] Initializing MCP Server with ${config.tools.length} configured tools...`);

  const server = new McpRuntimeServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.getServer().connect(serverTransport);

  const client = new Client(
    { name: 'demo-client', version: '1.0.0' },
    { capabilities: {} }
  );
  await client.connect(clientTransport);
  console.log('✅ Connected to MCP Server via MCP protocol transport.\n');

  // List tools
  console.log('--- Step 1: Querying available tools (tools/list) ---');
  const tools = await client.listTools();
  for (const t of tools.tools) {
    console.log(`  • Tool: ${t.name}`);
    console.log(`    Description: ${t.description}`);
    console.log(`    Input Schema:`, JSON.stringify(t.inputSchema.properties));
  }
  console.log();

  // Call tool 1
  console.log('--- Step 2: Calling "get_post" with { postId: "1" } ---');
  const postResult: any = await client.callTool({
    name: 'get_post',
    arguments: { postId: '1' }
  });
  console.log('Result:');
  console.log(postResult.content[0].text);
  console.log();

  // Call tool 2
  console.log('--- Step 3: Calling "list_posts" with { userId: "1" } (Shaped with max_items=5) ---');
  const listResult: any = await client.callTool({
    name: 'list_posts',
    arguments: { userId: '1' }
  });
  console.log('Result:');
  console.log(listResult.content[0].text);
  console.log();

  await client.close();
  console.log('====================================================');
  console.log('🎉 Demo completed successfully!');
  console.log('====================================================');
}

runDemo().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
