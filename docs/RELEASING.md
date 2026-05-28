# Releasing Pi-Flow

This guide covers publishing the Pi-Flow workspace packages to npm.

## Packages

The workspace root is private and must not be published. The publishable packages are:

- `@aphotic/pi-ideas` — standalone idea-capture extension
- `@aphotic/pi-flow-core` — workflow skills, agents, commands, and helper runner
- `@aphotic/pi-flow-ux` — optional footer/working indicator/theme resources
- `@aphotic/pi-flow` — aggregate install package that bundles the three packages above

> **Important:** do not run `pnpm pack` or `pnpm publish` directly for `@aphotic/pi-flow`. The aggregate uses `bundledDependencies`, which fails under pnpm's isolated linker. Use the package's `pack:aggregate` and `publish:aggregate` scripts instead.

## Prerequisites

Before releasing, ensure you have:

- `pnpm` installed and dependencies installed with `pnpm install`
- An npm account with publish access to the `@aphotic` organization
- npm authentication configured with `npm login` or `NPM_TOKEN`
- Any required npm 2FA/OTP code ready for the publish commands
- A clean release branch or a clearly intentional set of release-only changes

## Version Bump

Pi-Flow does not currently use Changesets or an automated versioning tool. Bump the root package and every publishable package to the same release version before publishing.

For a `0.6.0` release, one safe option from the repository root is:

```bash
VERSION=0.6.0 node - <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');

const version = process.env.VERSION;
const manifests = [
  'package.json',
  'packages/pi-ideas/package.json',
  'packages/pi-flow-core/package.json',
  'packages/pi-flow-ux/package.json',
  'packages/pi-flow/package.json',
];

for (const path of manifests) {
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}
NODE
```

Then review the diff:

```bash
git diff -- package.json packages/*/package.json
```

## Pre-publish Verification

Before any publish attempt, verify that the codebase is releasable:

```bash
pnpm check
```

Preview package contents for the non-aggregate packages:

```bash
pnpm --filter @aphotic/pi-ideas pack --dry-run
pnpm --filter @aphotic/pi-flow-core pack --dry-run
pnpm --filter @aphotic/pi-flow-ux pack --dry-run
```

Preview the aggregate package with its dedicated release guard:

```bash
pnpm --filter @aphotic/pi-flow run pack:aggregate -- --out "$PWD/dist"
```

Review the output carefully:

- Confirm package names and versions match the release plan
- Verify generated and runtime files are included
- Verify tests, fixtures, caches, and other unwanted files are excluded
- Confirm the aggregate tarball includes bundled core, UX, idea, and runtime dependency resources

Do not use `pnpm -r exec pnpm pack --dry-run` across the whole workspace; it will include `@aphotic/pi-flow` and fail on `bundledDependencies`.

## Release Commit

After versioning and pre-publish verification pass, commit the release changes so the publish commands run from a clean tree:

```bash
git status --short
git add package.json packages/*/package.json docs/RELEASING.md
git commit -m "Release 0.6.0"
```

If a later dry-run exposes a problem, fix it and amend or add a follow-up commit before publishing.

## Dry-run Publish

Dry-run the non-aggregate packages in dependency order:

```bash
pnpm --filter @aphotic/pi-ideas publish --dry-run --access public
pnpm --filter @aphotic/pi-flow-core publish --dry-run --access public
pnpm --filter @aphotic/pi-flow-ux publish --dry-run --access public
```

Dry-run the aggregate publish using the release-guarded tarball path:

```bash
pnpm --filter @aphotic/pi-flow run publish:aggregate -- --dry-run --access public
```

If npm 2FA requires an OTP during rehearsal or publishing, append it after the forwarded `--`, for example:

```bash
pnpm --filter @aphotic/pi-flow run publish:aggregate -- --dry-run --access public --otp 123456
```

## Publish

After the dry-runs look correct, publish the non-aggregate packages first:

```bash
pnpm --filter @aphotic/pi-ideas publish --access public
pnpm --filter @aphotic/pi-flow-core publish --access public
pnpm --filter @aphotic/pi-flow-ux publish --access public
```

Then publish the aggregate package:

```bash
pnpm --filter @aphotic/pi-flow run publish:aggregate -- --access public
```

Notes:

- `publishConfig.access` is already set to `public`, but the explicit `--access public` flag is harmless and useful for first-time scoped package publishes.
- pnpm rewrites `workspace:*` dependencies to concrete semver versions for the non-aggregate packages during publishing.
- `publish:aggregate` stages a clean tarball, rewrites `workspace:*` dependencies, bundles the three internal packages, runs the release guard, and publishes that exact tarball with `npm publish`.
- If you intentionally rehearse before committing, add `--no-git-checks` to the `pnpm publish --dry-run` commands. Avoid it for the final publish unless you explicitly accept publishing uncommitted local state.

## Post-publish Verification

Verify every package is visible at the released version:

```bash
VERSION=0.6.0
npm view @aphotic/pi-ideas@"$VERSION" version
npm view @aphotic/pi-flow-core@"$VERSION" version
npm view @aphotic/pi-flow-ux@"$VERSION" version
npm view @aphotic/pi-flow@"$VERSION" version
```

Test installation through Pi:

```bash
pi install npm:@aphotic/pi-flow@0.6.0
```

If any verification step fails, investigate before declaring the release complete.

## Git Tag

Once the release is published and verified, tag the release commit and push:

```bash
git tag v0.6.0
git push origin main --follow-tags
```
