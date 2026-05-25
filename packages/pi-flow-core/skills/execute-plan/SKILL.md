---
name: execute-plan
description: 'Use when executing an existing structured plan under docs/plans/.'
---

# Execute Plan

## Execution contract

- Run the git/worktree preflight, plan validation, settings menu, and existing-output gate before any worker dispatch.
- Execute dependency waves only through `coder` subagents, then route `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, and `BLOCKED` mechanically through Steps 9-13.
- Verify task acceptance only with fresh `verifier` subagents and `pi-flow helper execute-plan/parse-verifier-report`; `VERDICT: PASS` is required before Step 12.
- Run integration suites only through `test-runner` artifacts under `docs/test-runs/<plan-name>/`; reconcile via `current_failing_stable`, `current_non_reconcilable`, `current_non_baseline_stable`, and frozen `baseline_failures`.
- Preserve all user checkpoints: dirty reused workspace, settings, existing output files, blocked tasks, concerns, verifier failures, integration failures, retry exhaustion, refine-code budget exhaustion, final gate, and branch completion.
- After all waves, run `refine-code` with the configured iteration budget, enforce the final integration regression gate, clean artifacts, close linked ideas through the built-in `idea` tool, and offer branch completion.

### Non-negotiable boundaries

> The orchestrator MUST NOT run the configured test command itself or synthesize a `test-runner` artifact from locally-run output. All integration-test execution and artifact writing must be performed by the `test-runner` subagent.
>
> After a `coder` returns `DONE` or `DONE_WITH_CONCERNS`, the orchestrator MUST NOT run local grep / Python / assertion scripts, spot checks, or final-acceptance checks to decide whether the implementation satisfies the task. The only sanctioned path for substantive task verification is dispatching a fresh `verifier` subagent (Step 11).
>
> Completion cleanup, linked idea closure, and branch completion MUST NOT run while either final-gate regression set is non-empty: `current_non_baseline_stable ∪ current_non_reconcilable`.

See [`../_shared/orchestrator-verification-boundary.md`](../_shared/orchestrator-verification-boundary.md) for the shared boundary statement.

## Step 0: Worktree pre-flight

Run `pi-flow helper _shared/git-workspace-status --working-dir <working-dir>`. If `.is_git_repo` is `false`, stop with: `execute-plan requires a git repository.` Otherwise consume `IS_WORKTREE`, `IS_FEATURE_BRANCH`, `CURRENT_BRANCH`, `BRANCH_LABEL`, and `WORKSPACE_PATH` from the helper output.

| State | Action |
|---|---|
| `IS_WORKTREE=1` | Reuse the workspace; log `Reusing current workspace: <WORKSPACE_PATH> (reason: already inside worktree for branch '<BRANCH_LABEL>')`. |
| `IS_FEATURE_BRANCH=1` | Reuse the workspace; log `Reusing current workspace: <WORKSPACE_PATH> (reason: already on feature branch '<BRANCH_LABEL>')`. |
| main/master/develop and not in a worktree | Default to a new worktree with branch name derived from the plan filename. |
| User later chooses `(n) Create a new worktree instead` | Fall through to the same new-worktree flow. |

If both `IS_WORKTREE=1` and `IS_FEATURE_BRANCH=1`, use the `IS_WORKTREE=1` row.

For a reused workspace, run `DIRTY_STATUS=$(git status --porcelain)`.

- If clean, auto-proceed to Step 1 after the reuse log.
- If dirty, show this prompt exactly:

```
⚠️ Reused workspace <WORKSPACE_PATH> has uncommitted changes:
<DIRTY_STATUS>

Options:
(c) Continue in this workspace    — proceed as-is, mixing plan work with existing changes
(n) Create a new worktree instead — abandon reuse and fall back to the normal new-worktree flow
(x) Stop                          — cancel execution
```

Route choices:
- `(c)` proceed in the current workspace; Step 3 shows `Workspace: current workspace (on <BRANCH_LABEL>)`.
- `(n)` use the new-worktree default; Step 3 shows `Workspace: new worktree (branch: <suggested-branch>)`.
- `(x)` stop with `Plan execution cancelled.`

When a new worktree is selected, suggest a slash-free branch slug from the plan filename by stripping the leading date and `.md` (for example `2026-04-06-execute-plan-enhancements.md` -> `execute-plan-enhancements`). Follow the `using-git-worktrees` skill for directory selection, `git check-ignore` safety verification, project setup, and baseline test verification; continue subsequent steps in the worktree. If the user picks current workspace during customization, proceed without a worktree.

## Step 1: Locate the plan file

- If the user provides a path, use it directly.
- If the user says run the plan or similar without a path, list `docs/plans/` and let the user pick.
- If only one plan exists, confirm with the user before proceeding.
- Read the full contents of the plan file.

## Step 2: Validate the plan

Run `pi-flow helper execute-plan/extract-plan-tasks --plan <PLAN_PATH>`. On non-zero exit, surface the stderr JSON `missing_required_section` / `dependency_unknown_target` / `dependency_cycle` errors verbatim, suggest re-running `generate-plan`, and stop.

If the plan contains `## Test Command`, extract the bash fenced command inside it for later baseline and integration runs. If absent, Step 3 auto-detects the command.

## Step 3: Confirm execution settings

Present one settings confirmation:

```
Plan:  <plan filename>
Goal:  <plan goal>
Tasks: <count> across <N> waves

Workspace:          <see workspace values below>
TDD:                enabled
Execution:          parallel, pause on failure
Integration test:   <see defaults below>
Final review:       required (max 5 remediation iterations)

Ready to execute:
(s) Start
(c) Customize
(x) Stop
```

**Workspace values:** reused workspace accepted in Step 0 -> `current workspace (on <BRANCH_LABEL>)`; otherwise `new worktree (branch: <suggested-branch>)`.

**Integration test value:** if enabled and a command is available, show `enabled (<command>)`; otherwise `disabled (no test command)`.

| Setting | Default | Customization |
|---|---|---|
| Workspace | new worktree, unless Step 0 reuse was accepted | Skip this prompt if Step 0 reuse was accepted. |
| TDD | enabled | Can disable for non-code plans (docs, config, content). |
| Execution | parallel, pause on failure | Can switch to sequential or pause every wave. |
| Integration test | enabled when a command is available | Prompt for a command if enabling and none was detected. |
| Final review | required (max 5 iterations) | Can adjust max iterations; cannot disable. |

Resolve the test command in order:
1. Use the plan's `## Test Command` command from Step 2.
2. Otherwise run `pi-flow helper _shared/detect-test-command --working-dir <working-dir>` and consume `.command`.
3. If neither yields a command, show `not detected`; during customization let the user provide one or confirm no tests.

Route choices:
- `(s)` accept defaults and proceed to Step 4.
- `(c)` ask each setting individually, with final review limited to its max-iteration count, then show the final summary for confirmation.
- `(x)` stop with `Plan execution cancelled.`

After settings are confirmed, execute worktree setup now if it was selected and not already performed.

## Step 4: Check for existing output files

Before execution, scan the plan's task list for output file paths. If any already exist from a prior partial run, ask the user whether to:

- **Skip** those tasks, and their dependents if outputs appear valid.
- **Re-run** them, overwriting existing files.

## Step 5: Build dependency graph and group into waves

Use the `waves` array from `extract-plan-tasks` output. Each entry is `{wave, subwave, tasks}`; dispatch each subwave in order. The helper enforces `MAX_PARALLEL_HARD_CAP = 8`; pass `--max-parallel-hard-cap N` only when deliberately overriding the cap.

## Step 6: Resolve model tiers

Map plan recommendations to tiers:

| Task recommendation | Tier |
|---|---|
| `capable` | `capable` from `model-tiers.json` |
| `standard` | `standard` from `model-tiers.json` |
| `cheap` | `cheap` from `model-tiers.json` |

If a task has no tier, apply this rubric:
- 1-2 files and a complete spec -> `cheap`.
- Multiple files or integration concerns -> `standard`.
- Design judgment or broad codebase understanding -> `capable`.

For each task, invoke `pi-flow helper _shared/resolve-model-dispatch --tier <task-tier> --agent coder` and pass both resolved `model` and `cli` on every orchestration call, even when `cli` is `pi`. On non-zero exit, surface the byte-equal canonical Templates (1)-(4) from [`../_shared/model-tier-resolution.md`](../_shared/model-tier-resolution.md) and stop.

## Step 7: Baseline test capture

Skip this step if integration testing is disabled or no test command is available.

1. Compute `<plan-name>` as the plan filename without `.md`; create `docs/test-runs/<plan-name>/` before the first test-runner dispatch.
2. Dispatch `test-runner` per [`../_shared/test-runner-dispatch.md`](../_shared/test-runner-dispatch.md) with `artifact_path = <working-dir>/docs/test-runs/<plan-name>/baseline.log` and `phase_label = baseline`. The agent records stable suite-native identifiers in `FAILING_IDENTIFIERS:` and non-reconcilable evidence (panics, build errors, collection errors) in `NON_RECONCILABLE_FAILURES:`.
3. Parse the artifact handoff and format with `pi-flow helper _shared/parse-test-runner-artifact`.
4. Run `pi-flow helper _shared/reconcile-test-run --artifact <baseline-artifact-path> --mode capture > <working-dir>/docs/test-runs/<plan-name>/baseline-failures.json`; treat that file as `<baseline-json-path>`.
5. Read `.classification` (`clean` | `stable-failures-only` | `contains-non-reconcilable-evidence`) and `.baseline_failures`.

Route baseline classifications:

- `clean`: record `baseline_failures := ∅` and proceed.
- `stable-failures-only`: record `.baseline_failures`, warn, then proceed:

```
⚠️ Baseline: N tests already failing before execution. Only failures with stable identifiers not in this baseline will be flagged after each wave.
```

- `contains-non-reconcilable-evidence`: record `.baseline_failures` (possibly empty). Non-reconcilable entries are never set members of `baseline_failures`. Present:

```
⚠️ Baseline contains <M> non-reconcilable failure(s) (failures with no stable suite-native identifier).
These cannot be safely exempted by stable-identifier comparison: each later integration run will treat any non-reconcilable failure as a current gate-blocking failure, including ones that may already exist before this plan runs.

<render the three-section user-facing summary from integration-regression-gate.md, with current_failing_stable from FAILING_IDENTIFIERS and current_non_reconcilable from NON_RECONCILABLE_FAILURES>

Options:
(c) Continue anyway     — proceed with the baseline as-is; later non-reconcilable failures will block their gates and require Debug or Stop
(x) Stop plan execution — fix the suite first
```

  - `(c)` freeze `baseline_failures` and proceed.
  - `(x)` stop with `Plan execution cancelled — fix baseline non-reconcilable failures first.` Preserve `docs/test-runs/<plan-name>/`.

`baseline_failures` is frozen once recorded and never mutated by later waves, debugging passes, or the final gate. The reconciliation model, byte-for-byte comparison rules, classifications, and three-section summary live in [`integration-regression-gate.md`](integration-regression-gate.md).

### Test-runner call sites

> The orchestrator MUST NOT run the configured test command itself or synthesize a `test-runner` artifact from locally-run output. All integration-test execution and artifact writing must be performed by the `test-runner` subagent. The orchestrator may only create the parent directory with `mkdir -p docs/test-runs/<plan-name>/`, dispatch `test-runner` via `subagent_run_serial` with the filled `test-runner-prompt.md`, parse/validate the artifact with `pi-flow helper _shared/parse-test-runner-artifact`, and reconcile it against frozen `baseline_failures`.

Use the four protocol inputs from [`../_shared/test-runner-dispatch.md`](../_shared/test-runner-dispatch.md): `test_command`, `working_dir`, absolute `artifact_path`, and `phase_label`.

Artifact paths:
- Step 7 baseline: `docs/test-runs/<plan-name>/baseline.log` (written exactly once).
- Step 12.2 post-wave and Debugger-first re-test: `docs/test-runs/<plan-name>/wave-<N>-attempt-<K>.log`, where `<K>` increments on every re-entry within wave `<N>`.
- Step 16 final-gate: `docs/test-runs/<plan-name>/final-gate-<seq>.log`, where `<seq>` increments on every gate entry.

This boundary applies identically at Step 7, Step 12, the Step 12 Debugger-first re-test, and Step 16.

## Step 8: Execute waves

Before the first wave, record `PRE_EXECUTION_SHA=$(git rev-parse HEAD)` for Step 15/16 review and final-gate ranges.

If executing directly in the current workspace (not a worktree), emit once before the first wave:

```
⚠️ You're on `<branch_name>`. Commits will be made directly to <branch_name> after each wave.
```

For each wave/subwave:
1. Fill `$(pi-flow template execute-plan/execute-task-prompt)` via `pi-flow helper execute-plan/assemble-coder-prompt --task-spec <path-or-dash> --context <path-or-dash> --working-dir <abs-dir> --tdd-block <enabled|disabled> --output <filled-prompt-path>`; use a path or `-` for each path-or-dash input. `enabled` inlines `_shared/coder-tdd-block.md`; `disabled` substitutes empty. The helper performs single-pass literal substitution and fails closed on unreplaced placeholders.
2. Dispatch all tasks in parallel via `subagent_run_parallel`; in sequential mode, dispatch one at a time via `subagent_run_serial`.
3. Use task entries shaped like `{ name: '<task-N>: <task-title>', agent: 'coder', task: '<filled prompt>', model: '<resolved>', cli: '<resolved>' }`.
4. Parse each `finalMessage` with `pi-flow helper _shared/parse-coder-report --report <results[i].finalMessage path>`. `subagent_run_parallel` preserves input-task order.

The filled `execute-task-prompt.md` already includes TDD, self-review, escalation, code-organization, and report-format guidance; do not add those separately.

## Step 9: Handle worker status codes

See [`../_shared/coder-report-contract.md`](../_shared/coder-report-contract.md) for the parser invocation and status semantics; the local routing below is execute-plan-specific.

Route parsed `.status` values mechanically:

| Status | Route |
|---|---|
| `DONE` | Proceed to Step 10, then verification in Step 11. |
| `DONE_WITH_CONCERNS` | Record freeform concerns; do not resolve inline. Step 10 presents one combined checkpoint before Step 11. |
| `NEEDS_CONTEXT` | Provide the missing context and re-dispatch immediately. |
| `BLOCKED` | Record the blocker; do not recover inline. Step 10 handles the combined escalation with the canonical interventions. |

After the wave drains, Step 10 handles `BLOCKED` first, then `DONE_WITH_CONCERNS`. Step 11 runs only after Step 10 exits. Never ignore an escalation or re-dispatch the same task to the same model without changes.

### Acceptance-verification boundary

> After a `coder` returns `DONE` or `DONE_WITH_CONCERNS`, the orchestrator MUST NOT run local grep / Python / assertion scripts, spot checks, or final-acceptance checks to decide whether the implementation satisfies the task. The only sanctioned path for substantive task verification is dispatching a fresh `verifier` subagent (Step 11) with the planner-authored acceptance criteria and `Verify:` recipes, then mechanically parsing the verifier's protocol output via `pi-flow helper execute-plan/parse-verifier-report`.
>
> Forbidden behaviors include writing Python / grep / `Read` scripts that independently check criteria, running spot checks against implemented files to decide whether criteria pass, synthesizing a final acceptance script that re-checks task-specific expected strings, or interpreting local command output as evidence that a task passed.

Allowed mechanical glue:

| Activity | Helper |
|---|---|
| Plan parsing | `pi-flow helper execute-plan/extract-plan-tasks` |
| Coder prompt assembly | `pi-flow helper execute-plan/assemble-coder-prompt` |
| Verifier prompt assembly | `pi-flow helper execute-plan/assemble-verifier-prompt` |
| Diff context generation | `pi-flow helper execute-plan/collect-diff-context` |
| Verifier-visible file-set assembly | orchestrator-computed union rule (Step 11.2 compatibility label) |
| Model-tier resolution | `pi-flow helper _shared/resolve-model-dispatch` |
| Test-runner artifact parsing | `pi-flow helper _shared/parse-test-runner-artifact` |
| Verifier report parsing | `pi-flow helper execute-plan/parse-verifier-report` |
| Per-plan test-runs cleanup | `pi-flow helper _shared/cleanup-test-runs` |
| Post-helper Python bytecode cache cleanup | `pi-flow helper _shared/cleanup-pycache` |
| Completion bookkeeping | native git / built-in `idea` tool |

## Step 10: Wave gate: blocked and concerns handling

Run once per wave after every dispatched worker is classified. Order: drain wave -> blocked handling -> concerns handling -> exit. Do not start later waves, Step 11, or Step 12 while this gate is active. A wave with no `BLOCKED` and no `DONE_WITH_CONCERNS` passes through silently.

### 1. Drain the current wave

Wait for every worker. Build `BLOCKED_TASKS` from `.status == "BLOCKED"` and `CONCERNED_TASKS` from `.status == "DONE_WITH_CONCERNS"`; use `.blocker_text` or `.concerns_block` for user-facing text.

### 2. Blocked handling (runs first)

If `BLOCKED_TASKS` is empty, skip to concerns handling. Otherwise present one combined escalation view (not one prompt per task) containing:
1. Header: `🚫 Wave <N>: <count> task(s) BLOCKED. Execution paused before any later wave.`
2. Wave outcomes for every task in the wave, including successful same-wave tasks, with status, number, and title.
3. Blocked tasks with number, title, full untruncated blocker text from `## Concerns / Needs / Blocker`, and the task's `**Files:**` scope.

Example layout:

~~~
🚫 Wave 2: 1 task(s) BLOCKED. Execution paused before any later wave.

Wave outcomes:
  - Task 3: Add baseline test capture           DONE
  - Task 4: Add direct-branch warning          BLOCKED

Blocked tasks:

[Task 4] Add direct-branch warning
  Files: skills/execute-plan/SKILL.md
  Blocker:
    <full blocker text from the worker report>
~~~

Then ask per blocked task, one at a time:

~~~
Task <N>: <task_title> (current tier: <tier>) — choose an intervention:
(c) More context         — re-dispatch this task with additional context you supply
(m) Better model         — re-dispatch this task with a more capable model tier
                            [omit this line if current tier is already `capable`]
(s) Split into sub-tasks — break this task into smaller sub-tasks and dispatch them
(x) Stop execution       — halt the plan; prior wave commits remain in git history
~~~

Canonical interventions:
- `(c) More context`: prompt for context; re-dispatch the original task plus `## Additional Context`. Keep the tier unless `(m)` is also chosen.
- `(m) Better model`: only when current tier is `cheap` or `standard`; escalate `cheap` -> `standard` or `standard` -> `capable` and resolve per Step 6. Suppress this option at `capable`.
- `(s) Split into sub-tasks`: decompose in-session. Sub-tasks must preserve the same output files and acceptance-criteria coverage. Dispatch as a mini-wave bounded by `MAX_PARALLEL_HARD_CAP` (sequential if naturally ordered). Replace the parent slot with the sub-tasks; each sub-task is classified independently. Split dispatches run pre-commit, so their changes must remain in the working tree at Step 11 (see the Step 11.2 compatibility file-set fallback). Retry budget follows Step 13.
- `(x) Stop execution`: halt immediately; do not run Step 11/12 for this wave. Report via Step 14. Prior wave commits remain; `docs/test-runs/<plan-name>/` is preserved.

If any blocked task chooses `(x)`, stop the whole plan without prompting remaining blocked tasks. Otherwise re-dispatch the selected tasks together (parallel, capped by `MAX_PARALLEL_HARD_CAP`) using Step 8's dispatch shape; apply Step 9, rebuild `BLOCKED_TASKS` / `CONCERNED_TASKS`, and re-enter blocked handling until empty or stopped. Each re-dispatch counts toward Step 13.

### 3. Concerns handling (runs second)

Precondition: `BLOCKED_TASKS` is empty and every task is `DONE` or `DONE_WITH_CONCERNS`.

If `CONCERNED_TASKS` is empty, skip to gate exit. Otherwise present all concerned tasks together:

```
⚠️ Wave <N>: <M> task(s) returned DONE_WITH_CONCERNS. Review before verification.

── Task 3: <short title> ──────────────────────────────────
  Files: <path/one>, <path/two>
  Concerns:
    - <worker concern, verbatim>
    - <worker concern, verbatim>
───────────────────────────────────────────────────────────

Options:
(c) Continue to verification   — proceed to Step 11 with all tasks as-is
(r) Remediate selected task(s) — specify task number(s) and guidance; re-dispatch those tasks
(x) Stop execution             — halt the plan; prior wave commits remain in git history
```

Route choices:
- `(c)` exit concerns handling; verifier is the next gate.
- `(r)` prompt for task numbers from `CONCERNED_TASKS` and a freeform guidance block. Re-dispatch selected tasks to fresh `coder` workers with the original spec plus the worker concerns and user guidance under `## Concerns To Address`. Count each re-dispatch toward Step 13, apply Step 9, route any `BLOCKED` back to blocked handling, rebuild `CONCERNED_TASKS`, and re-enter concerns handling. Unselected tasks keep their prior status and re-appear.
- `(x)` halt immediately; do not run Step 11/12 for this wave. Report via Step 14; preserve `docs/test-runs/<plan-name>/`.

Repeat until `CONCERNED_TASKS` is empty or the user chooses `(x)`.

### 4. Gate exit

Exit only when `BLOCKED_TASKS` is empty and `CONCERNED_TASKS` is empty or the user chose `(c)`. Tasks still `DONE_WITH_CONCERNS` flow into Step 11 as-is; the verifier's verdict is authoritative.

## Step 11: Verify wave output

Precondition: Step 10 has exited. Verify every non-blocked task in the wave with a fresh-context `verifier` subagent and the protocol in [`acceptance-criteria-verification.md`](acceptance-criteria-verification.md). That file owns template placeholders, recipe classification, diff collection, prompt assembly, dispatch resolution, parser invocation, per-criterion output shape, `VERDICT:` shape, full-coverage rule, and Phase 1 evidence-block protocol errors.

Before dispatching a verifier, check that every acceptance criterion has a non-empty `Verify:` recipe. If any is missing, stop this wave, report the task number and criterion text, recommend re-running `generate-plan`, and do not dispatch the verifier or treat the task as passing. A plan without complete `Verify:` recipes is a protocol error and must be regenerated before execution continues.

1. **Dispatch verifiers (compatibility: Step 11.2 verifier dispatch).** Launch verifier work for the wave concurrently, bounded by the `@aphotic/pi-mux-subagents` `MAX_PARALLEL_HARD_CAP`; wait for all before parsing. For each task, compute `{MODIFIED_FILES}` with `pi-flow helper execute-plan/compute-verifier-file-set --task-files <task-files-json> --worker-files <worker-files-json> --observed-status <git-status-output-path-or-dash> --observed-diff-paths <diff-paths-json> --wave-shape <single-task|parallel-multi-task>` and consume `.verifier_visible_files`. Pass `--observed-status` as a path to verbatim `git status --porcelain` output, or `-` for stdin; never pass porcelain text directly as the argument value. The prompt records that the set is orchestrator-assembled.

   **Sub-task carve-out:** Step 10 split-into-sub-tasks dispatches MUST run pre-commit; their changes must remain in the working tree at Step 11 so `git diff HEAD` captures them. Step 12's commit is the only sanctioned working-tree -> committed transition. If a sub-task's changes were committed before Step 11 (protocol violation), substitute `git diff <pre-subtask-commit>..HEAD -- <modified files>` for those criteria.

2. **Parse verifier output and gate the wave (compatibility: Step 11.3 parser gate).** Parse each report with `pi-flow helper execute-plan/parse-verifier-report`. Route `VERDICT: PASS` as passing. Route `VERDICT: FAIL` (including malformed output or Phase 1 protocol errors) into Step 13 with the per-criterion `FAIL` entries and `reason:` text. Protocol errors never pass and are never silently interpreted as `PASS`.

Step 11 exits successfully only when every task in the wave has `VERDICT: PASS`. If any task has `VERDICT: FAIL`, Step 12 MUST NOT run until Step 13 produces `VERDICT: PASS` for every failed task.

## Step 12: Post-wave commit and integration tests

Precondition: Step 10 has exited and Step 11 reports `VERDICT: PASS` for every task in the wave. If not, return to Step 10 or Step 13. Both commit and integration test run are withheld until the wave succeeds.

1. **Commit wave changes.** Stage and commit all changes from the completed wave:

```bash
git add -A
git commit -m "feat(plan): wave <N> - <plan_goal_summary>

- Task <X>: <task_title>
- Task <Y>: <task_title>"
```

Subject: `feat(plan): wave <N> - <plan_goal_summary>` (truncate Goal with `...` near 72 chars), blank line, then one `- Task <X>: <task_title>` body line per task. If `git add -A` stages nothing, skip the commit silently.

2. **Run integration tests (compatibility: Step 12.2 post-wave reconcile).** Skip if integration testing is disabled or no test command is available. Dispatch `test-runner` with `artifact_path = <working-dir>/docs/test-runs/<plan-name>/wave-<N>-attempt-<K>.log` and `phase_label = wave-<N>-attempt-<K>`, where `<K>` is a 1-based wave attempt counter incremented on every Debugger-first re-test. Then run `pi-flow helper _shared/reconcile-test-run --artifact <wave-artifact-path> --mode reconcile --baseline-failures <baseline-json-path>` and consume `.current_failing_stable`, `.current_non_reconcilable`, `.current_non_baseline_stable`, and `.classification` (`pass` | `fail`). Render the [`integration-regression-gate.md`](integration-regression-gate.md) three-section summary.

   - `pass`: proceed to wave `<N+1>`, or Step 15/16 if final.
   - `fail`: render the Step 12 fail-path header. On intermediate waves only, run the expected-failure skip classification below before presenting the menu; on the final wave, go straight to the menu.

**Expected-failure skip (intermediate waves only).**

Some plans intentionally leave specific integration tests failing between waves because later wave work is what fixes them. Before presenting the intermediate-wave menu, evaluate each failing entry in `current_non_baseline_stable ∪ current_non_reconcilable` against the remaining waves and tasks. Skip the menu and continue to the next wave only when every failing entry is classifiable as **expected**. An entry is expected only when ALL of the following hold:

1. The executor can cite a specific future wave or task whose description, acceptance criteria, `**Files:**` scope, or feature work plausibly covers the failing behavior.
2. The connection is concrete: the future task's scope clearly relates to the failing test (matching file path, suite name, or feature area). Inferring "later code probably fixes it" without a concrete link is NOT sufficient.
3. The entry has a stable suite-native identifier. Non-reconcilable failures (panics, build errors, collection errors) are always ambiguous and never expected.

If — and only if — every failing entry meets all three criteria, skip the menu, render this notification, and proceed to wave `<N+1>`:

```
ℹ️ Integration tests failed after wave <N>, but every failure is expected to be fixed by later plan work. Continuing to wave <N+1>.

- <failing identifier> — expected fix: <concrete reason from evaluation>; to be addressed by Wave <M> / Task <X>: <task title>
- ...
```

`baseline_failures` is NOT mutated by this skip; the same failures will be re-evaluated after the next wave and at the Step 16 final gate, which has no skip path.

Do not use this skip as a blanket excuse to defer regressions. If ANY single failing entry is unexpected, ambiguous, mixed with unlinked failures, non-reconcilable, or cannot be confidently tied to future work, fall through to the unchanged **Intermediate-wave menu** below so the user sees the full failure context and chooses.

**Intermediate-wave menu** (`<N> < total_waves`):

```
Options:
(d) Debug failures now        — dispatch the Debugger-first flow against current_non_baseline_stable ∪ current_non_reconcilable, then re-test
(c) Continue despite failures — proceed to wave <N+1> without modifying baseline_failures
(x) Stop execution            — halt the plan; prior wave commits remain in git history
```

- `(d)` follow [`integration-regression-debugging.md`](integration-regression-debugging.md) using the **Step 12 (post-wave)** parameter row, scoped to `current_non_baseline_stable ∪ current_non_reconcilable`. `change_range` = the wave commit SHA; `suspect_universe` = wave `<N>` tasks whose modified files appear in failing stack traces, or all wave tasks if ambiguous; `re_test_callback` re-invokes test-runner dispatch with a fresh `wave-<N>-attempt-<K>` artifact and recomputes via `integration-regression-gate.md`. Do not undo the wave commit up front. Counts toward Step 13's 3-retry limit.
- `(c)` proceed to wave `<N+1>`. `baseline_failures` is NOT mutated; unresolved failures will be flagged again. Final completion remains blocked until both `current_non_baseline_stable` and `current_non_reconcilable` are empty. Warn the user accordingly.
- `(x)` halt; prior wave commits remain. Report via Step 14; preserve `docs/test-runs/<plan-name>/`.

**Final-wave menu** (`<N> == total_waves`):

```
Options:
(d) Debug failures now — dispatch the Debugger-first flow against current_non_baseline_stable ∪ current_non_reconcilable, then re-test
(x) Stop execution     — halt the plan; prior wave commits remain in git history
```

No continue option on the final wave. The user MUST either debug or stop.

- `(d)` same as the intermediate-wave debug path. Step 16's final gate still applies.
- `(x)` halt; prior wave commits remain. Report via Step 14; preserve `docs/test-runs/<plan-name>/`.

## Step 13: Handle failures and retries

All re-dispatches from Step 10 blocked handling, Step 10 concerns remediation, Step 11 `VERDICT: FAIL` routing, and Step 12/16 integration debugging share the same per-task retry rules:

| Rule | Behavior |
|---|---|
| Automatic retries | Retry automatically up to **3 times**, improving the prompt where possible. |
| Shared counter | Exhaustion in one path exhausts the budget everywhere; later failures go directly to the exhaustion menu. |
| Split rule | `(s) Split into sub-tasks` consumes 1 retry from the parent; each sub-task inherits the parent's remaining count, not a fresh budget. |
| Verifier failures | Unresolved `VERDICT: FAIL` must be retried to `VERDICT: PASS` or stopped. |

After 3 failed retries, notify the user at the end of the wave and ask:

```
Options:
(r) Retry again    — optionally with a different model or more context. Resets the per-task budget back to 3 for that task only.
(x) Stop execution — halt the plan; prior wave commits remain in git history
```

`docs/test-runs/<plan-name>/` is preserved on `(x)`. There is no skip option.

Apply wave pacing from Step 3 only after Step 10 has exited and every task has `VERDICT: PASS`; `BLOCKED`, unresolved concerns, and `VERDICT: FAIL` always pause regardless of pacing.

```
Options:
(f) Pause only on failure   [default]
(w) Pause every wave
```

## Step 14: Report partial progress

When execution stops early, leave the plan file in `docs/plans/` and report completed, failed, and remaining tasks.

If any post-wave or final-gate `test-runner` artifact exists, reconcile the most recent artifact with `pi-flow helper _shared/reconcile-test-run --artifact <most-recent-artifact-path> --mode reconcile --baseline-failures <baseline-json-path>` and render:

```
### Most recent integration run failures (unresolved)
<current_non_baseline_stable list, or `(none)`>

### Non-reconcilable failures from the most recent integration run
<current_non_reconcilable list, or `(none)`>

These failures were observed in the most recent integration run on this branch and remain unresolved.
They must be debugged before this branch is considered shippable.
```

Preserve `docs/test-runs/<plan-name>/` on every stop exit so the user can inspect raw output.

## Step 15: Request code review

After all waves complete successfully, run the required final review:

1. Gather inputs: `BASE_SHA = PRE_EXECUTION_SHA`; `HEAD_SHA = git rev-parse HEAD`; Description = plan Goal; Requirements = full plan; Max iterations = Step 3 setting (default 5); Working directory = current workspace; Review output path = `docs/reviews/<plan-name>-code-review`.
2. Invoke the `refine-code` skill with those inputs.
3. Parse the summary with `pi-flow helper refine-code/parse-refine-code-summary --summary <path-or-dash>` to obtain `{status, iterations, issues_found_total, issues_found_critical, issues_found_important, issues_found_minor, issues_fixed, issues_remaining, review_file, remaining_issues, failure_reason}`.
4. Route `status`: `approved` -> include iteration count and review file in Step 16; `approved_with_concerns` -> also point to the review file's `### Outcome`; `failed` -> surface `failure_reason` and stop via Step 14; `not_approved_within_budget` -> present `remaining_issues` and this menu:

   **`not_approved_within_budget` menu:**
   ```
   Options:
   (c) Continue iterating — fresh budget; new era starts with a remediation pass on the prior era's findings before the next review.
   (p) Proceed with issues noted
   (x) Stop execution     — halt the plan; prior wave commits remain in git history
   ```

   Preserve `docs/test-runs/<plan-name>/` on `(x)`.

## Step 16: Complete

### Final integration regression gate (precondition)

Skip only if integration tests are disabled or no test command is available. Otherwise always re-run the full integration suite before marking the plan complete. Use the same baseline-only model in [`integration-regression-gate.md`](integration-regression-gate.md): compare against frozen `baseline_failures` and treat any non-reconcilable failure as blocking.

Gate protocol:
1. Dispatch `test-runner` per Step 7 with `artifact_path = <working-dir>/docs/test-runs/<plan-name>/final-gate-<seq>.log` and `phase_label = final-gate-<seq>`, where `<seq>` increments on every gate entry.
2. Run `pi-flow helper _shared/reconcile-test-run --artifact <final-gate-artifact-path> --mode reconcile --baseline-failures <baseline-json-path>` and consume `.current_failing_stable`, `.current_non_reconcilable`, `.current_non_baseline_stable`, and `.classification`.
3. If both `current_non_baseline_stable` and `current_non_reconcilable` are empty, the gate passes; proceed to cleanup. Otherwise render the three-section summary with header `⚠️ Final completion blocked: current integration failures remain.` and note that both sets must be empty, then present:

   ```
   Options:
   (d) Debug failures now — follow integration-regression-debugging.md (Step 16 final-gate row) against current_non_baseline_stable ∪ current_non_reconcilable; on success, re-enter this gate
   (x) Stop execution     — halt the plan; prior wave commits remain in git history
   ```

   Empty sections render as `(none)`. There is no continue option.
4. Route menu actions:
   - `(d)` follow [`integration-regression-debugging.md`](integration-regression-debugging.md) using the **Step 16 (final-gate)** parameter row. `change_range = BASE_SHA..HEAD_SHA`, with `BASE_SHA = PRE_EXECUTION_SHA` and `HEAD_SHA = git rev-parse HEAD`; `suspect_universe` = every plan task whose `**Files:**` scope intersects `git diff --name-only BASE_SHA HEAD_SHA`; `re_test_callback` re-enters this gate at step 1. Repeat until both gate-blocking sets are empty or the user picks `(x)`. Each attempt counts toward Step 13.
   - `(x)` halt. Report via Step 14 using unresolved `current_non_baseline_stable` and `current_non_reconcilable` from the most recent final-gate artifact. Do NOT close the idea or run branch completion. Preserve `docs/test-runs/<plan-name>/`.

**Blocking guarantee:** cleanup, linked idea closure, and branch completion MUST NOT execute while `current_non_baseline_stable ∪ current_non_reconcilable` is non-empty. The only exits are gate-pass or `(x)`.

### 1. Cleanup

Precondition: `current_non_baseline_stable ∪ current_non_reconcilable` is empty and this run reached cleanup via final-gate success, never through a stop path. Delete the per-plan test-runs directory only via:

```bash
pi-flow helper _shared/cleanup-test-runs docs/test-runs/<plan-name>
```

### 2. Close linked idea

Apply the linked-idea-closure procedure in [`../_shared/idea-closure.md`](../_shared/idea-closure.md). Execute-plan resolves `idea_id` and `completion_note` per its own rules:

Scan the plan for `**Source:** IDEA-<id>`. If found:
1. Extract the idea ID, for example `IDEA-5735f43b`.
2. Read the idea via the built-in `idea` tool (`action: "read"`, `id: "<id>"`).
3. If it exists and is not already "closed": call the built-in `idea` tool with `action: "update"`, `id: "<id>"`, `status: "closed"`, and `body: "<existing body + \nCompleted via plan: docs/plans/<plan-filename>.md>"`. Record the ID for the summary report.
4. If the idea is missing, already closed, or unreadable, skip silently.

Skip this substep if no source line exists.

### 3. Report summary

Report the number of tasks completed, concerns noted, review status/notes if performed, total time taken, and any closed idea (for example `Closed IDEA-5735f43b`).

### 4. Branch completion (if applicable)

Only when running in a worktree or on a feature branch (not main/master/develop), invoke `finishing-a-development-branch`. It verifies tests, determines the base branch, presents merge/PR/keep/discard options, executes the choice, and cleans up the worktree if applicable. Offer branch completion even if review issues are pending.

When on main/master, skip branch completion and report the Step 16.3 summary.
