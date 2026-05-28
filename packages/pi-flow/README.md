# pi-flow

The aggregate package for pi-flow workflow resources — a single install point that forwards workflow skills, slash commands, bundled agents, and UX enhancements through `pi-flow-core` and `pi-flow-ux`.

## What this is

`pi-flow` is the primary install path for the pi-flow suite. Users install this single package (`npm:@aphotic/pi-flow` or a git-pinned equivalent) and get workflow resources from `@aphotic/pi-flow-core` plus the bundled UX layer from `@aphotic/pi-flow-ux`.

## What it includes

- **Workflow skills and bundled agents** via `@aphotic/pi-flow-core`
- **Slash commands and the `idea` tool** via `@aphotic/pi-flow-core`
- **Helper runner** (`pi-flow helper <id>`, `pi-flow template <id>`) via `@aphotic/pi-flow-core/bin`
- **UX enhancements** — status placement extension (`/status`: border editor, footer, or off), working indicator/message, Nord theme, and packaged defaults via `@aphotic/pi-flow-ux`

## /flow:* commands and idea tool

See [`@aphotic/pi-flow-core`](https://github.com/davidsunglee/pi-flow/tree/main/packages/pi-flow-core#readme) for the full `/flow:*` and `idea` documentation.

After installing with `pi install npm:@aphotic/pi-flow`, run `/flow:setup` so `@aphotic/pi-mux-subagents` can discover the bundled agent definitions used by subagent-backed workflows.

The aggregate install includes the UX layer (footer, working indicator, and Nord theme). If you want a headless install without those UX extras, install `@aphotic/pi-flow-core` directly instead.

## Required companion

This package declares `@aphotic/pi-mux-subagents` as a peer dependency (range `"^0.1.0"`). Install it alongside `pi-flow` if your Pi package source does not install peers automatically:

```sh
pi install npm:@aphotic/pi-mux-subagents
```

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

## Releasing (maintainers)

`@aphotic/pi-flow` is a self-contained aggregate: it bundles `@aphotic/pi-flow-core`, `@aphotic/pi-flow-ux`, and `@aphotic/pi-ideas` (plus their runtime deps) under its own `node_modules/` so a single install exposes every resource the `pi` manifest forwards to.

> **Do not run `pnpm pack` / `pnpm publish` directly on this package.** Under pnpm's isolated linker, `bundledDependencies` fail with `ERR_PNPM_BUNDLED_DEPENDENCIES_WITHOUT_HOISTED`. The aggregate has a dedicated release path instead.

Produce the bundled tarball:

```sh
pnpm --filter @aphotic/pi-flow run pack:aggregate            # prints {"tarball": "...", ...}
pnpm --filter @aphotic/pi-flow run pack:aggregate -- --out ./dist
```

Publish the (release-guarded) tarball:

```sh
pnpm --filter @aphotic/pi-flow run publish:aggregate                 # npm publish
pnpm --filter @aphotic/pi-flow run publish:aggregate -- --dry-run    # rehearse
```

`scripts/pack-aggregate.mjs` builds a clean staging directory, materializes the real subpackage contents under `stage/node_modules/@aphotic/...`, rewrites `workspace:*` specs to exact versions, then runs `npm pack`/`npm publish` from the stage. It includes a **release guard** that fails before publishing if any required bundled resource (core commands/skills/`ideas.json`, the UX footer/working/theme/`working.json`, the `pi-ideas` `idea.ts`, or its bundled `typebox`) is missing from the produced tarball.
