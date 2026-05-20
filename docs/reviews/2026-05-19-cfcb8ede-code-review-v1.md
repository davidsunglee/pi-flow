**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Not approved

**Reasoning:** Runtime structure and tests are largely solid, but the shipped helper-runner help/contract documentation contains multiple non-existent resource IDs, so copy-pasted documented commands fail and the helper-runner documentation requirement is not met.

### Strengths

- Workspace/package split is clean: `pi-flow-core` owns resources and `pi-flow` forwards through `node_modules/pi-flow-core` without source duplication.
- The 15 expected non-browser skills, 10 agent definitions, shared scripts/tests/fixtures, and per-skill helpers are present, and executable `python3 agent/skills/...` path leaks are covered by tests.
- Helper runner behavior is well covered for known helpers/templates, malformed IDs, unknown IDs, and exit-code/stdout/stderr forwarding.
- Verified `pnpm install && pnpm -r run check` passes after the helper test cleanup path removes generated Python cache artifacts.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

- **packages/pi-flow-core/docs/helper-runner.md:76: Helper-runner documentation is built around non-existent resource IDs**
  - **What:** The documented examples use helpers/templates that are not shipped, including `_shared/utils`, `_shared/format-output`, `define-spec/validate-spec`, `execute-plan/dispatch-task`, `fastlane/build-context`, `refine-code/lint-output`, `refine-plan/diff-plan`, `_shared/agent-persona`, `fastlane/agent-template`, and `execute-plan/task-prompt`. The CLI help repeats the same problem at `packages/pi-flow-core/bin/pi-flow.mjs:38` with `_shared/utils` and `fastlane/agent-template`.
  - **Why it matters:** `docs/helper-runner.md` is the installed contract for `pi-flow helper` / `pi-flow template`, and the plan explicitly requires representative real examples. Users following the docs or `pi-flow --help` will get `unknown helper` / `unknown template` failures for commands presented as valid.
  - **Recommendation:** Replace the fake examples with real shipped IDs such as `_shared/resolve-model-dispatch`, `_shared/detect-test-command`, `execute-plan/extract-plan-tasks`, `fastlane/recommend-workflow`, `refine-code/fill-refine-code-prompt`, `refine-plan/parse-refine-plan-summary`, `_shared/test-runner-dispatch`, and `fastlane/fastlane-coder-prompt`; include the required examples for every shared helper.

#### Minor (Nice to Have)

- **pnpm-workspace.yaml:3: Workspace file is not the exact two-line block required by the plan**
  - **What:** The file adds `autoInstallPeers: false` after the required `packages` glob.
  - **Why it matters:** This does not currently break install/check, but the acceptance criteria asked for exactly the two-line `packages` block, so the extra setting is an unnecessary deviation.
  - **Recommendation:** Remove the extra workspace setting unless there is a documented reason to keep it.

- **packages/pi-flow-core/__tests__/package-manifest.test.mjs:285: Pi discovery probes do not assert skill discovery when `pi` is available**
  - **What:** The core and aggregate best-effort probes run `pi -e <path> --version` and only assert exit status; they never parse output or verify that the 15 expected skill names are discoverable. The aggregate test has the same pattern at `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs:141`.
  - **Why it matters:** The plan called for the conditional probe to assert skill visibility when the Pi CLI is present. These tests can pass even if Pi ignores the package resources entirely.
  - **Recommendation:** Either use a Pi command that actually lists package resources and assert all 15 skill names, or explicitly document that the probe is only an extension-load smoke test and rely on the deterministic manifest/glob tests for discovery.

### Recommendations

- Fix the invalid helper/template examples before shipping; this is small and will bring the docs, CLI help, and acceptance criteria back into alignment.
- Consider adding a small documentation/example validation test that extracts `pi-flow helper` / `pi-flow template` IDs from `docs/helper-runner.md` and `pi-flow --help` and verifies that each resolves on disk.
