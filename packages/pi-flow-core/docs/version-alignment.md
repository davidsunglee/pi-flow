# Version Alignment — `pi-flow`

This document covers how to verify which `pi-flow` version is active in a
session, how Pi settings control pinning vs floating, how to use a local
checkout during development, and how `/flow:doctor --fix` repoints managed
links.

---

## Verifying which pi-flow version a session uses

Run `/flow:doctor` (no flags). The first line of the output is:

```text
Active pi-flow package: @aphotic/pi-flow-core@<version> (<root>)
```

The `<root>` value is `realpath(<bin>/..)` — exactly the same path
`bin/pi-flow.mjs` computes for `PACKAGE_ROOT` at runtime. What doctor reports
as the active package is what the runner uses to resolve helpers and templates.
See the [No-Fallback Guarantee](helper-runner.md#no-fallback-guarantee) in
`helper-runner.md` for why the root is the single source of truth for all
resource resolution.

---

## Pinning vs tracking latest via Pi settings

`.pi/settings.json` `packages` entries control which `pi-flow` install Pi
loads for a project:

- `npm:@aphotic/pi-flow@0.9.0` — **pinned**: Pi loads exactly version 0.9.0;
  no automatic updates.
- `npm:@aphotic/pi-flow` — **floating**: Pi loads the latest installed version
  of the package, which may advance across installs.

`/flow:doctor` reads these entries and reports each declared package row with
`(pinned, npm)` or `(floating, npm)` in the detail column. Doctor is
read-only with respect to settings: it reports what it finds and never writes
back.

To change whether a version is pinned or floating, edit the `packages` entry
in `.pi/settings.json` directly.

---

## Flow config and package pinning

A project-pinned pi-flow package (e.g. `npm:@aphotic/pi-flow@0.9.0` in `.pi/settings.json`) pairs naturally with a project-local `<project>/.pi/flow.json`: the dispatch config then matches the pinned core version, ensuring the flow config schema and the installed helpers stay in sync. The user/global `~/.pi/agent/flow.json` serves as the fallback for projects that do not carry their own `.pi/flow.json`.

`/flow:doctor` surfaces both the active package root and the resolved flow config path/scope. It warns when a project package is effective (i.e. a project-scoped install is active) but the flow config falls back to the user/global location — a sign that the project may benefit from a project-local `.pi/flow.json` to lock dispatch config alongside the pinned package.

See [`../skills/_shared/flow-config-resolution.md`](../skills/_shared/flow-config-resolution.md) for the full resolution algorithm.

---

## Using a local checkout for development

To develop against a local source tree, declare it as a local path in
`packages`:

```json
{
  "packages": [
    { "source": "packages/pi-flow-core" }
  ]
}
```

When `/flow:doctor` resolves a helper shim or agent symlink that points into a
path inside the active working tree — one that is not under `node_modules` or
`.pi/npm` — it classifies that link as a **local-dev override** and marks it
`[local-dev]` in the report. Doctor treats a local-dev override as intentional
and will never auto-clobber it.

To repoint managed links at a specific local checkout, use `--source`:

```sh
/flow:doctor --fix --source packages/pi-flow-core
```

See the next section for all `--source` forms.

---

## `/flow:doctor --fix` and `--source` target forms

Three invocations:

```
/flow:doctor
    inventory the managed surfaces and report version skew (read-only).
/flow:doctor --fix
    repoint the helper shim and agent symlinks at the reconcile target.
/flow:doctor --fix --source <target>
    repoint at an explicitly named target (required when ambiguous).
```

`--fix` repoints only the helper shim and agent symlinks. It refuses to clobber
a local-dev override or a real file, and requires `--source` when the intended
target is ambiguous (multiple packages declared/loaded).

`--source <target>` forms:

1. An absolute path to an `@aphotic/pi-flow-core` root — a directory with
   `bin/pi-flow.mjs` and a `package.json` whose name is `@aphotic/pi-flow-core`.

   ```sh
   /flow:doctor --fix --source /Users/me/src/pi-flow/packages/pi-flow-core
   ```

2. A cwd-relative path to the same kind of `@aphotic/pi-flow-core` root.

   ```sh
   /flow:doctor --fix --source ./packages/pi-flow-core
   ```

3. A checkout root or `@aphotic/pi-flow` meta-install that contains a single
   resolvable core at `packages/pi-flow-core` or
   `node_modules/@aphotic/pi-flow-core`.

   ```sh
   /flow:doctor --fix --source ./node_modules/@aphotic/pi-flow
   ```

---

## Mutation boundary

doctor never edits `.pi/settings.json`, never installs, and never creates a
pin file; to make a repoint durable, edit the `packages` entry in
`.pi/settings.json` yourself.

When settings alignment is needed — for example, when `--fix` repoints links
at a target not yet named in `packages` — doctor prints a `note:` line in the
fix report describing what to do. It prints guidance only; no file is written.
