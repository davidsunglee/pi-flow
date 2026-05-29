# Semantic muted border status fields

## Goal

De-emphasize secondary border-status values by rendering the thinking level, current context-token count, total context-window count, and working directory with the same muted gray theme token, while keeping each value on its own semantic color field.

## Architecture summary

This is a localized `@aphotic/pi-flow-ux` border-status renderer change. Today the border renderer has semantic fields for `model`, `context`, `branch`, `symbol`, and `cwd`; thinking bypasses that map via `theme.getThinkingBorderColor(level)`, and both token counts piggyback on `cwd` because they currently share its color. Replace those incidental routes with explicit semantic fields:

- `thinking` — thinking level label in the lower-left border.
- `contextTokensUsed` — current context-token count in the lower-right token window.
- `contextWindowTotal` — total context-window count in the lower-right token window.
- `cwd` — working directory in the upper-right border.

All four fields should currently resolve to the same `muted` theme token. The field names remain separate so future theme/color changes can target thinking, used tokens, total window, or cwd independently. Keep `/` on `symbol`, keep model id and context percentage on emphasized `accent` fields, leave the footer renderer unchanged, and preserve all responsive visibility/drop behavior.

## Tech stack

Node.js >=20, pnpm workspaces, ESM TypeScript executed with Node's `--experimental-strip-types`, `node:test`, `@earendil-works/pi-tui` width helpers, `@earendil-works/pi-coding-agent` theme tokens.

## File Structure

- `packages/pi-flow-ux/extensions/border-status.ts` — border-status color fields, token mapping, layout comments, token-window formatting, and thinking label rendering.
- `packages/pi-flow-ux/extensions/border-status.test.ts` — tests for distinct muted secondary fields and rendered color routing.
- `packages/pi-flow-ux/README.md` — border placement color documentation.

### Task 1: Route secondary values through explicit muted fields

**Files:**
- Modify: `packages/pi-flow-ux/extensions/border-status.ts`
- Modify: `packages/pi-flow-ux/extensions/border-status.test.ts`

**Steps:**
- [ ] **Step 1:** Update tests first. Extend the `BORDER_TOKENS` assertion so `cwd`, `thinking`, `contextTokensUsed`, and `contextWindowTotal` are distinct keys and all equal `"muted"`; keep `model`/`context` on `"accent"`, `branch` on `"success"`, and `symbol` on `"borderMuted"`.
- [ ] **Step 2:** Update token-window expectations so `formatContextTokenWindow(9300, 200000, markerColorize)` returns `[contextTokensUsed:9.3k][symbol:/][contextWindowTotal:200k]`, and the unknown-used case returns `[contextTokensUsed:?][symbol:/][contextWindowTotal:200k]`.
- [ ] **Step 3:** Update the `composeBorderLines` integration test so the lower-left block asserts `[model:gpt-5.5]` and `[thinking:xhigh]`, and explicitly does not use the old thinking-border marker. Update lower-right assertions to expect `[contextTokensUsed:9.3k]`, `[symbol:/]`, `[contextWindowTotal:200k]`, and `[context:12.3%]` in `used/total context%` order.
- [ ] **Step 4:** Run `pnpm --filter @aphotic/pi-flow-ux run test:node` and confirm RED for the expected routing failures before production changes.
- [ ] **Step 5:** In `border-status.ts`, add `"thinking"`, `"contextTokensUsed"`, and `"contextWindowTotal"` to `BorderColorField` and map each to `"muted"` in `BORDER_TOKENS`.
- [ ] **Step 6:** Change `formatContextTokenWindow` so the used value calls `colorize("contextTokensUsed", used)`, `/` stays `colorize("symbol", "/")`, and the total calls `colorize("contextWindowTotal", formatTokens(contextWindow))`.
- [ ] **Step 7:** Change `composeBorderLines` so the optional thinking label calls `colorize("thinking", p.thinkingLabel)`.
- [ ] **Step 8:** Remove the now-unused `thinkingColor` requirement from `ComposeBorderLinesOptions`, test call sites, and `installBorderStatus`; border placement should no longer call `theme.getThinkingBorderColor(level)` for the thinking label.
- [ ] **Step 9:** Update border-status comments to describe separate semantic fields that currently share `muted`, rather than saying token counts use cwd or thinking uses the thinking-border color.
- [ ] **Step 10:** Run `pnpm --filter @aphotic/pi-flow-ux run test:node` and confirm GREEN.

**Acceptance criteria:**
- The border renderer exposes separate semantic color fields for cwd, thinking, used context tokens, and total context window; all currently map to the same muted theme token.
  Verify: Run `pnpm --filter @aphotic/pi-flow-ux run test:node` and confirm the `BORDER_TOKENS` test asserts `cwd`, `thinking`, `contextTokensUsed`, and `contextWindowTotal` are distinct keys with value `"muted"`.
- The lower-left border still emphasizes the model id, while the thinking level is de-emphasized via the `thinking` field.
  Verify: Run `pnpm --filter @aphotic/pi-flow-ux run test:node` and confirm the `composeBorderLines` integration test sees `[model:...]` and `[thinking:...]`.
- The token window still renders `used/total` before the context percentage, with `/` subdued, but used and total counts route through their own semantic fields instead of `cwd`.
  Verify: Run `pnpm --filter @aphotic/pi-flow-ux run test:node` and confirm token-window assertions see `[contextTokensUsed:...]`, `[symbol:/]`, and `[contextWindowTotal:...]` in order before `[context:...]`.
- Responsive behavior remains unchanged: token window drops first, then branch, then thinking; model id and context percentage remain mandatory.
  Verify: Run `pnpm --filter @aphotic/pi-flow-ux run test:node` and confirm existing drop-priority tests pass.

**Model recommendation:** cheap

### Task 2: Document muted secondary field routing

**Files:**
- Modify: `packages/pi-flow-ux/README.md`

**Steps:**
- [ ] **Step 1:** Update the border placement color paragraph to say model id and context percentage use `accent`, branch uses `success`, separators/ellipsis use `borderMuted`, and thinking level, working directory, current context-token count, and total context-window count currently use muted gray.
- [ ] **Step 2:** Word the docs so thinking, cwd, used-token count, and total-window count remain conceptually separate values even though they currently resolve to the same muted theme token.
- [ ] **Step 3:** Leave footer renderer documentation and behavior unchanged.
- [ ] **Step 4:** Run `pnpm --filter @aphotic/pi-flow-ux run test:node` after docs edits.

**Acceptance criteria:**
- README docs describe thinking and token counts as muted like cwd without implying they share the `cwd` semantic field.
  Verify: Inspect `packages/pi-flow-ux/README.md` and confirm the color paragraph names thinking level, working directory, current context-token count, and total context-window count separately while assigning them to muted gray.
- Footer behavior remains untouched.
  Verify: Run `git diff -- packages/pi-flow-ux/extensions/footer.ts packages/pi-flow-ux/extensions/footer.test.ts` and confirm there is no diff.
- The package tests still pass after documentation changes.
  Verify: Run `pnpm --filter @aphotic/pi-flow-ux run test:node`.

**Model recommendation:** cheap

## Dependencies

- Task 2 depends on: Task 1

## Risk Assessment

Low risk. The implementation is confined to border-status color routing, tests, and docs. The main risk is collapsing semantically distinct values just because they currently share a color; this plan requires separate `thinking`, `contextTokensUsed`, and `contextWindowTotal` fields that happen to share the `muted` token with `cwd`.

## Test Command

```bash
pnpm --filter @aphotic/pi-flow-ux run test:node
```
