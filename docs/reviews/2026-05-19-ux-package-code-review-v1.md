**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Approved with concerns

**Reasoning:** The standalone `pi-flow-ux` package is cleanly separated, loader-tested, and its three-tier working-settings behavior matches the plan. One Important finding is waived for this private/workspace branch because the verified local workspace path passes, but `packages/pi-flow/package.json:19` must be fixed before documenting or shipping `npm:pi-flow` as a production aggregate install.

### Strengths

- `pi-flow-ux` is isolated from `pi-flow-core`: core keeps no extension/theme/default-working resources, while the UX package owns the footer, working extensions, Nord theme, and packaged `working.json` (`packages/pi-flow-ux/package.json:22-25`, `packages/pi-flow-core/__tests__/package-manifest.test.mjs:213-236`).
- The working configuration merge is implemented at the right boundary: package defaults load first, user settings normalize against that baseline, and `/working` persists only to the user path (`packages/pi-flow-ux/extensions/working/working.ts:248-262`, `packages/pi-flow-ux/extensions/working/working.ts:452`).
- Regression coverage is strong for the new three-tier semantics, including partial user overlays, malformed user fallback, malformed package fail-loud behavior, user-path persistence, and coordinator keying (`packages/pi-flow-ux/extensions/working/working.test.ts:548-620`).
- The UX loader smoke test exercises Pi's actual `DefaultResourceLoader` and verifies discovery of footer, `/working`, and the Nord theme rather than only checking file existence (`packages/pi-flow-ux/__tests__/pi-loader-smoke.test.mjs:20-90`).
- Verification passed locally: `pnpm install`, `pnpm --filter pi-flow-ux exec tsc --noEmit`, and `pnpm -r test` all exited 0.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

- **`packages/pi-flow/package.json:19`: Aggregate UX forwarding assumes the workspace symlink layout**
  - **What:** The aggregate manifest forwards UX resources via `node_modules/pi-flow-ux/...` relative to the `pi-flow` package root. That resolves in this repo because `packages/pi-flow/node_modules/pi-flow-ux` is a pnpm workspace symlink, but a default npm-style install of packed packages hoists `pi-flow-ux` as a sibling (`node_modules/pi-flow-ux`) and leaves no `node_modules/pi-flow/node_modules/pi-flow-ux`; Pi resolves manifest entries relative to the aggregate package root, so the forwarded UX entries are silently absent. I reproduced this by packing `pi-flow`, `pi-flow-core`, and `pi-flow-ux`, npm-installing them into a temp consumer, and observing all aggregate manifest paths under `node_modules/pi-flow/node_modules/...` resolve false.
  - **Why it matters:** The documented single-package `npm:pi-flow` install can appear successful while loading none of the forwarded UX resources (and the same dependency-layout assumption also affects the existing forwarded skills path). That is a production-readiness gap for the aggregate package, even though the current private workspace/local path passes.
  - **Recommendation:** Add a packed-consumer/Pi package-manager smoke test that uses the default npm install layout, then change aggregate forwarding to a layout Pi can resolve after installation (for example, validated sibling-relative entries, included thin forwarder files, or PackageManager support for dependency resource references). Until then, scope the README install guidance to the verified workspace/local layout.

#### Minor (Nice to Have)

- **`packages/pi-flow/README.md:78`: Aggregate install summary only mentions skill discovery**
  - **What:** The post-install paragraph shows only the `pi.skills` glob, even though the aggregate now also exposes UX resources through `pi.extensions` and `pi.themes`.
  - **Why it matters:** Readers can miss where the footer, working extension, and Nord theme are coming from.
  - **Recommendation:** Add one sentence or snippet that lists the forwarded UX manifest entries alongside the skills glob.

### Recommendations

- Add the packed-consumer aggregate resource-discovery probe to CI; the existing workspace-symlink assertions are useful but do not cover the package-manager layout users will get from `npm:pi-flow`.
