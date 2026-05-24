{
  "id": "54a0dbec",
  "title": "Prepare pi-flow packages for npm publication under @aphotic",
  "tags": [
    "npm",
    "release",
    "publishing",
    "pi-flow"
  ],
  "status": "closed",
  "created_at": "2026-05-23T04:50:19.308Z"
}

## Context
pi-flow is a pnpm monorepo with three intended npm package entry points: an aggregate package, a core workflow package, and an optional UX package. The unscoped npm name `pi-flow` is already owned by another project, so the first public npm release should publish under the existing `@aphotic` organization scope, matching `@aphotic/pi-mux-subagents`. The repo currently uses workspace-local package names and `workspace:*` dependencies; publication should use `pnpm publish`/`pnpm pack` so workspace references are rewritten to concrete versions. The scoped npm publication should be the first public `0.5.0` release after the accumulated functional improvements are tagged and pushed.

## Goal
Prepare the repo to publish public npm packages as `@aphotic/pi-flow`, `@aphotic/pi-flow-core`, and `@aphotic/pi-flow-ux` at version `0.5.0`, with `@aphotic/pi-flow` as the documented default aggregate install and core/UX packages available as independently installable advanced options.

## Scope
- Rename publishable package manifests and all internal references from unscoped package names to `@aphotic`-scoped names.
- Keep the workspace root private, but make the three package manifests publishable.
- Preserve `@aphotic/pi-flow` as the aggregate/default package depending on `@aphotic/pi-flow-core` and `@aphotic/pi-flow-ux`.
- Update aggregate `pi` manifest paths, helper-runner resolution, tests, and documentation to use scoped `node_modules/@aphotic/...` paths and `npm:@aphotic/...` install examples.
- Add npm metadata to each publishable package: MIT license, repository with package directory, bugs, homepage, author, Node engine, and public npm `publishConfig`.
- Replace wildcard dependency/peer ranges with compatible ranges based on currently tested versions where practical, including `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox`.
- Trim npm tarballs to intentional runtime/documentation content, excluding tests, test fixtures, `__tests__`, `*.test.*`, helper script test directories, and `.gitkeep` files unless a runtime dependency is discovered.
- Add regression coverage for the intended packlist and publish manifest shape.
- Add lightweight release documentation and/or scripts for `pnpm check`, pack dry-runs, publish dry-runs, and final `pnpm publish`; defer Changesets until versioning/release management becomes painful.

## Acceptance Sketch
- Package manifests use `@aphotic/pi-flow`, `@aphotic/pi-flow-core`, and `@aphotic/pi-flow-ux` at version `0.5.0`.
- Root package remains private; the three package manifests no longer contain `private: true` or otherwise block npm publication.
- `@aphotic/pi-flow` remains the primary documented install path, while `@aphotic/pi-flow-core` and `@aphotic/pi-flow-ux` are documented as advanced/headless/UX-only options.
- `pnpm check` passes after renaming, metadata, dependency, packlist, and documentation updates.
- `pnpm pack --dry-run` or equivalent packlist tests confirm each package contains only intentional files and excludes tests/fixtures/build junk.
- The aggregate package's packed manifest rewrites workspace dependencies to publishable `@aphotic` semver dependencies.
- Release docs/scripts clearly require `pnpm publish` rather than raw `npm publish`, and include dry-run steps before publishing.

## Open Questions
- What exact compatible ranges should be chosen for the Pi peer dependencies and `typebox` after checking the currently installed/tested versions?
- Should the release docs include npm 2FA/OTP guidance and organization access checks, or keep the first pass focused only on repo-local commands?
- Should packlist trimming be implemented with `files` negations, nested `.npmignore` files, or both, given npm/pnpm pack behavior for subdirectories?

Completed via plan: docs/plans/2026-05-23-54a0dbec.md
