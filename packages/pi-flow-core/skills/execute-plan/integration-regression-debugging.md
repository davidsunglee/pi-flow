# Integration regression debugging

## Why this exists

This file documents the parameterized debugger-first flow shared by execute-plan Step 12 (post-wave) and Step 16 (final-gate). When integration regressions appear, both callers route through the same investigation-then-targeted-remediation flow rather than blanket re-dispatching every task in scope. The parameter row identifies the caller and supplies the values that vary between them; menus, retry-budget bookkeeping (Step 13), and the actual undo execution remain in the caller.

## Inputs (caller-supplied)

The caller supplies six values when invoking this flow:

- `current_failures` — the set union `current_non_baseline_stable ∪ current_non_reconcilable` from the latest integration test artifact, computed per [`integration-regression-gate.md`](integration-regression-gate.md).
- `change_range` — the commit range that introduced the suspect changes. For Step 12 callers this is the wave commit SHA (`HEAD` at the time of dispatch). For Step 16 callers this is the `BASE_SHA..HEAD_SHA` form, where `BASE_SHA` is the recorded `PRE_EXECUTION_SHA` and `HEAD_SHA` is `git rev-parse HEAD` at the moment the gate runs.
- `suspect_universe` — the set of candidate tasks together with their plan-declared `**Files:**` scope, derived per the caller's parameter row (see `## Parameter rows`). This is the universe from which the suspect list is drawn at flow step 1.
- `commit_template` — the string used for any remediation commit message. Examples: `fix(plan): wave <N> regression — <summary>` (Step 12) or `fix(plan): final-gate regression — <summary>` (Step 16).
- `undo_policy` — `allowed` for Step 12 callers (the wave commit may be undone as a fallback), `forbidden` for Step 16 callers (HEAD is not guaranteed to be a wave commit and prior wave commits must be preserved).
- `re_test_callback` — a callable that re-invokes the integration gate per `skills/execute-plan/integration-regression-gate.md`'s reconcile mode and returns the new classification together with the recomputed `current_non_baseline_stable` and `current_non_reconcilable` sets. The flow uses this to evaluate the caller's success condition.

## Parameter rows

The table below is the load-bearing reference for callers. Each caller identifies its column by name.

| Parameter | Step 12 (post-wave) | Step 16 (final-gate) |
|---|---|---|
| Scope | Triggered by Step 12's post-wave integration-test menu, while a current wave `<N>` exists. | Triggered by Step 16's "Final integration regression gate (precondition)" after all waves and any Step 15 remediation. No current wave exists; `HEAD` may be a Step 15 commit. |
| Range / changed-file universe | The wave commit: use `git show HEAD --stat` and `git show HEAD` to enumerate the files introduced by the wave. | The plan execution range: `BASE_SHA` = `PRE_EXECUTION_SHA` (recorded in Step 8, immediately before the first wave dispatched); `HEAD_SHA` = `git rev-parse HEAD` at this moment. Use `git diff --name-only BASE_SHA HEAD_SHA` — NOT `git show HEAD`, since HEAD at final-gate time is not guaranteed to be a wave commit. |
| Suspect / failure scope | The current run's `current_non_baseline_stable ∪ current_non_reconcilable` — the stable failures not in `baseline_failures` plus any non-reconcilable evidence from the same artifact. | Same: the final-gate run's `current_non_baseline_stable ∪ current_non_reconcilable`. |
| Suspect task universe | Wave `<N>`'s tasks whose modified files appear in the failing stack traces or whose behavior the failing tests cover. If the mapping is ambiguous, include every wave task. | Every plan task whose declared `**Files:**` scope (from the plan file) intersects the failing stack traces or whose behavior the failing tests cover. If the mapping is ambiguous, include every plan task whose `**Files:**` scope intersects `git diff --name-only BASE_SHA HEAD_SHA` — i.e., every task whose output was touched by plan execution. Do NOT constrain to a single wave. |
| Success condition | On re-dispatching `test-runner` per Step 7's shared test-runner dispatch subsection (with a fresh `wave-<N>-attempt-<K>` filename — increment `<K>`) and recomputing per `integration-regression-gate.md`, **both** `current_non_baseline_stable` and `current_non_reconcilable` are empty. Pre-existing baseline failures (members of `baseline_failures ∩ current_failing_stable`) may remain. On success, proceed to the next wave. | On re-entering the Step 16 gate at its step 1 (re-run the suite, recompute the per-run inputs), **both** `current_non_baseline_stable` and `current_non_reconcilable` are empty. Pre-existing baseline failures may remain. On success, the gate passes and normal completion proceeds. |
| Commit template / undo behavior | Remediation commit message: `fix(plan): wave <N> regression — <short summary>`. **Commit-undo fallback is available**: if targeted remediation also fails and the user chooses to retry again, offer to undo the wave commit with `git reset HEAD~1` (working-tree changes preserved unstaged) before a broader retry. Do not undo proactively. | Remediation commit message: `fix(plan): final-gate regression — <short summary>`. **Commit-undo fallback is NOT available**: `HEAD` is not guaranteed to be a wave commit, and prior wave commits must be kept intact for the `(x) Stop plan execution` exit path. On repeated failure, the only exits are another debugging attempt (costing a Step 13 retry) or `(x) Stop plan execution`. |

## Flow

Applies to both callers; substitute the parameter values from the row above.

1. **Identify suspects from the failure output.** Inspect the failing test identifiers in `current_non_baseline_stable`, the non-reconcilable evidence entries in `current_non_reconcilable`, file paths in stack traces, and the diff of the caller's `change_range`. Build a short suspect list drawn from the caller's `suspect_universe`, including each candidate task's title (and, for Step 16, its declared `**Files:**` scope). If the mapping is ambiguous, fall back to the "include every …" rule spelled out for the caller in `## Parameter rows`.

2. **Dispatch a single debugging pass** using the `coder` agent with a prompt that follows the `systematic-debugging` skill (using `subagent_run_serial` per Step 8 of execute-plan). The prompt MUST include:
   - The failing test output (full, not truncated) for `current_failures`, with a labeled breakdown distinguishing stable identifiers (from `current_non_baseline_stable`) from non-reconcilable evidence entries (from `current_non_reconcilable`, copied verbatim from the artifact's `NON_RECONCILABLE_FAILURES:` block) so the diagnosis can reason about cause (e.g., test-level assertion failure vs. crash or collection error).
   - The `change_range` identifier (Step 12: the wave commit SHA; Step 16: `BASE_SHA..HEAD_SHA`) and the list of files changed across it.
   - The suspect task list from step 1, with each task's title.
   - An explicit instruction: "Follow the `systematic-debugging` skill. Complete Phase 1 (root cause investigation) before proposing any fix. If the root cause is a clear, localized defect in one or two files, you MAY apply the fix in this same dispatch — follow TDD (write a failing test reproducing the regression, then fix). If the root cause spans multiple tasks or requires design judgment, return a diagnosis only and do NOT modify code."
   - The required report shape: either `STATUS: DONE` with the fix applied and RED/GREEN evidence for the regression test, or `STATUS: DONE_WITH_CONCERNS` containing a `## Diagnosis` section naming the implicated task(s), the root cause, and the minimal change needed.

3. **Handle the debugging pass result.** Judge success by the caller's success condition (both `current_non_baseline_stable` and `current_non_reconcilable` empty on the re-test).

   - **Diagnosed and fixed (`STATUS: DONE`):** Commit any applied fix using the caller's `commit_template` (skip the commit if the dispatch returned `DONE` without file changes). Then evaluate the success condition by invoking `re_test_callback`. If both sets are empty on the re-test, the remediation succeeded — return `success`. If either set is still non-empty, treat this as a failed debugging pass (below).
   - **Diagnosis only (`STATUS: DONE_WITH_CONCERNS` with `## Diagnosis`):** Use the diagnosis to dispatch a **targeted remediation** — a second `coder` dispatch scoped to only the implicated task(s)/files from the diagnosis. Include the diagnosis text, the failing test output, and the original task spec(s) for the implicated task(s) from the plan file. After that dispatch returns, commit its changes using the caller's `commit_template` (skip if no files changed) and evaluate the success condition by invoking `re_test_callback`. If it holds, the remediation succeeded — return `success`. If it does not, treat this as a failed debugging pass.
   - **Failed debugging pass** (blocker, or the success condition still does not hold): return `fail`. If `undo_policy == allowed`, include the optional "may undo wave commit" hint described under `## Output`.

4. **Do NOT blanket re-dispatch tasks outside the diagnosis.** Avoiding re-runs of unaffected tasks is the point of this flow — only the tasks explicitly implicated by the diagnosis are re-dispatched.

5. **Commit-undo fallback availability is governed by `undo_policy`.** When `undo_policy == allowed` (Step 12), the fallback is used only after targeted remediation has also failed and the user chooses to retry again — never proactively. When `undo_policy == forbidden` (Step 16), the only exits on repeated failure are another debugging attempt (costing a Step 13 retry) or `(x) Stop plan execution`. This file does not execute the undo; it only surfaces the hint described under `## Output`.

## Output

The flow returns one of two outcomes:

- `success` — the success condition holds: `re_test_callback` reports both `current_non_baseline_stable` and `current_non_reconcilable` empty after the most recent remediation. Pre-existing baseline failures may remain; they do not block success.
- `fail` — the success condition does not hold (the debugging pass blocked, or the re-test still reports a non-empty `current_non_baseline_stable` or `current_non_reconcilable` after any applied fix or targeted remediation). When `undo_policy == allowed` and remediation has also failed, the `fail` output includes a non-binding **"may undo wave commit"** hint advising the caller that `git reset HEAD~1` (working-tree changes preserved unstaged) is available as a fallback before a broader retry. The hint is informational; the caller decides whether to act on it. The hint is suppressed when `undo_policy == forbidden`.

This file never executes the undo itself, never renders a menu, and never updates retry budgets — those belong to the caller.

## Out of scope (caller's responsibility)

This flow does not handle:

- **Menu rendering.** The wave/gate-specific `(d)/(c)/(x)` (intermediate Step 12 wave) or `(d)/(x)` (final-wave Step 12 / Step 16) choices are rendered by the caller, not by this flow.
- **Retry-budget bookkeeping.** Step 13 of execute-plan owns the per-task 3-retry counter and the shared-counter rules. This flow returns `success`/`fail`; the caller decides whether the attempt counts against a task's budget.
- **Actual undo execution.** This flow returns a hint under `undo_policy == allowed`; the caller decides whether to run `git reset HEAD~1` and how to message it to the user.
- **Wave/gate state management.** Incrementing the wave attempt counter `<K>`, naming the next test artifact, and re-entering the Step 16 gate at its own step 1 are caller concerns. `re_test_callback` encapsulates the suite re-run from this flow's perspective.

## Callers

Two known callers identify their parameter row by name from `## Parameter rows`:

- **execute-plan Step 12 (post-wave)** — invoked from the post-wave integration-test menu's `(d) Debug failures now` option, while a current wave `<N>` exists. Uses the **Step 12 (post-wave)** column.
- **execute-plan Step 16 (final-gate)** — invoked from the final integration regression gate's `(d) Debug failures now` option, after all waves and any Step 15 remediation. Uses the **Step 16 (final-gate)** column.
