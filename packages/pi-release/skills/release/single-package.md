# Single-package release mechanics

Mechanics only. The security audit, notes review, readiness gate, and user-owned-action rules live in `SKILL.md`; this file is loaded after shape confirmation.

## Version bump

There is exactly one `package.json` in this project. Bump it directly:

1. Edit the `version` field in the sole `package.json` with a precise, targeted edit — change only that line. Do **not** run `npm version` (it creates a commit/tag and runs lifecycle hooks you do not want here).
2. Update the lockfile only if the project requires it — for example run `npm install --package-lock-only` (or the pnpm/yarn equivalent) so the lockfile's recorded version matches. Skip this if the project keeps no lockfile or does not pin its own version in it.
3. Review the change before going further:

```bash
git diff -- package.json
```

Confirm the diff touches only the `version` field (plus the lockfile if you updated it).

## Publish + verify

These commands are printed for the user to run themselves (per the spine's user-owned-action rule). Replace `<PACKAGE_NAME>` and `<VERSION>` with the values from `package.json`.

```bash
npm whoami
npm publish --dry-run --access public
npm publish --access public
npm view <PACKAGE_NAME>@<VERSION> version
```

Package-manager equivalents:

- **pnpm:** `pnpm publish --dry-run --access public`, then `pnpm publish --access public`.
- **yarn (Berry):** `yarn npm publish` (uses the `publishConfig.access` from `package.json`; pass `--access public` if not set there).

**Verification:** `npm view <PACKAGE_NAME>@<VERSION> version` returns the version you just released. If it returns the previous version or errors, the publish did not land — stop and investigate before declaring the release done.
