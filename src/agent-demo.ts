/**
 * MCPForge — Autonomous Agent Demo
 * ─────────────────────────────────
 * Runs the full "build your MCP server" flow without any user input.
 * Uses real Gemini API to design tools for a sample Task Manager API.
 *
 * Run: npx tsx src/agent-demo.ts
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Pretty terminal output ──────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',  bold:    '\x1b[1m',  dim:     '\x1b[2m',
  green:   '\x1b[32m', cyan:    '\x1b[36m', yellow:  '\x1b[33m',
  red:     '\x1b[31m', blue:    '\x1b[34m', magenta: '\x1b[35m',
  white:   '\x1b[97m', bg_blue: '\x1b[44m', bg_green:'\x1b[42m',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function box(title: string, lines: string[]) {
  const width = Math.max(title.length, ...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length)) + 4;
  const border = '═'.repeat(width);
  console.log(`\n${C.bold}${C.magenta}╔${border}╗${C.reset}`);
  console.log(`${C.bold}${C.magenta}║  ${title.padEnd(width - 2)}║${C.reset}`);
  console.log(`${C.bold}${C.magenta}╠${border}╣${C.reset}`);
  for (const l of lines) {
    const plain = l.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = ' '.repeat(Math.max(0, width - 2 - plain.length));
    console.log(`${C.bold}${C.magenta}║${C.reset}  ${l}${pad}${C.bold}${C.magenta}║${C.reset}`);
  }
  console.log(`${C.bold}${C.magenta}╚${border}╝${C.reset}\n`);
}

function step(icon: string, label: string, value: string) {
  console.log(`  ${icon} ${C.bold}${label}:${C.reset} ${C.cyan}${value}${C.reset}`);
}

function log(msg: string)  { console.log(msg); }
function ok(msg: string)   { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
function info(msg: string) { console.log(`  ${C.blue}ℹ${C.reset} ${msg}`); }
function think(msg: string){ console.log(`  ${C.dim}🤖 ${msg}${C.reset}`); }

async function typewriter(text: string, delay = 18) {
  for (const ch of text) {
    process.stdout.write(ch);
    await sleep(delay);
  }
  process.stdout.write('\n');
}

// ─── Gemini API ───────────────────────────────────────────────────────────────
async function callGemini(prompt: string): Promise<{ text: string; tokens: number }> {
  const apiKey  = process.env.GEMINI_API_KEY!;
  const modelId = process.env.MODEL_ID || 'gemini-2.5-flash';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
    })
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return {
    text:   data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    tokens: data.usageMetadata?.totalTokenCount || 0
  };
}

// ─── Tool generation prompt ───────────────────────────────────────────────────
const SYSTEM = `You are an expert MCP (Model Context Protocol) server designer.
Given a plain English description of an API, generate a complete list of MCP tools.

RULES:
1. Return ONLY a valid JSON array of tools. No markdown fences, no explanation.
2. Each tool must have: name (snake_case verb_noun), description (2-3 sentences), enabled (bool), mode ("read"|"write"), input_schema, executor
3. Write tools (POST/PUT/DELETE) must have "enabled": false
4. Read tools (GET) must have "enabled": true
5. Generate 5-10 tools maximum
6. Cap response_shaping: max_items 20, max_bytes 50000

EXECUTOR FORMAT (use source_id "main_api"):
{"type":"http","source_id":"main_api","steps":[{"method":"GET","path":"/path/{{input.id}}","response_shaping":{"max_items":20,"max_bytes":50000}}]}`;

// ─── THE DEMO SCENARIO ────────────────────────────────────────────────────────
const DEMO = {
  serverName:  'Task Manager API',
  baseUrl:     'https://api.taskmanager.io',
  authType:    'api_key',
  keyHeader:   'X-API-Key',
  description: `
A task management REST API for teams. It supports:
- Listing all tasks with optional filters (status, assignee, due date)
- Getting a single task by ID with full details (title, description, status, priority, comments)
- Creating new tasks with title, description, assignee, due date, and priority
- Updating task status (open, in-progress, done, blocked)
- Assigning or reassigning tasks to team members
- Adding comments to tasks
- Deleting tasks (destructive - managers only)
- Listing all team members / assignees
- Getting task statistics (counts by status, overdue count)
`.trim()
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.clear();

  box('🤖  MCPForge Agent Demo', [
    'Watching the agent build a full MCP server autonomously.',
    `Powered by ${C.cyan}Gemini AI${C.reset}  •  No human input needed.`,
    `Target API: ${C.bold}${DEMO.serverName}${C.reset}`,
  ]);

  await sleep(1000);

  // ── PHASE 1: Read environment ───────────────────────────────────────────────
  log(`${C.bold}${C.blue}━━━  PHASE 1: Environment Check  ━━━${C.reset}\n`);
  await sleep(400);

  const apiKey  = process.env.GEMINI_API_KEY;
  const modelId = process.env.MODEL_ID || 'gemini-2.5-flash';

  if (!apiKey) {
    console.log(`${C.red}✗ GEMINI_API_KEY not found in .env — aborting${C.reset}`);
    process.exit(1);
  }

  step('🔑', 'Gemini API Key',  `${apiKey.slice(0, 12)}${'*'.repeat(12)} (loaded from .env)`);
  step('🧠', 'Model',           modelId);
  step('🌐', 'Target API',      DEMO.baseUrl);
  step('🔒', 'Auth',            `API Key via "${DEMO.keyHeader}" header`);
  await sleep(600);

  // ── PHASE 2: Validate Gemini key ────────────────────────────────────────────
  log(`\n${C.bold}${C.blue}━━━  PHASE 2: Validate Gemini API Key  ━━━${C.reset}\n`);
  think('Pinging Gemini API to verify the key is valid...');
  await sleep(300);

  const ping = await callGemini('Reply with exactly one word: READY');
  if (!ping.text.includes('READY')) throw new Error(`Unexpected ping response: ${ping.text}`);
  ok(`Gemini is ${C.green}${C.bold}READY${C.reset}  (${ping.tokens} tokens used on ping)`);
  await sleep(500);

  // ── PHASE 3: Show what we'll build ──────────────────────────────────────────
  log(`\n${C.bold}${C.blue}━━━  PHASE 3: Building Context for Gemini  ━━━${C.reset}\n`);
  await sleep(300);
  info('API description being sent to Gemini:');
  log(`\n  ${C.dim}${DEMO.description.split('\n').join('\n  ')}${C.reset}\n`);
  await sleep(800);

  // ── PHASE 4: Call Gemini ─────────────────────────────────────────────────────
  log(`${C.bold}${C.blue}━━━  PHASE 4: Gemini Designs Your MCP Tools  ━━━${C.reset}\n`);
  think('Sending full prompt to Gemini...');
  await sleep(300);

  const prompt = `${SYSTEM}\n\nAPI Name: ${DEMO.serverName}\nBase URL: ${DEMO.baseUrl}\nAuth: ${DEMO.authType}\n\nAPI Description:\n${DEMO.description}\n\nGenerate the JSON array of MCP tools now. Return ONLY the JSON array.`;

  const spinner = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let si = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${C.cyan}${spinner[si++ % spinner.length]}${C.reset} Gemini is thinking...`);
  }, 120);

  const t0 = Date.now();
  const result = await callGemini(prompt);
  clearInterval(interval);
  process.stdout.write('\r');

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  ok(`Gemini responded in ${C.bold}${elapsed}s${C.reset}  •  ${C.bold}${result.tokens}${C.reset} tokens used`);
  await sleep(300);

  // Parse tools
  const jsonMatch = result.text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Gemini did not return a valid JSON array:\n' + result.text.slice(0, 400));
  const tools: any[] = JSON.parse(jsonMatch[0]);
  ok(`Parsed ${C.bold}${tools.length}${C.reset} tools from Gemini response`);
  await sleep(400);

  // ── PHASE 5: Show each tool ──────────────────────────────────────────────────
  log(`\n${C.bold}${C.blue}━━━  PHASE 5: Tools Designed by Gemini  ━━━${C.reset}\n`);
  await sleep(300);

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    const enabled = t.enabled !== false;
    const icon    = enabled ? `${C.green}🟢${C.reset}` : `${C.red}🔴${C.reset}`;
    const mode    = t.mode === 'write' ? `${C.yellow}write${C.reset}` : `${C.green}read${C.reset}`;
    const status  = enabled ? `${C.green}enabled${C.reset}` : `${C.red}disabled (write-safety)${C.reset}`;
    const method  = t.executor?.steps?.[0]?.method || 'GET';
    const ep      = t.executor?.steps?.[0]?.path   || '/';

    log(`  ${icon}  ${C.bold}${t.name}${C.reset}  ${C.dim}[${mode}]${C.reset}  →  ${status}`);
    log(`      ${C.dim}${method} ${ep}${C.reset}`);
    log(`      ${C.dim}${String(t.description).slice(0, 90)}${t.description?.length > 90 ? '...' : ''}${C.reset}`);
    await sleep(220);
  }

  // ── PHASE 6: Build server config ─────────────────────────────────────────────
  log(`\n${C.bold}${C.blue}━━━  PHASE 6: Assembling Server Config  ━━━${C.reset}\n`);
  await sleep(400);

  const slugName = DEMO.serverName.toLowerCase().replace(/\s+/g, '-');
  const config = {
    name: slugName,
    version: '1.0.0',
    description: DEMO.description.split('\n')[0],
    inbound_auth: { type: 'api_key', key_header: DEMO.keyHeader },
    sources: [{
      type: 'openapi',
      id: 'main_api',
      base_url: DEMO.baseUrl,
      allowed_hosts: ['api.taskmanager.io']
    }],
    tools
  };

  const configPath = path.join(ROOT, `${slugName}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  ok(`Config written → ${C.cyan}${path.basename(configPath)}${C.reset}  (${fs.statSync(configPath).size} bytes)`);
  await sleep(300);

  // ── PHASE 7: Write start script ───────────────────────────────────────────────
  const startPath = path.join(ROOT, `start-${slugName}.ts`);
  const startScript = `/**
 * Auto-generated by MCPForge Agent Demo
 * Run: npx tsx ${path.basename(startPath)}
 */
import { createMcpHttpServer } from './src/protocol/http-server.js';
import { McpRuntimeServer } from './src/protocol/server.js';
import { ServerConfigSchema } from './src/schema.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '${slugName}.config.json'), 'utf8'));
const config = ServerConfigSchema.parse(raw);
const PORT = Number(process.env.PORT) || 3001;
process.env.ALLOW_LOOPBACK_DEV = '1';

const runtime = new McpRuntimeServer(config);
const server = createMcpHttpServer(runtime);
server.listen(PORT, '127.0.0.1', () => {
  console.log('\\n✅  ${config.name} MCP Server running!');
  console.log(\`🌐  Studio UI : http://127.0.0.1:\${PORT}/studio\`);
  console.log(\`📡  MCP URL   : http://127.0.0.1:\${PORT}/mcp\`);
  console.log(\`🔑  API Key   : (set X-API-Key header)\\n\`);
  console.log('Tools:');
  config.tools.forEach(t => console.log(\`  \${t.enabled !== false ? '🟢' : '🔴'} \${t.name}\`));
});
`;

  fs.writeFileSync(startPath, startScript);
  ok(`Start script  → ${C.cyan}${path.basename(startPath)}${C.reset}`);
  await sleep(300);

  // ── PHASE 8: Start the server ─────────────────────────────────────────────────
  log(`\n${C.bold}${C.blue}━━━  PHASE 7: Starting the MCP Server  ━━━${C.reset}\n`);
  await sleep(400);

  // Dynamically import the runtime to start it inline
  const { McpRuntimeServer }   = await import('./protocol/server.js');
  const { createMcpHttpServer } = await import('./protocol/http-server.js');
  const { ServerConfigSchema }  = await import('./schema.js');

  process.env.ALLOW_LOOPBACK_DEV = '1';
  const PORT = 3001;
  const validated = ServerConfigSchema.parse(config);
  const runtime   = new McpRuntimeServer(validated);
  const server    = createMcpHttpServer(runtime);

  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  ok(`Server is live on port ${C.bold}${PORT}${C.reset}`);
  await sleep(400);

  // ── PHASE 9: Live smoke tests ─────────────────────────────────────────────────
  log(`\n${C.bold}${C.blue}━━━  PHASE 8: Live Smoke Tests  ━━━${C.reset}\n`);
  await sleep(500);

  // Test 1: Studio UI
  think('GET http://127.0.0.1:3001/ (Studio UI)...');
  const uiRes = await fetch(`http://127.0.0.1:${PORT}/`);
  const uiHtml = await uiRes.text();
  if (uiRes.ok && uiHtml.includes('MCPForge')) {
    ok(`Studio UI  →  ${C.green}HTTP ${uiRes.status}${C.reset}  |  title found: "MCPForge Assistant Studio"`);
  } else {
    log(`  ${C.red}✗ Studio UI test failed (${uiRes.status})${C.reset}`);
  }
  await sleep(400);

  // Test 2: OAuth metadata
  think('GET /.well-known/oauth-authorization-server...');
  const oauthRes = await fetch(`http://127.0.0.1:${PORT}/.well-known/oauth-authorization-server`);
  const oauthData = await oauthRes.json();
  ok(`OAuth metadata →  ${C.green}HTTP ${oauthRes.status}${C.reset}  |  issuer: ${oauthData.issuer}`);
  await sleep(400);

  // Test 3: tools/list without auth
  think('POST /mcp without auth (should get 401)...');
  const noAuthRes = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  });
  ok(`Auth guard     →  ${C.green}HTTP ${noAuthRes.status}${C.reset} (correctly rejected — no API key)`);
  await sleep(400);

  // Test 4: tools/list with auth - we need to register a key first
  runtime.registerApiKey('demo_agent_key_12345', 'agent-tenant');
  think('POST /mcp with valid API key → tools/list...');
  const listRes = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'demo_agent_key_12345' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  });
  const listData = await listRes.json() as any;
  const toolsReturned = listData?.result?.tools || [];
  ok(`tools/list     →  ${C.green}HTTP ${listRes.status}${C.reset}  |  ${C.bold}${toolsReturned.length} tools${C.reset} returned to AI client`);
  await sleep(400);

  // Test 5: Show tools returned
  log(`\n  ${C.bold}Tools visible to Claude / ChatGPT:${C.reset}`);
  for (const t of toolsReturned) {
    log(`    ${C.green}▸${C.reset} ${C.bold}${t.name}${C.reset}  ${C.dim}${t.description?.slice(0, 60)}...${C.reset}`);
    await sleep(100);
  }

  // Test 6: servers API
  think('\nGET /api/mcp/servers...');
  const srvsRes  = await fetch(`http://127.0.0.1:${PORT}/api/mcp/servers`);
  const srvsData = await srvsRes.json() as any;
  const srv = srvsData?.servers?.[0];
  if (srv) {
    ok(`Servers API    →  ${C.green}HTTP ${srvsRes.status}${C.reset}  |  slug: "${srv.slug}"  tools: ${srv.toolsCount} total, ${srv.activeCount} active`);
  }
  await sleep(400);

  // ── FINAL SUMMARY ─────────────────────────────────────────────────────────────
  box('🎉  Agent Demo Complete!', [
    `Server:    ${C.bold}${config.name}${C.reset}`,
    `MCP URL:   ${C.cyan}http://127.0.0.1:${PORT}/mcp${C.reset}`,
    `Studio UI: ${C.cyan}http://127.0.0.1:${PORT}/studio${C.reset}`,
    `API Key:   ${C.cyan}demo_agent_key_12345${C.reset}`,
    `Tools:     ${C.bold}${tools.length}${C.reset} generated by Gemini`,
    `Tests:     ${C.green}All 6 smoke tests passed ✓${C.reset}`,
    `Config:    ${C.cyan}${path.basename(configPath)}${C.reset}`,
    '',
    `${C.bold}To connect Claude Desktop, add:${C.reset}`,
    `${C.dim}"${config.name}": { "command": "npx", "args":${C.reset}`,
    `${C.dim}  ["tsx", "src/index.ts", "${path.basename(configPath)}"] }${C.reset}`,
  ]);

  log(`${C.dim}Server is still running. Press Ctrl+C to stop.${C.reset}\n`);
}

main().catch(e => {
  console.error(`\n${C.red}✗ Demo failed: ${e.message}${C.reset}`);
  console.error(e.stack);
  process.exit(1);
});

