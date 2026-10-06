#!/usr/bin/env node
/**
 * MCPForge Build Wizard
 * ─────────────────────
 * Interactive CLI that lets any user describe their API and auto-generates
 * a fully-working MCP server config using the Gemini API.
 *
 * Usage:
 *   npx tsx src/create-mcp.ts
 */

import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Terminal colours ────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  green: '\x1b[32m',
  cyan:  '\x1b[36m',
  yellow:'\x1b[33m',
  red:   '\x1b[31m',
  blue:  '\x1b[34m',
  magenta:'\x1b[35m',
};

function log(msg: string) { process.stdout.write(msg + '\n'); }
function ok(msg: string)  { log(`${C.green}✓${C.reset} ${msg}`); }
function info(msg: string){ log(`${C.cyan}ℹ${C.reset} ${msg}`); }
function warn(msg: string){ log(`${C.yellow}⚠${C.reset} ${msg}`); }
function err(msg: string) { log(`${C.red}✗${C.reset} ${msg}`); }
function step(n: number, total: number, msg: string) {
  log(`\n${C.bold}${C.blue}[${n}/${total}]${C.reset} ${C.bold}${msg}${C.reset}`);
}
function banner() {
  log(`\n${C.bold}${C.magenta}╔══════════════════════════════════════════════╗${C.reset}`);
  log(`${C.bold}${C.magenta}║   MCPForge — Build Your MCP Server Wizard    ║${C.reset}`);
  log(`${C.bold}${C.magenta}╚══════════════════════════════════════════════╝${C.reset}\n`);
  log(`${C.dim}Powered by Gemini AI  •  Takes about 2 minutes${C.reset}\n`);
}

// ─── Readline helper ─────────────────────────────────────────────────────────
function createRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(rl: readline.Interface, question: string, defaultVal = ''): Promise<string> {
  return new Promise((resolve) => {
    const hint = defaultVal ? ` ${C.dim}(default: ${defaultVal})${C.reset}` : '';
    rl.question(`${C.cyan}?${C.reset} ${question}${hint}: `, (ans) => {
      resolve(ans.trim() || defaultVal);
    });
  });
}

async function askSecret(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`${C.cyan}?${C.reset} ${question}: `);
    // Turn off echo for secret input
    if ((process.stdin as any).isTTY) {
      (process.stdin as any).setRawMode?.(true);
    }
    let input = '';
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const handler = (ch: string) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0003') {
        process.stdin.pause();
        process.stdin.removeListener('data', handler);
        if ((process.stdin as any).isTTY) (process.stdin as any).setRawMode?.(false);
        process.stdout.write('\n');
        resolve(input);
      } else if (ch === '\u007F') {
        input = input.slice(0, -1);
      } else {
        input += ch;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', handler);
  });
}

async function confirm(rl: readline.Interface, question: string): Promise<boolean> {
  const ans = await ask(rl, `${question} ${C.dim}(y/n)${C.reset}`, 'y');
  return ans.toLowerCase().startsWith('y');
}

// ─── Gemini API call ─────────────────────────────────────────────────────────
async function callGemini(apiKey: string, modelId: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const tokens = data.usageMetadata?.totalTokenCount || 0;
  info(`Gemini used ${C.bold}${tokens}${C.reset} tokens  •  model: ${C.bold}${modelId}${C.reset}`);
  return text;
}

// ─── Generate tools from plain English description (no OpenAPI needed) ───────
async function generateToolsFromDescription(params: {
  apiKey: string;
  modelId: string;
  serverName: string;
  baseUrl: string;
  description: string;
  authType: string;
}): Promise<any[]> {

  const systemPrompt = `You are an expert MCP (Model Context Protocol) server designer.
Given a plain English description of an API, generate a complete list of MCP tools.

RULES:
1. Return ONLY a valid JSON array of tools. No markdown, no explanation.
2. Each tool must have: name (snake_case), description, enabled (bool), mode ("read"|"write"), input_schema, executor
3. Write tools (POST/PUT/DELETE) must have "enabled": false by default
4. Read tools (GET) should have "enabled": true
5. Keep descriptions clear: when to use the tool AND when NOT to use it
6. Cap max_items at 20, max_bytes at 50000 in response_shaping
7. Generate 3-15 tools maximum
8. Tool names: verb_noun format e.g. list_customers, get_order, create_invoice

EXECUTOR FORMAT:
{
  "type": "http",
  "source_id": "main_api",
  "steps": [{
    "method": "GET|POST|PUT|DELETE",
    "path": "/your/path/{{input.param}}",
    "response_shaping": { "max_items": 20, "max_bytes": 50000 }
  }]
}

INPUT_SCHEMA FORMAT:
{
  "type": "object",
  "properties": {
    "param_name": { "type": "string", "description": "what this param does" }
  },
  "required": ["param_name"]
}`;

  const userPrompt = `API Name: ${params.serverName}
Base URL: ${params.baseUrl}
Auth Type: ${params.authType}

API Description:
${params.description}

Generate a JSON array of MCP tools for this API. Return ONLY the JSON array, nothing else.`;

  log(`\n${C.dim}🤖 Asking Gemini to design your tools...${C.reset}`);
  const raw = await callGemini(params.apiKey, params.modelId, `${systemPrompt}\n\n${userPrompt}`);

  // Extract JSON array from response
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Gemini did not return a valid JSON array. Raw response:\n${raw.slice(0, 500)}`);
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Failed to parse Gemini response as JSON: ${(e as Error).message}`);
  }
}

// ─── Generate config from scratch using Gemini ───────────────────────────────
async function generateFullConfig(params: {
  apiKey: string;
  modelId: string;
  serverName: string;
  baseUrl: string;
  description: string;
  authType: string;
  keyHeader?: string;
}): Promise<any> {

  const tools = await generateToolsFromDescription(params);
  ok(`Gemini designed ${C.bold}${tools.length}${C.reset} tools`);

  // Build the full server config
  const authConfig = params.authType === 'api_key'
    ? { type: 'api_key', key_header: params.keyHeader || 'X-API-Key' }
    : params.authType === 'oauth'
    ? { type: 'oauth', issuer: 'https://auth.example.com', client_id: 'mcp-client', scopes: [], allowed_callback_urls: [] }
    : { type: 'none', warning_accepted: true };

  return {
    name: params.serverName.toLowerCase().replace(/\s+/g, '-'),
    version: '1.0.0',
    description: params.description.slice(0, 120),
    inbound_auth: authConfig,
    sources: [
      {
        type: 'openapi',
        id: 'main_api',
        base_url: params.baseUrl,
        allowed_hosts: [new URL(params.baseUrl).hostname]
      }
    ],
    tools
  };
}

// ─── Write files ─────────────────────────────────────────────────────────────
function writeServerConfig(config: any, outputDir: string): string {
  const configPath = path.join(outputDir, `${config.name}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function writeEnvFile(apiKey: string, modelId: string, outputDir: string): string {
  const envPath = path.join(outputDir, '.env');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `GEMINI_API_KEY=${apiKey}\nMODEL_ID=${modelId}\n`);
  }
  return envPath;
}

function writeStartScript(config: any, outputDir: string): string {
  const scriptPath = path.join(outputDir, `start-${config.name}.ts`);
  const content = `/**
 * Auto-generated by MCPForge Build Wizard
 * Start your MCP server: npx tsx ${path.basename(scriptPath)}
 */
import { createMcpHttpServer } from './src/protocol/http-server.js';
import { McpRuntimeServer } from './src/protocol/server.js';
import { ServerConfigSchema } from './src/schema.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '${config.name}.config.json');
const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const config = ServerConfigSchema.parse(raw);

const PORT = Number(process.env.PORT) || 3000;
process.env.ALLOW_LOOPBACK_DEV = '1';

const runtime = new McpRuntimeServer(config);
const server = createMcpHttpServer(runtime);

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log(\`║  ✅ ${config.name.padEnd(42)}║\`);
  console.log(\`║  🌐 Studio UI:  http://127.0.0.1:\${PORT}/studio  ║\`);
  console.log(\`║  📡 MCP URL:    http://127.0.0.1:\${PORT}/mcp     ║\`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('Tools available:');
  config.tools.forEach(t => {
    const icon = t.enabled !== false ? '🟢' : '🔴';
    console.log(\`  \${icon} \${t.name} [\${t.mode}]\`);
  });
});
`;
  fs.writeFileSync(scriptPath, content);
  return scriptPath;
}

// ─── Main wizard ─────────────────────────────────────────────────────────────
async function main() {
  banner();

  const rl = createRl();
  const TOTAL_STEPS = 7;

  try {
    // ── STEP 1: Gemini API Key ───────────────────────────────────────────────
    step(1, TOTAL_STEPS, 'Gemini API Key');
    info(`Get a free key at: ${C.cyan}https://aistudio.google.com/app/apikey${C.reset}`);

    let geminiKey = process.env.GEMINI_API_KEY || '';
    if (!geminiKey) {
      geminiKey = await ask(rl, 'Enter your Gemini API key');
    } else {
      ok(`Using GEMINI_API_KEY from environment (${geminiKey.slice(0, 8)}...)`);
    }

    if (!geminiKey) {
      err('Gemini API key is required. Get one free at https://aistudio.google.com/app/apikey');
      process.exit(1);
    }

    const modelId = process.env.MODEL_ID || await ask(rl, 'Gemini model ID', 'gemini-2.5-flash');

    // Validate key with a quick ping
    log(`${C.dim}  Testing your Gemini API key...${C.reset}`);
    try {
      await callGemini(geminiKey, modelId, 'Reply with just the word: OK');
      ok('Gemini API key is valid!');
    } catch (e) {
      err(`API key test failed: ${(e as Error).message}`);
      process.exit(1);
    }

    // ── STEP 2: Server Name ──────────────────────────────────────────────────
    step(2, TOTAL_STEPS, 'Name Your MCP Server');
    info('This is how your server will appear to Claude / other AI clients.');
    const serverName = await ask(rl, 'Server name (e.g. "My CRM API", "Shopify Store")', 'my-mcp-server');

    // ── STEP 3: Your API Base URL ────────────────────────────────────────────
    step(3, TOTAL_STEPS, 'Your API Base URL');
    info('This is the root URL of the REST API you want to connect.');
    info(`Examples: ${C.dim}https://api.mycompany.com${C.reset}  or  ${C.dim}http://localhost:8080${C.reset}`);
    const baseUrl = await ask(rl, 'API base URL', 'https://api.example.com');

    // ── STEP 4: Auth Type ────────────────────────────────────────────────────
    step(4, TOTAL_STEPS, 'Authentication');
    log('How does your API authenticate requests?');
    log(`  ${C.bold}1${C.reset} API Key (e.g. X-API-Key header)    ${C.dim}← most common${C.reset}`);
    log(`  ${C.bold}2${C.reset} OAuth 2.0`);
    log(`  ${C.bold}3${C.reset} No auth (public API)`);

    const authChoice = await ask(rl, 'Choose (1/2/3)', '1');
    const authType = authChoice === '2' ? 'oauth' : authChoice === '3' ? 'none' : 'api_key';
    let keyHeader = 'X-API-Key';

    if (authType === 'api_key') {
      keyHeader = await ask(rl, 'API key header name', 'X-API-Key');
      ok(`Auth: API Key via "${keyHeader}" header`);
    } else if (authType === 'oauth') {
      ok('Auth: OAuth 2.0 (you can customize the issuer in the generated config)');
    } else {
      warn('Auth: None (public API — write tools will be blocked automatically)');
    }

    // ── STEP 5: Describe Your API ────────────────────────────────────────────
    step(5, TOTAL_STEPS, 'Describe Your API');
    log('Tell Gemini what your API does in plain English.');
    log(`${C.dim}The more detail you give, the better the tools Gemini will design.${C.reset}`);
    log(`\nExample description:\n${C.dim}  "A customer management API with endpoints to list customers, get customer`);
    log(`  details by ID, create new customers, update their contact info, and`);
    log(`  delete customers. Also supports searching customers by name or email."${C.reset}\n`);

    log(`Enter your description (press Enter twice when done):`);
    const lines: string[] = [];
    let emptyCount = 0;

    await new Promise<void>((resolve) => {
      rl.on('line', (line) => {
        if (line === '') {
          emptyCount++;
          if (emptyCount >= 2) {
            rl.removeAllListeners('line');
            resolve();
          }
        } else {
          emptyCount = 0;
          lines.push(line);
        }
      });
    });

    const description = lines.join('\n').trim();
    if (!description) {
      err('API description is required. Please run the wizard again.');
      process.exit(1);
    }

    ok(`Got it! (${description.split(' ').length} words)`);

    // ── STEP 6: Generate with Gemini ─────────────────────────────────────────
    step(6, TOTAL_STEPS, 'Gemini Designs Your MCP Tools');
    log(`${C.dim}Sending your description to Gemini AI to design the perfect MCP tools...${C.reset}\n`);

    let config: any;
    try {
      config = await generateFullConfig({
        apiKey: geminiKey,
        modelId,
        serverName,
        baseUrl,
        description,
        authType,
        keyHeader
      });
    } catch (e) {
      err(`Gemini design failed: ${(e as Error).message}`);
      process.exit(1);
    }

    // Show what was generated
    log(`\n${C.bold}${C.green}🎉 Gemini designed ${config.tools.length} tools for you:${C.reset}\n`);
    for (const tool of config.tools) {
      const icon = tool.enabled !== false ? `${C.green}🟢${C.reset}` : `${C.red}🔴${C.reset}`;
      const mode = tool.mode === 'write' ? `${C.yellow}[write]${C.reset}` : `${C.green}[read]${C.reset}`;
      log(`  ${icon} ${C.bold}${tool.name}${C.reset} ${mode}`);
      log(`     ${C.dim}${tool.description?.slice(0, 80)}...${C.reset}`);
    }

    log(`\n${C.dim}🔴 = write tool (disabled by default for safety)${C.reset}`);
    log(`${C.dim}🟢 = read tool (enabled)${C.reset}\n`);

    // ── STEP 7: Save Files ───────────────────────────────────────────────────
    step(7, TOTAL_STEPS, 'Save Your MCP Server Files');

    const outputDir = path.resolve(__dirname, '..');
    const configPath = writeServerConfig(config, outputDir);
    const startScript = writeStartScript(config, outputDir);
    writeEnvFile(geminiKey, modelId, outputDir);

    ok(`Config saved:  ${C.cyan}${path.basename(configPath)}${C.reset}`);
    ok(`Start script:  ${C.cyan}${path.basename(startScript)}${C.reset}`);
    ok(`.env updated`);

    // ── DONE ─────────────────────────────────────────────────────────────────
    log(`\n${C.bold}${C.magenta}╔══════════════════════════════════════════════════════════╗${C.reset}`);
    log(`${C.bold}${C.magenta}║  ✅  Your MCP Server is Ready!                          ║${C.reset}`);
    log(`${C.bold}${C.magenta}╚══════════════════════════════════════════════════════════╝${C.reset}\n`);

    log(`${C.bold}Next steps:${C.reset}\n`);
    log(`  1️⃣  ${C.bold}Start your server:${C.reset}`);
    log(`     ${C.cyan}npx tsx ${path.basename(startScript)}${C.reset}\n`);

    log(`  2️⃣  ${C.bold}Open the Studio UI in your browser:${C.reset}`);
    log(`     ${C.cyan}http://127.0.0.1:3000/studio${C.reset}\n`);

    log(`  3️⃣  ${C.bold}Connect to Claude Desktop — add this to your Claude config:${C.reset}`);
    log(`     ${C.dim}(${getClaudeConfigPath()})${C.reset}`);
    log(`     ${C.cyan}{`);
    log(`       "mcpServers": {`);
    log(`         "${config.name}": {`);
    log(`           "command": "npx",`);
    log(`           "args": ["tsx", "${path.resolve(outputDir, 'src/index.ts').replace(/\\/g, '/')}",`);
    log(`                    "${configPath.replace(/\\/g, '/')}"]`);
    log(`         }`);
    log(`       }`);
    log(`     }${C.reset}\n`);

    log(`  4️⃣  ${C.bold}Test your MCP endpoint:${C.reset}`);
    log(`     ${C.cyan}curl -X POST http://127.0.0.1:3000/mcp \\`);
    log(`       -H "Content-Type: application/json" \\`);
    log(`       -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'${C.reset}\n`);

    log(`  5️⃣  ${C.bold}Edit the generated config to fine-tune your tools:${C.reset}`);
    log(`     ${C.cyan}${configPath}${C.reset}\n`);

    log(`${C.dim}Tip: To enable write tools, set "enabled": true in the config${C.reset}`);
    log(`${C.dim}     (only do this after reviewing each tool carefully)${C.reset}\n`);

    rl.close();
    process.exit(0);

  } catch (e) {
    err(`Unexpected error: ${(e as Error).message}`);
    rl.close();
    process.exit(1);
  }
}

function getClaudeConfigPath(): string {
  if (process.platform === 'win32') {
    return '%APPDATA%\\Claude\\claude_desktop_config.json';
  } else if (process.platform === 'darwin') {
    return '~/Library/Application Support/Claude/claude_desktop_config.json';
  }
  return '~/.config/Claude/claude_desktop_config.json';
}

main();
