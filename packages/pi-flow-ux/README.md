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

You can install `pi-flow-ux` as a standalone Pi package without the aggregate:

```sh
npm install pi-flow-ux
# or pin from git
```

Reference it in your Pi `settings.json`:

```jsonc
{
  "packages": ["pi-flow-ux"]
}
```

After Pi loads the package, the following resources become available:

- **Extensions:** footer renderer, working indicator, working message
- **Themes:** `nord` theme
- **Working config defaults:** packaged `working.json` settings (described below)

## Aggregate install and use

`pi-flow` is the recommended aggregate package that includes `pi-flow-ux` resources forwarded through `node_modules/pi-flow-ux/`. Install the aggregate to get UX resources alongside workflow skills:

```sh
npm install pi-flow
```

The aggregate forwards UX resources automatically through its `pi` manifest:

```json
{
  "extensions": ["node_modules/pi-flow-ux/extensions/footer.ts", "node_modules/pi-flow-ux/extensions/working/index.ts"],
  "themes": ["node_modules/pi-flow-ux/themes/nord.json"]
}
```

## Nord theme activation

The Nord theme is discoverable by Pi after the package is loaded. To activate it, use the Pi theme command or update your Pi settings:

```sh
pi theme nord
```

Or set it persistently in Pi `settings.json`:

```jsonc
{
  "theme": "nord"
}
```

Pi discovers the theme by scanning the `node_modules/pi-flow-ux/themes/` directory for theme definitions named `nord.json`.

## Working indicator and message configuration

The working indicator and message are configured through a three-tier system with code defaults, packaged defaults, and user overrides.

### Configuration tiers (precedence, highest to lowest)

1. **User override:** `~/.pi/agent/working.json` — user-level configuration that takes precedence over all other tiers
2. **Packaged default:** `node_modules/pi-flow-ux/working.json` (or equivalent from your installed pi-flow-ux version) — curated Nord-tuned defaults, applied when user settings are absent or incomplete
3. **Code default:** hardcoded defaults in the extension if both user and packaged files are missing or malformed

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

If you prefer the workflow skills without UX enhancements, install `pi-flow-core` directly instead:

```sh
npm install pi-flow-core
```

`pi-flow-core` is the independent skill package with no theme, footer, working indicator, or packaged defaults—suitable for headless, script-driven, or minimal CLI environments.
