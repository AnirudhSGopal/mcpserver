# 09. Token Efficiency

Goal: spend AI tokens on the problem, not on re-learning the codebase. Two parts:
- **Part A:** how the coding agent (Claude Code) should work on this repo.
- **Part B:** how the product itself keeps LLM cost low (designer, evals, playground).

---

# Part A. Working on the codebase

## 1. The core rule

**Locate, then read. Never explore.**
Do not scan the repo, list every folder, or open files "to understand the project". Use `CODEMAP.md` to find the right file, read only that file (or the relevant line range), fix, and run only the related test.

## 2. Standard order for any task

1. Read `CLAUDE.md` (already loaded automatically). Do not re-read `SKILL.md` or docs unless the task touches that area.
2. Open `CODEMAP.md` to find the file(s) for the task.
3. Search with a targeted grep (symbol, error text, tool name) instead of opening directories.
4. Read a **line range** (about 40 lines around the target), not the whole file, unless the file is under about 150 lines.
5. Make the smallest edit that fixes the problem.
6. Run the **scoped** test or typecheck, not the whole suite.
7. Stop. Do not re-read files you just edited or summarize what you did at length.

## 3. Bug-fix protocol

```
1. Start from the error: message, stack trace, failing test name, or log line.
2. Take the top stack frame inside our code -> that file and line.
3. Read that file only around that line (about +/-40 lines).
4. If the cause is in a called function, follow ONE hop: grep the symbol, read that range.
5. Fix. Run the single failing test:  pnpm --filter <pkg> test -- <file or -t "name">
6. If it passes, run that package's typecheck. Done.
```

Escalate to broader reading only if two targeted attempts fail, and say why before doing it.

## 4. Scoped commands (use these, not the full suite)

```bash
pnpm --filter runtime test -- src/pipeline/shape.test.ts
pnpm --filter runtime test -- -t "blocks metadata ip"
pnpm --filter @mcpforge/config-schema typecheck
pnpm --filter web lint -- --file src/app/workbench/page.tsx
git diff --stat            # see what changed without reopening files
git diff -- path/to/file   # review just one change
```
Full `pnpm test` runs only before a commit or PR.

## 5. Prompt templates that save tokens

**Bug fix**
```
Bug: <one-line symptom>
Error: <paste the error or failing test name, trimmed to the relevant lines>
Likely area: <file or package if known>
Fix it. Read only the files the stack trace points to. Run only the related test.
Reply with the diff summary in 3 lines max.
```

**Small feature**
```
Task: <one sentence>
Files: <paths you expect to change, from CODEMAP.md>
Constraints: follow CLAUDE.md. Do not refactor unrelated code.
Add or update one test. Run only that test. Reply with changed files and one line each.
```

**Question about code**
```
Where is <thing> handled? Answer with file path and line range only. Do not paste code unless I ask.
```

**Review a change**
```
Review `git diff` for security issues from docs/07-SECURITY.md sections relevant to the files changed. List problems only. No praise, no restating the diff.
```

## 6. Session hygiene

- **One task per session.** Start a fresh session (or clear context) between unrelated tasks.
- Compact or restart when the conversation gets long; carry over a 5-line handoff note instead of the whole history.
- Do not paste large logs. Trim to the error and about 10 lines of context.
- Do not paste whole files into the prompt; give the path and let the agent read the range.
- Keep answers short: ask for diffs and file paths, not restated code or long explanations.
- Prefer a cheaper, faster model for mechanical work (renames, formatting, simple tests) and a stronger one for design, security review, and hard bugs.

## 7. Keep the repo cheap to work in

- **Small files:** target under 300 lines. Split by responsibility.
- **Clear names:** file names say what is inside (`ssrf-guard.ts`, `response-shaper.ts`), so grep and CODEMAP work.
- **One place per concept:** types in `config-schema`, errors in `shared/errors.ts`. No duplicated definitions.
- **Colocated tests:** `x.ts` next to `x.test.ts`, so a fix touches one directory.
- **Per-package README (max 10 lines):** purpose, entry file, how to test it.
- **Avoid giant barrel files and generated code in the read path.** Add generated files, build output, lockfiles, and fixtures to ignore lists.
- **Stable interfaces:** packages talk through typed functions, so a fix inside a package rarely requires reading another one.

## 8. Ignore noise

Add to `.gitignore` and to the agent's read-deny settings (check the current Claude Code docs for the exact settings format):

```
node_modules/
dist/
.next/
coverage/
*.lock, pnpm-lock.yaml
benchmarks/fixtures/*.json     # big spec files; open only when working on the designer
**/*.snap
```

## 9. Keep CODEMAP.md current

Update it in the same commit whenever you add, move, or delete a file listed there. A stale map costs more than no map. See `CODEMAP.md`.

## 10. Token budget rules of thumb

| Situation | Budget |
|---|---|
| Simple bug | 1-3 files, 1 scoped test |
| Small feature | up to 5 files, 1-2 tests |
| Cross-package change | state the plan in 5 lines first, then edit package by package |
| Needs more than about 8 files | stop and ask; the task is probably too big or badly located |

---

# Part B. Keeping product LLM cost low

The product makes three kinds of LLM calls: designer, evals, playground. Evals are the biggest spend.

## 1. Designer
- **Triage before design.** Send only the top relevant operations (about 40-80) in full; send the rest as names only.
- **Compact the input.** Strip long descriptions, examples, and unused response schemas from operations before sending. Keep name, method, path, summary, params, short description.
- **Force structured output** so there are no wasted tokens on prose and fewer retries.
- **Cap output** with a sensible `max_tokens`.
- **Cache by hash.** Key: hash(normalized operations + requirement + prompt version). Same input returns the stored draft.
- **Use prompt caching** for the long, static system prompt and output schema (place static content first, dynamic content last). Check the provider's current caching rules.
- **Retry with the validator error only**, not the full prompt history.

## 2. Evals
- **Cache results** by (config hash, case id, model). Re-run only cases whose tools changed.
- **Deterministic scoring first.** Tool match, args subset, forbidden tools cost zero tokens. Call the LLM judge only for grounding, and only on cases that passed the deterministic check.
- **Use a cheaper model for the judge and for case generation;** use the target model only for the agent-under-test.
- **Batch APIs** for large eval runs that do not need instant results (check current batch pricing and limits).
- **Limit suite size** by plan: for example about 25 cases default, more on paid plans.
- **Send only relevant tools** in multi-tool cases when testing a subset; send the full tool list for realism in the final run.
- **Trim tool results** returned to the agent (same response shaping as production).
- **Stop early:** end a case when the expected call sequence is observed or after N turns.

## 3. Playground
- Cap conversation length and tool result size.
- Summarize old turns after a threshold instead of resending everything.
- Rate limit per user; show remaining runs in the UI.

## 4. Accounting
- Wrap every LLM call in `packages/designer/llm.ts`. Record: org, feature (design, eval, playground, judge), model, input tokens, output tokens, cached tokens, cost estimate.
- Show per-org monthly spend in an internal dashboard; alert when an org exceeds its plan.
- Add a CI check that fails if a prompt grows by more than about 20% without a note.

## 5. Runtime tokens (what the customer's AI pays for)
The runtime's tool descriptions and responses consume the **customer's** model context. This is a product feature:
- Fewer tools, shorter descriptions, minimal input schemas.
- Response shaping with `pick`, `max_items`, and `max_string_length` on every list tool.
- Report "average response tokens per tool" in the eval summary and warn when a tool returns more than about 2,000 tokens.
