# pi-flow-ux

Optional UX enhancements for pi-flow: footer extension, working indicator/message, Nord theme, and packaged working defaults.

## What this package provides

This package contains optional UX polish that extends the core pi-flow experience:

- **Footer extension** — displays context, model, thinking tokens, and other metadata in a customizable footer area
- **Working indicator** — animated indicator showing active, tool-use, and thinking states with Nord-tuned defaults
- **Working message** — status messages corresponding to working states, customizable via configuration
- **Nord theme** — a complete dark theme package tuned to the Nord color palette (https://www.nordtheme.com/)
- **Packaged working defaults** — curated Nord-tuned settings for the working indicator and message, with user override support

## Standalone install and use

You can install `pi-flow-ux` as a standalone Pi package without the aggregate. Pi package sources must be one of: `npm:<pkg>`, a git URL (with `git:` prefix or a protocol URL), or a local/absolute path — bare names like `"pi-flow-ux"` are not valid sources.

Once the package is published to npm:

```sh
pi install npm:pi-flow-ux
```

While the package is private or unpublished, install it directly from git or a local checkout:

```sh
pi install git:github.com/your-org/pi-flow-ux@main
pi install /absolute/path/to/pi-flow-ux
```

To trial it for a single Pi run without writing to settings, use `-e` with a valid source form:

```sh
pi -e npm:pi-flow-ux
pi -e git:github.com/your-org/pi-flow-ux@main
```

Or reference the package in your Pi `settings.json` using one of the supported source forms:

```jsonc
{
  // pick one source form
  "packages": ["npm:pi-flow-ux"]
  // "packages": ["git:github.com/your-org/pi-flow-ux@main"]
  // "packages": ["/absolute/path/to/pi-flow-ux"]
}
```

After Pi loads the package, the following resources become available:

- **Extensions:** footer renderer, working indicator, working message
- **Themes:** `nord` theme
- **Working config defaults:** packaged `working.json` settings (described below)

## Aggregate install and use

`pi-flow` is the recommended aggregate package that includes `pi-flow-ux` resources forwarded through `node_modules/pi-flow-ux/`. Install the aggregate via Pi to get UX resources alongside workflow skills:

```sh
pi install npm:pi-flow
# or, while private/unpublished:
pi install git:github.com/your-org/pi-flow@main
pi install /absolute/path/to/pi-flow
```

The aggregate forwards UX resources automatically through its `pi` manifest:

```json
{
  "extensions": ["node_modules/pi-flow-ux/extensions/footer.ts", "node_modules/pi-flow-ux/extensions/working/index.ts"],
  "themes": ["node_modules/pi-flow-ux/themes/nord.json"]
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

Pi discovers the theme by scanning the `node_modules/pi-flow-ux/themes/` directory for theme definitions named `nord.json`.

## Working indicator and message configuration

The working indicator and message are configured through a three-tier system with code defaults, packaged defaults, and user overrides.

### Configuration tiers (precedence, highest to lowest)

1. **User override:** `~/.pi/agent/working.json` — user-level configuration that takes precedence over all other tiers
2. **Packaged default:** `node_modules/pi-flow-ux/working.json` (or equivalent from your installed pi-flow-ux version) — curated Nord-tuned defaults, applied when user settings are absent or fields are missing
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

- `indicatorShape` — animation shape ('pulse', 'spinner', etc.)
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

If you prefer the workflow skills without UX enhancements, install `pi-flow-core` directly instead, using one of Pi's supported source forms:

```sh
pi install npm:pi-flow-core
# or, while private/unpublished:
pi install git:github.com/your-org/pi-flow-core@main
pi install /absolute/path/to/pi-flow-core
```

`pi-flow-core` is the independent skill package with no theme, footer, working indicator, or packaged defaults—suitable for headless, script-driven, or minimal CLI environments.
