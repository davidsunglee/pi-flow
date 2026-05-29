**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Approved

**Reasoning:** The implementation satisfies the cwd/branch order and token swaps and frames the editor using the planned inner-width rendering approach. The scoped and package-level test suites pass; only minor documentation drift remains.

### Strengths

- `packages/pi-flow-ux/extensions/border-status.ts:205-245` cleanly preserves the existing branch-intact/cwd-tail-truncation behavior while changing the rendered order to branch-first.
- `packages/pi-flow-ux/extensions/border-status.ts:74-83` and `packages/pi-flow-ux/extensions/border-status.test.ts:119-130` explicitly verify the cwd/branch token swap.
- `packages/pi-flow-ux/extensions/border-status.ts:424-475` implements the rectangle non-destructively by rendering/detecting the inner width, relocating the bottom border, and framing interior rows after indices are final.
- `packages/pi-flow-ux/extensions/border-status.test.ts:393-487` covers autocomplete preservation, full-width rectangle framing, and extremely narrow widths.
- Verification run: `node --experimental-strip-types --test packages/pi-flow-ux/extensions/border-status.test.ts` passed (28/28), and `pnpm --filter @aphotic/pi-flow-ux test` passed (140/140).

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

- **packages/pi-flow-ux/extensions/border-status.ts:315: ComposeBorderLinesOptions comment still describes lines as `super.render(width)`**
  - **What:** `BorderStatusEditor.render()` now calls `super.render(innerWidth)` at line 556, but the `lines` option comment still says the lines come from `super.render(width)`.
  - **Why it matters:** This is only documentation drift, but it can mislead future callers/tests because bottom-border detection now intentionally expects inner-width stock borders.
  - **Recommendation:** Update the comment to say the lines come from the inner editor render width (`width - 2`, clamped to at least 1) while `width` remains the final framed output width.

### Recommendations

- Perform the planned live terminal QA before release to visually confirm rounded rectangle rendering, branch/cwd colors, wrapping, cursor placement, and autocomplete behavior in the real TUI.
