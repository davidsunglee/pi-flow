**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Approved

**Reasoning:** The IDEA cutover is implemented consistently across runtime storage/routing, provenance helpers, orchestration prose, documentation, and regression tests. I found no Critical or Important issues; `pnpm run check` and the required legacy-leak greps pass.

### Strengths

- Storage and ID normalization now hard-cut to `docs/ideas` and `IDEA-` only, with no legacy `getTodoDir`/`isLegacyTodoId` surface remaining (`packages/pi-flow-core/extensions/storage.ts:15-31`).
- Exact routing canonicalizes supported artifact IDs to `IDEA-<id>` and treats legacy-prefixed input as interpreted prose rather than an exact artifact (`packages/pi-flow-core/extensions/router.ts:60-109`).
- Provenance extraction was updated to emit `source_idea`, require `IDEA-` sources, and avoid the prior legacy scout-brief special case while preserving supported freeform brief filenames (`packages/pi-flow-core/skills/_shared/scripts/extract-provenance-preamble.py:35-119`).
- The new integration coverage verifies the loaded extension surface exposes `flow:idea`/`idea` only, checks generate/execute skill prose for no external todo-tool dependency, and round-trips execute-plan closure through the built-in idea tool (`packages/pi-flow-core/__tests__/idea-tool-only.test.mjs:49-106`).
- Migration documentation clearly explains the hard cutover, the one-time `mv docs/todos docs/ideas`, and the provenance implications for historical artifacts (`packages/pi-flow-core/README.md:57-75`).

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

_None._

### Recommendations

_None._
