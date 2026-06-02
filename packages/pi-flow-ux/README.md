# @aphotic/pi-flow-ux

Optional UX layer for pi-flow: an always-on border-status editor, a custom startup header, the Nord theme, and a single unified `/tui` configuration (`tui.json`).

## What this package provides

This package contains optional UX polish that extends the core pi-flow experience:

- **Border-status editor** — an always-on editor border that draws session metadata (activity, model, thinking level, context usage, and working directory)
- **Custom startup header** — a gradient pi logo with version and humanized startup reason, installed at session start
- **Nord theme** — a complete dark theme package tuned to the Nord color palette (https://www.nordtheme.com/)
- **Unified TUI configuration** — a single `tui.json` config file and `/tui` command for all user-facing TUI settings

## Standalone install and use

You can install `@aphotic/pi-flow-ux` as a standalone Pi package without the aggregate. Pi package sources must be one of: `npm:<pkg>`, a git URL (with `git:` prefix or a protocol URL), or a local/absolute path — bare names like `"@aphotic/pi-flow-ux"` are not valid sources.

Once the package is published to npm:

```sh
pi install npm:@aphotic/pi-flow-ux
```

For local development, install it directly from this monorepo checkout:

```sh
pi install /absolute/path/to/pi-flow/packages/pi-flow-ux
```

To trial it for a single Pi run without writing to settings, use `-e` with a valid source form:

```sh
pi -e npm:@aphotic/pi-flow-ux
pi -e /absolute/path/to/pi-flow/packages/pi-flow-ux
```

Or reference the package in your Pi `settings.json` using one of the supported source forms:

```jsonc
{
  // pick one source form
  "packages": ["npm:@aphotic/pi-flow-ux"]
  // "packages": ["/absolute/path/to/pi-flow/packages/pi-flow-ux"]
}
```

After Pi loads the package, the following resources become available:

- **Extensions:** the unified UX entrypoint (`extensions/index.ts`), which wires the border editor, custom header, and working coordinator
- **Themes:** `nord` theme
- **Config defaults:** packaged `tui.json` (described below)

## Border status

The border-status editor is always on. It draws session metadata directly into the editor border lines:

- **Lower-left border:** a fixed-width activity slot, then the model id, plus the thinking level when reasoning is enabled.
- **Lower-right border:** the `used/total` context-window token counts followed by the context percentage used, with the percentage as the rightmost value (e.g. `9.3k/200k 12.3%`).
- **Upper-right border:** the working directory (with `~` home substitution and tail truncation when long).

At narrow widths, optional fields degrade in priority order: the `used/total` token-window detail first, then the thinking level. The model id and context percentage are never dropped; the working directory is tail-truncated rather than dropped.

Because the border already carries model, context, and project metadata, Pi's built-in footer and host working row are suppressed while this package is installed.

## Custom header

On `session_start` (when a UI is present), the package installs a custom header consisting of:

- A gradient pi logo wordmark
- A `version <VERSION>` line
- A humanized session-reason line (`hello`, `session reloaded`, `a fresh start`, `session resumed`, or `session forked`)

The header is installed via `ctx.ui.setHeader` and disposed on `session_shutdown`.

## TUI configuration

All user-facing TUI options are configured through a single `tui.json` file and the `/tui` command.

### Canonical shape

```json
{
  "version": 1,
  "working": { "indicator": "wave" },
  "header": {},
  "editor": {},
  "footer": {}
}
```

### Working indicator

The `working.indicator` field controls the animation shape used in the activity slot. Valid values:

- `dot` — static dot
- `pulse` — pulsing dot
- `spinner` — braille spinner
- `wave` — braille wave (default)

### Configuration resolution order

1. **User override:** `~/.pi/agent/tui.json` — takes precedence over all other tiers.
2. **Packaged default:** `node_modules/@aphotic/pi-flow-ux/tui.json` — ships with `working.indicator: "wave"`.
3. **Code default:** hardcoded `working.indicator: "wave"`, used when both files are missing.

### Failure semantics

- **Missing or malformed user file → packaged default.** No `~/.pi/agent/tui.json`, or invalid JSON in it, falls back to the packaged default.
- **Missing packaged file → code default.** A missing packaged `tui.json` falls back to hardcoded code defaults.
- **Malformed packaged JSON → throws.** Invalid packaged JSON throws on startup so a broken release surfaces immediately.

### The `/tui` command

- `/tui` — reports current settings (e.g. `TUI: working.indicator=wave`).
- `/tui working indicator=<dot|pulse|spinner|wave>` — updates the indicator and persists the change atomically to `~/.pi/agent/tui.json`.

The user file is written in the canonical shape above. Any unrecognized top-level keys already in the user file are preserved.

## Aggregate install and use

`@aphotic/pi-flow` is the recommended aggregate package that includes `@aphotic/pi-flow-ux` resources forwarded through `node_modules/@aphotic/pi-flow-ux/`. Install the aggregate via Pi to get UX resources alongside workflow skills:

```sh
pi install npm:@aphotic/pi-flow
# or, for local development from this monorepo:
pi install git:github.com/davidsunglee/pi-flow
pi install /absolute/path/to/pi-flow
```

The aggregate forwards UX resources automatically through its `pi` manifest:

```json
{
  "extensions": ["node_modules/@aphotic/pi-flow-ux/extensions/index.ts"],
  "themes": ["node_modules/@aphotic/pi-flow-ux/themes/nord.json"]
}
```

## Nord theme activation

The Nord theme is discoverable by Pi after the package is loaded. To activate it, either pick it interactively via `/settings` inside Pi, or set it persistently in Pi `settings.json`:

```jsonc
{
  "theme": "nord"
}
```

Pi has no `pi theme` subcommand — theme selection is always via the `theme` setting (interactively through `/settings`, or by editing `settings.json` directly). See the Pi themes docs for details.

Pi discovers the theme by scanning the `node_modules/@aphotic/pi-flow-ux/themes/` directory for theme definitions named `nord.json`.

## Minimal/headless use

If you prefer the workflow skills without UX enhancements, install `@aphotic/pi-flow-core` directly instead, using one of Pi's supported source forms:

```sh
pi install npm:@aphotic/pi-flow-core
# or, for local development from this monorepo checkout:
pi install /absolute/path/to/pi-flow/packages/pi-flow-core
```

`@aphotic/pi-flow-core` is the independent skill package with no theme, footer, working indicator, or packaged defaults—suitable for headless, script-driven, or minimal CLI environments.
