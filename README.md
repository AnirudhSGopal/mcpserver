# MCPForge — Build Your Own MCP Server

> A config-driven, no-code platform for spinning up safe, tested MCP servers in minutes.  
> Connect any REST API or database → AI proposes tools → you review → publish.

---

## What Is This?

**MCP (Model Context Protocol)** is the open standard that lets AI assistants like Claude and ChatGPT call your company's tools and data. MCPForge gives you a ready-made MCP server — no raw protocol code needed.

You write a JSON config describing what your API can do. MCPForge handles:
- Auth (API keys, OAuth)
- SSRF protection & security
- Tool validation and rate-limiting
- A visual Builder Assistant Studio UI
- One-command deployment

---

## Quick Start (5 Minutes)

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18 or higher | https://nodejs.org |
| npm | comes with Node | — |
| Git | any | https://git-scm.com |

### 1 — Clone & Install

```bash
git clone https://github.com/AnirudhSGopal/mcpserver.git
cd mcpserver
npm install
```

### 2 — Set Up Environment

Create a `.env` file in the project root:

```bash
# .env
GEMINI_API_KEY=your_gemini_api_key_here
MODEL_ID=gemini-2.5-flash
```

> Get a free Gemini API key at https://aistudio.google.com/app/apikey

### 3 — Run the Server

```bash
npx tsx src/serve-invoiceapp.ts
```

You should see:
```
InvoiceApp MCP Server listening at http://127.0.0.1:3000/mcp
```

### 4 — Open the Studio UI

Visit **http://127.0.0.1:3000** in your browser.

You'll see the **MCPForge Assistant Studio** — a visual dashboard with:
- 🗺️ A live route map of your build milestones
- 💬 A Builder Assistant chat panel
- 📡 An engine log stream

---

## Project Structure

```
mcpserver/
├── src/
│   ├── protocol/
│   │   ├── http-server.ts       ← Main HTTP server (all routes live here)
│   │   ├── server.ts            ← MCP SDK wrapper (tools/list, tools/call)
│   │   └── studio.html          ← Frontend UI (served by the backend)
│   ├── builder/
│   │   ├── assistant.ts         ← Builder Assistant chat logic + security
│   │   ├── milestones.ts        ← Build milestone tracker
│   │   └── progress-pipeline.ts ← AI-driven build progress pipeline
│   ├── designer/
│   │   ├── designer.ts          ← AI tool designer (reads OpenAPI → suggests tools)
│   │   ├── llm.ts               ← LLM wrapper (Gemini/OpenAI, retries, tokens)
│   │   ├── prompts.ts           ← System prompts for the AI designer
│   │   └── templates.ts         ← Config templates
│   ├── evals/
│   │   └── eval-engine.ts       ← Automated eval engine for tool quality scoring
│   ├── storage/
│   │   ├── version-manager.ts   ← Config versioning + rollback
│   │   └── postgres-storage.ts  ← PostgreSQL persistence (optional)
│   ├── schema.ts                ← Zod schema — the heart of the config format
│   ├── lint.ts                  ← Config lint rules (catches common mistakes)
│   ├── ssrf-guard.ts            ← Blocks SSRF attacks (private IP ranges, etc.)
│   ├── vault.ts                 ← Secret storage + envelope encryption
│   ├── http-executor.ts         ← Executes HTTP tool calls against upstream APIs
│   ├── expr.ts                  ← Safe expression evaluator for path templates
│   ├── shaper.ts                ← Response shaping (pick fields, cap size)
│   ├── serve-invoiceapp.ts      ← Demo server entry point (InvoiceApp fixture)
│   └── index.ts                 ← Main entry point (loads JSON config file)
├── tests/                       ← Unit tests (Vitest)
├── benchmarks/e2e/              ← End-to-end acceptance tests
├── examples/
│   └── demo.config.json         ← Example server config you can copy
├── docker/
│   └── init.sql                 ← PostgreSQL schema (for storage layer)
├── docker-compose.yml           ← Spin up Postgres with one command
├── package.json
├── tsconfig.json
└── .env                         ← Your secrets (never committed)
```

---

## How to Build Your Own MCP Server

### Step 1 — Understand the Config Format

Everything is driven by a JSON config. Here's the minimal shape:

```json
{
  "name": "my-api-server",
  "version": "1.0.0",
  "inbound_auth": {
    "type": "api_key",
    "key_header": "X-API-Key"
  },
  "sources": [
    {
      "type": "openapi",
      "id": "my_api",
      "base_url": "https://api.mycompany.com",
      "allowed_hosts": ["api.mycompany.com"]
    }
  ],
  "tools": [
    {
      "name": "list_customers",
      "description": "List all customers from the CRM.",
      "enabled": true,
      "mode": "read",
      "input_schema": {
        "type": "object",
        "properties": {
          "limit": { "type": "string", "description": "Max results" }
        }
      },
      "executor": {
        "type": "http",
        "source_id": "my_api",
        "steps": [
          {
            "method": "GET",
            "path": "/customers",
            "response_shaping": {
              "pick": ["id", "name", "email"],
              "max_items": 50
            }
          }
        ]
      }
    }
  ]
}
```

### Step 2 — Copy the Example Config

```bash
cp examples/demo.config.json my-server.config.json
```

Edit `my-server.config.json` with your API's base URL and tools.

### Step 3 — Run with Your Config

```bash
npx tsx src/index.ts my-server.config.json
```

Your MCP server is now live on **stdio** (for Claude Desktop) or extend it to HTTP using `http-server.ts`.

### Step 4 — Connect to Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["tsx", "C:/path/to/mcpserver/src/index.ts", "C:/path/to/my-server.config.json"]
    }
  }
}
```

### Step 5 — Run as HTTP Server (for Claude.ai / web clients)

Start the HTTP mode:

```bash
npx tsx src/serve-invoiceapp.ts
```

Then use this MCP URL in any MCP-compatible client:

```
http://127.0.0.1:3000/mcp
X-API-Key: mcp_live_claude_connector_key_8888
```

---

## Available npm Scripts

| Command | What it does |
|---------|-------------|
| `npm start` | Run MCP server via stdio (loads `examples/demo.config.json`) |
| `npm run dev` | Same as start (hot-reload friendly) |
| `npm run demo` | Run the demo runner script |
| `npm test` | Run all 59 tests (Vitest) |
| `npm run build` | Compile TypeScript → `dist/` |

---

## Live API Endpoints (HTTP mode)

Once the server is running on port 3000:

| Method | URL | Description | Auth required? |
|--------|-----|-------------|---------------|
| `GET` | `http://127.0.0.1:3000/` | Studio UI (browser) | No |
| `GET` | `http://127.0.0.1:3000/studio` | Studio UI (alias) | No |
| `POST` | `http://127.0.0.1:3000/mcp` | MCP protocol endpoint | ✅ Yes |
| `GET` | `http://127.0.0.1:3000/invoiceapp/invoices` | Sample invoices REST API | No |
| `GET` | `http://127.0.0.1:3000/api/mcp/servers` | List registered servers | No |
| `GET` | `http://127.0.0.1:3000/.well-known/oauth-authorization-server` | OAuth metadata (RFC 8414) | No |
| `GET` | `http://127.0.0.1:3000/.well-known/oauth-protected-resource` | Protected resource (RFC 9728) | No |

### Test it with curl

```bash
# List tools (authenticated)
curl -X POST http://127.0.0.1:3000/mcp \
  -H "X-API-Key: mcp_live_claude_connector_key_8888" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Call a tool
curl -X POST http://127.0.0.1:3000/mcp \
  -H "X-API-Key: mcp_live_claude_connector_key_8888" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_invoices","arguments":{}}}'
```

---

## Auth Modes

The `inbound_auth` field in your config controls how clients authenticate:

```json
// API Key (simplest)
"inbound_auth": { "type": "api_key", "key_header": "X-API-Key" }

// OAuth 2.0
"inbound_auth": {
  "type": "oauth",
  "issuer": "https://auth.yourcompany.com",
  "client_id": "my-client",
  "scopes": ["read"],
  "allowed_callback_urls": ["https://claude.ai/api/mcp/callback"]
}

// Public (no auth — read-only tools only)
"inbound_auth": { "type": "none", "warning_accepted": true }
```

---

## Tool Safety Rules

| Rule | What it does |
|------|-------------|
| `"mode": "read"` | Tool can only read data |
| `"mode": "write"` | Tool modifies data — **disabled by default** |
| `"enabled": false` | Tool exists in config but is invisible to AI clients |
| SSRF guard | Blocks calls to `127.x`, `10.x`, `192.168.x`, `169.254.x` |
| Response shaping | `pick` trims fields; `max_items` caps list size |

---

## Running Tests

```bash
npm test
```

Expected output:
```
Test Files  11 passed (11)
     Tests  59 passed (59)
```

Run a single test file:
```bash
npx vitest run tests/config-schema.test.ts
```

---

## Docker (Optional — for PostgreSQL storage)

```bash
docker-compose up -d
```

This starts a Postgres instance. Set the connection string in `.env`:

```bash
DATABASE_URL=postgresql://postgres:password@localhost:5432/mcpforge
```

---

## Common Problems & Fixes

| Problem | Fix |
|---------|-----|
| `GEMINI_API_KEY not set` | Add `GEMINI_API_KEY=...` to your `.env` file |
| Port 3000 already in use | Kill existing process or change `PORT` in `serve-invoiceapp.ts` |
| `401 Unauthorized` on `/mcp` | Add `X-API-Key: mcp_live_claude_connector_key_8888` header |
| Tool not showing in Claude | Check `"enabled": true` in your tool config |
| SSRF blocked | Add your API host to `allowed_hosts` in the source definition |
| TypeScript errors | Run `npx tsc --noEmit` and check `tsconfig.json` `rootDir` |
| Tests failing | Run `npm test` and check the specific failing test file |

---

## Architecture in One Diagram

```
  Claude / ChatGPT / any MCP client
          │
          │ POST /mcp  (JSON-RPC 2.0)
          ▼
  ┌─────────────────────────────┐
  │   http-server.ts            │  ← HTTP layer, routing, auth check
  │   (port 3000)               │
  └────────────┬────────────────┘
               │
  ┌────────────▼────────────────┐
  │   server.ts                 │  ← MCP SDK: tools/list, tools/call
  │   (McpRuntimeServer)        │
  └────────────┬────────────────┘
               │
  ┌────────────▼────────────────┐
  │   http-executor.ts          │  ← Executes HTTP steps against your API
  │   + ssrf-guard.ts           │  ← Blocks dangerous internal IPs
  │   + shaper.ts               │  ← Trims/caps the response
  └────────────┬────────────────┘
               │
  ┌────────────▼────────────────┐
  │   Your upstream REST API    │  ← e.g. https://api.mycompany.com
  └─────────────────────────────┘

  Browser → GET / → studio.html  (Builder Assistant UI)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+, TypeScript |
| MCP Protocol | `@modelcontextprotocol/sdk` |
| Schema validation | Zod |
| Tests | Vitest |
| AI Designer | Gemini 2.5 Flash (via `GEMINI_API_KEY`) |
| HTTP server | Node `http` built-in |
| Database (opt) | PostgreSQL via `docker-compose` |
| Frontend | Vanilla HTML/CSS/JS (zero framework) |

---

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feat/my-feature`
3. Make changes and run `npm test` — all 59 must pass
4. Run `npx tsc --noEmit` — zero TypeScript errors
5. Open a pull request

---

## License

MIT — free to use, modify, and deploy.
