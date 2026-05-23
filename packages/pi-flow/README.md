# pi-flow

The aggregate package for pi-flow workflow resources — a single install point that forwards workflow skills, slash commands, bundled agents, and UX enhancements through `pi-flow-core` and `pi-flow-ux`.

## What this is

`pi-flow` is the primary install path for the pi-flow suite. Users install this single package (`npm:@aphotic/pi-flow` or a git-pinned equivalent) and get workflow resources from `@aphotic/pi-flow-core` plus the bundled UX layer from `@aphotic/pi-flow-ux`.

## What it includes

- **Workflow skills and bundled agents** via `@aphotic/pi-flow-core`
- **Slash commands and the `idea` tool** via `@aphotic/pi-flow-core`
- **Helper runner** (`pi-flow helper <id>`, `pi-flow template <id>`) via `@aphotic/pi-flow-core/bin`
- **UX enhancements** — footer extension, working indicator/message, Nord theme, and packaged defaults via `@aphotic/pi-flow-ux`

## /flow:* commands and idea tool

See [`@aphotic/pi-flow-core`](../pi-flow-core/README.md) for the full `/flow:*` and `idea` documentation.

After `pnpm add @aphotic/pi-flow`, run `/flow:setup` so `@aphotic/pi-mux-subagents` can discover the bundled agent definitions used by subagent-backed workflows.

The aggregate install includes the UX layer (footer, working indicator, and Nord theme). If you want a headless install without those UX extras, install `@aphotic/pi-flow-core` directly instead.

## Required companion

This package declares `@aphotic/pi-mux-subagents` as a peer dependency (range `"^0.1.0"`). Install it alongside `pi-flow`.

## Install pointer

Pi package sources must be one of: `npm:<pkg>`, a git URL (with `git:` prefix or a protocol URL), or a local/absolute path — bare names like `"@aphotic/pi-flow"` are not valid sources.

Reference `@aphotic/pi-flow` in your Pi `settings.json` using a supported source form:

```jsonc
// settings.json
{
  "packages": ["npm:@aphotic/pi-flow"]
}
```

Or install it explicitly via `pi install`:

```sh
pi install npm:@aphotic/pi-flow
```
