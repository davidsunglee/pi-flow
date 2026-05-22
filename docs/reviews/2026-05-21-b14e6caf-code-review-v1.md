**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Approved

**Reasoning:** The implementation satisfies the requested Flow ideas parity work, preserves the IDEA/docs/ideas semantics, and has focused storage/tool/TUI tests plus passing typecheck and node tests. I found only a small transcript-rendering edge case that does not block production readiness.

### Strengths

- Storage migration is backward-compatible and narrowly scoped: legacy `done` is normalized to `closed`, unknown header fields are ignored, and writes continue through temp-file + rename (`packages/pi-flow-core/extensions/storage.ts:93-145`).
- The expanded tool API validates action-specific fields and rejects nonsensical `status: "all"` mutations before writing (`packages/pi-flow-core/extensions/idea.ts:134-204`).
- `/flow:ideas` covers both non-interactive grouped output and interactive TUI management while keeping handoffs as editor prefill instead of auto-send (`packages/pi-flow-core/extensions/idea.ts:895-1097`).
- Tests cover the schema migration, filtered lists, append/delete helpers, renderers, command registration, non-UI command behavior, and component smoke cases; `pnpm --filter pi-flow-core run typecheck && pnpm --filter pi-flow-core run test:node` passed locally.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

- **packages/pi-flow-core/extensions/idea.ts:1130: Empty list renderer suppresses the fallback text**
  - **What:** `renderResult` takes over whenever `details.list` is present, but when the list is empty it returns `new Text(lines.join("\n"), ...)` with `lines.length === 0`, hiding the underlying `"No ideas found."` text from `executeIdeaTool`.
  - **Why it matters:** The custom transcript renderer can show a blank tool result for an empty filtered list, which is confusing even though the tool result itself is correct.
  - **Recommendation:** If both grouped arrays are empty, return `firstText ?? "No ideas found."` or add an explicit muted empty-state line before returning.

### Recommendations

- Add a regression test that invokes `renderResult` for an empty `details.list` so the custom renderer keeps a visible empty state.
