Review provenance: code-reviewer openai-codex/gpt-5.5:xhigh visual-effects-state-mapping working-tree

### Outcome

**Verdict:** Approved

**Reasoning:** The changed mapping implements the requested state-specific effects: active-only model gleam, tool-use-only activity gleam, and thinking rainbow without gleam. The targeted behavior is covered by tests, and the package suite passes; only a non-blocking stale helper comment remains.

### Strengths

- `packages/pi-flow-ux/extensions/effects.ts:84-87` keeps `active` and `toolUse` unchanged while changing `thinking` to `{ gleam: false, rainbow: true }`, matching the required activity-glyph mapping.
- `packages/pi-flow-ux/extensions/editor.ts:626-635` isolates state-to-styler resolution in a pure exported helper and gates both stylers by visibility plus the exact working state; `render()` consumes it at `packages/pi-flow-ux/extensions/editor.ts:738-753`.
- Tests explicitly cover the mapping and rainbow-only thinking glyphs (`packages/pi-flow-ux/extensions/effects.test.ts:12-20`, `packages/pi-flow-ux/extensions/effects.test.ts:75-86`) plus active-only model gleam and static model behavior during `toolUse`/`thinking` (`packages/pi-flow-ux/extensions/editor.test.ts:683-705`).
- Verified `pnpm --dir packages/pi-flow-ux test`: 144 passing, 0 failing.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

- `packages/pi-flow-ux/extensions/effects.ts:122` still describes `gleamText` as "Gleam the model name while any activity is visible", which conflicts with the new active-only model gleam mapping. Update the comment to describe the helper generically or clarify that callers decide when to apply it.

### Recommendations

_None._
