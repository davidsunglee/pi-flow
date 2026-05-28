{
  "id": "f5f1ada1",
  "title": "Add border status extension to pi-flow-ux",
  "tags": [
    "pi-flow-ux",
    "extension",
    "ui",
    "theme"
  ],
  "status": "closed",
  "created_at": "2026-05-28T18:31:19.480Z"
}

## Context

Pi supports replacing/wrapping the editor with a custom editor component and drawing status text into the editor border, as shown by the upstream `border-status-editor.ts` example. `@aphotic/pi-flow-ux` currently provides `packages/pi-flow-ux/extensions/footer.ts`, which renders model, thinking, cwd, git branch, and context-token information in a theme-aware footer.

Confirmed footer color behavior:
- `modelName` and `contextUsage` both default to the `accent` theme token.
- In the bundled Nord theme, both are overridden to `#88c0d0` / `nord8`, so model text and context percentage currently match.
- Footer token counts currently use the separate `tokens` color (`border` by default, `#81a1c1` / `nord9` in Nord), but the border-status extension should intentionally color token counts like `contextUsage` / model.
- Thinking labels use `theme.getThinkingBorderColor(thinkingLevel)`, so their color changes by thinking level and theme.
- Footer colors are resolved per render from theme tokens/Nord overrides, so theme switches do not leave stale cached ANSI colors.

## Goal

Create a new `border-status.ts` Pi extension next to `packages/pi-flow-ux/extensions/footer.ts` that places key footer metadata into the editor border with theme-linked colors and responsive degradation at narrow terminal widths.

## Scope

- Add `packages/pi-flow-ux/extensions/border-status.ts`.
- Use the upstream example pattern: extend or wrap `CustomEditor`, override `render(width)`, and rewrite the top/bottom border lines with fitted left/right status text.
- Keep `footer.ts` unchanged for now; the border-status extension should coexist with the existing footer until a separate decision is made to remove duplicate footer metadata.
- Lower-left border:
  - Show model id, e.g. `gpt-5.5`.
  - Show thinking level, e.g. `xhigh`, only when current footer behavior would show it.
  - Color model text the same way `footer.ts` colors `modelName`.
  - Color thinking text with `theme.getThinkingBorderColor(thinkingLevel)`.
- Lower-right border:
  - Show context percentage used.
  - Show used tokens and total context-window tokens as `used/total`, using `/` for consistency with the footer.
  - Color the percentage and both token counts with the same color as footer `contextUsage` / `modelName`.
  - Color `/` with the subdued footer `symbols` color.
- Upper-right border:
  - Show formatted current working directory, followed by git branch when available.
  - Color cwd with the theme token `muted` for readable subtlety.
  - Color git branch with the same color as footer `branch` (`success` by default, Nord `#a3be8c` / `nord14`).
- Keep colors theme-linked and dynamic: resolve colors during render or invalidate rather than caching pre-colored strings across theme switches.
- Implement responsive degradation using the same relative priority as the current footer for the fields present in border status:
  - Highest priority: model id and context percentage; keep these visible whenever physically possible.
  - Cwd remains present but may be tail-truncated.
  - Drop `used/total` token-window details before dropping branch.
  - Drop branch before dropping thinking.
  - Thinking is the last optional field to drop.
  - When only truncation can fit, truncate status text ANSI-safely and avoid broken separators or orphaned spaces.
- Add tests comparable to `footer.test.ts` for formatting, color-field routing, responsive visibility/drop order, truncation/fitting, branch-change rerendering, and session shutdown restoration.
- Update `packages/pi-flow-ux/package.json` Pi manifest and README so the extension is discoverable when the package loads.

## Acceptance Sketch

- The pi-flow-ux test suite passes.
- Loading `@aphotic/pi-flow-ux` installs the new border-status extension without breaking the existing footer or working extensions.
- The editor border shows:
  - lower-left: model + optional thinking level,
  - lower-right: context percentage + optional `used/total` token window,
  - upper-right: cwd + optional git branch.
- Model, context percentage, and token counts share the footer model/context usage color.
- Thinking color changes by thinking level exactly like the current footer.
- Git branch uses the footer branch color.
- Cwd uses `muted` and remains theme-adaptive.
- `/` remains subdued using the footer symbols color.
- Narrow terminal widths degrade predictably according to the footer-inspired priority order: token-window details drop before branch, branch before thinking, while model and context percentage remain highest priority.
- Theme switches update border-status colors without stale ANSI colors.

## Open Questions

- Should a later idea remove or simplify duplicated footer metadata once `border-status.ts` has proven useful?

Completed via fastlane: 70ff60328ec7fa61bf95ca1bee4d2fd5dc105638, spec: (input was idea)
