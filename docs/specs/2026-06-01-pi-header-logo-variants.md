# Pi header logo variants + configuration extraction

**Date:** 2026-06-01
**Package:** `@aphotic/pi-flow-ux`
**Status:** Design approved, ready for implementation plan

## Summary

Restyle the Pi header logo from a single block-art glyph into four selectable
**lettered "pi" wordmarks**, each rendered with the existing left→right gradient.
The active variant is user-configurable via the existing `/tui` command and
persisted to `tui.json`.

As a prerequisite cleanup, extract configuration ownership out of
`WorkingCoordinator` into a dedicated `TuiSettingsStore`. The coordinator has
accreted responsibility for all `TuiSettings`, the `/tui` command, and the
packaged-default→user merge — none of which relate to working state. The header
needs *configuration*, not *working state*, so routing a new logo setting
through a "working" object would deepen an existing smell. Extracting a config
owner gives the header (and the editor's settings reads) a fitting dependency
and lets `WorkingCoordinator` return to a single responsibility.

## Goals

- Four logo variants, all using the current gradient across the bare letters `pi`.
- Variant selectable at runtime via `/tui header logo=<variant>`, persisted to `tui.json`.
- Live update: changing the variant re-renders the header without a restart.
- A dedicated configuration owner; `WorkingCoordinator` reduced to working-state only.

## Non-goals

- Changing the gradient stops/colors (unchanged: pi-blue → muted-blue → soft-magenta).
- Changing the `version` / startup-reason lines below the logo.
- Reworking the working indicator, footer, or border-status behavior.
- New config surfaces beyond `header.logo` (the store is structured to grow, but
  this change adds only the one field).

## The four variants

All variants render the plain lowercase letters `pi` and are colored by the
existing `applyLogoGradient` (per-column gradient, spaces left untouched, so the
gradient washes across the whole mark including the frame — the "full gradient"
look chosen during design).

**Canonical order — used everywhere (type unions, validation arrays, `/tui`
usage text, docs, tests): `bracket`, `sidebar`, `rounded`, `squared`.**

`bracket` is the **default**.

### `bracket` (default) — 1 row
```
[ pi ]
```

### `sidebar` — 1 row
```
▌ pi ▐
```

### `rounded` — 3 rows
```
╭────╮
│ pi │
╰────╯
```

### `squared` — 3 rows
```
┏━━━━┓
┃ pi ┃
┗━━━━┛
```

## Architecture

Three units, each with one clear purpose:

### 1. `settings.ts` — `TuiSettingsStore` (new; extracted from `working.ts`)

**Purpose:** the single owner of TUI configuration.

Moves out of `working.ts`:
- `TuiSettings` type, `DEFAULT_TUI_SETTINGS`, `DEFAULT_TUI_SETTINGS_PATH`,
  `PACKAGE_DEFAULT_TUI_SETTINGS_PATH`.
- `normalizeTuiSettings`, `loadSavedTuiSettings`, `loadPackagedDefaultTuiSettings`,
  `saveTuiSettings`, and the `isIndicatorShape` / shape-validation helpers.
- Registration and handling of the `/tui` command, plus `getTuiUsage` /
  `describeTuiSettings`.

**Interface:**
- `get(): TuiSettings` — current resolved settings (clone).
- `subscribe(listener: (settings: TuiSettings) => void): () => void` — notified
  on load and on every successful `/tui` mutation.
- `ensureRegistered(pi, { registerCommand }): void` — loads packaged default →
  user override on `session_start` and registers the `/tui` command. Mirrors the
  existing coordinator registration shape so wiring in `index.ts` is familiar.
- A `getTuiSettingsStore(settingsPath?, packageDefaultPath?)` singleton accessor
  paralleling today's `getWorkingCoordinator`, keyed by settings path (reuse the
  existing per-path singleton map pattern).

**Depends on:** node `fs`/`path`/`os`/`crypto` only. No UI, no working state.

### 2. `working.ts` — `WorkingCoordinator` (slimmed)

**Purpose:** working-state tracking only (turn active, thinking, in-flight tool
calls) and host-working-row suppression.

Changes:
- Remove all settings ownership. `WorkingSnapshot` drops the `settings` field;
  it becomes `{ visible, state }`.
- The coordinator no longer registers `/tui`.
- No settings dependency at all: the coordinator never consumed `working.indicator`
  itself (only `editor.ts` does), so it takes **no** reference to the store.
- Keeps its name: with config removed, "WorkingCoordinator" is accurate again.

### 3. `header.ts` — logo rendering (updated)

- Replace the single `PI_LOGO_ART` with
  `LOGO_VARIANTS: Record<LogoVariant, string[]>`, declared in canonical order,
  where `LogoVariant = "bracket" | "sidebar" | "rounded" | "squared"`.
- `applyLogoGradient`, `humanizeStartupReason`, gradient stops: unchanged.
- `buildHeaderLines(version, reason, variant)` selects
  `LOGO_VARIANTS[variant] ?? LOGO_VARIANTS.bracket` and gradient-colors it, then
  appends the existing `version` / reason lines.
- `installHeader(ctx, reason, store)` takes the `TuiSettingsStore`. Inside the
  `setHeader((tui, theme) => …)` factory (the factory receives `tui`, confirmed
  in `pi-coding-agent@0.75.3` `types.d.ts`):
  - `render()` reads the current variant live from `store.get().header.logo`.
  - Subscribe to `store`; on change, call `tui.requestRender()` (same pattern as
    the editor's `requestRedraw → tui.requestRender()`), so `/tui` switches and
    the async settings load both reflect immediately.
  - `dispose()` unsubscribes; the returned `HeaderHandle.dispose()` also
    unsubscribes (idempotent) and clears the header.
- This subscribe-and-read-live design removes the current ordering hazard, where
  the coordinator loads settings asynchronously in its own `session_start`
  handler while the header installs synchronously in another.

### 4. `index.ts` — wiring

- Construct/resolve the `TuiSettingsStore` singleton and call its
  `ensureRegistered(pi, { registerCommand: true })` first.
- Construct the `WorkingCoordinator` (no store reference).
- On `session_start`, install footer, border editor, and
  `installHeader(ctx, reason, store)`.

### Editor's indicator read

`editor.ts` currently reads the indicator via `snapshot.settings.working.indicator`
(lines ~410, ~615). Since the working snapshot no longer carries settings, the
editor reads the indicator from the **store** (`store.get().working.indicator`)
and subscribes to **both** the coordinator (working-state → border re-render) and
the store (indicator change → border re-render via `requestRedraw`). Working-state
animation/cadence behavior is otherwise unchanged.

## Configuration

### Schema (`tui.json`)
`header` changes from `Record<string, never>` to `{ logo: LogoVariant }`:
```json
{
  "version": 1,
  "working": { "indicator": "wave" },
  "header": { "logo": "bracket" },
  "editor": {},
  "footer": {}
}
```

### Validation (`normalizeTuiSettings`)
- `header.logo` accepted only if it is one of the four variants; otherwise falls
  back to `fallback.header.logo` (ultimately `"bracket"`).
- `saveTuiSettings` already spreads `header`; it persists the validated
  `{ logo }`.

### Command
- `/tui header logo=<bracket|sidebar|rounded|squared>` sets and saves the variant.
- Invalid value → usage text, no change.
- `/tui` with no args lists current values; `describeTuiSettings` extends to
  `TUI: working.indicator=<…> header.logo=<…>`.
- `getTuiUsage` adds the `header logo=` line, listing variants in canonical order.

## Data flow

```
session_start
  └─ TuiSettingsStore.ensureRegistered → load packaged default → merge user tui.json
        └─ emit() → subscribers (header, editor)
  └─ installHeader(ctx, reason, store)
        └─ setHeader((tui) => component)
              render(): variant = store.get().header.logo
                        → applyLogoGradient(LOGO_VARIANTS[variant]) + version/reason
              store.subscribe(() => tui.requestRender())   // live updates

/tui header logo=rounded
  └─ store validates → saveTuiSettings(tui.json) → emit()
        └─ header subscriber → tui.requestRender() → render() picks up new variant
```

## Error handling

- Missing/corrupt `tui.json`: existing load helpers return `undefined`; store
  falls back to packaged default → `DEFAULT_TUI_SETTINGS`. Unchanged behavior.
- Unknown `header.logo` (hand-edited file or future/older value): normalized to
  `"bracket"`.
- `installHeader` when `!ctx.hasUI`: returns a no-op handle (unchanged guard).
- Save failure: surfaced via the existing `/tui` notify path; atomic temp-file
  write already prevents partial writes.

## Testing

### `header.test.ts` (extend)
- Each variant renders its expected frame characters.
- Gradient is still applied (non-space chars carry `\x1b[38;2;` sequences;
  spaces untouched).
- Unknown variant → renders `bracket`.
- `buildHeaderLines` appends the version + humanized reason lines unchanged.

### `settings.test.ts` (new — migrated + extended from working.ts settings tests)
- `normalizeTuiSettings`: valid `header.logo` round-trips; invalid/missing →
  default `"bracket"`; canonical-order constant matches the type union.
- `saveTuiSettings`: writes `header.logo`, preserves unrelated keys, atomic write.
- Load precedence: user override beats packaged default beats built-in default.

### `working.test.ts` (update)
- `WorkingSnapshot` no longer carries `settings`; working-state transitions
  (turn/thinking/tool-call open/close) unchanged.
- Coordinator has no settings/store dependency.

### `index.test.ts` / `editor.test.ts` (update)
- Editor reads the indicator setting from the store and working-state from the
  coordinator; border still re-renders on working-state changes.
- `/tui` command is registered by the store.

## Migration / compatibility

- Existing `tui.json` files without `header.logo` normalize to `"bracket"` — no
  user action required.
- The packaged default `tui.json` (`packages/pi-flow-ux/tui.json`) gains
  `"header": { "logo": "bracket" }`.
- Public re-exports from `index.ts` (`DEFAULT_TUI_SETTINGS_PATH`,
  `PACKAGE_DEFAULT_TUI_SETTINGS_PATH`) are preserved (re-export from `settings.ts`)
  to avoid breaking external imports.

## Housekeeping

- `docs/design/pi-header-logo-samples.{md,html}` are earlier block-art glyph
  explorations superseded by this lettered direction. Update or remove them as
  part of the change so the design record reflects the chosen variants.
