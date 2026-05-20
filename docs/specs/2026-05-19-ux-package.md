# Package Optional UX Layer

Source: TODO-cfcb8ede
Scout brief: docs/briefs/2026-05-20-2026-05-19-ux-package-md-brief.md

## Goal

Extract the optional UI polish from `../pi-config` into a separate `pi-flow-ux` package and wire the aggregate `pi-flow` package to expose it alongside `pi-flow-core`. The UX package should provide the custom footer, working indicator/message experience, default working configuration, and nord theme without pulling in unrelated personal utilities or changing core workflow behavior.

## Context

The first two specs split the reusable workflow into core resources and an active command/setup layer. This third slice owns only the UX package. The relevant source files live under `../pi-config/agent/`:

- `extensions/footer.ts` plus `extensions/footer.test.ts` — custom compact footer with independent field colors, width-aware field dropping, provider/model/thinking/context formatting, and status rendering.
- `extensions/working/index.ts` — entry point that registers the working indicator and working message extensions.
- `extensions/working/indicator.ts` — custom inline working indicator and `/working` command integration.
- `extensions/working/message.ts` — random/custom working message display during turns.
- `extensions/working/effects.ts`, `extensions/working/working.ts`, and related message/config helpers — shared implementation for animation, settings normalization, and persistence.
- `extensions/working/*.test.ts` — Node test coverage for working indicator/message/settings behavior.
- `agent/working.json` — current Nord-tuned working indicator defaults.
- `themes/nord.json` — custom theme with nord palette and Pi status/theme tokens.

The source TypeScript imports still use older `@mariozechner/*` package names. Pi package docs say extensions should use current `@earendil-works/*` imports as peer dependencies with `"*"` ranges for Pi core packages. The package should keep tests/dev tooling dev-only.

The current working indicator implementation reads and writes `~/.pi/agent/working.json`. For a distributable UX package, a fresh install should get useful defaults immediately without requiring setup or manual copying, while preserving the existing `/working` customization path for users who want overrides.

## Requirements

- Add `packages/pi-flow-ux/` as a distributable Pi package.
- Add a valid `package.json` for `pi-flow-ux` with `keywords: ["pi-package"]`, accurate `pi` manifest entries, and correct runtime/dev dependency placement.
- Package the custom footer extension from `../pi-config/agent/extensions/footer.ts`.
- Package the working indicator/message extension subtree from `../pi-config/agent/extensions/working/`.
- Package `../pi-config/agent/themes/nord.json` as a theme resource.
- Package a default working configuration based on `../pi-config/agent/working.json`.
- Update aggregate `pi-flow` so the default install exposes both `pi-flow-core` and `pi-flow-ux` resources through dependencies or bundled `node_modules/...` resource paths, without duplicating source files.
- Keep `pi-flow-core` independently installable without UX resources.
- Update TypeScript imports from `@mariozechner/*` to current `@earendil-works/*` package names unless a deliberate compatibility exception is documented.
- Declare Pi core packages used by extensions as peer dependencies with appropriate ranges, and keep TypeScript/test tooling dev-only.
- Preserve custom footer behavior: width-aware field visibility, context usage escalation, provider/model/thinking formatting, session/branch/path display, extension status display, and theme-aware color fallbacks.
- Preserve working indicator/message behavior: indicator shapes, active/tool-use/thinking styles, gleam/rainbow support, random working messages, command-driven customization, and cleanup on session shutdown/turn end.
- Implement working config resolution as package default plus user override:
  - Use the packaged default config when no user config exists.
  - Read the standard user config path as an override when present.
  - Keep `/working` customization persisted to the standard user config path.
  - Do not require `/flow:setup` or manual file copying for default UX behavior.
- Ensure malformed or partial user working config falls back safely to normalized defaults without crashing Pi startup.
- Exclude unrelated personal extensions such as `answer.ts`, `context.ts`, `files.ts`, `session-breakdown.ts`, `usage-bar.ts`, `guardrails.ts`, and `herdr-agent-state.ts`.
- Migrate relevant footer and working tests to the workspace and keep them running under Node-compatible test scripts.
- Add manifest/resource tests that verify UX resources are included and excluded resources are absent.
- Document how to install/use the UX package independently and through aggregate `pi-flow`, how the nord theme is selected, and how `/working` customization interacts with packaged defaults.

## Constraints

- Do not add core workflow skills, Flow commands, setup symlinks, or idea/TODO storage behavior in this spec.
- Do not make UX resources mandatory for users who install `pi-flow-core` directly.
- Do not preserve old `@mariozechner/*` imports unless an explicit compatibility reason is documented.
- Do not rely on a user-created `~/.pi/agent/working.json` for the package to show the intended default working indicator/message behavior.
- Do not mutate global/project config files on package load just to install defaults.
- Do not include unrelated personal utility extensions or their tests in the package.
- Do not introduce Bun as a runtime or test requirement.

## Approach

**Chosen approach:** Create a separate `pi-flow-ux` package for the footer, working UI, default working config, and nord theme. Use a package default plus user override model for working settings: bundled defaults power fresh installs, while `/working` continues to write user overrides to the standard user config path. Update the aggregate `pi-flow` package to expose both core and UX resources once this package exists.

**Why this over alternatives:** This preserves a clean workflow/UX package boundary while making the default aggregate install feel complete. Package defaults avoid setup friction, and user overrides preserve the existing customization behavior.

**Considered and rejected:**

- User config only — simpler and closest to the current personal setup, but a fresh install would not get the intended default working indicator without manual copying or setup side effects.
- Package config only — predictable defaults, but removes the useful `/working` customization persistence model.
- Bundling UX into `pi-flow-core` — easier aggregate wiring, but makes UI polish inseparable from the workflow engine.
- Copying all personal extensions — would ship unrelated commands and stateful utilities outside the intended UX scope.

## Acceptance Criteria

- `packages/pi-flow-ux/` exists with a valid package manifest, `keywords: ["pi-package"]`, and accurate `pi` declarations for extensions and themes.
- Aggregate `pi-flow` exposes `pi-flow-core` and `pi-flow-ux` resources through dependency or bundled `node_modules/...` paths, without duplicating their source files.
- `pi-flow-core` remains usable without installing or loading `pi-flow-ux` directly.
- The custom footer extension is present in `pi-flow-ux`, imports current `@earendil-works/*` packages, typechecks, and passes migrated tests.
- The working indicator/message extension subtree is present in `pi-flow-ux`, imports current `@earendil-works/*` packages, typechecks, and passes migrated tests.
- The nord theme is present in `pi-flow-ux` and discoverable as a Pi theme resource.
- The package includes a default working config equivalent to the current Nord-tuned `agent/working.json` defaults.
- With no user working config present, the working extension uses the packaged default settings.
- With a user working config present, the working extension uses the user override path and normalizes partial/malformed content safely.
- `/working` persists changes to the standard user config path without modifying the packaged default file.
- Package-loading smoke tests show the footer extension, working extension, and nord theme are discoverable from `pi-flow-ux`.
- Aggregate package smoke tests show UX resources are discoverable through `pi-flow` after aggregate wiring.
- Excluded personal utility extensions and their tests are absent from `pi-flow-ux` package resources.
- Runtime dependencies and peer dependencies follow Pi package guidance, with test/build tooling kept dev-only.
- Documentation explains standalone UX installation, aggregate installation, theme selection, default working config behavior, and user override behavior.

## Non-Goals

- Implementing or modifying core workflow skills.
- Implementing `/flow:*` commands, `/flow:setup`, or idea/TODO tooling.
- Changing the artifact workflow or model-tier behavior.
- Rebranding TODO artifacts to IDEA artifacts.
- Shipping personal productivity extensions outside footer/working UI.
- Publishing to npm.

## Open Questions

- Should aggregate `pi-flow` enable UX resources by default in all contexts, or should docs recommend installing `pi-flow-core` for headless/minimal environments where custom UI is not desired?
- Should the package expose `working.json` as a documented template path in addition to embedding it as the default runtime config?
- Does the current Pi theme schema URL in `nord.json` need updating from the older `badlogic/pi-mono` path to the current `earendil-works` location, or is the schema URL only advisory?
- Are all APIs used by `footer.ts` and `working/*` still compatible under `@earendil-works/*` package names, or do type/API adjustments need to be made during migration?
