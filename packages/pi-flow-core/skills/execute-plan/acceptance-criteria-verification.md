# Acceptance-criteria verification

## Why this exists

This file is the per-task acceptance-verification protocol consumed by `skills/execute-plan/SKILL.md` Step 11, and by any future caller that has explicit acceptance criteria with attached `Verify:` recipes.

Ad hoc / inferred-criteria mode is **out of scope** for this protocol and is recorded as a future-idea follow-up. This document assumes the caller already has criteria with complete `Verify:` recipes.

## Inputs

The caller supplies five inputs:

1. **Task spec** — the task description as a verbatim string.
2. **Acceptance criteria** — a list of `(criterion_text, verify_recipe)` pairs. Each pair must have a non-empty `Verify:` recipe.
3. **Verifier-visible file set** — a deduplicated list of paths the verifier may inspect. The caller computes this via the `{MODIFIED_FILES}` union rule; that computation is out of scope for this file.
4. **Diff context** — a single text block produced by `pi-flow helper execute-plan/collect-diff-context`.
5. **Working directory** — the absolute path the verifier subagent will operate from.

## Behavior

Step by step:

a. **Validate criteria.** Confirm every criterion has a non-empty `Verify:` recipe. If any criterion lacks one, surface the protocol-error stop: *"plan without complete `Verify:` recipes is a protocol error from generate-plan and must be regenerated"* and stop the call site.

b. **Classify recipes.** Classify each `Verify:` recipe as either command-style (a runnable shell command) or inspection-style (a file/section to read and assert against).

c. **Fill the verifier prompt.** Fill `$(pi-flow template execute-plan/verify-task-prompt)` via `pi-flow helper execute-plan/assemble-verifier-prompt`, passing the inputs above.

d. **Resolve dispatch.** Resolve `(model, cli)` for the dispatch by invoking `pi-flow helper _shared/resolve-model-dispatch --tier crossProvider.standard --agent verifier`. On resolution failure, surface the byte-equal canonical Templates (1)–(4) per `skills/_shared/model-tier-resolution.md`.

e. **Dispatch the verifier.** Dispatch a single `verifier` subagent via:

   ```
   subagent_run_serial { tasks: [{ name: "verifier: <task-N>", agent: "verifier", task: <filled prompt>, model: <resolved>, cli: <resolved> }] }
   ```

f. **Parse the result.** Parse the dispatched final message via `pi-flow helper execute-plan/parse-verifier-report`. Treat any protocol errors the parser surfaces as `VERDICT: FAIL`.

## Output

The protocol returns a structured result:

- Per-criterion verdicts of the form `[Criterion N] PASS|FAIL` plus the verifier's `reason:` text.
- An overall `VERDICT: PASS|FAIL`.
- OR a structured protocol-error reason that the caller treats as `VERDICT: FAIL`.

The output is the JSON shape produced by `pi-flow helper execute-plan/parse-verifier-report`, with fields:

- `verdict`
- `per_criterion`
- `phase1_evidence`
- `protocol_errors`

The `parse-verifier-report.py` script is the canonical contract for this shape.

## Out of scope (caller's responsibility)

This protocol applies to a single task. The caller composes per-wave parallelism and retry semantics. The following are **not** handled here:

1. Wave-level parallel/serial dispatch shape.
2. Retry loops on `VERDICT: FAIL` (Step 13 of execute-plan).
3. Remediation menus.
4. Post-verification commits.
5. The `{MODIFIED_FILES}` union rule (which is wave-shape-specific).
