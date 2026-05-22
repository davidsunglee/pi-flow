---
name: execute-plan
description: "Executes a structured plan file from docs/plans/. Decomposes tasks into dependency-ordered waves and dispatches coder subagents in parallel. Use when the user wants to execute an existing plan."
---

# Execute Plan

## Step 0: Worktree pre-flight

Before starting execution, determine the workspace.

**Auto-detect:** Run `pi-flow helper _shared/git-workspace-status --working-dir <working-dir>`. The helper emits a JSON object with `is_git_repo`, `is_worktree`, `is_feature_branch`, `current_branch`, `branch_label`, and `workspace_path` fields. If `.is_git_repo` is `false`, stop with: `execute-plan requires a git repository.` Otherwise consume `IS_WORKTREE`, `IS_FEATURE_BRANCH`, `CURRENT_BRANCH`, `BRANCH_LABEL`, and `WORKSPACE_PATH` from the helper output.

**If `IS_WORKTREE=1` or `IS_FEATURE_BRANCH=1`:** Reuse the existing workspace, but log and safety-check it first.

1. **Log the reused workspace explicitly.** Emit one message (worktree takes priority over feature-branch):
   - If `IS_WORKTREE=1`: `Reusing current workspace: <WORKSPACE_PATH> (reason: already inside worktree for branch '<BRANCH_LABEL>')`
   - Else (`IS_FEATURE_BRANCH=1`): `Reusing current workspace: <WORKSPACE_PATH> (reason: already on feature branch '<BRANCH_LABEL>')`

   This log is mandatory for every reuse.

2. **Check whether the reused workspace is dirty.** Run `DIRTY_STATUS=$(git status --porcelain)`. The workspace is dirty if `DIRTY_STATUS` is non-empty (it covers modified tracked files, staged changes, and untracked files).

3. **If the reused workspace is clean:** auto-proceed to Step 1 after the reuse log.

4. **If the reused workspace is dirty:** warn the user before continuing and offer three choices:
   ```
   ⚠️ Reused workspace <WORKSPACE_PATH> has uncommitted changes:
   <DIRTY_STATUS>

   Options:
   (c) Continue in this workspace — proceed as-is, mixing plan work with existing changes
   (n) Create a new worktree instead — abandon reuse and fall back to the normal new-worktree flow
   (x) Stop — cancel execution
   ```

   - **(c) Continue:** proceed to Step 1 in the current workspace.
   - **(x) Stop:** stop with `Plan execution cancelled.`
   - **(n) New worktree instead:** fall through to the new-worktree flow below (the same flow used when starting from main/master/develop), including the usual suggested branch name derived from the plan filename. The settings summary (Step 3) will then show `new worktree (branch: <suggested-branch>)`.

Once reuse is accepted (clean, or dirty with `(c) Continue`), the settings summary (Step 3) shows `Workspace: current workspace (on <BRANCH_LABEL>)`.

**If on main/master/develop and NOT in a worktree, or the user chose `(n) Create a new worktree instead`:** the settings summary (Step 3) shows `new worktree (branch: <suggested-branch>)` as the default.

If the user accepts the worktree default (or selects it during customization):
1. Suggest a branch name derived from the plan filename: strip the leading date and `.md`, keep a slash-free slug (e.g. `2026-04-06-execute-plan-enhancements.md` → `execute-plan-enhancements`). Avoid `/` prefixes (they produce nested worktree directories).
2. Follow the `using-git-worktrees` skill: directory selection (existing `.worktrees/` > project config > ask), safety verification (`git check-ignore`), project setup (`package.json`, `Cargo.toml`, etc.), baseline test verification.
3. Continue subsequent steps in the worktree.

If the user picks "current workspace" during customization, proceed without a worktree.

## Step 1: Locate the plan file

- If the user provides a path, use it directly.
- If the user says "run the plan" or similar without a path, list `docs/plans/` and let the user pick.
- If only one plan exists, confirm with the user before proceeding.
- Read the full contents of the plan file.

## Step 2: Validate the plan

Run `pi-flow helper execute-plan/extract-plan-tasks --plan <PLAN_PATH>`; on non-zero exit, surface the stderr JSON `missing_required_section` / `dependency_unknown_target` / `dependency_cycle` errors verbatim and stop. Suggest re-running `generate-plan`.

The plan may also contain an optional `## Test Command` section with a bash command for running the project's test suite. If present, extract the command (the content of the bash fenced code block inside `## Test Command`) for use in later steps (baseline capture and integration tests). If absent, test command detection falls back to auto-detect in Step 3.

## Step 3: Confirm execution settings

Present a single settings confirmation showing the plan context and recommended defaults:

```
Plan:  <plan filename>
Goal:  <plan goal>
Tasks: <count> across <N> waves

Workspace:          <see workspace values below>
TDD:                enabled
Execution:          parallel, pause on failure
Integration test:   <see defaults below>
Final review:       enabled (max 3 remediation iterations)

Ready to execute:
(s) Start
(c) Customize
(x) Stop
```

**Workspace values:** if reuse was accepted in Step 0 (clean, or dirty with `(c) Continue`), show `current workspace (on <BRANCH_LABEL>)`; otherwise show `new worktree (branch: <suggested-branch>)`. Declined reuse follows the new-worktree default.

**Integration test value:** when enabled and a test command is available, show `enabled (<command>)`; otherwise `disabled (no test command)`.

**Defaults:**

| Setting | Default | Notes |
|---------|---------|-------|
| Workspace | new worktree | See Step 0 for the reuse-vs-new-worktree decision rules. |
| TDD | enabled | Can disable for non-code plans (docs, config, content) |
| Execution | parallel, pause on failure | Can customize to sequential, or change pacing |
| Integration test | enabled | If a test command is available, show `enabled (<command>)`. If no test command, show `disabled (no test command)` |
| Final review | enabled (max 3 iterations) | Iterative review-remediate loop after all waves — can disable or adjust max iterations |

**Test command resolution order:**
1. If the plan contains a `## Test Command` section (extracted in Step 2), use that command.
2. Otherwise, run `pi-flow helper _shared/detect-test-command --working-dir <working-dir>` and consume the helper's `.command` field.
3. If neither yields a command, show "not detected" in the settings. During customize, allow the user to provide a command or confirm no tests.

**If `s`:** Accept all defaults and proceed to Step 4.

**If `c`:** Ask each setting individually — Workspace (skip if Step 0 reuse was accepted), TDD, Execution mode (Sequential/Parallel), Wave pacing if parallel ((f) Pause only on failure [default] / (w) Pause every wave), Integration test (prompt for command if enabling and none detected), Final review (prompt for max iterations if enabling). After customization, show the final settings summary for confirmation.

**If `x`:** stop with `Plan execution cancelled.`

After settings are confirmed, if Worktree was selected and Step 0 hasn't executed worktree setup yet, execute it now.

## Step 4: Check for existing output files

Before execution, scan the plan's task list for output file paths. If any already exist (from a prior partial run), ask the user:
- **Skip** those tasks (and their dependents if outputs appear valid)
- **Re-run** them (overwrite existing files)

## Step 5: Build dependency graph and group into waves

Read the `waves` array from `extract-plan-tasks.py` output (Step 2 invocation). Each entry is `{wave, subwave, tasks}`; dispatch each subwave in order. The cap `MAX_PARALLEL_HARD_CAP = 8` is enforced by the helper; pass `--max-parallel-hard-cap N` to override.

Worked example (illustrative only — helper output is authoritative):
```
Dependencies:
- Task 3 depends on: Task 1, Task 2
- Task 4 depends on: Task 1
- Task 5 depends on: Task 3, Task 4

Wave 1: [Task 1, Task 2]
Wave 2: [Task 3, Task 4]
Wave 3: [Task 5]
```

## Step 6: Resolve model tiers

Map each task's model recommendation to the tier map:

| Task recommendation | Model to use |
|---------------------|-------------|
| `capable` | `capable` from model-tiers.json |
| `standard` | `standard` from model-tiers.json |
| `cheap` | `cheap` from model-tiers.json |

If a task has no tier specified, apply this rubric:
- Touches 1–2 files with a complete spec → `cheap`
- Touches multiple files with integration concerns → `standard`
- Requires design judgment or broad codebase understanding → `capable`

Resolve `(model, cli)` per task by invoking `pi-flow helper _shared/resolve-model-dispatch --tier <task-tier> --agent coder`. The full procedure is documented in [`skills/_shared/model-tier-resolution.md`](../_shared/model-tier-resolution.md). Surface byte-equal canonical Template (1)–(4) on non-zero exit and stop the call site.

Always pass `cli` explicitly on every orchestration call, even when it resolves to `"pi"`.

## Step 7: Baseline test capture

**Skip if:** Integration test is disabled (Step 3 settings) or no test command is available.

Before the first wave, run the integration suite via `test-runner` (see the shared dispatch subsection below) with `{ARTIFACT_PATH} = <working-dir>/docs/test-runs/<plan-name>/baseline.log` and `{PHASE_LABEL} = baseline`. The agent applies the two-bucket extraction contract from `agent/agents/test-runner.md`: stable suite-native identifiers in `FAILING_IDENTIFIERS:` and non-reconcilable evidence (panics, build errors, collection errors) in `NON_RECONCILABLE_FAILURES:`. The orchestrator reads both buckets from the artifact.

#### Baseline recording

After artifact readback, run `pi-flow helper _shared/reconcile-test-run --artifact <baseline-artifact-path> --mode capture > <working-dir>/docs/test-runs/<plan-name>/baseline-failures.json`. Treat that file as `<baseline-json-path>` for every later reconcile call. Read `.classification` (`clean` | `stable-failures-only` | `contains-non-reconcilable-evidence`) and `.baseline_failures` from the saved JSON, then route to the per-classification user prompts below.

**`clean`:** record `baseline_failures := ∅` and proceed.

**`stable-failures-only`:** record `baseline_failures` from the helper's `.baseline_failures`. Warn the user:
```
⚠️ Baseline: N tests already failing before execution. Only failures with stable identifiers not in this baseline will be flagged after each wave.
```
Then proceed.

**`contains-non-reconcilable-evidence`:** record `baseline_failures` from `.baseline_failures` (may be empty). Non-reconcilable entries are never set members of `baseline_failures`. Present the user with an explicit decision:
```
⚠️ Baseline contains <M> non-reconcilable failure(s) (failures with no stable suite-native identifier).
These cannot be safely exempted by stable-identifier comparison: each later integration run will treat any non-reconcilable failure as a current gate-blocking failure, including ones that may already exist before this plan runs.

<render the three-section user-facing summary from integration-regression-gate.md, with current_failing_stable from FAILING_IDENTIFIERS and current_non_reconcilable from NON_RECONCILABLE_FAILURES>

Options:
(c) Continue anyway — proceed with the baseline as-is; later non-reconcilable failures will block their gates and require Debug or Stop.
(x) Stop plan execution — fix the suite first.
```
- **(c) Continue anyway:** freeze `baseline_failures` (which may be empty) and proceed.
- **(x) Stop plan execution:** stop with `Plan execution cancelled — fix baseline non-reconcilable failures first.` The per-plan `docs/test-runs/<plan-name>/` directory is preserved on every stop exit so the user can inspect run artifacts.

In all branches, `baseline_failures` is frozen once recorded and never mutated by any later wave, debugging pass, or final-gate run.

#### Integration regression gate

See [`integration-regression-gate.md`](integration-regression-gate.md) for the baseline-only reconciliation model: the frozen `baseline_failures` set, per-run inputs (`current_failing_stable`, `current_non_reconcilable`, `current_non_baseline_stable`), the byte-for-byte set-comparison rules, the pass/fail classification, and the user-facing summary format. Step 12, the Step 12 Debugger-first flow, and Step 16 all consume this same model.

#### Test-runner dispatch (shared)

### Boundary: orchestrator MUST NOT run the test command itself

> The orchestrator MUST NOT run the configured test command itself or synthesize a `test-runner` artifact from locally-run output. All integration-test execution and artifact writing must be performed by the `test-runner` subagent. The orchestrator may only:
> - Create the parent directory `docs/test-runs/<plan-name>/` (via `mkdir -p`).
> - Dispatch `test-runner` via `subagent_run_serial` with the filled `test-runner-prompt.md` template.
> - Parse the artifact handoff marker via `pi-flow helper _shared/parse-test-runner-artifact`.
> - Validate the artifact format via the same `pi-flow helper _shared/parse-test-runner-artifact` helper, which performs both the handoff parse and the structural format checks (required-header presence and order, `EXIT_CODE` integer parse, `FAILING_IDENTIFIERS_COUNT` / `NON_RECONCILABLE_COUNT` integer parse and count reconciliation, raw-output marker presence).
> - Reconcile the parsed `FAILING_IDENTIFIERS:` and `NON_RECONCILABLE_FAILURES:` against the frozen `baseline_failures` per `integration-regression-gate.md`.
>
> This boundary applies identically at Step 7 (baseline), Step 12 (post-wave), the Step 12 Debugger-first re-test, and Step 16 (final-gate). See `skills/_shared/orchestrator-verification-boundary.md` for the shared statement.

**Per-plan runs directory.** Compute `<plan-name>` as the plan filename without the `.md` extension; before the first `test-runner` dispatch in the plan, create it with `mkdir -p docs/test-runs/<plan-name>`.

**Filename scheme.** `{ARTIFACT_PATH}` is the absolute path formed by joining `<working-dir>` with one of:
- Step 7 baseline: `docs/test-runs/<plan-name>/baseline.log` (written exactly once).
- Step 12.2 post-wave + Debugger-first re-test: `docs/test-runs/<plan-name>/wave-<N>-attempt-<K>.log`, where `<K>` increments on every re-entry within wave `<N>`.
- Step 16 final-gate: `docs/test-runs/<plan-name>/final-gate-<seq>.log`, where `<seq>` increments on every gate entry.

Test-runner invocations follow the protocol in [`skills/_shared/test-runner-dispatch.md`](../_shared/test-runner-dispatch.md). For each invocation, supply the four protocol inputs: `test_command` from Step 3 settings; `working_dir` = the absolute working directory; `artifact_path` = an absolute path under `docs/test-runs/<plan-name>/` per the filename scheme above; `phase_label` = the appropriate label for the call site (`baseline`, `wave-<N>-attempt-<K>`, or `final-gate-<seq>`).

## Step 8: Execute waves

Before dispatching the first wave, record the current HEAD SHA for the post-completion review: `PRE_EXECUTION_SHA=$(git rev-parse HEAD)`.

### Direct-branch warning

If executing directly in the current workspace (not a worktree), emit this warning once before the first wave (continue without an extra confirmation):

```
⚠️ You're on `<branch_name>`. Commits will be made directly to <branch_name> after each wave.
```

For each wave, dispatch all tasks in parallel via `subagent_run_parallel`; in sequential mode, dispatch one at a time via `subagent_run_serial`. Each task entry has shape `{ name: "<task-N>: <task-title>", agent: "coder", task: "<self-contained prompt>", model: "<resolved>", cli: "<resolved>" }`.

For each result, run `pi-flow helper execute-plan/parse-coder-report --report <results[i].finalMessage path>`; route on `.status` (`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`). `subagent_run_parallel` preserves input-task order.

### Assembling worker prompts

For each task, fill `$(pi-flow template execute-plan/execute-task-prompt)` via `pi-flow helper execute-plan/assemble-coder-prompt --task-spec <path-or-`-`> --context <path-or-`-`> --working-dir <abs-dir> --tdd-block <enabled|disabled> --output <filled-prompt-path>` (`enabled` inlines `tdd-block.md`; `disabled` substitutes empty). The helper enforces single-pass literal substitution and fails closed on any unreplaced placeholder.

The filled template becomes the `coder` task prompt; it already includes self-review, escalation, code-organization, and report-format guidance — do not add these separately.

## Step 9: Handle worker status codes

After each wave completes, process each worker response:

- **DONE** → proceed to verification (Step 11).
- **DONE_WITH_CONCERNS** → record the freeform concerns; do NOT resolve inline. Step 10 presents a single combined checkpoint for all concerned tasks before Step 11.
- **NEEDS_CONTEXT** → provide the missing context and re-dispatch immediately.
- **BLOCKED** → do NOT recover inline. Record the blocker; Step 10 (wave gate) handles the combined escalation. The four canonical interventions (more context, better model, split, stop) live in Step 10.

After the wave drains, Step 10 handles `BLOCKED` first then `DONE_WITH_CONCERNS`. Step 11 runs only after the gate exits.

**Never ignore an escalation or re-dispatch the same task to the same model without changes.**

### Boundary: orchestrator MUST NOT verify coder output itself

> After a `coder` returns `DONE` or `DONE_WITH_CONCERNS`, the orchestrator MUST NOT run local grep / Python / assertion scripts, spot checks, or final-acceptance checks to decide whether the implementation satisfies the task. The only sanctioned path for substantive task verification is dispatching a fresh `verifier` subagent (Step 11) with the planner-authored acceptance criteria and `Verify:` recipes, then mechanically parsing the verifier's protocol output via `pi-flow helper execute-plan/parse-verifier-report`.
> Forbidden behaviors (illustrative, not exhaustive): writing Python / grep / `Read` scripts that independently check criteria; running spot checks against implemented files to decide whether criteria pass; synthesizing a "final acceptance" script that re-checks task-specific expected strings; interpreting local command output as evidence that a task passed.
> See `skills/_shared/orchestrator-verification-boundary.md` for the shared statement that anchors this rule across `execute-plan`, `refine-code`, and `refine-plan`.

### Allowed mechanical work (orchestrator)

> The orchestrator's sanctioned activities are mechanical glue connecting substantive subagents. None of these produces a PASS/FAIL verdict on implementation acceptance criteria — those judgments belong to `verifier` and `test-runner`.
>
> | Activity | Helper |
> |---|---|
> | Plan parsing (task spec, files, criteria, recipes) | `pi-flow helper execute-plan/extract-plan-tasks` |
> | Coder prompt assembly | `pi-flow helper execute-plan/assemble-coder-prompt` |
> | Verifier prompt assembly | `pi-flow helper execute-plan/assemble-verifier-prompt` |
> | Diff context generation | `pi-flow helper execute-plan/collect-diff-context` |
> | Verifier-visible file-set assembly | orchestrator-computed (union rule, Step 11.2) |
> | Model-tier resolution | `pi-flow helper _shared/resolve-model-dispatch` |
> | Test-runner artifact parsing | `pi-flow helper _shared/parse-test-runner-artifact` |
> | Verifier report parsing | `pi-flow helper execute-plan/parse-verifier-report` |
> | Per-plan test-runs cleanup (success exit only) | `pi-flow helper _shared/cleanup-test-runs` |
> | Post-helper Python bytecode cache cleanup | `pi-flow helper _shared/cleanup-pycache` |
> | Completion bookkeeping (idea close, branch finish) | native git / idea tool |

## Step 10: Wave gate: blocked and concerns handling

Run this gate once per wave after every dispatched worker is classified. Order: blocked handling first, then concerns handling, then exit to Step 11. Any `BLOCKED` pauses execution before any later wave / Step 11 / Step 12. A wave with no `BLOCKED` and no `DONE_WITH_CONCERNS` passes through silently.

### 1. Drain the current wave

Wait for every dispatched worker to return and be classified by Step 9. Do not start the next wave or run Step 11/12 yet. Build `BLOCKED_TASKS` from `parse-coder-report.py` output (`.status == "BLOCKED"`) and `CONCERNED_TASKS` from `.status == "DONE_WITH_CONCERNS"`. Use the helper's `.blocker_text` or `.concerns_block` field for the user-facing escalation view.

### 2. Blocked handling (runs first)

If `BLOCKED_TASKS` is empty, skip to §3.

Otherwise present a single combined escalation view (do NOT prompt one-at-a-time) containing:
1. A header line naming the wave, e.g., `🚫 Wave <N>: <count> task(s) BLOCKED. Execution paused before any later wave.`
2. A "Wave outcomes" summary listing every task in the wave with its Step 9 status (DONE / DONE_WITH_CONCERNS / BLOCKED), task number, and title. Successful same-wave tasks MUST appear here.
3. A "Blocked tasks" block, one entry per task: number + title, full untruncated blocker text from the worker's `## Concerns / Needs / Blocker`, and the task's `**Files:**` scope.

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

After the combined view, ask per-task for an intervention (one task at a time, independent choices):

~~~
Task <N>: <task_title> (current tier: <tier>) — choose an intervention:
  (c) More context      — re-dispatch this task with additional context you supply
  (m) Better model      — re-dispatch this task with a more capable model tier
                            [omit this line if current tier is already `capable`]
  (s) Split into sub-tasks — break this task into smaller sub-tasks and dispatch them
(x) Stop execution — halt the plan; prior wave commits remain in git history
~~~

These are the canonical intervention options. The `(m) Better model` option is suppressed when the task's tier is already `capable` (no higher tier exists; re-dispatching to the same model violates the Step 9 rule). When suppressed, the user must pick `(c)`, `(s)`, or `(x)`.

- **(c) More context:** prompt the user for additional context. Re-dispatch the task to a `coder` worker with the original task spec plus the supplied context appended under `## Additional Context`. Keep the existing tier unless `(m)` is also chosen.
- **(m) Better model:** offered only when current tier is `cheap` or `standard`. Re-dispatch using the next tier up (`cheap` → `standard`, `standard` → `capable`); resolve the concrete model per Step 6.
- **(s) Split into sub-tasks:** decompose in-session. Sub-tasks must collectively preserve the same output files and acceptance-criteria coverage (no criterion dropped). Dispatch as a mini-wave bounded by `MAX_PARALLEL_HARD_CAP` (sequential if ordering is natural). The parent's slot is replaced by the sub-tasks; each sub-task is independent for Step 9 classification and gate re-entry. ⚠ Sub-task dispatches run pre-commit; their changes must remain in the working tree at Step 11 (see Step 11.2 fallback). Retry budget: see Step 13.
- **(x) Stop execution:** halt immediately. Do NOT run Step 11 or Step 12 for this wave. Report partial progress via Step 14. Prior wave commits remain in git history; `docs/test-runs/<plan-name>/` is preserved on every stop exit.

If the user picks `(x)` for any blocked task, stop the whole plan; do not continue asking about remaining blocked tasks.

After collecting a non-stop intervention for every task in `BLOCKED_TASKS`, re-dispatch them together (parallel, capped by `MAX_PARALLEL_HARD_CAP`) using Step 8's dispatch shape. Wait, apply Step 9, rebuild `BLOCKED_TASKS` / `CONCERNED_TASKS`, and re-enter §2. Repeat until empty or `(x)`. For tasks where `(s)` was chosen, the sub-tasks' responses replace the parent's slot; any sub-task returning `BLOCKED` appears in `BLOCKED_TASKS` on the next pass. Each re-dispatch counts toward the per-task retry budget (Step 13).

### 3. Concerns handling (runs second)

**Precondition:** §2 has exited (i.e., `BLOCKED_TASKS` is empty); every task in the wave is `DONE` or `DONE_WITH_CONCERNS`.

If `CONCERNED_TASKS` is empty, skip to §4 (gate exit) and proceed directly to Step 11.

Otherwise, present every concerned task together in a single combined message — do not prompt one-task-at-a-time:

```
⚠️ Wave <N>: <M> task(s) returned DONE_WITH_CONCERNS. Review before verification.

── Task 3: <short title> ──────────────────────────────────
  Files: <path/one>, <path/two>
  Concerns:
    - <worker concern, verbatim>
    - <worker concern, verbatim>
───────────────────────────────────────────────────────────

Options:
  (c) Continue to verification — proceed to Step 11 with all tasks as-is
  (r) Remediate selected task(s) — specify task number(s) and guidance; re-dispatch those tasks
(x) Stop execution — halt the plan; prior wave commits remain in git history
```

- **(c) Continue to verification.** Exit §3 with concerned tasks' status unchanged; the verifier is the next gate.
- **(r) Remediate selected task(s).** Prompt for (a) task numbers from `CONCERNED_TASKS` and (b) a freeform guidance block. Re-dispatch each selected task to a fresh `coder` with the original spec plus the worker's concerns block and the user's guidance appended under `## Concerns To Address`. Each re-dispatch counts toward Step 13's budget. Apply Step 9 to responses; any `BLOCKED` returns to §2; otherwise rebuild `CONCERNED_TASKS` and re-enter §3. Tasks not selected keep their prior status and re-appear.
- **(x) Stop execution.** Halt immediately. Do NOT run Step 11/12 for this wave. Report via Step 14; `docs/test-runs/<plan-name>/` is preserved.

Repeat §3 until `CONCERNED_TASKS` is empty or the user picks `(x)`.

### 4. Gate exit

The gate exits when `BLOCKED_TASKS` is empty and `CONCERNED_TASKS` is either empty or the user picked `(c)`. Tasks still `DONE_WITH_CONCERNS` flow into Step 11 as-is; the verifier's verdict is authoritative. Selecting `(x)` from §2 or §3 halts the plan via Step 14 without running Step 11/12 for this wave.

## Step 11: Verify wave output

**Precondition:** Step 10 must have exited. Each task is verified in a fresh-context `verifier` subagent via `skills/execute-plan/verify-task-prompt.md`: Phase 1 collects command evidence (executing each `Verify:` recipe byte-equal verbatim), Phase 2 judges each criterion. The orchestrator dispatches and routes the verdict.

**Protocol-error stop — missing `Verify:` recipes:** before dispatching the verifier, check that every acceptance criterion for the task has an attached `Verify:` recipe. If any is missing, STOP this wave: report the task number and criterion text, recommend re-running `generate-plan`, and do not dispatch the verifier or treat the task as passing. A plan without complete `Verify:` recipes is a protocol error and must be regenerated before execution continues.

### Step 11.2: Dispatch the verifier

Verifier dispatches for the wave run in parallel, bounded by the `@aphotic/pi-mux-subagents` `MAX_PARALLEL_HARD_CAP` cap (see Step 5). Issue all verifier subagents concurrently up to the cap and wait for all of them to return before parsing in Step 11.3.

**Verifier-visible file set (`{MODIFIED_FILES}`).** For each task in the wave, run `pi-flow helper execute-plan/compute-verifier-file-set --task-files <task-files-json> --worker-files <worker-files-json> --observed-status <git-status-output-path-or-dash> --observed-diff-paths <diff-paths-json> --wave-shape <single-task|parallel-multi-task>`; consume `.verifier_visible_files` as `{MODIFIED_FILES}`. The `--observed-status` argument is the path to a file holding the verbatim `git status --porcelain` output, or `-` to stream that output via stdin (matches the helper's `PATH_OR_DASH` contract); never pass the porcelain text directly as the argument value. The prompt records that the set is orchestrator-assembled, not the worker's self-report.

**Sub-task carve-out:** Step 10 split-into-sub-tasks dispatches MUST run pre-commit; their changes must remain in the working tree at Step 11 so `git diff HEAD` captures them. (Step 12's commit is the only sanctioned working-tree → committed transition.) If a sub-task's changes were committed before Step 11 (protocol violation), substitute `git diff <pre-subtask-commit>..HEAD -- <modified files>` for those criteria.

For each task in the wave (regardless of its Step 9 status, except `BLOCKED` which is already handled in Step 10), follow the per-task verification protocol in [`acceptance-criteria-verification.md`](acceptance-criteria-verification.md) — it owns template placeholders, the dispatch sequence (extract-plan-tasks → classify recipes → collect-diff-context → assemble-verifier-prompt → resolve dispatch → dispatch verifier), and the parser invocation. The wave-level orchestration here only assembles `{MODIFIED_FILES}` per the union rule above and dispatches the per-task protocol concurrently across the wave (parallel, capped by `MAX_PARALLEL_HARD_CAP`).

### Step 11.3: Parse verifier output and gate the wave

For each task, parse the verifier's report per the protocol in [`acceptance-criteria-verification.md`](acceptance-criteria-verification.md) (which owns the per-criterion header shape, overall `VERDICT:` shape, full-coverage rule, and Phase 1 evidence-block protocol errors). The parser yields a per-task `VERDICT: PASS` or `VERDICT: FAIL`.

Route each parsed result:

- `VERDICT: PASS` — the task passes wave verification.
- `VERDICT: FAIL` (including any malformed-output or Phase 1 protocol error surfaced by the script) — route the task into Step 13's retry loop, including the per-criterion `FAIL` entries and their `reason:` text so the retry has concrete remediation targets. Protocol errors never pass the wave gate and are never silently interpreted as `PASS`.

**Wave gate exit:** The wave exits Step 11 successfully only when every task in the wave has `VERDICT: PASS`. If any task has `VERDICT: FAIL`, the wave is not verified and Step 12 MUST NOT run until Step 13's retry loop produces a `VERDICT: PASS` for every failed task.

## Step 12: Post-wave commit and integration tests

**Precondition:** Step 10 (wave gate) must have exited and Step 11 must report `VERDICT: PASS` for every task in the wave. If any precondition is unmet, return to the responsible gate (Step 10 for BLOCKED or unresolved concerns, Step 13's retry loop for `VERDICT: FAIL`). Both the post-wave commit and the integration-test run are withheld until the wave completes successfully.

### 1. Commit wave changes

Stage and commit all changes from the completed wave:

```bash
git add -A
git commit -m "feat(plan): wave <N> - <plan_goal_summary>

- Task <X>: <task_title>
- Task <Y>: <task_title>"
```

**Commit message format:** subject `feat(plan): wave <N> - <plan_goal_summary>` (truncate Goal with `...` to stay near 72 chars), blank line, then one body line per task as `- Task <X>: <task_title>`.

**If `git add -A` stages nothing** (e.g., verification-only wave): skip the commit silently.

### 2. Run integration tests

**Skip if:** Integration test is disabled (Step 3 settings) or no test command is available.

Run the integration suite via `test-runner` (see Step 7's shared dispatch subsection) with `{ARTIFACT_PATH} = <working-dir>/docs/test-runs/<plan-name>/wave-<N>-attempt-<K>.log` (`<K>` is a 1-based attempt counter for the wave, incremented on each Debugger-first re-test) and `{PHASE_LABEL} = wave-<N>-attempt-<K>`. Run `pi-flow helper _shared/reconcile-test-run --artifact <wave-artifact-path> --mode reconcile --baseline-failures <baseline-json-path>`; consume `.current_failing_stable`, `.current_non_reconcilable`, `.current_non_baseline_stable`, and `.classification` (`pass`|`fail`). Render the [`integration-regression-gate.md`](integration-regression-gate.md) three-section summary from those fields.

**Pass (`.classification == "pass"`):** proceed to wave `<N+1>` (or Step 15/16 if final).

**Fail (`.classification == "fail"`):** render the three-section summary with the Step 12 fail-path header, then present the menu below.

#### Menu

The menu differs between intermediate and final waves.

**Intermediate-wave menu** (`<N> < total_waves`):

```
Options:
(d) Debug failures now       — dispatch the Debugger-first flow against current_non_baseline_stable ∪ current_non_reconcilable, then re-test
(c) Continue despite failures — proceed to wave <N+1> without modifying baseline_failures
(x) Stop execution — halt the plan; prior wave commits remain in git history
```

- **(d) Debug failures now:** Follow [`integration-regression-debugging.md`](integration-regression-debugging.md) using the **Step 12 (post-wave)** parameter row, scoped to `current_non_baseline_stable ∪ current_non_reconcilable`. `change_range` = the wave commit SHA; `suspect_universe` = wave `<N>`'s tasks whose modified files appear in failing stack traces (or all wave tasks if ambiguous); `re_test_callback` re-invokes test-runner-dispatch with a fresh `wave-<N>-attempt-<K>` artifact and recomputes via `integration-regression-gate.md`. Do NOT undo the wave commit up front; the debugging dispatch inspects the committed state. Counts as a retry toward Step 13's 3-retry limit.
- **(c) Continue despite failures:** proceed to wave `<N+1>`. **`baseline_failures` is NOT mutated**; the next wave reconciles against the original frozen baseline, so unresolved failures will be flagged again. Final plan completion remains blocked until both `current_non_baseline_stable` and `current_non_reconcilable` are empty — `(c)` defers but does not waive that gate. Warn the user accordingly.
- **(x) Stop plan execution:** halt. Prior wave commits remain in git history; report via Step 14; `docs/test-runs/<plan-name>/` is preserved.

**Final-wave menu** (`<N> == total_waves`):

```
Options:
(d) Debug failures now   — dispatch the Debugger-first flow against current_non_baseline_stable ∪ current_non_reconcilable, then re-test
(x) Stop execution — halt the plan; prior wave commits remain in git history
```

No continue option on the final wave: there is no subsequent wave to absorb unresolved failures, and the final-completion precondition forbids silently shipping them. The user MUST either debug or stop.

- **(d) Debug failures now:** same as the intermediate-wave `(d)`. Step 16's final-gate applies the same baseline-only reconciliation before the plan can report success.
- **(x) Stop plan execution:** halt. Prior wave commits remain; report via Step 14; `docs/test-runs/<plan-name>/` is preserved.

## Step 13: Handle failures and retries

If a worker produces empty, missing, or incorrect output:
1. Retry automatically up to **3 times** (improving the prompt where possible). **Shared counter:** all re-dispatches from Step 10 Blocked handling, Step 10 Concerns `(r)` remediation, and Step 11 `VERDICT: FAIL` routing share a single per-task retry counter. Exhaustion in one path exhausts it everywhere; subsequent failures go directly to step 2 below. **Split rule:** choosing `(s) Split into sub-tasks` in Step 10 consumes 1 retry against the parent's budget, and each sub-task inherits the parent's remaining count (no fresh 3-budget) — this closes the split-to-bypass-exhaustion path.
2. If still failing after 3 retries, **notify the user at the end of the wave** and ask:
   ```
   Options:
   (r) Retry again — optionally with a different model or more context. Resets the per-task budget back to 3 for that task only.
(x) Stop execution — halt the plan; prior wave commits remain in git history
   ```
   `docs/test-runs/<plan-name>/` is preserved on `(x)`. There is no skip option. Any unresolved failure — including Step 11 `VERDICT: FAIL` — must be `(r)` retried to resolution or `(x)` stopped.

Apply wave pacing from Step 3 — `(f)` Pause only on failure (default) or `(w)` Pause every wave. Pacing only governs waves where Step 10 has exited and every task is `VERDICT: PASS`. `BLOCKED`, unresolved concerns, and `VERDICT: FAIL` always pause via the gates regardless of wave pacing.

```
Options:
(f) Pause only on failure   [default]
(w) Pause every wave
```

## Step 14: Report partial progress

When execution stops early: leave the plan file in `docs/plans/` for reference and report which tasks completed, failed, and remain.

**Most recent integration run failures:** if any `test-runner` artifact exists (post-wave `wave-<N>-attempt-<K>.log` or `final-gate-<seq>.log`), run `pi-flow helper _shared/reconcile-test-run --artifact <most-recent-artifact-path> --mode reconcile --baseline-failures <baseline-json-path>`; render `.current_non_baseline_stable` and `.current_non_reconcilable` into the report sections below:

```
### Most recent integration run failures (unresolved)
<current_non_baseline_stable list, or `(none)`>

### Non-reconcilable failures from the most recent integration run
<current_non_reconcilable list, or `(none)`>

These failures were observed in the most recent integration run on this branch and remain unresolved.
They must be debugged before this branch is considered shippable.
```

`docs/test-runs/<plan-name>/` is preserved on every stop exit so the user can inspect raw run output alongside this report.

## Step 15: Request code review

After all waves complete successfully (and if review was enabled in Step 3):

1. **Gather inputs:** `BASE_SHA` = `PRE_EXECUTION_SHA` (Step 8); `HEAD_SHA` = `git rev-parse HEAD`; Description = plan Goal; Requirements = full plan; Max iterations = Step 3 setting (default 3); Working directory = current workspace; Review output path = `docs/reviews/<plan-name>-code-review`.
2. **Invoke the `refine-code` skill** with those inputs.
3. **Handle the result:** Run `pi-flow helper refine-code/parse-refine-code-summary --summary <path-or-`-`>` to obtain `{status, iterations, issues_found_total, issues_found_critical, issues_found_important, issues_found_minor, issues_fixed, issues_remaining, review_file, remaining_issues, failure_reason}`. Route on `status`: `approved` → include iteration count and review file in the Step 16 report; `approved_with_concerns` → also point the user at the review file's `### Outcome` reasoning; `not_approved_within_budget` → present `remaining_issues` plus the menu below; `failed` → surface `failure_reason` and stop per Step 14.

   **`not_approved_within_budget` menu:**
   ```
   Options:
   (c) Continue iterating — fresh budget; new era starts with a remediation pass on the prior era's findings before the next review.
   (p) Proceed with issues noted
(x) Stop execution — halt the plan; prior wave commits remain in git history
   ```
   `docs/test-runs/<plan-name>/` is preserved on `(x)`.

   **Review disabled:** skip to Step 16.

## Step 16: Complete

### Final integration regression gate (precondition)

**Skip if:** Integration tests are disabled (Step 3 settings) or no test command is available.

Otherwise, always run this gate: re-run the full integration suite and confirm no plan-introduced regression remains before marking the plan complete. The gate uses the same baseline-only reconciliation defined in [`integration-regression-gate.md`](integration-regression-gate.md) — comparing the final-gate run's stable failures against the frozen `baseline_failures` and treating any non-reconcilable failure as a blocker.

**Gate protocol:**
1. **Re-dispatch the integration suite via `test-runner`** per Step 7's shared dispatch subsection with `{ARTIFACT_PATH} = <working-dir>/docs/test-runs/<plan-name>/final-gate-<seq>.log` (where `<seq>` is a 1-based counter incremented on every gate entry) and `{PHASE_LABEL} = final-gate-<seq>`. Read back the artifact.
2. **Compute the per-run inputs:** Run `pi-flow helper _shared/reconcile-test-run --artifact <final-gate-artifact-path> --mode reconcile --baseline-failures <baseline-json-path>`; consume `.current_failing_stable`, `.current_non_reconcilable`, `.current_non_baseline_stable`, `.classification`.
3. **Gate on `current_non_baseline_stable ∪ current_non_reconcilable`:** if both are empty, the gate passes — proceed to `### 1. Cleanup`. Otherwise the plan cannot be marked complete: render the three-section [User-facing summary](integration-regression-gate.md#user-facing-summary-format) with header `⚠️ Final completion blocked: current integration failures remain.` and a trailing note that both sets must be empty, then present:
   ```
   Options:
   (d) Debug failures now — follow integration-regression-debugging.md (Step 16 final-gate row) against current_non_baseline_stable ∪ current_non_reconcilable; on success, re-enter this gate.
(x) Stop execution — halt the plan; prior wave commits remain in git history
   ```
   Empty sections render as `(none)`. No continue option by design (matches the Step 12 final-wave menu).
4. **Menu actions:**
   - **(d) Debug failures now:** Follow [`integration-regression-debugging.md`](integration-regression-debugging.md) using the **Step 16 (final-gate)** parameter row. `change_range` = `BASE_SHA..HEAD_SHA` (`BASE_SHA` = `PRE_EXECUTION_SHA` from Step 8, `HEAD_SHA` = `git rev-parse HEAD`); `suspect_universe` = every plan task whose `**Files:**` scope intersects `git diff --name-only BASE_SHA HEAD_SHA`; `re_test_callback` re-enters this gate at step 1. Repeat until both gate-blocking sets are empty or the user picks `(x)`. Each attempt counts toward Step 13's retry budget.
   - **(x) Stop execution:** halt. Report via Step 14 (list unresolved `current_non_baseline_stable` and `current_non_reconcilable` from the most recent final-gate artifact). Do NOT close the idea or run branch completion. `docs/test-runs/<plan-name>/` is preserved.

**Blocking guarantee:** `### 1. Cleanup`, `### 2. Close linked idea`, and `### 4. Branch completion` MUST NOT execute while either set is non-empty. The only exits are gate-pass or `(x)`.

### 1. Cleanup

**Precondition:** `current_non_baseline_stable ∪ current_non_reconcilable` is empty AND this run reached this substep via the final-gate success exit (never via any `(x) Stop execution` path; every stop exit leaves `docs/test-runs/<plan-name>/` in place so the user can inspect run artifacts). Delete the per-plan test-runs directory via the sanctioned helper (argument validation is the safety surface — see the helper for the exact validation contract):

```bash
pi-flow helper _shared/cleanup-test-runs docs/test-runs/<plan-name>
```

### 2. Close linked idea

Scan the plan for a line matching `**Source:** IDEA-<id>`. If found:
1. Extract the idea ID (e.g., `IDEA-5735f43b`).
2. Read the idea via the built-in `idea` tool (`action: "read"`, `id: "<id>"`).
3. If it exists and is not already "closed": call the built-in `idea` tool with `action: "update"`, `id: "<id>"`, `status: "closed"`, and `body: "<existing body + \nCompleted via plan: docs/plans/<plan-filename>.md>"`. Record the ID for the summary report.
4. If the idea is missing, already closed, or unreadable: skip silently.

Skip the entire substep if no `**Source:** IDEA-<id>` line exists.

### 3. Report summary

Report: number of tasks completed, concerns noted, review status/notes (if performed), total time taken, and any closed idea (e.g., "Closed IDEA-5735f43b").

### 4. Branch completion (if applicable)

**Only when running in a worktree or on a feature branch** (not main/master/develop): invoke the `finishing-a-development-branch` skill, which verifies tests, determines the base branch, presents merge/PR/keep/discard options, executes the choice, and cleans up the worktree if applicable. Branch completion is offered even if review issues are pending.

**When on main/master:** skip; just report the summary from step 3.
