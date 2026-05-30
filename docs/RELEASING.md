# Releasing Pi-Flow

This guide covers publishing the Pi-Flow workspace packages to npm.

## Packages

The workspace root is private and must not be published. The publishable packages are:

- `@aphotic/pi-ideas` — standalone idea-capture extension
- `@aphotic/pi-flow-core` — workflow skills, agents, commands, and helper runner
- `@aphotic/pi-flow-ux` — optional border status/status placement, working indicator/message, theme, and packaged defaults
- `@aphotic/pi-flow` — aggregate install package that bundles the three packages above

> **Important:** do not run `pnpm pack` or `pnpm publish` directly for `@aphotic/pi-flow`. The aggregate uses `bundledDependencies`, which fails under pnpm's isolated linker. Use the package's `pack:aggregate` and `publish:aggregate` scripts instead.

## Prerequisites

Before releasing, ensure you have:

- `pnpm` installed and dependencies installed with `pnpm install`
- An npm account with publish access to the `@aphotic` organization
- npm authentication configured with `npm login` or `NPM_TOKEN`
- Any required npm 2FA/OTP code ready for the publish commands
- `gitleaks` or an equivalent git secret scanner available for the security audit
- A clean release branch or a clearly intentional set of release-only changes

## Security Audit

Treat security checks as a release prerequisite. Run them before publishing, and re-run them if dependency, release-tooling, or other non-version-only changes are introduced after the audit.

Capture the exact commands, exit codes, and redacted output in a release artifact, for example `/tmp/pi-flow-security-audit-$VERSION.md`.

```bash
git status --short --branch
git rev-parse HEAD
pnpm audit
pnpm audit --prod
gitleaks detect --source . --redact --no-banner
```

The release is blocked if:

- any dependency audit reports a vulnerability that should be remediated before release
- the secret scan reports any candidate leak
- the git status reveals unexpected local changes
- the security-audit commands cannot be run or their results cannot be reviewed

If `gitleaks` is unavailable, use an equivalent dedicated git-history secret scanner and record the exact tool and command. A simple `grep`/`rg` pattern scan is only a fallback and should be called out as less complete than a dedicated scanner.

## Version Bump

Pi-Flow does not currently use Changesets or an automated versioning tool. Bump the root package and every publishable package to the same release version before publishing.

For a release, set the target version and update every manifest from the repository root:

```bash
VERSION=0.7.0 node - <<'NODE'
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
VERSION=0.7.0
git status --short
git add package.json packages/*/package.json docs/RELEASING.md docs/releases/
git commit -m "Release $VERSION"
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
VERSION=0.7.0
npm view @aphotic/pi-ideas@"$VERSION" version
npm view @aphotic/pi-flow-core@"$VERSION" version
npm view @aphotic/pi-flow-ux@"$VERSION" version
npm view @aphotic/pi-flow@"$VERSION" version
```

Test installation through Pi:

```bash
pi install npm:@aphotic/pi-flow@"$VERSION"
```

If any verification step fails, investigate before declaring the release complete.

## Git Tag

Once the release is published and verified, tag the release commit and push:

```bash
VERSION=0.7.0
git tag "v$VERSION"
git push origin main --follow-tags
```
