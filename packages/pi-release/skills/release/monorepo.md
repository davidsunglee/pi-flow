# Monorepo release mechanics

Mechanics only. The security audit, notes review, readiness gate, and user-owned-action rules live in `SKILL.md`; this file is loaded after shape confirmation.

## Enumerate publishable packages

Discover packages generically — never hardcode package names:

1. Read the workspace metadata to find member globs:
   - **pnpm:** the `packages:` globs in `pnpm-workspace.yaml`.
   - **npm/yarn:** the `workspaces` array in the root `package.json`.
2. Expand the globs and collect every member `package.json`.
3. A package is **publishable** when it declares a `name` and does **not** set `private: true`.
4. The private workspace root (`private: true`) is bumped but **never published**.

If the release profile defines an explicit publishable set or order, honor it instead of (or layered over) this generic discovery.

## Version alignment

Bump **all** manifests to one shared version — every publishable package **and** the private root. Edit each `version` field with a precise, targeted edit (not `npm version`). Update lockfiles only if the project requires it, then review:

```bash
git diff -- '**/package.json'
```

Confirm every manifest now carries the same target version and that no other fields changed.

## Publish in dependency order

Derive the publish order from the workspace dependency graph: a package must be published **before** any package that depends on it (dependencies before dependents). Topologically sort the publishable set and publish in that order so each dependent resolves its just-published dependency.

**Honor a package's own pack/publish script.** A package that defines its own `pack:`/`publish:` script (for example `publish:aggregate`) is packed/published **via that script** — never via raw `pnpm pack` / `pnpm publish`. This covers aggregate packages whose `bundledDependencies` fail under pnpm's isolated linker.

## Publish + verify commands

These commands are printed for the user to run themselves (the spine owns the "never run these yourself" guardrail). Replace `<pkg>` with each package name in dependency order and `<VERSION>` with the shared target version.

Standard packages — dry-run first, then publish:

```bash
pnpm --filter <pkg> publish --dry-run --access public
pnpm --filter <pkg> publish --access public
```

Custom-script packages (those with their own `pack:`/`publish:` script) — run the script, passing flags after `--`:

```bash
pnpm --filter <pkg> run publish:<name> -- --dry-run --access public
pnpm --filter <pkg> run publish:<name> -- --access public
```

Verify each package after it publishes:

```bash
npm view <pkg>@<VERSION> version
```

Each `npm view <pkg>@<VERSION> version` must return the shared target version. If any package reports the previous version or errors, stop and investigate before publishing dependents.
