{
  "id": "cfcb8ede",
  "title": "Extract current pi-config workflow into pi-flow packages",
  "tags": [
    "pi-flow",
    "pi-package",
    "extraction",
    "agents",
    "extensions",
    "skills",
    "monorepo"
  ],
  "status": "done",
  "created_at": "2026-05-18T00:00:00.000Z"
}

## Goal

Extract the reusable artifact-driven workflow from the current `../pi-config` checkout into this `pi-flow` repository so a fresh Pi setup can install and use it without depending on the personal `pi-config` repo.

This todo should track the current `../pi-config` source state, not the older pre-rename workflow. In particular, the source now uses `fastlane` (not `fast-lane`), has no per-skill `README.md` files, and includes newer workflow guardrails/edge cases in `generate-plan`, `refine-plan`, `execute-plan`, and `fastlane`.

## Current `../pi-config` facts to preserve

Use the current repo contents as source of truth, with `agent/settings.json` and live skill files taking precedence over any stale README prose.

- `agent/skills/` contains workflow and discipline skills. Include the reusable non-browser skills:
  - `scout`
  - `define-spec`
  - `fastlane`
  - `generate-plan`
  - `refine-plan`
  - `execute-plan`
  - `refine-code`
  - `requesting-code-review`
  - `receiving-code-review`
  - `commit`
  - `test-driven-development`
  - `systematic-debugging`
  - `verification-before-completion`
  - `using-git-worktrees`
  - `finishing-a-development-branch`
- `agent/skills/web-browser/` exists locally but is out of scope for the initial `pi-flow` package.
- `agent/skills/_shared/` and per-skill `scripts/` directories contain important Python helpers and tests. Extract or deliberately replace these; do not drop them as incidental files.
- Current workflow behavior includes:
  - `fastlane` spelling everywhere in live workflow docs/prompts and `/fastlane` routing.
  - `fastlane` protected-branch and completion edge-case handling from the latest skill file.
  - `generate-plan` scout-brief drift classification and missing-brief handling.
  - `refine-plan` / `generate-plan` parseability guardrails before execute-plan handoff.
  - `execute-plan` parser compatibility for bold section labels and suffixed task IDs.
  - marker/subagent completion contracts using both final-message markers and `subagent_done(...)` where documented.
- `agent/agents/` contains the required subagent definitions: `scout`, `spec-designer`, `planner`, `plan-reviewer`, `plan-refiner`, `coder`, `verifier`, `test-runner`, `code-reviewer`, and `code-refiner`.
- `agent/extensions/` contains many local TypeScript modules, but `agent/settings.json` currently enables only `./extensions/env.ts` by default.
- Extension source still imports older `@mariozechner/...` package names in places; package extraction should update imports to current `@earendil-works/...` names unless a compatibility exception is intentional and documented.
- `agent/themes/nord.json` is the custom theme to package with the UX layer.
- `agent/model-tiers.json` is a personal example/template. Runtime model selection remains user-owned, and workflow skills currently read `~/.pi/agent/model-tiers.json` through helper scripts.
- `agent/settings.json` currently loads `npm:@aphotic/pi-mux-subagents`, `npm:pi-web-access`, and `npm:@aliou/pi-processes`. Only `@aphotic/pi-mux-subagents` is a core workflow requirement; do not turn `pi-web-access` or `pi-processes` into `pi-flow` requirements unless a packaged skill actually depends on them.

## Target package shape

Build `pi-flow` as a clean package repository, preferably a pnpm workspace with separable package boundaries:

```text
pi-flow/
  package.json          # workspace root / scripts
  README.md
  packages/
    pi-flow/            # aggregate/default install package
    pi-flow-core/       # workflow skills, agents, setup, commands, model-tier template
    pi-flow-ux/         # footer/working UI modules and nord theme
```

The package names may be adjusted before publish, but the conceptual boundaries should stay clear:

- `pi-flow` is the primary documented install path and should expose core + UX resources through dependencies/bundled resources rather than duplicating source files.
- `pi-flow-core` owns the artifact-driven workflow: skills, helper scripts, subagent definitions, Flow-facing commands, setup, model-tier documentation/template, and TODO-compatible intent storage.
- `pi-flow-ux` owns optional UI polish: custom footer, working indicator modules/config, and the nord theme.

Each distributable package should have `keywords: ["pi-package"]` and an accurate `pi` manifest for the resources it actually ships, for example `extensions`, `skills`, and `themes`. Exclude test files from runtime extension globs.

## Core package scope

`pi-flow-core` should:

- Extract the reusable skills listed above from `../pi-config/agent/skills` into package-level directories, not an `agent/` compatibility layout.
- Preserve the current `fastlane` skill name, folder, prompt file names, review artifact suffixes, and user-facing spelling.
- Include the required subagent definitions from `../pi-config/agent/agents`.
- Provide Flow-facing commands that invoke packaged workflow entry points directly enough to keep working even if generic `/skill:*` commands are hidden later:
  - `/flow:setup`
  - `/flow:idea`
  - `/flow:scout`
  - `/flow:spec`
  - `/flow:plan`
  - `/flow:refine-plan`
  - `/flow:execute`
  - `/flow:refine-code`
  - `/flow:fastlane`
- Package the initial intent-capture surface as `idea` / `/flow:idea`, while preserving compatibility with existing `TODO-<id>` files, IDs, paths, and provenance lines.
- Keep the full `TODO-<id>` to `IDEA-<id>` artifact/provenance migration out of this extraction; that is tracked separately by `TODO-d9644bc0`.
- Preserve consumer-project artifact conventions as runtime conventions: `docs/todos`, `docs/briefs`, `docs/specs`, `docs/plans`, `docs/plans/reviews`, `docs/reviews`, and `docs/test-runs`.
- Provide a model-tier setup guide and example/template based on `agent/model-tiers.json`, while making clear that the installed user's `~/.pi/agent/model-tiers.json` remains the runtime source of truth.
- Declare/document `@aphotic/pi-mux-subagents` as the required companion package because the workflow dispatches subagents via `subagent_run_serial` / `subagent_run_parallel` and depends on completion watching / `subagent_done` markers.

## Agent-definition packaging issue

Pi package manifests do not currently make arbitrary package-bundled `agents/` available as first-class subagent definitions. `@aphotic/pi-mux-subagents` discovers project-local `.pi/agents/`, global `~/.pi/agent/agents/`, and its own bundled agents, so `pi-flow` must bridge that gap.

Implement an explicit `/flow:setup` command that makes the bundled `pi-flow-core` agent definitions discoverable from the matching install scope:

- Scope-aware: global installs set up global agents; project-local installs set up project-local agents; do not intentionally mix scopes.
- Conservative and idempotent: create missing symlinks, leave matching symlinks alone, refuse to overwrite real files or symlinks pointing elsewhere, and report exact conflicts.
- Explicit only: do not create global/project symlinks as a package-load side effect.
- Honest about temporary loads: `pi -e` is useful as a smoke test, but setup should not pretend a temporary package load is a durable install unless the user explicitly requests setup and the target is valid.

If `@aphotic/pi-mux-subagents` gains direct package-agent discovery before this work lands, use it instead and document the minimum companion version. Otherwise, do not block the initial extraction on companion changes.

## UX package scope

`pi-flow-ux` should include only the UI pieces intended for distribution:

- Custom footer module(s).
- Working indicator/message modules and required config.
- `agent/themes/nord.json`.

Keep this package optional/separable from the core workflow. Update imports and runtime peer/dependency declarations so the package works with current Pi packages.

## Exclusions / non-goals for initial extraction

Do not copy or package:

- Personal workflow artifacts or state from `../pi-config/docs/`, including todos, specs, briefs, plans, reviews, test-runs, analysis docs, sandbox notes, or run outputs.
- Auth/session/history/cache files, `node_modules`, `.worktrees`, `__pycache__`, `.DS_Store`, or generated caches.
- `agent/skills/web-browser/`.
- Personal utility extensions not needed by the initial workflow package, including `answer.ts`, `context.ts`, `files.ts`, `session-breakdown.ts`, `usage-bar.ts`, `guardrails.ts`, and `herdr-agent-state.ts`.
- Generic external productivity packages such as `pi-web-access` or `pi-processes` as `pi-flow` runtime requirements unless a packaged command directly depends on them.
- Automatic mutation of global/project agent directories on package load.
- The durable `IDEA-<id>` artifact rename; keep TODO compatibility for now and leave the rename to `TODO-d9644bc0`.

## Portability work

Audit and fix references that assume the old personal config layout:

- Rewrite `agent/skills/...` and `~/.pi/agent/skills/...` script/template references so they resolve from the installed package or skill-relative locations.
- Ensure helper scripts invoked by skills work after packaging; if Python helpers remain, document the Python runtime and migrate their tests.
- Update workflow docs so they no longer assume `../pi-config` is present.
- Update TypeScript extension imports from `@mariozechner/...` to current `@earendil-works/...` package names unless a compatibility reason is documented.
- Keep runtime dependencies in `dependencies` or `peerDependencies` as appropriate for Pi packages; keep tests and development tooling dev-only.
- Standardize repository development on pnpm workspace scripts. Do not introduce Bun as a runtime/test requirement.
- Migrate or replace the existing extension tests and helper-script tests, including smoke tests for package manifests/resource discovery and setup symlink behavior.

## Acceptance criteria

- The repository has a workspace layout with package roots for aggregate `pi-flow`, core workflow, and UX packages.
- Root scripts can run package build/test/check commands across the workspace.
- Each distributable package has a valid `package.json` with `keywords: ["pi-package"]` and an accurate Pi manifest.
- The aggregate package exposes core and UX resources through package dependencies/bundled resource paths rather than duplicated copies.
- Current non-browser skills from `../pi-config/agent/skills` are present, loadable, and no longer rely on the old `agent/skills/...` checkout layout.
- The current `fastlane` source is extracted under that spelling; no live `fast-lane` identifiers are reintroduced.
- Current workflow guardrails from `generate-plan`, `refine-plan`, `execute-plan`, and `fastlane` are preserved or intentionally replaced with equivalent tested behavior.
- Required subagent definitions are included in the core package and `/flow:setup` can make them discoverable by `@aphotic/pi-mux-subagents` from the matching install scope.
- `/flow:setup` is explicit, idempotent, scope-aware, conflict-safe, and reports created links/conflicts clearly.
- `/flow:idea`, `/flow:scout`, `/flow:spec`, `/flow:plan`, `/flow:refine-plan`, `/flow:execute`, `/flow:refine-code`, and `/flow:fastlane` are registered and can invoke packaged workflow entry points.
- The initial idea surface avoids generic `todo` command naming while remaining compatible with existing `TODO-<id>` storage/provenance.
- `pi-flow-ux` includes the intended footer, working indicator, and nord theme resources with current imports and correct runtime dependency declarations.
- Personal utilities, web-browser, unrelated external packages, personal docs artifacts, auth/session files, node_modules, and generated caches are absent from distributed package contents.
- README/docs explain the package split, primary install path, required `@aphotic/pi-mux-subagents` companion, `/flow:setup`, model-tier configuration, artifact directory conventions, and basic workflow entry points.
- A package-loading smoke test such as `pi -e <package>` shows expected skills/extensions/themes/commands without creating unintended agent symlinks.
- A real install/setup verification confirms subagent definitions are discoverable after `/flow:setup` and at least one minimal subagent-backed workflow path can dispatch.
- Migrated helper-script and included-extension tests pass, including manifest/resource and setup-symlink tests.

## Notes

This extraction should prefer a maintainable package boundary over preserving the old `pi-config` layout. Treat `../pi-config` as source material, not as a runtime dependency or an API contract.

Completed via plan: docs/plans/2026-05-19-cfcb8ede.md
