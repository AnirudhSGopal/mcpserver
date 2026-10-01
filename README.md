# MCPForge: No-Code Platform for Custom MCP Servers

> "MCPForge" is a placeholder name. Rename freely.

A SaaS platform where a company describes what it wants AI assistants to do, connects its systems (OpenAPI first, PostgreSQL second), and gets a **safe, tested, hosted MCP server** in minutes, without writing code.

## Document map

| File | Purpose | Read when |
|---|---|---|
| `README.md` | This index and the one-page summary | First |
| `01-PRD.md` | Problem, users, scope, features, success metrics | Deciding what to build |
| `02-ARCHITECTURE.md` | Components, workflows, runtime lifecycle, data model | Before writing code |
| `03-TECH-STACK.md` | Every technology choice and why, repo layout, env vars | Setting up the project |
| `04-CONFIG-SCHEMA.md` | The versioned server config (the heart of the product) | Building runtime and editor |
| `05-PROMPTS.md` | LLM prompts used inside the product + prompts to drive a coding agent phase by phase | Building the AI parts / using Claude Code |
| `06-DESIGN.md` | UI/UX direction, tokens, screens, copy rules | Building the web app |
| `07-SECURITY.md` | Threat model and required controls | Before any customer data |
| `08-ROADMAP.md` | Week-by-week plan, milestones, validation checkpoints | Planning |
| `09-TOKEN-EFFICIENCY.md` | How to use AI tokens efficiently: coding-agent rules and product LLM cost controls | Always; before starting any task |
| `CODEMAP.md` | Lookup table: which file does what, where to start for common problems | Instead of exploring the repo |
| `SKILL.md` | Skill file for an AI coding agent working on this repo | Give to Claude Code |
| `CLAUDE.md` | Short project rules file for Claude Code | Put in repo root |

## The idea in one page

**Problem.** Companies want AI assistants (Claude, ChatGPT, custom agents) to use their software. That needs an MCP server, which means coding, auth, security, hosting, and testing.

**Solution.** A platform with a two-part design:

- **Control plane** (website + API): the company connects a source, states its requirement, reviews AI-suggested tools, sets safety rules, tests, and publishes.
- **Data plane** (MCP runtime): one shared multi-tenant service that reads each server's **versioned config** and executes tools against the company's API or database.

**Differentiators.**
1. Requirement-driven tool design (15 good tools, not 200 raw endpoints).
2. Built-in eval loop that proves the AI picks the right tools.
3. Safety by default: read-only mode, per-tool switches, scoped keys, logs.
4. Hosting included.

**Golden rule.** *Config is the product.* Never generate code per customer.

## Core flow

```
Connect source -> State requirement -> AI proposes tools -> Human edits + sets rules
      -> Run evals -> Publish version -> Claude/ChatGPT call the hosted MCP URL
```

## Start here (first 3 days)

1. Build a tiny MCP server with one hardcoded tool using the official TypeScript SDK.
2. Connect it to Claude Desktop (or MCP Inspector) and confirm it works.
3. Replace the hardcoded tool with one loaded from a JSON config file.

If that works, the hardest technical risk is gone. Then follow `08-ROADMAP.md`.

## Important caveat

The MCP specification and its authorization model are still evolving. Before building the protocol layer, check the current spec at modelcontextprotocol.io and keep all protocol handling in one isolated module (`apps/runtime/src/protocol/`).
