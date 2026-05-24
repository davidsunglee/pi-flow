**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Approved

**Reasoning:** The diff satisfies the npm publication-prep requirements: publishable package identities, metadata, scoped internal references, packlist protections, and release docs are in place, and validation passed. Only minor documentation polish remains.

### Strengths

- `packages/pi-flow/package.json:2-19` correctly renames the aggregate package, keeps the `pi-flow` bin, scopes workspace dependencies, and updates forwarded `pi` manifest paths through `node_modules/@aphotic/...`.
- `packages/pi-flow-core/package.json:2-23` and `packages/pi-flow-ux/package.json:2-15` remove publish-blocking privacy, set version `0.5.0`, tighten peer/runtime ranges, and add packlist exclusions for test artifacts.
- `packages/pi-flow-core/package.json:35-50`, `packages/pi-flow-ux/package.json:25-40`, and `packages/pi-flow/package.json:21-36` add the expected npm metadata, Node engine, MIT license declaration, and public publish config.
- `packages/pi-flow/bin/pi-flow.mjs:13-17` updates the aggregate wrapper to resolve the scoped core package and reports a clear scoped-package failure when resolution fails.
- `packages/pi-flow-core/__tests__/packlist.test.mjs:19-43` plus the aggregate/UX packlist tests add direct dry-run coverage for required tarball contents and exclusion of test/build artifacts.
- Verified locally: `pnpm check` passed, all three `pnpm pack --dry-run --json` previews included expected files and excluded test fixtures, no install-time side-effect scripts were found, and an actual aggregate pack rewrote `workspace:*` dependencies to `0.5.0`.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

- **packages/pi-flow/README.md:3: Stale unscoped package names remain in aggregate README prose**
  - **What:** The opening paragraph still says the aggregate forwards resources through `pi-flow-core` and `pi-flow-ux`; line 26 also says to install the peer alongside `pi-flow`.
  - **Why it matters:** The install examples are correct, but these stale names slightly undercut the requirement to update documentation to scoped package names and may confuse readers scanning the README.
  - **Recommendation:** Change those prose references to `@aphotic/pi-flow-core`, `@aphotic/pi-flow-ux`, and `@aphotic/pi-flow` where package identity is intended.

- **docs/RELEASING.md:30: Release docs mention `.npmignore` despite using package `files` exclusions**
  - **What:** The verification checklist tells maintainers to ensure unwanted files are excluded via `.npmignore`, but this implementation uses `package.json` `files` allowlists/negations.
  - **Why it matters:** This is not functionally wrong for the package output, but it could send future maintainers looking for the wrong control surface.
  - **Recommendation:** Reword to reference package `files` entries or npm packlist configuration generically.

### Recommendations

- Consider adding an explicit manifest regression test for `private` being absent and license/publish metadata being present in all three publishable packages, so future publication readiness changes fail close to the manifests.
