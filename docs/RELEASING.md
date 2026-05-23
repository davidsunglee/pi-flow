# Releasing Pi-Flow

This guide covers the process for publishing the Pi-Flow packages to npm.

## Prerequisites

Before releasing, ensure you have:

- **pnpm** installed and up to date
- An npm account with access to the `@aphotic` organization
- Authentication configured via `npm login` or by setting the `NPM_TOKEN` environment variable

## Pre-publish Verification

Before proceeding with any publish steps, verify that the codebase is in a releasable state:

1. **Run tests and checks:**
   ```bash
   pnpm check
   ```
   This verifies that all tests pass and the codebase is ready for release.

2. **Preview package contents:**
   ```bash
   pnpm -r exec pnpm pack --dry-run
   ```
   This command previews the tarball contents for all packages in the workspace. Review the output carefully:
   - Verify that each tarball includes only intentional files
   - Check that generated files are included
   - Ensure that unwanted files (e.g., test fixtures, build artifacts) are excluded via `.npmignore`

## Dry-run Publish

Before publishing to the registry, simulate the publish process:

```bash
pnpm -r publish --dry-run --access public --no-git-checks
```

This command performs a dry-run publish of all packages without actually pushing to npm. Review the output carefully:

- Verify that scoped package names are correct (`@aphotic/pi-flow`, `@aphotic/pi-flow-core`, `@aphotic/pi-flow-ux`)
- Confirm that versions are correct and match your release plan
- Check that all files that will be published are included

## Publish

Once you're confident that the dry-run output is correct, perform the actual publish:

```bash
pnpm -r publish --access public --no-git-checks
```

This command publishes all three packages to the npm registry. 

**Key points:**
- The `--access public` flag ensures the packages are published publicly (required for scoped packages)
- The `--no-git-checks` flag allows publishing even if there are uncommitted changes (useful if you're publishing from a clean release branch)
- **Important:** pnpm automatically rewrites `workspace:*` references in `package.json` files to concrete semver versions during publishing. You don't need to manually update these.

## Publish Order

pnpm automatically handles dependency ordering when using `pnpm -r publish`. The packages are published in the correct order to satisfy internal dependencies. You don't need to manually manage the order.

## Post-publish Verification

After publishing, verify that the packages are available on npm and can be installed:

1. **Verify each package on npm:**
   ```bash
   npm view @aphotic/pi-flow
   npm view @aphotic/pi-flow-core
   npm view @aphotic/pi-flow-ux
   ```

2. **Test installation:**
   ```bash
   pi install npm:@aphotic/pi-flow
   ```

   This verifies that the package can be installed correctly using the Pi package manager.

If any of these verification steps fail, investigate the issue before declaring the release complete.
