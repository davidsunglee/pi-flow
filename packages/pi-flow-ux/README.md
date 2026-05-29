# @aphotic/pi-flow-ux

Optional UX enhancements for pi-flow: a unified status placement extension (border editor, footer, or off), working indicator/message, Nord theme, and packaged defaults.

## What this package provides

This package contains optional UX polish that extends the core pi-flow experience:

- **Status extension** — a single coordinator that draws session metadata in exactly one place: the editor border (default), a custom footer, or nowhere. Switch in-session with `/status`.
- **Working indicator** — animated indicator showing active, tool-use, and thinking states with Nord-tuned defaults
- **Working message** — status messages corresponding to working states, customizable via configuration
- **Nord theme** — a complete dark theme package tuned to the Nord color palette (https://www.nordtheme.com/)
- **Packaged defaults** — curated Nord-tuned settings for the working indicator/message and a packaged status placement default, both with user override support

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

- **Extensions:** status placement coordinator (defaulting to the border editor), working indicator, working message
- **Themes:** `nord` theme
- **Config defaults:** packaged `working.json` and `status.json` settings (described below)

## Status extension

The status extension is a single coordinator that owns where session metadata is drawn. Exactly one placement is active at a time, so the placements are mutually exclusive:

- **`border`** (default) — draws metadata into the editor's top and bottom border lines, and blanks out Pi's built-in footer so the border is the only status surface (see below).
- **`footer`** — draws metadata in a custom footer below the editor.
- **`off`** — installs neither; Pi's built-in/default footer is left in place.

The border and footer renderers are internal implementation details of the coordinator; they are no longer loaded as independent extensions. The working indicator/message behavior is independent of status placement and is unaffected by your choice here.

### The `/status` command

- `/status` — reports the current placement and the accepted values (`border|footer|off`).
- `/status border`, `/status footer`, `/status off` — switch the placement immediately in the current session and persist your choice to `~/.pi/agent/status.json`.

The selected placement persists across Pi reloads and sessions.

### Border placement details

When `border` is active:

- **Lower-left border:** model id, plus the thinking level when reasoning is enabled.
- **Lower-right border:** the `used/total` context-window token counts followed by the context percentage used, with the percentage as the rightmost value (e.g. `9.3k/200k 12.3%`).
- **Upper-right border:** the working directory (with `~` home substitution).

Because the border already carries the model, context, and project metadata, border placement also suppresses Pi's built-in footer (it installs a footer that renders nothing) so the same information isn't duplicated below the editor. Switching to `footer` or `off` restores the normal footer behavior automatically.

Colors resolve from theme tokens per render: the model id and the emphasized context percentage use `accent`, the working directory uses `success`, and separators/ellipsis use `borderMuted`. The secondary values — the thinking level, the current context-token count, and the total context-window count — are each de-emphasized to the same muted gray. They remain conceptually separate fields (so any one can be re-colored later), even though they currently all resolve to the `muted` token. Because tokens resolve per render, theme switches update immediately with no stale cached ANSI. At narrow widths the optional fields degrade in priority order: the `used/total` token-window detail first, then the thinking level. The model id and context percentage are always kept (truncated only as a last resort) and the working directory is tail-truncated rather than dropped.

### Status configuration

Status placement follows the same three-tier convention as the working settings (see below), with a `{ "placement": "border" | "footer" | "off" }` schema:

1. **User override:** `~/.pi/agent/status.json` — takes precedence over all other tiers.
2. **Packaged default:** `node_modules/@aphotic/pi-flow-ux/status.json` — ships with `placement: "border"`.
3. **Code default:** hardcoded `placement: "border"`, used when both files are missing.

Failure semantics match `working.json`: a missing or malformed user file falls back to the packaged default; a missing packaged file falls back to the code default; malformed packaged JSON throws on startup so a broken release surfaces loudly. `/status` mutations persist only to `~/.pi/agent/status.json` (written atomically) and never modify the packaged default.

There is no project-specific status config layer; status placement is user-global only.

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
  "extensions": ["node_modules/@aphotic/pi-flow-ux/extensions/status/index.ts", "node_modules/@aphotic/pi-flow-ux/extensions/working/index.ts"],
  "themes": ["node_modules/@aphotic/pi-flow-ux/themes/nord.json"]
}
```

Both the direct `@aphotic/pi-flow-ux` install and the aggregate `@aphotic/pi-flow` install default to the same unified status behavior (`placement: "border"`), and the packaged `status.json` ships with both.

## Nord theme activation

The Nord theme is discoverable by Pi after the package is loaded. To activate it, either pick it interactively via `/settings` inside Pi, or set it persistently in Pi `settings.json`:

```jsonc
{
  "theme": "nord"
}
```

Pi has no `pi theme` subcommand — theme selection is always via the `theme` setting (interactively through `/settings`, or by editing `settings.json` directly). See the Pi themes docs for details.

Pi discovers the theme by scanning the `node_modules/@aphotic/pi-flow-ux/themes/` directory for theme definitions named `nord.json`.

## Working indicator and message configuration

The working indicator and message are configured through a three-tier system with code defaults, packaged defaults, and user overrides.

### Configuration tiers (precedence, highest to lowest)

1. **User override:** `~/.pi/agent/working.json` — user-level configuration that takes precedence over all other tiers
2. **Packaged default:** `node_modules/@aphotic/pi-flow-ux/working.json` (or equivalent from your installed @aphotic/pi-flow-ux version) — curated Nord-tuned defaults, applied when user settings are absent or fields are missing
3. **Code default:** hardcoded defaults in the extension, used when both the user and packaged files are missing

### Failure semantics

- **Missing user file → packaged default.** No `~/.pi/agent/working.json` is fine; packaged defaults apply.
- **Malformed user JSON → packaged default.** Invalid user JSON falls back to packaged defaults until the user file is corrected or removed.
- **Missing packaged file → code default.** A missing packaged `working.json` (e.g., during local development) falls back to hardcoded code defaults.
- **Malformed packaged JSON → fail loudly.** Invalid packaged JSON throws on startup rather than silently degrading to code defaults, so a broken release surfaces immediately instead of masking corruption.

### User override path: `~/.pi/agent/working.json`

Place a `working.json` file at `~/.pi/agent/working.json` to customize the working indicator and message behavior. Only fields you provide override the packaged defaults; missing fields fall back to the packaged tier.

Example partial user override:

```json
{
  "indicatorShape": "spinner",
  "active": {
    "color": "#ffffff"
  }
}
```

This overrides only `indicatorShape` and the `active.color`. All other settings come from the packaged defaults.

### Packaged defaults: `working.json`

The `working.json` file in this package (`packages/pi-flow-ux/working.json`) is tuned for the Nord theme and includes:

- `indicatorShape` — animation shape (`dot`, `pulse`, `spinner`, or `wave`; defaults to `wave`)
- `active` — settings for the active state (color, gleam, rainbow effects)
- `toolUse` — settings for tool-use state (color, gleam, rainbow effects)
- `thinking` — settings for thinking state (color, gleam, rainbow effects)

### Persistence and `/working` mutations

When the working indicator or message extension mutates settings (via a `/working` command or API), the changes are persisted to the user path `~/.pi/agent/working.json`, creating it if necessary. The packaged defaults are never modified.

If user settings become malformed (invalid JSON), the extension falls back to the packaged defaults until the user file is corrected or removed.

### Example: override active color only

```json
{
  "active": {
    "color": "#ff6b6b"
  }
}
```

Saved to `~/.pi/agent/working.json`, this overrides the active color while all other settings (shape, tool-use, thinking, gleam/rainbow effects) come from the packaged defaults.

## Minimal/headless use

If you prefer the workflow skills without UX enhancements, install `@aphotic/pi-flow-core` directly instead, using one of Pi's supported source forms:

```sh
pi install npm:@aphotic/pi-flow-core
# or, for local development from this monorepo checkout:
pi install /absolute/path/to/pi-flow/packages/pi-flow-core
```

`@aphotic/pi-flow-core` is the independent skill package with no theme, footer, working indicator, or packaged defaults—suitable for headless, script-driven, or minimal CLI environments.
