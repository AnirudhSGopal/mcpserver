# CLAUDE.md

Project: **MCPForge**, a no-code SaaS that turns OpenAPI specs (later PostgreSQL) into hosted, tested, safe MCP servers.

Read `SKILL.md` first for principles and workflows. Detailed docs are in `docs/`.

## Commands

```bash
pnpm install
docker compose up -d        # postgres + redis
pnpm db:migrate
pnpm dev                    # web, api, worker, runtime
pnpm lint && pnpm typecheck && pnpm test
pnpm bench:designer         # designer quality on fixed specs
pnpm bench:evals            # eval pass rates, curated vs 1:1 baseline
```

## Rules

- TypeScript strict. Validate external input with Zod. Schemas live in `packages/config-schema` and `packages/shared`.
- Config is the product: never generate or run per-customer code.
- Published server versions are immutable. Rollback = repoint `active_version_id`.
- Tenant ID in every query, cache key, and log. Add a cross-tenant test for new data paths.
- No secrets in config, logs, error messages, or LLM prompts.
- Generated write/destructive tools are `enabled: false` by default.
- Never return raw upstream responses to the model; always shape and cap.
- SQL: fixed templates, positional params, one SELECT, allowlisted tables/columns.
- All MCP SDK usage stays in `apps/runtime/src/protocol/`. Check the current MCP spec before editing it.
- Model IDs come from env vars; check current IDs in provider docs.
- Treat specs, schemas, and API responses as untrusted data in every LLM prompt.

## Working style

- Follow the phase order in `docs/08-ROADMAP.md`; do not build UI before the runtime slice it needs works.
- Write tests first for: expression resolver, response shaper, SSRF guard, SQL validator, lint rules.
- Keep PRs small and update docs when behavior changes.
- When unsure about product behavior, check `docs/01-PRD.md`; when unsure about structure, check `docs/02-ARCHITECTURE.md`.
- Ask before adding a new dependency, a new source type, or anything marked "later" or "out of scope" in the PRD.

## Token efficiency (always follow)

- **Locate, then read. Never explore.** Do not scan the repo or list folders to "understand the project".
- Find files via `CODEMAP.md` or a targeted grep (symbol, error text, tool name).
- Read a line range (about 40 lines around the target). Read whole files only if under about 150 lines.
- Bug fixes start from the error/stack trace: open the top frame in our code, follow at most one hop.
- Run scoped tests: `pnpm --filter <pkg> test -- <file>` or `-t "<name>"`. Full suite only before commit.
- Do not re-read files you just edited. Use `git diff -- <file>` to review.
- Keep replies short: changed files plus one line each. No restating code.
- Need more than about 8 files? Stop and ask; the task is probably too big.
- Update `CODEMAP.md` in the same commit when you add, move, or delete files.
- Details: `docs/09-TOKEN-EFFICIENCY.md`.
