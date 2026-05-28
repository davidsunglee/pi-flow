# De-emphasize border status token counts and right-align context percentage

**Source:** IDEA-f31e62f6

## Goal

In the `@aphotic/pi-flow-ux` border-status renderer, render the optional `used/total` context token window to the left of the context percentage and de-emphasize the token counts with the same muted/cwd color used for the working directory. Keep the footer renderer unchanged.

## Architecture summary

This is a localized renderer/test/docs change in `packages/pi-flow-ux`. The border renderer already computes separate lower-right segments for the context percentage and optional token window; update the token-window color field and concatenate the token window before the percentage when present. Preserve the existing visibility calculation because the total lower-right width and token-window drop priority are unchanged.

## Tech stack

Node.js >=20, pnpm workspaces, ESM TypeScript executed with Node's `--experimental-strip-types`, `node:test`, `@earendil-works/pi-tui` width helpers, `@earendil-works/pi-coding-agent` theme tokens.

## File Structure

- `packages/pi-flow-ux/extensions/border-status.ts` — border-status formatting, layout, and comments.
- `packages/pi-flow-ux/extensions/border-status.test.ts` — unit/integration coverage for color routing, ordering, and responsive drop priority.
- `packages/pi-flow-ux/README.md` — user-facing border placement description.

### Task 1: Reorder and recolor border context metrics

**Files:**
- Modify: `packages/pi-flow-ux/extensions/border-status.ts`
- Modify: `packages/pi-flow-ux/extensions/border-status.test.ts`

**Steps:**
- [ ] **Step 1:** Update the border-status tests first so `formatContextTokenWindow` expects used/total counts on the `cwd` field, the slash on `symbol`, and `composeBorderLines` expects the lower-right order `used/total context%`.
- [ ] **Step 2:** Add or adjust an ordering assertion in the existing responsive/drop-priority test so the wide case proves the token window appears before the percentage while the narrow cases still prove token-window → branch → thinking drop order.
- [ ] **Step 3:** Run the targeted package test and confirm the updated expectations fail before the renderer change.
- [ ] **Step 4:** In `border-status.ts`, update the top layout/color comments to document `used/total context%`, with the percentage on `context`/`accent` and token counts on `cwd`/`muted`.
- [ ] **Step 5:** Change `formatContextTokenWindow` so the used and total counts call `colorize("cwd", ...)`, while `/` continues to call `colorize("symbol", "/")`.
- [ ] **Step 6:** Change `composeBorderLines` so `bottomRight` is `formatContextTokenWindow(...) + " " + formatContextPercent(...)` when the token window is visible, and just the percentage when it is not visible. Leave `computeBorderVisibility` and its width inputs semantically unchanged except for any comment clarifications needed.
- [ ] **Step 7:** Run the targeted package test again and confirm it passes.

**Acceptance criteria:**
- Border token-window counts use the same color field as the cwd, while the `/` separator remains on the symbol color.
  Verify: Run `pnpm --filter @aphotic/pi-flow-ux run test:node` and confirm the border-status color-routing tests pass.
- The lower-right border renders token counts to the left of the context percentage, e.g. `9.3k/200k 12.3%`, making the percentage the rightmost lower-right value.
  Verify: Run `pnpm --filter @aphotic/pi-flow-ux run test:node` and confirm the `composeBorderLines` ordering assertions pass.
- Existing responsive behavior is preserved: the token window still drops before branch and thinking, while model id and context percentage remain mandatory.
  Verify: Run `pnpm --filter @aphotic/pi-flow-ux run test:node` and confirm the existing narrow-width/drop-priority tests pass.

**Model recommendation:** cheap

### Task 2: Update border-status documentation

**Files:**
- Modify: `packages/pi-flow-ux/README.md`

**Steps:**
- [ ] **Step 1:** Update the Border placement details lower-right bullet to describe `used/total` token counts followed by the context percentage, with the percentage as the rightmost value.
- [ ] **Step 2:** Update the color paragraph so it distinguishes the emphasized context percentage (`accent`) from muted token counts (`cwd`/`muted`) and keeps separators/ellipsis on `borderMuted`.
- [ ] **Step 3:** Keep the responsive behavior text aligned with the unchanged drop priority: token-window detail drops first, then branch, then thinking; model id and context percentage remain kept.
- [ ] **Step 4:** Run the package test once more after docs edits to ensure no code/test regressions were introduced.

**Acceptance criteria:**
- README border-placement docs describe the new lower-right order and rightmost emphasized percentage.
  Verify: Inspect `packages/pi-flow-ux/README.md` and confirm it states that `used/total` token counts precede the context percentage.
- README color docs describe token counts as muted/cwd-colored and the context percentage as accent/emphasized, without changing footer documentation.
  Verify: Inspect `packages/pi-flow-ux/README.md` and confirm the border color paragraph separates token-count and percentage color treatment.
- The package tests still pass after documentation changes.
  Verify: Run `pnpm --filter @aphotic/pi-flow-ux run test:node`.

**Model recommendation:** cheap

## Dependencies

- Task 2 depends on: Task 1

## Risk Assessment

Low risk. The change is confined to the border-status renderer, its tests, and README documentation. The main implementation risk is accidentally changing responsive width/drop behavior while reordering the lower-right segments; keeping the width accounting unchanged and exercising the existing drop-priority tests should catch that.

## Test Command

```bash
pnpm --filter @aphotic/pi-flow-ux run test:node
```
