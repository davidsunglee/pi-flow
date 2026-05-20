**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Approved with concerns

**Reasoning:** The plan covers the UX-package spec and scout-brief risks well enough to execute. Waiving the Important finding for Task 6.2/6.4 because V1, manifest glob tests, and the existing aggregate `pi -e ... --help` probe substantially reduce aggregate-discovery risk; waiving the Important finding for Task V2 because the default `.ts` path is fully specified and V2 is an early gate, but execution should stop for a plan update if Pi requires compiled `.js`.

### Strengths

- The outcomes map ties each spec acceptance area to implementation phases and includes concrete `Verify:` recipes.
- V1 explicitly prevents guessing Pi manifest field names and includes a propagation rule so package manifests and tests stay aligned with authoritative loader behavior.
- Phase 3 gives detailed, buildable instructions for the packaged-default/user-override working config model, including singleton-sharing invariants and regression cases.
- Phase 5 preserves the package boundary: `pi-flow-core` remains UX-free while aggregate `pi-flow` forwards UX resources through `node_modules/pi-flow-ux/...` instead of duplicating source.
- The plan incorporates the scout brief's major risk areas: API rename typechecks, runtime TypeScript verification, manifest schema verification, Nord schema handling, and test-runner migration.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

- **Task 6.2/6.4: Aggregate UX discovery smoke test is weaker than the standalone loader smoke test**
  - **What:** Phase 6.4 requires loader/CLI discovery assertions for `pi-flow-ux`, but Phase 6.2 only requires aggregate dependency/symlink/glob assertions for UX resources. The existing aggregate `pi -e ... --help` probe catches load failures, but the plan does not explicitly require asserting that footer, working, and nord are discoverable through aggregate `pi-flow` by the actual loader/resource list.
  - **Why it matters:** A packaging or aggregate-manifest issue could still leave UX resources undiscoverable through the default `pi-flow` install while passing path/glob checks, weakening one spec acceptance criterion.
  - **Recommendation:** Extend Phase 6.2 to reuse the loader-driven or CLI-driven smoke mechanism from 6.4 against `packages/pi-flow`, asserting footer, working, and nord are discovered through `node_modules/pi-flow-ux/...`.

- **Task V2: Compiled-JavaScript fallback path is under-specified**
  - **What:** V2 says to switch to compiled `.js` output if Pi cannot load `.ts` extensions, but unlike V1 it does not provide a propagation rule for updating manifest entries, aggregate forwarding paths, package `files`, tests, and verify recipes from `.ts` to compiled `.js`.
  - **Why it matters:** If V2 fails, an executor could be left with internally inconsistent instructions: build `.js` artifacts while later phases and acceptance checks still require `.ts` manifest entries and source paths.
  - **Recommendation:** Add a V2 stop-and-revise condition or an explicit `.js` propagation checklist covering Phase 1, Phase 5, Phase 6 tests, and the outcomes-map verify recipes.

#### Minor (Nice to Have)

- **Task 7.1: Theme-selection confirmation points at the wrong pre-flight check**
  - **What:** The README task says to confirm the exact nord activation mechanism during V2, but V2 is about runtime TypeScript loading rather than theme selection.
  - **Why it matters:** This is unlikely to block execution, but it may send the documentation worker to the wrong earlier evidence.
  - **Recommendation:** Change the reference to V1/Pi docs inspection or add a small documentation-specific verification step for the theme activation command/settings key.

### Recommendations

_None._
