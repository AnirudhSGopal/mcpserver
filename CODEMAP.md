# CODEMAP

Lookup table so the agent never explores the repo. **Update in the same commit when files change.**
Format: path | what it does | entry point | test.

## apps/runtime  (data plane)
| Path | Purpose | Test |
|---|---|---|
| `src/server.ts` | HTTP server, routing `/s/{slug}` | `server.test.ts` |
| `src/protocol/` | ALL MCP SDK usage (initialize, tools/list, tools/call) | `protocol/*.test.ts` |
| `src/pipeline/auth.ts` | Inbound credential check | `auth.test.ts` |
| `src/pipeline/load-config.ts` | Config load + LRU cache + invalidation | `load-config.test.ts` |
| `src/pipeline/validate.ts` | Tool exists/enabled, Ajv input validation | `validate.test.ts` |
| `src/pipeline/policy.ts` | Read/write mode, rate limit, approval | `policy.test.ts` |
| `src/pipeline/execute.ts` | Dispatch to executors | `execute.test.ts` |
| `src/pipeline/shape.ts` | Response shaping (pick, caps) | `shape.test.ts` |
| `src/pipeline/log-call.ts` | tool_calls logging + redaction | `log-call.test.ts` |

## packages
| Path | Purpose | Test |
|---|---|---|
| `config-schema/src/schema.ts` | Zod ServerConfig, Tool, executors | `schema.test.ts` |
| `config-schema/src/lint.ts` | Lint rules | `lint.test.ts` |
| `config-schema/src/expr.ts` | Whitelisted expression resolver | `expr.test.ts` |
| `config-schema/migrations/` | Schema version migrations | per file |
| `executors/src/http/` | HTTP executor | `http/*.test.ts` |
| `executors/src/http/ssrf-guard.ts` | DNS + IP blocklist + host allowlist | `ssrf-guard.test.ts` |
| `executors/src/sql/` | SQL executor + validator (phase 2) | `sql/*.test.ts` |
| `connectors/src/openapi/` | Parse, dereference, normalize, risk-classify | `openapi/*.test.ts` |
| `connectors/src/postgres/` | Introspection, read-only check (phase 2) | `postgres/*.test.ts` |
| `designer/src/llm.ts` | LLM wrapper: retries, model from env, token accounting | `llm.test.ts` |
| `designer/src/design.ts` | Designer pipeline | `design.test.ts` |
| `designer/src/triage.ts` | Rank/trim operations | `triage.test.ts` |
| `designer/prompts/` | Prompt files + version constant | n/a |
| `evals/src/generate.ts` | Eval case generation | `generate.test.ts` |
| `evals/src/agent-loop.ts` | Run model against draft config | `agent-loop.test.ts` |
| `evals/src/score.ts` | Deterministic scoring | `score.test.ts` |
| `evals/src/baseline.ts` | Naive 1:1 conversion for comparison | `baseline.test.ts` |
| `vault/src/` | Envelope encryption, KMS providers | `vault.test.ts` |
| `shared/src/errors.ts` | Typed errors with stable codes | n/a |
| `shared/src/redact.ts` | Log/arg redaction | `redact.test.ts` |

## apps/api
| Path | Purpose | Test |
|---|---|---|
| `src/routes/projects.ts` | Project CRUD | `projects.test.ts` |
| `src/routes/sources.ts` | Spec upload, DB connect | `sources.test.ts` |
| `src/routes/design.ts` | Start/poll design job | `design.test.ts` |
| `src/routes/versions.ts` | Draft save, publish, rollback | `versions.test.ts` |
| `src/routes/evals.ts` | Start/poll evals | `evals.test.ts` |
| `src/routes/logs.ts` | Log queries | `logs.test.ts` |
| `src/db/schema.ts` | Drizzle tables | n/a |

## apps/worker
| Path | Purpose |
|---|---|
| `src/jobs/design.ts` | Design job processor |
| `src/jobs/evals.ts` | Eval job processor |
| `src/jobs/parse-spec.ts` | Spec parsing with limits |

## apps/web
| Path | Purpose |
|---|---|
| `src/app/(app)/projects/` | Projects list, wizard |
| `src/app/(app)/p/[id]/workbench/` | Workbench (operations <-> tools) |
| `src/app/(app)/p/[id]/test/` | Playground + evals |
| `src/app/(app)/p/[id]/publish/` | Versions, URL, keys |
| `src/app/(app)/p/[id]/logs/` | Log viewer |
| `src/components/` | Shared UI (Tag, Switch, Table, Dialog) |

## Where to look for common problems
| Symptom | Start at |
|---|---|
| Tool missing in Claude / wrong schema | `runtime/src/protocol/`, then `config-schema/src/schema.ts` |
| Tool call returns error | `runtime/src/pipeline/execute.ts`, then the executor |
| Response too big / wrong fields | `runtime/src/pipeline/shape.ts` |
| Blocked request (SSRF) | `executors/src/http/ssrf-guard.ts` |
| Designer output invalid | `designer/src/design.ts`, `config-schema/src/lint.ts` |
| Bad tool suggestions | `designer/prompts/`, run `pnpm bench:designer` |
| Eval fails oddly | `evals/src/score.ts`, `evals/src/agent-loop.ts` |
| Publish/rollback bug | `api/src/routes/versions.ts`, `runtime/src/pipeline/load-config.ts` |
| Secret not found | `vault/src/`, `api/src/routes/sources.ts` |
| UI state bug | the specific route folder under `apps/web/src/app` |

## Package READMEs
Each package has a `README.md` (max 10 lines): purpose, entry file, how to run its tests.
