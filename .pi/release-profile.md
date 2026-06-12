# Pi-Flow release profile

## Project shape

`monorepo` — a pnpm workspace (`pnpm-workspace.yaml: packages/*`).

## Publishable packages

Publish in this order (dependencies before dependents); the workspace root is **private and never published**:

1. `@aphotic/pi-ideas`
2. `@aphotic/pi-flow-core` (depends on `@aphotic/pi-ideas`)
3. `@aphotic/pi-flow-ux`
4. `@aphotic/pi-release`
5. `@aphotic/pi-flow` — aggregate, published **last** via its own script (see Publish tooling)

Version bump aligns all manifests to one shared version: the private root `package.json` plus `packages/pi-ideas`, `packages/pi-flow-core`, `packages/pi-flow-ux`, `packages/pi-release`, and `packages/pi-flow`.

## Publish tooling

`@aphotic/pi-flow` is an aggregate that uses `bundledDependencies`, which fails under pnpm's isolated linker. Never run raw `pnpm pack` / `pnpm publish` for it. Pack/publish it via its own scripts:

- preview: `pnpm --filter @aphotic/pi-flow run pack:aggregate -- --out "$PWD/dist"`
- dry-run: `pnpm --filter @aphotic/pi-flow run publish:aggregate -- --dry-run --access public`
- publish: `pnpm --filter @aphotic/pi-flow run publish:aggregate -- --access public`

The non-aggregate packages publish via `pnpm --filter <pkg> publish --access public` (pnpm rewrites `workspace:*` specs to concrete versions). Do not use `pnpm -r exec pnpm pack --dry-run` across the whole workspace — it includes the aggregate and fails on `bundledDependencies`.

## Release notes

Write persistent release notes to `docs/releases/<version>.md` (e.g. `docs/releases/0.9.0.md`), committed as part of the release commit. This is distinct from the ephemeral working-file default — the per-version notes are a durable, versioned record.

## Post-publish smoke tests

After the aggregate publishes, install the aggregate end-to-end:

- `pi install npm:@aphotic/pi-flow@<version>`

Then confirm each published package is visible on the registry at the new version:

- `npm view @aphotic/pi-ideas@<version> version`
- `npm view @aphotic/pi-flow-core@<version> version`
- `npm view @aphotic/pi-flow-ux@<version> version`
- `npm view @aphotic/pi-release@<version> version`
- `npm view @aphotic/pi-flow@<version> version`

## Hazards & notes

- Isolated-linker hazard: `@aphotic/pi-flow`'s `bundledDependencies` fail under pnpm's isolated linker — only pack/publish it through its `pack:aggregate` / `publish:aggregate` scripts, never raw `pnpm pack` / `pnpm publish`.
- Pi-flow uses manual version bumps (no Changesets); align every manifest to the one shared version by hand.
