**Reviewer:** anthropic/claude-opus-4-8 via claude

### Outcome

**Verdict:** Approved

**Reasoning:** The `/flow:doctor` feature is implemented faithfully to the plan across all five tasks — parity-critical resolution primitives, surface inventory/classification, repair with the never-overwrite posture, arg parsing/registration, and docs — with comprehensive tests (`pnpm --filter @aphotic/pi-flow-core run check` passes: `tsc --noEmit` clean, all suites green). The prior-review finding is fully remediated: `repairLink` now only repoints divergent symlinks that resolve to an enclosing `@aphotic/pi-flow-core` package, and reports non-pi-flow/unresolved targets as `conflict` while leaving them byte-for-byte unchanged. No Critical or Important findings.

### Strengths

- **Faithful runner parity.** `packageRootFromBin` (`package-resolution.ts:28-32`) reproduces `bin/pi-flow.mjs`'s `PACKAGE_ROOT = realpath(dirname(bin))/..` exactly with no fallback, and `resolveBinToCore` (`doctor.ts:75-109`) reproduces the aggregate `@aphotic/pi-flow` wrapper's `createRequire(...).resolve("@aphotic/pi-flow-core/bin/pi-flow.mjs")` delegation — so version verdicts match what actually executes. The aggregate-wrapper path is exercised end-to-end (`doctor.test.ts:255-273`, `631-657`).
- **Prior finding cleanly remediated.** The added `!enclosing` branch (`doctor.ts:729-746`) reports non-pi-flow targets as `conflict` (`reason: "non-pi-flow symlink target — refusing to overwrite"`) and unresolved targets as `conflict` (`"unresolved symlink target"`), both left untouched. Only an enclosing-core, non-local-dev symlink (stale-skew) is repointed. Directly tested at `doctor.test.ts:468-494`, which asserts `readlink`/`realpath` are unchanged after the conflict.
- **Never-overwrite posture preserved.** `repairLink` refuses to clobber a local-dev override (`preserved-other`) or a real file/dir (`conflict`), and the tests assert the targets are byte-for-byte unchanged (`doctor.test.ts:440-466`, `496-518`). The `runDoctorFix` integration test proves `.pi/settings.json` is byte-identical before/after (`doctor.test.ts:626-628`).
- **Clean separation of concerns.** Pure functions (`classifySurface`, `parseDeclaredPackages`, `resolveReconcileTarget`, `validateExplicitTarget`, `renderReport`, `renderFixReport`) are decoupled from the `ctx.ui.notify` plumbing in `registerDoctor`, making the verdict and report strings unit-testable independent of Pi.
- **Verdict scoping matches the plan.** `skewKinds`/`hasSkew` are restricted to the active resolution-path surfaces (`doctor.ts:594-606`); installs and declared packages are reported with classification but never trip the hard failure, and `local-dev` never counts as skew (`doctor.test.ts:175-195`).
- **Documentation is accurate and non-drifting.** `version-alignment.md` reproduces the three `--source` forms and the mutation-boundary sentence verbatim from `helpText()`, and `helper-runner.md` cross-links it.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

- **`packages/pi-flow-core/extensions/doctor.ts:702-708`: `repairLink`'s `activeRoot` parameter is unused.**
  - **What:** The function signature accepts `activeRoot`, but the body destructures only `{ linkPath, desiredTarget, cwd }` and never reads `activeRoot`.
  - **Why it matters:** A declared-but-unused parameter invites confusion about whether classification against the active root participates in the repair decision (it does not — `findEnclosingCoreRoot` + `isLocalDevCheckout` drive it).
  - **Recommendation:** Either drop `activeRoot` from the interface or add a short comment noting it is retained for call-site symmetry with `setup`'s helpers.

- **`packages/pi-flow-core/extensions/doctor.ts:736 vs 767: inconsistent `from` canonicalization.**
  - **What:** The conflict branch sets `from: resolvedRealpath ?? resolvedActual` (realpath'd when resolvable), while the `repaired`/`preserved-other` branches set `from: resolvedActual` (the pre-realpath resolved link target).
  - **Why it matters:** `from` can be a realpath in one outcome and a raw resolved path in another; tests pass only because sandboxes are pre-realpath'd. Cosmetic, but could surprise a future consumer that compares `from` across outcomes.
  - **Recommendation:** Canonicalize `from` consistently (realpath everywhere, or document that it is the resolved link target pre-realpath).

- **`packages/pi-flow-core/extensions/doctor.ts:771-781: real-file/dir conflict omits `expected`/`actual`.**
  - **What:** The symlink-conflict path populates `conflict.expected`/`conflict.actual`, but the real-file/dir conflict sets only `path` and `reason`.
  - **Why it matters:** Slightly inconsistent `SetupConflict` shape across conflict kinds; a reader inspecting conflicts gets less context for the real-file case.
  - **Recommendation:** Set `expected: desiredTarget` (and `actual: linkPath`) for the real-file/dir conflict for parity.

- **`packages/pi-flow-core/extensions/doctor.ts:128-134: `BuildDiagnosisOptions` "injectable for tests" comment is misleading.**
  - **What:** The trailing comment implies an injection hook, but `buildDiagnosis` always reads the real filesystem; injection is only via the `homeDir`/`cwd`/`activeRoot` directory parameters.
  - **Why it matters:** Minor doc accuracy; could mislead a maintainer into looking for an absent FS-mock seam.
  - **Recommendation:** Reword to "directories are injected so tests can point at a sandbox tree."

### Recommendations

- Consider a brief note (in `version-alignment.md` or the report itself) that a `node-bin` resolving to an npm install while the active package is a local checkout will legitimately report `SKEW DETECTED` in self-hosting/dev trees — this is by design per the risk assessment, but a one-line reader cue would reduce "is this a false positive?" confusion.
- The `binSurfaceReport` `exists: false` branch (`doctor.ts:205-207`) is currently unreachable given both call sites pre-check existence; it is harmless defensiveness, but a short comment marking it as a guard would clarify intent.
