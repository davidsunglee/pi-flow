**Reviewer:** openai-codex/gpt-5.5 via codex

### Outcome

**Verdict:** Approved with concerns

**Reasoning:** The flow-config hard cutover is implemented coherently and the full workspace test suite passes. I am waiving the Important finding "Non-object flow config can escape canonical failures" because it affects malformed-but-valid JSON config files, not valid five-section `flow.json` inputs, and can be hardened as a narrow follow-up without changing the cutover design.

### Strengths

- The shared dispatch authority is consolidated in `packages/pi-flow-core/skills/_shared/dispatch-contract.md:53`, with leaf and coordinator mapping, unconditional `executionPolicy` injection, canonical templates, and coordinator procedure in one place.
- The leaf and coordinator helpers emit the requested complete envelopes, including `executionPolicy`, at `packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py:108` and `packages/pi-flow-core/skills/_shared/scripts/resolve-coordinator-dispatch.py:93`.
- The new guardrail suite pins the stop strings and mechanically scans package source for legacy flow configuration naming at `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs:188` and `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs:202`.
- Documentation now covers setup, schema, backend policy semantics, canonical templates, verification commands, and manual migration in `packages/pi-flow-core/docs/flow-config-setup.md:7`.
- Verification run: `pnpm test` completed successfully from the worktree, including the root tests, node suites, Python helper suites, and aggregate package tests. Targeted helper smoke tests and `node --test --experimental-strip-types packages/pi-flow-core/__tests__/guardrail-strings.test.mjs` also passed.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

- **packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py:45: Non-object flow config can escape canonical failures**
  - **What:** After `json.load`, the leaf helper assumes the parsed config is a dict and calls `data.get(...)` through `resolve_tier`. A syntactically valid non-object JSON file such as `[]` raises an `AttributeError` traceback instead of emitting a canonical hard-stop. `validate-review-provenance.py` has the same root-object assumption at `packages/pi-flow-core/skills/_shared/scripts/validate-review-provenance.py:109`, where it tracebacks before producing its structured failure JSON.
  - **Why it matters:** The cutover emphasizes strict, predictable config failure handling. Tracebacks leak implementation details and are harder for workflow prose and downstream validators to classify than the canonical template or provenance failure label.
  - **Recommendation:** Validate `isinstance(data, dict)` immediately after loading config in both scripts. For `resolve-model-dispatch.py`, treat a non-object as Template (2) for the requested tier or add a small `resolve_tier` guard. For `validate-review-provenance.py`, fail with the existing `flow.json missing or unreadable` label or another documented structured label.

#### Minor (Nice to Have)

- **packages/pi-flow-core/skills/refine-code/scripts/fill-refine-code-prompt.py:168: Placeholder count comment is stale**
  - **What:** The helper builds nine owned placeholders, but the inline comment says it owns "only the eight placeholders above."
  - **Why it matters:** This is harmless at runtime, but it can mislead future edits to the placeholder contract.
  - **Recommendation:** Change "eight" to "nine" in the comment.

### Recommendations

- Add regression tests for non-object parsed config values in the leaf helper and provenance validator so malformed config handling stays canonical.
