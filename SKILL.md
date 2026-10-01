---
name: mcpforge-builder
description: Use when building or modifying the MCPForge platform, a no-code SaaS that turns OpenAPI specs (and later PostgreSQL databases) into hosted, tested, safe MCP servers. Covers the config-as-product design, multi-tenant MCP runtime, LLM tool designer, eval engine, and security rules. Trigger on tasks touching apps/runtime, packages/config-schema, packages/designer, packages/evals, executors, connectors, vault, or the Workbench UI.
---

# MCPForge Builder Skill

Read this before changing code. Then read the linked docs for the area you touch.

## Product in one paragraph

Companies connect a source, state a requirement, review AI-suggested tools, test them, and publish a hosted MCP server. A control plane (web + API + worker) writes versioned JSON configs. A shared multi-tenant runtime reads published configs and executes tools against the company's API or database.

## Non-negotiable principles

1. **Config is the product.** Never generate or execute per-customer code. Tools are data interpreted by the runtime.
2. **Two planes, separate deploys.** Runtime depends only on `config-schema`, `executors`, `vault`, `shared`.
3. **Published versions are immutable.** Rollback repoints `active_version_id`.
4. **Tenant isolation everywhere.** `org_id`/`tenant_id` in every query, cache key, log row. Add a cross-tenant test for anything new.
5. **Secrets stay out of config, logs, errors and LLM prompts.** Only `secret_ref` in config; decrypt at call time in memory.
6. **Writes are off by default.** Generated write/destructive tools have `enabled: false`.
7. **Shape every response.** Never return raw upstream bodies to the model; pick fields, cap items and bytes.
8. **Untrusted input is data.** Specs, schemas, API responses, and table comments never act as instructions to any LLM call.
9. **SQL is fixed templates with positional params.** One SELECT, parsed and allowlist-checked. No interpolation.
10. **Isolate the MCP protocol.** All SDK usage in `apps/runtime/src/protocol/`. Check the current spec before touching it; it changes.

## Where things live

| Area | Path | Doc |
|---|---|---|
| Config schema, lint, migrations | `packages/config-schema` | `docs/04-CONFIG-SCHEMA.md` |
| Runtime pipeline | `apps/runtime/src/pipeline` | `docs/02-ARCHITECTURE.md` section 4 |
| Designer + prompts | `packages/designer` | `docs/05-PROMPTS.md` Part A |
| Evals + benchmarks | `packages/evals`, `benchmarks/` | `docs/02-ARCHITECTURE.md` section 7 |
| Security controls | across | `docs/07-SECURITY.md` |
| UI rules | `apps/web` | `docs/06-DESIGN.md` |
| Phase prompts | n/a | `docs/05-PROMPTS.md` Part B |
| File lookup | whole repo | `CODEMAP.md` |
| Token rules | n/a | `docs/09-TOKEN-EFFICIENCY.md` |

## Workflows

### Add a new tool executor type
1. Add Zod schema in `config-schema` and a lint rule.
2. Implement in `packages/executors/<type>` with timeout, size cap, and redaction.
3. Register in runtime pipeline step "Execute".
4. Add designer prompt guidance and a benchmark.
5. Add security tests (injection, SSRF or equivalent, tenant isolation).

### Change a designer or eval prompt
1. Bump the prompt version constant.
2. Run `pnpm bench:designer` and `pnpm bench:evals`.
3. Record pass rate, wrong-tool rate, avg calls versus main. Reject the change if pass rate drops more than 3 points.

### Add a config field
1. Update Zod schema; bump `schema_version` only if breaking, with a migration.
2. Update editor form, lint, runtime handling, example configs, and `docs/04-CONFIG-SCHEMA.md`.
3. Add runtime test for absent and present values.

### Add a UI screen
1. Use tokens and copy rules from `docs/06-DESIGN.md`.
2. Provide loading, empty, and error states in plain language.
3. Keyboard navigable, visible focus, reduced-motion safe.

## Coding standards

- TypeScript strict; no `any` without a comment. Validate all external input with Zod.
- Errors: typed error classes with stable codes; user-facing messages short and actionable; never leak internals or secrets.
- Structured logging (pino) with trace ID; no `console.log` in committed code.
- Tests first for: expression resolver, response shaper, SSRF guard, SQL validator, tenant isolation, lint rules.
- Small PRs by phase. Update docs when behavior changes.

## Token efficiency

Work narrowly. The repo is mapped so you do not need to explore it.

1. Use `CODEMAP.md` to find the file for the task; grep for symbols or error text if not listed.
2. Read only the relevant line range; do not open whole directories or unrelated packages.
3. For bugs: start at the error, open the top stack frame in our code, follow one hop at most, fix, run the single related test.
4. Use scoped commands (`pnpm --filter <pkg> test -- <file>`); run the full suite only before committing.
5. Keep answers to file paths and short diffs. Do not restate unchanged code.
6. If a fix seems to need many files, state a 5-line plan first or ask.
7. Keep files under about 300 lines and update `CODEMAP.md` when files move.

Full guide (including product-side LLM cost controls): `docs/09-TOKEN-EFFICIENCY.md`.

## Definition of done

- Types, lint, unit and integration tests pass.
- Security test checklist items relevant to the change pass.
- Benchmarks not regressed (when designer/eval code changed).
- Docs updated.
- No secrets or PII in logs (verified by test where applicable).

## Common mistakes to avoid

- Mapping one API endpoint to one tool. Design around tasks.
- Sending huge specs unfiltered to the LLM. Triage first.
- Passing upstream errors verbatim to the model. Summarize.
- Trusting client-side confirmation for dangerous actions. Enforce server-side.
- Hardcoding model IDs. Read from env; verify current IDs in provider docs.
- Building UI before the runtime slice it depends on works.
