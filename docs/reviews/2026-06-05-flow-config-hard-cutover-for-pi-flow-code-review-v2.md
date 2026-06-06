**Reviewer:** openai-codex/gpt-5.5 via codex

### Outcome

**Verdict:** Approved

**Reasoning:** The final diff satisfies the hard cutover requirements: helpers read `flow.json`, emit explicit `executionPolicy`, coordinator dispatch is separated behind the shared contract, all package-source naming sweeps pass, and the relevant test and typecheck commands are green.

### Strengths

- `packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py:72`: The leaf helper exposes the new `--flow-config` flag with the required `~/.pi/agent/flow.json` default.
- `packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py:78`: Leaf validation follows the specified order and emits canonical hard-stop messages for unreadable config, unusable tier values, missing dispatch maps, missing provider mappings, and invalid `executionPolicy`.
- `packages/pi-flow-core/skills/_shared/scripts/resolve-coordinator-dispatch.py:71`: Coordinator dispatch validates `coordinatorSubagentDispatch.modelChain` separately from leaf `subagentDispatch`, hardcodes `cli: "pi"`, and carries `executionPolicy` in the success envelope.
- `packages/pi-flow-core/skills/_shared/dispatch-contract.md:45`: The new shared dispatch contract centralizes the task-entry shape, flow-config mapping, executionPolicy injection rule, canonical templates, coordinator modelChain procedure, and worker re-resolution rule.
- `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs:59`: Guardrail coverage pins the canonical templates and stop strings, and the package-source naming sweep rejects legacy `model-tiers` and model-matrix terminology.
- `packages/pi-flow-core/skills/_shared/scripts/tests/test_resolve_model_dispatch.py:97`: Helper regression tests cover malformed tier values and strict executionPolicy behavior, including traceback-free failures.
- `packages/pi-flow-core/skills/_shared/scripts/tests/test_resolve_coordinator_dispatch.py:37`: Coordinator tests cover valid chains, opaque model identifiers, ignored extra keys, wholesale modelChain rejection, and invalid executionPolicy.
- `packages/pi-flow-core/package.json:8`: The packaged files array now ships `flow.example.json`, and `packages/pi-flow-core/__tests__/packlist.test.mjs:19` pins that packlist expectation.
- `packages/pi-flow-core/docs/flow-config-setup.md:127`: Setup documentation includes verification commands whose output shapes match the actual helper stdout.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

_None._

### Recommendations

_None._
