**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Approved

**Reasoning:** The workspace, package manifests, helper runner, aggregate forwarding path, extracted resources, and regression tests satisfy the core production requirements. Only minor documentation/workspace-polish issues remain; no blocking runtime or architecture problems were found.

### Strengths

- The core package cleanly exposes the required Pi package metadata, resource files, `pi-flow` bin entry, peer dependency, and manifest glob (`packages/pi-flow-core/package.json:7-17`).
- The helper runner has a small, auditable command surface with structured errors, no fallback search, package-local resolution, and faithful child stdio/exit forwarding (`packages/pi-flow-core/bin/pi-flow.mjs:10-102`).
- The aggregate package avoids source duplication while still exposing a consumer-facing `node_modules/.bin/pi-flow` wrapper that delegates to `pi-flow-core` (`packages/pi-flow/bin/pi-flow.mjs:1-29`).
- Tests cover the required 15-skill manifest, agent count, path-rewrite regressions, helper/template resolution, aggregate forwarding through `node_modules`, and fresh consumer install behavior (`packages/pi-flow-core/__tests__/package-manifest.test.mjs:119-285`, `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs:98-213`).
- Verified `pnpm test` passes: 44 Node tests in `pi-flow-core`, 605 Python helper tests across copied scripts, and 9 aggregate package tests all succeeded.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

- **packages/pi-flow-core/docs/helper-runner.md:72: Shared-helper examples are slightly incomplete and one example uses an invalid marker**
  - **What:** The shared helper example block omits the executable `_shared/plan_fence_hardening` helper, and the `parse-artifact-handoff` example passes `--marker test_run`, which is not one of the helper's accepted marker choices.
  - **Why it matters:** Runtime resources resolve correctly, but the installed helper-runner contract is less complete and one copy-pasted example will fail argument validation.
  - **Recommendation:** Add a `pi-flow helper _shared/plan_fence_hardening --plan <path> --rewrite-in-place` example and change the handoff example to a valid marker such as `PLAN_ARTIFACT` or `TEST_RESULT_ARTIFACT`.

- **pnpm-workspace.yaml:3: Extra workspace setting is undocumented**
  - **What:** `autoInstallPeers: false` is added in the workspace file even though the packaging plan only calls for declaring the `packages/*` workspace.
  - **Why it matters:** This does not break the current install/test flow, but it changes pnpm peer-install behavior without a documented rationale.
  - **Recommendation:** Either remove it for the initial slice or document why this workspace intentionally disables automatic peer installation.

### Recommendations

- Add a small docs-validation test that extracts `pi-flow helper` / `pi-flow template` IDs from `packages/pi-flow-core/docs/helper-runner.md`, verifies each ID resolves, and asserts the documented shared helper list covers every intended CLI helper.
