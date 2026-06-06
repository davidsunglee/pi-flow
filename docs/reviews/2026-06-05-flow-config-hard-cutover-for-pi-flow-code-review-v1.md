**Reviewer:** openai-codex/gpt-5.5 via codex

### Outcome

**Verdict:** Not approved

**Reasoning:** The hard cutover is broadly implemented, but the leaf model-resolution path still accepts invalid tier values until it either crashes or emits an invalid dispatch envelope. That violates the canonical hard-stop contract and affects both dispatch and downstream provenance validation.

### Strengths

- The new shared contract clearly centralizes task shape, helper mapping, coordinator dispatch, and unconditional `executionPolicy` injection (`packages/pi-flow-core/skills/_shared/dispatch-contract.md:43`).
- The dispatch helpers emit `executionPolicy` in their success envelopes and validate it without a silent default (`packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py:104`, `packages/pi-flow-core/skills/_shared/scripts/resolve-coordinator-dispatch.py:86`).
- The coordinator prompts and concrete dispatch examples now carry `executionPolicy` through the coordinator hop and worker dispatches (`packages/pi-flow-core/skills/refine-code/refine-code-prompt.md:119`, `packages/pi-flow-core/skills/refine-code/refine-code-prompt.md:143`).
- Guardrail coverage pins the canonical flow templates, stop strings, and legacy naming sweep (`packages/pi-flow-core/__tests__/guardrail-strings.test.mjs:62`, `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs:188`, `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs:202`).
- Verification passed for `pnpm run test:helpers` and `pnpm run test:node`.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

- **`packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py:88`: Invalid tier values can traceback or dispatch malformed models instead of using Template (2)**
  - **What:** The helper only checks `if not model` before calling `model.split("/", 1)`. A readable `flow.json` with a truthy non-string tier value such as `42` raises `AttributeError`, and a slashless string can be accepted if `subagentDispatch` contains the same bogus provider key.
  - **Why it matters:** The spec defines tier values as non-empty provider/model strings and requires canonical hard stops for unusable models. This is the shared dispatch seam for all leaf worker sites, so malformed config should produce `flow.json has no usable "<tier>" model — cannot dispatch <agent>.`, not a Python traceback or invalid dispatch envelope.
  - **Recommendation:** Treat the resolved tier as usable only when it is a non-empty string with a non-empty provider prefix and model suffix, then add regression tests for non-string and slashless tier values.
- **`packages/pi-flow-core/skills/_shared/scripts/validate-review-provenance.py:120`: Provenance validation repeats the same untyped model split**
  - **What:** The provenance helper resolves each allowed tier and then calls `resolved_model.split("/", 1)` after only an `if not resolved_model` guard.
  - **Why it matters:** A malformed but readable `flow.json` can make the helper emit a traceback instead of its JSON failure payload. `refine-plan` and `refine-code` consume stderr JSON from this script, so a traceback breaks their documented failure handling.
  - **Recommendation:** Reuse or mirror the same model-string validation used by `resolve-model-dispatch.py`; skip unusable allowed tiers or fail with the existing `flow.json missing or unreadable` label, and test that stderr remains JSON with no traceback.

#### Minor (Nice to Have)

- **`packages/pi-flow-core/docs/flow-config-setup.md:18`: Dynamic copy command uses template contents as a path**
  - **What:** `pi-flow template _shared/dispatch-contract` prints the markdown template contents, so piping it through `sed` does not reliably produce the installed package path for `flow.example.json`.
  - **Why it matters:** The primary copy command is present, but this alternate setup path is likely to fail or produce confusing shell errors.
  - **Recommendation:** Replace the dynamic command with a reliable package-root lookup, or remove the alternate path and keep the direct `node_modules/@aphotic/pi-flow-core/flow.example.json` copy command.

### Recommendations

- Add malformed `flow.json` tests for every schema field that the helpers dereference as a string, not just missing and empty cases.
