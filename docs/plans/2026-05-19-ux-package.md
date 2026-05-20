# Package Optional UX Layer (`pi-flow-ux`)

**Source:** TODO-cfcb8ede
**Spec:** `docs/specs/2026-05-19-ux-package.md`
**Scout brief:** `docs/briefs/2026-05-20-2026-05-19-ux-package-md-brief.md`

## Goal

Carve the optional UX polish from `../pi-config/agent/` into a new workspace package, `packages/pi-flow-ux/`, while keeping `pi-flow-core` independently usable without extensions, themes, or UX defaults.

## Architecture summary

Add a third workspace package, `pi-flow-ux`, that owns the footer extension, working indicator/message extension subtree, Nord theme, and packaged `working.json` default. The aggregate `pi-flow` package forwards UX resources through its `node_modules/pi-flow-ux/...` workspace symlink, matching the existing `pi-flow-core` forwarding pattern and avoiding duplicated source. The working extension keeps user overrides in `~/.pi/agent/working.json` while adding a package-default layer from `packages/pi-flow-ux/working.json` between hardcoded defaults and user config.

## Tech stack

Node.js ESM workspace managed by pnpm; TypeScript extension sources loaded/tested with Node's `--experimental-strip-types`; package resources consumed by `@earendil-works/pi-coding-agent`; UI helpers from `@earendil-works/pi-tui`; tests use the built-in Node test runner plus existing package-manifest tests.

## File Structure

- `packages/pi-flow-ux/package.json` (Create) — standalone UX package manifest, scripts, peer/dev dependencies, `pi` resource manifest, and package `files` list.
- `packages/pi-flow-ux/tsconfig.json` (Create) — TypeScript configuration matching `../pi-config/agent/tsconfig.json` for no-emit source shipping.
- `packages/pi-flow-ux/extensions/footer.ts` (Create) — ported custom footer extension with `@earendil-works/*` imports.
- `packages/pi-flow-ux/extensions/footer.test.ts` (Create) — migrated footer tests run under Node with strip-types.
- `packages/pi-flow-ux/extensions/working/effects.ts` (Create) — working animation rendering helpers.
- `packages/pi-flow-ux/extensions/working/index.ts` (Create) — Pi loader entry point registering indicator and message extensions.
- `packages/pi-flow-ux/extensions/working/indicator.ts` (Create) — working indicator extension factory with package-default path support.
- `packages/pi-flow-ux/extensions/working/message.ts` (Create) — working message extension factory with package-default path support.
- `packages/pi-flow-ux/extensions/working/messages.ts` (Create) — working-message catalog and picker.
- `packages/pi-flow-ux/extensions/working/working.ts` (Create) — shared coordinator, settings normalization, package default loading, user override loading, and persistence.
- `packages/pi-flow-ux/extensions/working/*.test.ts` (Create) — migrated and expanded working extension tests.
- `packages/pi-flow-ux/themes/nord.json` (Create) — packaged Nord theme.
- `packages/pi-flow-ux/working.json` (Create) — packaged Nord-tuned working defaults.
- `packages/pi-flow-ux/__tests__/package-manifest.test.mjs` (Create) — UX package manifest/resource/exclusion tests.
- `packages/pi-flow-ux/__tests__/pi-loader-smoke.test.mjs` (Create, if loader or CLI discovery can be exercised) — actual Pi loader/CLI discovery smoke test for footer, working, and nord.
- `packages/pi-flow-ux/README.md` (Create) — standalone and aggregate UX package documentation.
- `packages/pi-flow/package.json` (Modify) — add `pi-flow-ux` dependency and forward UX resources in the aggregate `pi` manifest.
- `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs` (Modify) — add aggregate UX dependency, symlink, manifest, and no-duplicate-source assertions.
- `packages/pi-flow/README.md` (Create/Modify) — document opinionated aggregate UX inclusion and direct `pi-flow-core` option for minimal/headless users.
- `packages/pi-flow-core/package.json` (Unchanged) — remains UX-free; tests assert no UX resource manifest entries are added.
- `packages/pi-flow-core/__tests__/package-manifest.test.mjs` (Modify only if needed) — optionally add explicit no-UX assertions while preserving existing checks.

## Tasks

### Task 1: Scaffold `pi-flow-ux` and resolve Pi package preflight decisions

**Files:**
- Create: `packages/pi-flow-ux/package.json`, `packages/pi-flow-ux/tsconfig.json`
- Create: `packages/pi-flow-ux/extensions/.gitkeep`, `packages/pi-flow-ux/themes/.gitkeep`, `packages/pi-flow-ux/__tests__/.gitkeep`
- Modify: `pnpm-lock.yaml`
- Test: `packages/pi-flow-ux/package.json`

**Steps:**
- [ ] **Step 1: Create the package directory skeleton** — create `packages/pi-flow-ux/`, `packages/pi-flow-ux/extensions/`, `packages/pi-flow-ux/themes/`, and `packages/pi-flow-ux/__tests__/`.
- [ ] **Step 2: Write a minimal dependency-bearing `package.json` first** — include `name: "pi-flow-ux"`, `version: "0.1.0"`, `private: true`, `type: "module"`, `peerDependencies` for `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` with `"*"` ranges, and matching `devDependencies` so `pnpm install` materializes local `@earendil-works/*` packages for inspection.
- [ ] **Step 3: Run `pnpm install` from the repository root** — this updates the lockfile and makes both workspace and hoisted dependency paths available for the V1/V2 checks.
- [ ] **Step 4: Resolve V1 package manifest field names from authoritative Pi sources** — inspect installed `@earendil-works/*` package metadata, loader code, and docs for extension/theme package manifest fields; use commands such as `node --print "JSON.parse(require('node:fs').readFileSync(require.resolve('@earendil-works/pi-coding-agent/package.json'),'utf8'))"` and `grep -rn "pi.extensions\|pi.themes\|manifest\.extensions\|manifest\.themes\|loadExtensions\|loadThemes" node_modules/@earendil-works`.
- [ ] **Step 5: Stop if V1 is ambiguous** — if loader code or Pi package docs do not confirm exact field names for both extensions and themes, stop and ask the user before writing final manifests; do not guess from `pi-config/agent/settings.json`.
- [ ] **Step 6: Resolve V2 runtime TypeScript loading** — confirm Pi can load `.ts` extensions natively by finding runtime loader evidence such as `experimental-strip-types`, `stripTypes`, or equivalent loader code in installed Pi sources, or by running an existing `.ts` extension through Pi locally.
- [ ] **Step 7: Write final `packages/pi-flow-ux/package.json`** — keep the peer/dev dependencies from Step 2, add `description`, `keywords: ["pi-package"]`, `files: ["extensions", "themes", "working.json"]`, scripts `test:node`, `test`, and `check`, and add `pi` manifest entries using the exact field names from V1. If V2 says Pi requires compiled `.js`, update this manifest to point at compiled `.js` resources and include an explicit build/prepublish step instead of `.ts` entry points.
- [ ] **Step 8: Write `tsconfig.json`** — mirror `../pi-config/agent/tsconfig.json` with NodeNext module settings, `allowImportingTsExtensions`, `noEmit`, and `strict` mode.
- [ ] **Step 9: Record preflight evidence** — include the chosen manifest field names, confirming source file/line(s), TypeScript-loading decision, and source path used for Pi inspection in the implementation commit message.

**Acceptance criteria:**
- `packages/pi-flow-ux/package.json` exists with the correct package identity, package keyword, peer dependencies, dev dependencies, no side-effect install scripts, and final `pi` manifest field names resolved from V1.
  Verify: `node -e "const p=require('/Users/david/Code/pi-flow/packages/pi-flow-ux/package.json'); if(p.name!=='pi-flow-ux'||p.type!=='module'||!p.private) throw 1; if(!p.keywords.includes('pi-package')) throw 2; for (const d of ['@earendil-works/pi-coding-agent','@earendil-works/pi-tui']) { if(p.peerDependencies[d]!=='*'||!p.devDependencies[d]) throw new Error(d); } for (const s of ['preinstall','install','postinstall','setup']) if(p.scripts&&p.scripts[s]) throw new Error('side-effect script '+s); if(!p.pi) throw new Error('missing pi manifest');"` exits 0.
- V1 evidence identifies authoritative extension and theme manifest field names before any final UX resource forwarding is implemented.
  Verify: read the implementation commit message or task notes and confirm it names the exact Pi source file/line or docs section used to choose the extension and theme manifest keys.
- V2 evidence states whether the package ships `.ts` entry points or compiled `.js` entry points, and later manifest paths match that decision.
  Verify: read the implementation commit message or task notes and confirm it records the runtime TypeScript-loading evidence; then run `node -e "const p=require('/Users/david/Code/pi-flow/packages/pi-flow-ux/package.json'); const text=JSON.stringify(p.pi); if(text.includes('.ts')&&text.includes('.js')) throw new Error('mixed ts/js resource entries');"` and confirm exit code 0.
- `packages/pi-flow-ux/tsconfig.json` is valid JSON with NodeNext module settings, strict mode, no emit, and `allowImportingTsExtensions`.
  Verify: `node -e "const c=require('/Users/david/Code/pi-flow/packages/pi-flow-ux/tsconfig.json').compilerOptions; if(c.module!=='NodeNext'||c.moduleResolution!=='NodeNext'||!c.strict||!c.noEmit||!c.allowImportingTsExtensions) throw 1;"` exits 0.

**Model recommendation:** standard

### Task 2: Port the footer extension and preserve behavior

**Files:**
- Create: `packages/pi-flow-ux/extensions/footer.ts`
- Create: `packages/pi-flow-ux/extensions/footer.test.ts`
- Test: `packages/pi-flow-ux/extensions/footer.test.ts`

**Steps:**
- [ ] **Step 1: Copy the footer source** — copy `../pi-config/agent/extensions/footer.ts` to `packages/pi-flow-ux/extensions/footer.ts`.
- [ ] **Step 2: Rewrite package imports** — replace `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` imports with `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.
- [ ] **Step 3: Copy the footer tests** — copy `../pi-config/agent/extensions/footer.test.ts` to `packages/pi-flow-ux/extensions/footer.test.ts` and apply the same import rewrite.
- [ ] **Step 4: Run the migrated footer tests** — run the footer test directly with Node's strip-types support.
- [ ] **Step 5: Typecheck the package** — run `pnpm --filter pi-flow-ux exec tsc --noEmit`; if upstream API drift appears, narrow the fix to the actual changed type or signature and avoid `any` unless the upstream type is truly unavailable.

**Acceptance criteria:**
- The footer source and tests exist in `pi-flow-ux` and no `@mariozechner/*` imports remain in either file.
  Verify: `test -s /Users/david/Code/pi-flow/packages/pi-flow-ux/extensions/footer.ts && test -s /Users/david/Code/pi-flow/packages/pi-flow-ux/extensions/footer.test.ts && ! grep -R "@mariozechner" /Users/david/Code/pi-flow/packages/pi-flow-ux/extensions/footer.ts /Users/david/Code/pi-flow/packages/pi-flow-ux/extensions/footer.test.ts` exits 0.
- The port preserves the existing footer behavior tests, including visibility priority, context escalation, provider/model/thinking formatting, status rendering, sanitization, metric joining, and stub-pi integration behavior.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux exec node --experimental-strip-types --test extensions/footer.test.ts` exits 0 and reports the migrated footer test file as passing.
- The footer port typechecks against `@earendil-works/*` without broad type erasure.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux exec tsc --noEmit` exits 0 and `grep -R "as any\|: any" /Users/david/Code/pi-flow/packages/pi-flow-ux/extensions/footer.ts` produces no new matches introduced by this task.

**Model recommendation:** standard

### Task 3: Port the working extension subtree at baseline behavior

**Files:**
- Create: `packages/pi-flow-ux/extensions/working/effects.ts`, `packages/pi-flow-ux/extensions/working/index.ts`, `packages/pi-flow-ux/extensions/working/indicator.ts`, `packages/pi-flow-ux/extensions/working/message.ts`, `packages/pi-flow-ux/extensions/working/messages.ts`, `packages/pi-flow-ux/extensions/working/working.ts`
- Create: `packages/pi-flow-ux/extensions/working/effects.test.ts`, `packages/pi-flow-ux/extensions/working/indicator.test.ts`, `packages/pi-flow-ux/extensions/working/message.test.ts`, `packages/pi-flow-ux/extensions/working/working.test.ts`
- Test: `packages/pi-flow-ux/extensions/working/*.test.ts`

**Steps:**
- [ ] **Step 1: Copy the working subtree** — copy the complete `../pi-config/agent/extensions/working/` directory into `packages/pi-flow-ux/extensions/working/`, including tests that exist in the source tree.
- [ ] **Step 2: Rewrite imports** — replace all `@mariozechner/pi-coding-agent` imports in the copied working files with `@earendil-works/pi-coding-agent`.
- [ ] **Step 3: Preserve the loader entry shape** — keep `extensions/working/index.ts` as the Pi entry point that registers both the indicator and message extensions.
- [ ] **Step 4: Run baseline working tests before behavioral changes** — run only the copied working test files before implementing the package-default configuration change, so package rename regressions are isolated from new behavior.
- [ ] **Step 5: Typecheck baseline working code** — run `pnpm --filter pi-flow-ux exec tsc --noEmit` and fix only rename/API drift that is proven by type errors.

**Acceptance criteria:**
- The working source files and test files are present under `packages/pi-flow-ux/extensions/working/`.
  Verify: `for f in effects.ts index.ts indicator.ts message.ts messages.ts working.ts indicator.test.ts message.test.ts working.test.ts; do test -s "/Users/david/Code/pi-flow/packages/pi-flow-ux/extensions/working/$f" || exit 1; done` exits 0; include `effects.test.ts` in the same check if it exists in `../pi-config/agent/extensions/working/`.
- No `@mariozechner/*` imports remain in the `pi-flow-ux` working subtree.
  Verify: `! grep -R "@mariozechner" /Users/david/Code/pi-flow/packages/pi-flow-ux/extensions/working` exits 0.
- Baseline working tests pass before the two-tier configuration change is added.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux exec node --experimental-strip-types --test extensions/working/*.test.ts` exits 0 before Task 4 changes are applied.
- The baseline working port typechecks against `@earendil-works/pi-coding-agent`.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux exec tsc --noEmit` exits 0 after import rewrites and before Task 4 changes.

**Model recommendation:** standard

### Task 4: Implement packaged-default plus user-override working settings

**Files:**
- Modify: `packages/pi-flow-ux/extensions/working/working.ts`
- Modify: `packages/pi-flow-ux/extensions/working/indicator.ts`
- Modify: `packages/pi-flow-ux/extensions/working/message.ts`
- Modify: `packages/pi-flow-ux/extensions/working/index.ts`
- Modify: `packages/pi-flow-ux/extensions/working/working.test.ts`, `packages/pi-flow-ux/extensions/working/indicator.test.ts`, `packages/pi-flow-ux/extensions/working/message.test.ts`
- Test: `packages/pi-flow-ux/extensions/working/*.test.ts`

**Steps:**
- [ ] **Step 1: Add package-default path support** — in `working.ts`, export `PACKAGE_DEFAULT_SETTINGS_PATH = path.join(import.meta.dirname, "..", "..", "working.json")` so the path resolves to `packages/pi-flow-ux/working.json` when the source is loaded.
- [ ] **Step 2: Add packaged default loading** — export `loadPackagedDefaultSettings(packagePath: string): Promise<WorkingSettings | undefined>` that reads the packaged JSON, normalizes it against `DEFAULT_WORKING_SETTINGS`, returns `undefined` only when the package file is missing, and throws on malformed packaged JSON.
- [ ] **Step 3: Refactor normalization to accept a fallback** — change `normalizeWorkingSettings(raw)` to `normalizeWorkingSettings(raw, fallback: WorkingSettings = DEFAULT_WORKING_SETTINGS)` and have every missing or invalid field fall back to the supplied baseline instead of hardcoded defaults.
- [ ] **Step 4: Refactor user settings loading** — change `loadSavedWorkingSettings(settingsPath, fallback)` to normalize user JSON against the supplied fallback, while preserving the existing one-argument behavior by defaulting fallback to `DEFAULT_WORKING_SETTINGS`.
- [ ] **Step 5: Change coordinator startup merge order** — in the `session_start` handler, load `packaged = await loadPackagedDefaultSettings(this.packageDefaultPath)`, compute `baseline = packaged ?? cloneDefaultSettings()`, then load `user = await loadSavedWorkingSettings(this.settingsPath, baseline)` and set `this.settings = user ?? baseline`.
- [ ] **Step 6: Thread `packageDefaultPath` through factories** — extend `WorkingCoordinator` and `getWorkingCoordinator` to accept an optional package default path while keeping the singleton keyed by user `settingsPath`; subsequent calls with the same `settingsPath` and a different `packageDefaultPath` should throw a programming error.
- [ ] **Step 7: Preserve persistence target** — confirm all `/working` mutations still call `saveWorkingSettings` with the user `settingsPath`, never `PACKAGE_DEFAULT_SETTINGS_PATH`.
- [ ] **Step 8: Update tests for three-tier behavior** — add tests for no user/no package → code default, packaged-only → packaged default, full user → user wins, partial user → user field overrides packaged while other fields stay packaged, malformed user JSON → packaged baseline, and `/working` writes only to the user path.
- [ ] **Step 9: Isolate indicator/message tests from packaged defaults** — update tests that expect code-level defaults to pass temp paths for both user settings and package defaults, so they do not accidentally depend on the real packaged `working.json`.
- [ ] **Step 10: Run working tests and typecheck** — run `pnpm --filter pi-flow-ux test` and `pnpm --filter pi-flow-ux exec tsc --noEmit`.

**Acceptance criteria:**
- `working.ts` exports `PACKAGE_DEFAULT_SETTINGS_PATH`, `loadPackagedDefaultSettings`, and fallback-aware `normalizeWorkingSettings` / `loadSavedWorkingSettings` signatures.
  Verify: `grep -nE "PACKAGE_DEFAULT_SETTINGS_PATH|loadPackagedDefaultSettings|normalizeWorkingSettings\(.*fallback|loadSavedWorkingSettings\(.*fallback" /Users/david/Code/pi-flow/packages/pi-flow-ux/extensions/working/working.ts` returns matches for all four concepts.
- Partial user settings overlay the packaged default field-by-field rather than reverting unspecified fields to code defaults.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux exec node --experimental-strip-types --test extensions/working/working.test.ts --test-name-pattern "partial user"` exits 0 and the test asserts a user value such as `indicatorShape: "dot"` overrides while color/gleam/rainbow fields remain from the packaged baseline.
- Malformed user JSON falls back to the packaged baseline, while malformed packaged JSON fails loudly.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux exec node --experimental-strip-types --test extensions/working/working.test.ts --test-name-pattern "malformed"` exits 0 and includes separate cases for malformed user JSON and malformed packaged JSON.
- `/working` persistence writes only to the user settings path and never mutates the package default file.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux exec node --experimental-strip-types --test extensions/working/working.test.ts --test-name-pattern "user path"` exits 0 and the test asserts the packaged file mtime/content is unchanged after a `/working` mutation.
- All UX package tests and typechecking pass after the configuration change.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux test && pnpm --filter pi-flow-ux exec tsc --noEmit` exits 0.

**Model recommendation:** capable

### Task 5: Package the Nord theme and default working config

**Files:**
- Create: `packages/pi-flow-ux/themes/nord.json`
- Create: `packages/pi-flow-ux/working.json`
- Modify: `packages/pi-flow-ux/package.json`
- Test: `packages/pi-flow-ux/themes/nord.json`, `packages/pi-flow-ux/working.json`

**Steps:**
- [ ] **Step 1: Copy the Nord theme** — copy `../pi-config/agent/themes/nord.json` to `packages/pi-flow-ux/themes/nord.json`.
- [ ] **Step 2: Check theme schema URL** — if V1/Pi docs or installed package files reveal a current `earendil-works` theme schema URL, update `$schema`; if no current URL is discoverable, leave the existing URL and note that schema URLs are advisory in the commit message.
- [ ] **Step 3: Copy the working default** — copy `../pi-config/agent/working.json` to `packages/pi-flow-ux/working.json` byte-for-byte.
- [ ] **Step 4: Confirm package files coverage** — ensure `packages/pi-flow-ux/package.json` includes `working.json` and `themes` in its `files` array.
- [ ] **Step 5: Run JSON checks** — parse both JSON files and confirm `working.json` has the Nord-tuned pulse defaults.

**Acceptance criteria:**
- The Nord theme exists and parses as JSON.
  Verify: `node -e "JSON.parse(require('node:fs').readFileSync('/Users/david/Code/pi-flow/packages/pi-flow-ux/themes/nord.json','utf8'))"` exits 0.
- `working.json` exists, matches the source file byte-for-byte, and contains the Nord pulse default.
  Verify: `diff -q /Users/david/Code/pi-flow/packages/pi-flow-ux/working.json /Users/david/Code/pi-config/agent/working.json && node -e "const s=JSON.parse(require('node:fs').readFileSync('/Users/david/Code/pi-flow/packages/pi-flow-ux/working.json','utf8')); if(s.indicatorShape!=='pulse') throw 1;"` exits 0.
- The UX package includes `working.json` and `themes` in the package `files` list.
  Verify: `node -e "const p=require('/Users/david/Code/pi-flow/packages/pi-flow-ux/package.json'); for (const x of ['working.json','themes']) if(!p.files.includes(x)) throw new Error(x);"` exits 0.

**Model recommendation:** cheap

### Task 6: Wire the aggregate package without changing core

**Files:**
- Modify: `packages/pi-flow/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `packages/pi-flow/package.json`, `packages/pi-flow-core/package.json`

**Steps:**
- [ ] **Step 1: Add the UX workspace dependency** — add `"pi-flow-ux": "workspace:*"` to `packages/pi-flow/package.json` dependencies.
- [ ] **Step 2: Forward UX resources through the aggregate manifest** — extend the aggregate `pi` manifest with the resolved extension/theme field names from Task 1, pointing to `node_modules/pi-flow-ux/extensions/footer.ts`, `node_modules/pi-flow-ux/extensions/working/index.ts`, and `node_modules/pi-flow-ux/themes/nord.json` or their compiled `.js` equivalents if V2 required compilation.
- [ ] **Step 3: Do not duplicate UX sources in the aggregate** — do not add `extensions/` or `themes/` directories to `packages/pi-flow`, and do not add them to the aggregate `files` array.
- [ ] **Step 4: Leave core UX-free** — do not add extension/theme manifest fields, UX dependencies, or UX source directories to `packages/pi-flow-core`.
- [ ] **Step 5: Run `pnpm install`** — update workspace symlinks and lockfile so `packages/pi-flow/node_modules/pi-flow-ux` exists.

**Acceptance criteria:**
- The aggregate depends on `pi-flow-ux` and forwards UX resources through `node_modules/pi-flow-ux/...`.
  Verify: `node -e "const p=require('/Users/david/Code/pi-flow/packages/pi-flow/package.json'); if(p.dependencies['pi-flow-ux']!=='workspace:*') throw 1; const manifest=JSON.stringify(p.pi); for (const s of ['node_modules/pi-flow-ux/extensions/footer','node_modules/pi-flow-ux/extensions/working/index','node_modules/pi-flow-ux/themes/nord.json']) if(!manifest.includes(s)) throw new Error(s);"` exits 0.
- The aggregate has no duplicated UX source directories.
  Verify: `test ! -d /Users/david/Code/pi-flow/packages/pi-flow/extensions && test ! -d /Users/david/Code/pi-flow/packages/pi-flow/themes` exits 0.
- The aggregate workspace symlink resolves to `packages/pi-flow-ux`.
  Verify: `cd /Users/david/Code/pi-flow && realpath packages/pi-flow/node_modules/pi-flow-ux | grep -F '/packages/pi-flow-ux'` exits 0.
- `pi-flow-core` remains UX-free.
  Verify: `node -e "const p=require('/Users/david/Code/pi-flow/packages/pi-flow-core/package.json'); const text=JSON.stringify(p.pi||{}); if(text.includes('extensions')||text.includes('themes')) throw 1;" && test ! -d /Users/david/Code/pi-flow/packages/pi-flow-core/extensions && test ! -d /Users/david/Code/pi-flow/packages/pi-flow-core/themes` exits 0.

**Model recommendation:** standard

### Task 7: Add package manifest, aggregate forwarding, and loader smoke tests

**Files:**
- Create: `packages/pi-flow-ux/__tests__/package-manifest.test.mjs`
- Create: `packages/pi-flow-ux/__tests__/pi-loader-smoke.test.mjs`
- Modify: `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs`
- Modify: `packages/pi-flow-core/__tests__/package-manifest.test.mjs`
- Test: `packages/pi-flow-ux/__tests__/*.test.mjs`, `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs`, `packages/pi-flow-core/__tests__/package-manifest.test.mjs`

**Steps:**
- [ ] **Step 1: Add the UX package manifest test** — model it on `packages/pi-flow-core/__tests__/package-manifest.test.mjs`; assert keyword, resolved extension entries, resolved theme entries, `working.json`, excluded personal extensions absent, no side-effect scripts, and peer dependencies.
- [ ] **Step 2: Reuse or copy the glob-expansion helper intentionally** — import an existing helper if practical; otherwise copy the helper with a comment that it mirrors aggregate/core test duplication.
- [ ] **Step 3: Extend aggregate forwarding tests** — assert `pi-flow-ux` dependency, symlink realpath, UX resource paths resolving through `node_modules/pi-flow-ux`, and absence of aggregate-owned `extensions/` or `themes/` directories.
- [ ] **Step 4: Add or preserve core no-UX assertions** — ensure `packages/pi-flow-core/__tests__/package-manifest.test.mjs` still passes and, if needed, add explicit assertions that core has no extension/theme manifest entries and no UX source directories.
- [ ] **Step 5: Add the Pi loader smoke test for `pi-flow-ux`** — prefer a loader-driven test if Task 1 found an importable loader; otherwise use a CLI-driven smoke test that lists or prints discovered resources and checks for footer, working, and nord.
- [ ] **Step 6: Stop if loader/CLI discovery cannot be tested** — if neither a programmatic loader nor a CLI listing/probe can verify resource discovery, stop and ask the user before declaring the package shippable on manifest tests alone.
- [ ] **Step 7: Ensure smoke tests run under the package test script** — make `pnpm --filter pi-flow-ux test` run the loader/CLI smoke test from Step 5.
- [ ] **Step 8: Run package and aggregate tests** — run `pnpm --filter pi-flow-ux test`, `pnpm --filter pi-flow test`, and `pnpm --filter pi-flow-core test`.

**Acceptance criteria:**
- The UX manifest test asserts package identity, resolved UX resource entries, `working.json`, excluded personal extension absence, no side-effect scripts, and required peers.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux exec node --test __tests__/package-manifest.test.mjs` exits 0; reading the test confirms it names `extensions/footer`, `extensions/working/index`, `themes/nord.json`, `working.json`, and each excluded extension from the spec.
- The aggregate forwarding test covers the UX package dependency, symlink, manifest forwarding, and no duplicated source directories.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow exec node --test __tests__/aggregate-forwarding.test.mjs` exits 0 and the test file contains assertions for `pi-flow-ux`, `node_modules/pi-flow-ux`, `footer`, `working/index`, `nord`, and absence of aggregate `extensions/` / `themes/` directories.
- The core package test still passes and guards against accidental UX resources in core.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-core test` exits 0 and `packages/pi-flow-core/__tests__/package-manifest.test.mjs` contains either existing or new assertions that UX-related directories are absent.
- A loader-driven or CLI-driven smoke test verifies actual discovery of footer, working, and nord from `pi-flow-ux`, not just manifest path existence.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux exec node --test __tests__/pi-loader-smoke.test.mjs` exits 0 and the test fails loudly if footer, working, or nord is absent from the loader/CLI-discovered resource list.
- All relevant package tests pass through their package scripts.
  Verify: `cd /Users/david/Code/pi-flow && pnpm --filter pi-flow-ux test && pnpm --filter pi-flow test && pnpm --filter pi-flow-core test` exits 0.

**Model recommendation:** capable

### Task 8: Document standalone UX, aggregate UX, and minimal core usage

**Files:**
- Create: `packages/pi-flow-ux/README.md`
- Create: `packages/pi-flow/README.md`
- Modify: `README.md`
- Test: `packages/pi-flow-ux/README.md`, `packages/pi-flow/README.md`, `README.md`

**Steps:**
- [ ] **Step 1: Write `packages/pi-flow-ux/README.md`** — cover what the package provides: footer, working indicator/message, Nord theme, and Nord-tuned packaged working default.
- [ ] **Step 2: Document standalone install/use** — describe how to install or reference `pi-flow-ux` as a standalone Pi package and list the resources it exposes.
- [ ] **Step 3: Document aggregate install/use** — describe that installing `pi-flow` includes UX resources through the aggregate forwarding manifest.
- [ ] **Step 4: Document Nord activation** — use the exact theme activation command or settings key confirmed from Pi docs/loader inspection; if no exact command exists, document the confirmed mechanism rather than guessing.
- [ ] **Step 5: Document working config precedence** — explain packaged `working.json` defaults, user override path `~/.pi/agent/working.json`, partial-user overlay semantics, `/working` persistence to the user path, and malformed-user fallback to packaged defaults.
- [ ] **Step 6: Write or update `packages/pi-flow/README.md`** — state that the aggregate is opinionated and includes UX resources, and point headless/minimal users to install/use `pi-flow-core` directly.
- [ ] **Step 7: Check the top-level README** — if the top-level `README.md` lists packages or would be inconsistent, update it to mention `pi-flow-ux`; otherwise leave it unchanged.

**Acceptance criteria:**
- `packages/pi-flow-ux/README.md` documents package contents, standalone use, aggregate use, Nord theme activation, packaged defaults, and user overrides.
  Verify: `grep -E "footer|working indicator|working message|Nord|Standalone|Aggregate|packaged.*default|~/.pi/agent/working.json|/working" /Users/david/Code/pi-flow/packages/pi-flow-ux/README.md` returns matches for all listed concepts.
- `packages/pi-flow/README.md` documents aggregate UX inclusion and the minimal/headless `pi-flow-core` option.
  Verify: `grep -E "pi-flow-ux|pi-flow-core|headless|minimal|aggregate" /Users/david/Code/pi-flow/packages/pi-flow/README.md` returns matches for all listed concepts.
- The top-level README is either unchanged because it does not list packages, or updated consistently if it does list packages.
  Verify: open `/Users/david/Code/pi-flow/README.md` and confirm it does not contradict the existence of `pi-flow-ux`; if it lists package names, confirm it names `pi-flow-core`, `pi-flow-ux`, and `pi-flow`.

**Model recommendation:** cheap

### Task 9: Run final verification and runtime probes

**Files:**
- Test: `pnpm-lock.yaml`, `packages/pi-flow-ux/package.json`, `packages/pi-flow/package.json`, `packages/pi-flow-core/package.json`
- Test: `packages/pi-flow-ux/extensions/**`, `packages/pi-flow-ux/__tests__/**`, `packages/pi-flow/__tests__/**`, `packages/pi-flow-core/__tests__/**`

**Steps:**
- [ ] **Step 1: Run a clean install** — run `pnpm install` from `/Users/david/Code/pi-flow` and ensure workspace symlinks and lockfile are current.
- [ ] **Step 2: Typecheck only `pi-flow-ux`** — run `pnpm --filter pi-flow-ux exec tsc --noEmit`; do not use `pnpm -r exec tsc --noEmit` because `pi-flow-core` has a `tsconfig.json` whose include glob has no TypeScript inputs.
- [ ] **Step 3: Run the full recursive test suite** — run `pnpm -r test` from the repository root and resolve any failures.
- [ ] **Step 4: Run a fresh-home Pi runtime probe** — start `pi` or the equivalent runner against a temporary `$HOME` with no `~/.pi/agent/working.json` and confirm the working indicator uses the packaged Nord pulse defaults.
- [ ] **Step 5: Run a partial-user override probe** — in the same temp-home setup, write a partial `~/.pi/agent/working.json` such as `{ "indicatorShape": "dot" }` and confirm the user value wins while unspecified fields continue to come from the packaged defaults.
- [ ] **Step 6: Verify compiled-output mode if V2 required it** — if Task 1 determined Pi requires compiled `.js`, confirm the build step produces shippable files and the runtime probe loads the compiled entries rather than `.ts` files.
- [ ] **Step 7: Record verification evidence** — include command outputs or concise summaries in the final implementation report and commit message.

**Acceptance criteria:**
- Install, typecheck, and full test suite all pass.
  Verify: from `/Users/david/Code/pi-flow`, run `pnpm install`, `pnpm --filter pi-flow-ux exec tsc --noEmit`, and `pnpm -r test`; all three commands exit 0.
- The manual/fresh-home runtime probe confirms packaged defaults are used when no user config exists.
  Verify: run the documented probe command from Task 9 Step 4 and confirm it observes `indicatorShape: "pulse"` and the packaged Nord color/gleam/rainbow defaults.
- The manual/fresh-home runtime probe confirms partial user overrides merge over packaged defaults.
  Verify: run the documented probe command from Task 9 Step 5 and confirm `indicatorShape: "dot"` is active while unspecified style fields still match `packages/pi-flow-ux/working.json`.
- If V2 required compiled JavaScript, the final package manifests and runtime probe use compiled `.js` outputs consistently.
  Verify: `node -e "const ux=require('/Users/david/Code/pi-flow/packages/pi-flow-ux/package.json'); const agg=require('/Users/david/Code/pi-flow/packages/pi-flow/package.json'); const text=JSON.stringify([ux.pi,agg.pi]); if(text.includes('.ts')) throw new Error('compiled mode still references .ts');"` exits 0 when compiled mode is active; skip this check only when Task 1 confirmed native `.ts` loading.

**Model recommendation:** capable

## Dependencies

- Task 1 depends on: none
- Task 2 depends on: Task 1
- Task 3 depends on: Task 1
- Task 4 depends on: Task 3, Task 5
- Task 5 depends on: Task 1
- Task 6 depends on: Task 1, Task 2, Task 4, Task 5
- Task 7 depends on: Task 2, Task 4, Task 5, Task 6
- Task 8 depends on: Task 6, Task 7
- Task 9 depends on: Task 7, Task 8

## Risk Assessment

- **Pi manifest field names are external to this repo.** Mitigation: Task 1 requires authoritative loader/docs evidence and a stop-and-ask condition if extension/theme fields are not confirmed.
- **Runtime `.ts` extension loading may not be supported by the packaged install path.** Mitigation: Task 1 requires V2 evidence; if `.ts` loading fails, all package/aggregate manifest paths and tests must move consistently to compiled `.js` output before implementation continues.
- **`@mariozechner/*` to `@earendil-works/*` may include API drift.** Mitigation: Tasks 2 and 3 isolate import rewrites and run tests/typechecks before the two-tier config behavior change.
- **Working coordinator singleton sharing can break indicator/message coordination.** Mitigation: Task 4 keeps the singleton keyed by user settings path, stores package-default path at first construction, and throws if later callers disagree for the same user path.
- **Packaged defaults could accidentally be mutated by `/working`.** Mitigation: Task 4 requires a regression test that `/working` changes write only to the user path and leave the package default file unchanged.
- **Aggregate discovery can pass path tests while failing actual loader discovery.** Mitigation: Task 7 adds a loader-driven or CLI-driven smoke test for `pi-flow-ux`, and extends aggregate tests for UX forwarding; if no loader/CLI check is possible, implementation stops for user guidance.
- **Nord theme `$schema` URL may be stale.** Mitigation: Task 5 updates it only if a current authoritative schema URL is discoverable; otherwise it leaves the advisory URL unchanged and records the decision.
- **Recursive TypeScript typechecking can produce false failures in `pi-flow-core`.** Mitigation: Task 9 explicitly typechecks only `pi-flow-ux` and reserves `pnpm -r test` for the full workspace verification.

## Test Command

```bash
pnpm -r test
```

## Out of Scope

- Core workflow skills, `/flow:*` commands, `/flow:setup`, idea/TODO tooling, model-tier behavior, and npm publishing.
- Personal extensions: `answer.ts`, `context.ts`, `files.ts`, `session-breakdown.ts`, `usage-bar.ts`, `guardrails.ts`, `herdr-agent-state.ts`, `todos.ts`, `env.ts`, and their tests.
- Bun or Deno runtime/test dependency.
- Mutating global or project config on package load.

## Review Notes

_Approved with concerns by plan reviewer. Full review: `/Users/david/Code/pi-flow/docs/plans/reviews/2026-05-19-ux-package-plan-review-v1.md`._

### Important (waived)

- **Task 6.2/6.4**: Aggregate UX discovery smoke test is weaker than the standalone loader smoke test — _waived: V1, manifest glob tests, and the existing aggregate `pi -e ... --help` probe substantially reduce aggregate-discovery risk._
- **Task V2**: Compiled-JavaScript fallback path is under-specified — _waived: the default `.ts` path is fully specified and V2 is an early gate, but execution should stop for a plan update if Pi requires compiled `.js`._
