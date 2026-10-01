import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerConfigSchema } from './schema.js';
import { McpRuntimeServer } from './protocol/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const configPath = process.argv[2] 
    ? path.resolve(process.cwd(), process.argv[2])
    : path.resolve(__dirname, '../examples/demo.config.json');

  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const parseResult = ServerConfigSchema.safeParse(rawConfig);

  if (!parseResult.success) {
    console.error('Invalid Server Config:');
    console.error(JSON.stringify(parseResult.error.format(), null, 2));
    process.exit(1);
  }

  const config = parseResult.data;
  console.error(`Starting MCP Server '${config.name}' from ${path.basename(configPath)}...`);
  console.error(`Loaded ${config.tools.length} tool(s): ${config.tools.map(t => t.name).join(', ')}`);

  const server = new McpRuntimeServer(config);
  await server.startStdio();
}

main().catch((err) => {
  console.error('Fatal runtime error:', err);
  process.exit(1);
});
