---
name: fastlane
description: "Lightweight implementation workflow after define-spec for small features and non-trivial bug fixes. Generates a checklist, dispatches one coder, runs the project test suite, commits, invokes refine-code at reduced budget, and offers branch completion. Does not create a worktree, does not dispatch a verifier, does not push."
---

# Fastlane

Inline orchestrator skill. Every step runs in the orchestrator's session — no coordinator subagent. Composes the commit skill, the refine-code skill, the finishing-a-development-branch skill, and existing shared helpers. The dispatched `coder` is directed by its prompt to consult `test-driven-development` for behavioral changes and `verification-before-completion` before reporting DONE.

## Step 0: Input shape detection

Detect the shape of the input strictly. Mirror `skills/define-spec/spec-design-procedure.md` Step 1's strictness:

- **Idea ID** — if the input matches `^IDEA-[0-9a-f]{8}$` (case-insensitive after strip/lowercase), it is an idea ID. Strip the `IDEA-` prefix to obtain `<bare-id>` (the 8-character hex tail). Call the built-in `idea` tool with `action: "read"`, `id: "<bare-id>"`. Capture the artifact's title from `details.title` and body from `details.body`. Retain the original `IDEA-<id>` form for user-facing messages and for the `Source: IDEA-<id>` line in Step 10 (idea closure). If the tool returns isError (idea not found), reject with the verbatim message:

  ~~~
  fastlane: idea IDEA-<id> not found via the idea tool.
  ~~~

  and stop.

- **Spec path** — else if the input ends in `.md` and is either a relative path beginning with `docs/specs/` or an absolute path containing `/docs/specs/`, and the file exists on disk, it is a spec path. Read the file.

- **Freeform (rejected)** — else reject with the verbatim message:

  ~~~
  fastlane: input must be a spec path under docs/specs/ or an IDEA-<id>. Run /define-spec first to shape a spec.
  ~~~

  and stop.

## Step 1: Generate checklist

Read the spec/idea body. Run a brief codebase survey scoped to the file and subsystem mentions in the spec/idea. Emit a 3–7-step numbered implementation checklist that captures the concrete edits required, in order.

The checklist is **ephemeral** — never written to disk. It lives in the orchestrator's conversation state only.

## Step 2: Settings and top-level confirmation

Resolve the project test command up front for the Settings display, using this order:

1. The test command named in the user's checklist edits (if `(e) Edit checklist` was used and the user named one).
2. `pi-flow helper _shared/detect-test-command --working-dir <working-dir>` — consume `.command` when `.detected` is `true`.
3. "not detected" — the Settings block displays Test suite check as `disabled (no test command detected)`.

Initialize the run state for this step:

- `coder_tier = "capable"` (default; mutable from `(t)` in the customize submenu; allowed values: `cheap`, `standard`, `capable`).
- `refine_max_iterations = 3` (default; mutable from `(r)` in the customize submenu; allowed values: integer 1–5).

Both fields are consumed downstream: `coder_tier` by Step 4 (coder dispatch), `refine_max_iterations` by Step 9 (refine-code).

Render the top-level confirmation menu:

~~~
Fastlane plan:
  Source:   <spec path or IDEA-<id>>
  Checklist:
    1. <step>
    2. <step>
    ...

  Settings:
    Coder tier:              capable (high thinking)
    TDD:                     enabled
    Test suite check:        <resolved test command, or "disabled (no test command detected)">
    Refine-code iterations:  3

Options:
  (s) Start                      — proceed with these settings
  (c) Customize                  — change a setting
  (e) Edit checklist             — revise the numbered checklist before starting
  (x) Stop                       — exit fastlane (spec/idea remains committed)
~~~

### `(c) Customize` submenu

`(c)` opens the customize submenu. The **only** letter options in this submenu are `(t)`, `(r)`, and `(m)`. "TDD" and "Test suite check" are transparency-only — visible in the Settings block above, but NOT reachable from the customize submenu. Render byte-equal:

~~~
Choose a setting to change:
  (t) Coder tier               — current: capable (high thinking)
  (r) Refine-code iterations   — current: 3
  (m) Back to main menu
~~~

- `(t)` prompts for one of `cheap|standard|capable` and writes the chosen value to the run-state field `coder_tier`. The top-level Settings block re-renders with the new value before returning to the customize submenu.
- `(r)` prompts for an integer 1–5 and writes it to the run-state field `refine_max_iterations`. The Settings block re-renders.
- `(m)` returns to the top-level confirmation.

The customize submenu MUST NOT expose a TDD toggle or a Test suite check toggle.

### Other top-level options

- `(e) Edit checklist` — let the user revise the numbered checklist (and optionally name a test command), then re-show the top-level confirmation menu.
- `(x) Stop` — silent exit. The spec/idea remains committed; no rollback. If the user wants to escalate to the deep workflow instead, they can re-run `/generate-plan <spec-path>` manually after stopping.

## Step 3: Git preflight

- Capture `BASE_SHA = git rev-parse HEAD`.
- Run `git status --porcelain`. If non-empty, render the dirty-state checkpoint byte-equal:

  ~~~
  ⚠️ Working tree is dirty:
  <git status --porcelain output, verbatim>

  Options:
  (c) Continue — commit existing changes now, then proceed with fastlane
  (x) Stop     — handle existing changes manually
  ~~~

  `(c)` invokes the commit skill with no path restriction (the user supplies the commit message via the skill's standard prompt) and re-captures `BASE_SHA = git rev-parse HEAD` after the commit. `(x)` exits.

- Determine the current branch via `git rev-parse --abbrev-ref HEAD` (or the existing `pi-flow helper _shared/git-workspace-status` helper). If the branch is one of `{main, master, develop}`, render the protected-branch warning byte-equal and proceed automatically (no checkpoint, no prompt):

  ~~~
  ⚠️ You are on protected branch <branch>.
  Fastlane will commit directly to this branch.
  ~~~

- **No worktree creation.** Fastlane operates in the current workspace. This skill does NOT invoke `using-git-worktrees` and does NOT create a worktree.

## Step 4: Dispatch the coder

- Resolve `(model, cli)` via:

  ~~~
  pi-flow helper _shared/resolve-model-dispatch --tier <coder_tier> --agent coder
  ~~~

  where `<coder_tier>` is the run-state field initialized to `capable` in Step 2 and mutable via the customize submenu's `(t) Coder tier` option (allowed values: `cheap`, `standard`, `capable`). On non-zero exit from the helper, surface its stderr (canonical templates (1)–(4)) byte-equal and stop.

- Compose the placeholders:
  - `{SPEC_OR_IDEA_CONTENT}` — full spec body (for spec-path inputs) or full idea body (for idea-ID inputs).
  - `{CHECKLIST}` — the confirmed numbered checklist from Step 1/Step 2 `(e)`.
  - `{WORKING_DIR}` — the absolute working directory.
  - `{TDD_BLOCK}` — contents of `skills/execute-plan/tdd-block.md` read from disk.

- Write the placeholders to a temporary JSON file, then fill the coder-prompt template:

  ~~~
  pi-flow helper _shared/fill-template \
      --template "$(pi-flow template fastlane/fastlane-coder-prompt)" \
      --placeholders-json <tmp-json> \
      --output <tmp-prompt> \
      --require-all-replaced
  ~~~

  On non-zero exit, surface the helper's stderr verbatim and stop.

- Dispatch via `subagent_run_serial`:

  ~~~
  subagent_run_serial {
    tasks: [
      {
        name: "fastlane-coder",
        agent: "coder",
        task: "<filled prompt>",
        model: "<resolved model>",
        cli: "<resolved cli>",
        thinking: "high"
      }
    ],
    wait: true
  }
  ~~~

  The `thinking: "high"` field is a **per-call override** at the `subagent_run_serial` task site. The global `agent/agents/coder.md` default is **NOT** modified by this skill. Running fastlane at the coder's `thinking: medium` default is **NOT** an acceptable outcome.

## Step 5: Handle the coder status

Parse `results[0].finalMessage` via:

~~~
pi-flow helper execute-plan/parse-coder-report --report <path-to-finalMessage>
~~~

Route on `.status`. Mirror `skills/execute-plan/SKILL.md` Step 9.

- **DONE** — continue to Step 6 (verification phase).

- **DONE_WITH_CONCERNS** — surface the parsed `.concerns_block` verbatim with the menu:

  ~~~
  ⚠️ Coder returned DONE_WITH_CONCERNS:
  <concerns_block, verbatim>

  Options:
  (c) Continue — record concerns for the final summary and proceed to verification
  (x) Stop     — leave changes uncommitted for manual triage
  ~~~

  `(c)` records the concerns text in run state for the final summary and continues to Step 6. `(x)` exits without committing; any `docs/test-runs/<spec-name>/` artifacts are preserved.

- **NEEDS_CONTEXT** — surface the parsed `.needs_text`, prompt the user for the missing context, append the user's reply under a `## Additional Context` heading appended to the prompt body, and re-dispatch **once** with the same model/cli/thinking. A second `NEEDS_CONTEXT` or any `BLOCKED` from the re-dispatch falls through to the BLOCKED handler.

- **BLOCKED** — surface the parsed `.blocker_text` with the verbatim menu:

  ~~~
  🚫 Coder returned BLOCKED:
  <blocker_text, verbatim>

  Fastlane cannot continue. Options:
  (x) Stop — leave partial changes uncommitted for manual triage
  ~~~

  `(x)` surfaces investigation guidance and exits. Fastlane **does NOT auto-discard or auto-stash** — the user remains in control of their working tree. If the user wants to escalate to the deep workflow after stopping, they can discard or stash the working tree manually (`git checkout -- .` or `git stash push -u`) and then run `/generate-plan <spec-path>`.

## Step 6: Verification phase

- Resolve the project test command:
  1. The checklist-named command if the user supplied one in `(e) Edit checklist`.
  2. `pi-flow helper _shared/detect-test-command --working-dir <working-dir>` — consume `.command` when `.detected == true`.
  3. "not detected" — skip the verification phase silently and proceed to Step 8 (commit phase).

- Create the artifact directory: `mkdir -p docs/test-runs/<spec-name>`, where `<spec-name>` is the spec filename without `.md`. For idea-only inputs (no spec involved), substitute `IDEA-<id>` for `<spec-name>` (i.e., `docs/test-runs/IDEA-<id>/`).

- Dispatch `test-runner` per `skills/_shared/test-runner-dispatch.md` with:
  - `test_command = <resolved>`
  - `working_dir = <abs-dir>`
  - `artifact_path = <abs-dir>/docs/test-runs/<spec-name>/full-suite.log`
  - `phase_label = full-suite`

- Parse the artifact:

  ~~~
  pi-flow helper _shared/parse-test-runner-artifact --artifact <artifact-path>
  ~~~

  Read `.failing_identifiers` and `.non_reconcilable_failures`.

- **No baseline reconciliation by default.** If both lists are empty, the suite is clean — proceed silently to Step 8 (commit phase).

- If either list is non-empty, surface the verification-failure checkpoint byte-equal:

  ~~~
  ⚠️ Project test suite reported failures after fastlane implementation:
  <failing identifiers, verbatim>
  <non-reconcilable evidence, verbatim>

  Options:
  (c) Continue to refine loop — record as concerns, commit, and move to review
  (b) Compare with baseline — stash changes, re-run suite, restore changes, show existing failures vs regressions
  (x) Stop — leave spec committed but changes uncommitted for manual triage
  ~~~

  `(c)` records the failures in run state for the final summary and proceeds to Step 8. `(b)` enters Step 7 (on-demand baseline comparison). `(x)` exits; `docs/test-runs/<spec-name>/` is preserved.

## Step 7: (b) Baseline comparison

On-demand reconciliation branch entered via `(b)` in Step 6.

**Ordering deviation from the spec:** The spec (lines 174–176) lists `reconcile reconcile` before `git stash pop`. However, `git stash push -u` from Step 1 of this sub-flow includes the untracked verification-phase artifact `docs/test-runs/<spec-name>/full-suite.log`, removing it from the working tree until pop restores it. Reconcile-reconcile must therefore run **after** `git stash pop` so `full-suite.log` is present on disk when the helper reads it.

Steps:

1. `git stash push -u -m "fastlane-baseline-comparison-<spec-name>"`. Immediately after the push succeeds, capture the stash ref:

   ~~~
   git stash list -n 1 --format=%gd
   ~~~

   Read its single-line stdout (e.g., `stash@{0}`) and preserve that value for the failure path. **Do NOT** attempt to parse the stash ref from `git stash push`'s `Saved working directory and index state ...` line — that line does not reliably include a usable `stash@{N}` ref. The stash includes `docs/test-runs/<spec-name>/full-suite.log` (untracked file from the verification phase, picked up by `-u`).

2. Recreate the artifact parent directory: `mkdir -p <abs-dir>/docs/test-runs/<spec-name>`. The `-u` stash from the previous step swept the untracked `docs/test-runs/<spec-name>/` directory out of the working tree, so the parent must be re-established before the test-runner dispatch (which per `skills/_shared/test-runner-dispatch.md` requires the artifact parent to exist).

   Then dispatch `test-runner` over the clean working tree per `skills/_shared/test-runner-dispatch.md` with:
   - `artifact_path = <abs-dir>/docs/test-runs/<spec-name>/baseline.log` (absolute path, per the dispatch contract)
   - `phase_label = baseline`

   `baseline.log` is created **after** the stash push, so it is NOT part of the stash and remains on disk through pop.

3. Capture baseline failures:

   ~~~
   pi-flow helper _shared/reconcile-test-run \
       --artifact <abs-dir>/docs/test-runs/<spec-name>/baseline.log \
       --mode capture \
       > <abs-dir>/docs/test-runs/<spec-name>/baseline-failures.json
   ~~~

   `baseline-failures.json` is also created after the stash push, so it remains on disk through pop. The capture JSON's `baseline_failures` field (a list of stable identifiers) is the authoritative pre-change failure set used in Step 5 below.

4. `git stash pop`. If the pop output contains the substring `CONFLICT (` or git exits non-zero with a conflict notice, **hard-stop** with the verbatim message:

   ~~~
   Stash restoration produced conflicts. Working tree is in a mixed state.
   Stash ref preserved: <ref>
   Resolve manually: `git stash show <ref>`, then `git stash apply <ref>` / `git checkout -- .` as appropriate.
   Fastlane stopped.
   ~~~

   `docs/test-runs/<spec-name>/` is preserved on this hard-stop. The reconcile-reconcile step below does NOT run; the three-bucket summary is NOT rendered.

5. On clean pop (`full-suite.log` and coder changes restored alongside `baseline.log` and `baseline-failures.json`), run reconcile-reconcile:

   ~~~
   pi-flow helper _shared/reconcile-test-run \
       --artifact <abs-dir>/docs/test-runs/<spec-name>/full-suite.log \
       --mode reconcile \
       --baseline-failures <abs-dir>/docs/test-runs/<spec-name>/baseline-failures.json
   ~~~

   Capture `.current_non_baseline_stable` (new regressions) and `.current_non_reconcilable` from the reconcile output. Compute the pre-existing/fixed buckets from the capture JSON's `baseline_failures` field and the reconcile output's `current_failing_stable` field (these are the documented field names — the reconcile output does not expose `failing_identifiers`):

   - pre-existing = `set(baseline_failures) ∩ set(current_failing_stable)`
   - fixed-by-change = `set(baseline_failures) - set(current_failing_stable)`

6. Render the three-bucket summary byte-equal to the spec:

   ~~~
   Baseline comparison summary:
     Pre-existing failures (present on base):
       <list, verbatim>
     New regressions introduced by this change:
       <list, verbatim>
     Failures fixed by this change:
       <list, verbatim>

   Options:
   (c) Continue — record new regressions and non-reconcilable evidence as concerns, then commit
   (x) Stop    — leave spec committed but changes uncommitted for manual triage
   ~~~

   `(c)` records the new regressions and non-reconcilable evidence as concerns for the final summary and proceeds to Step 8. `(x)` exits, preserving `docs/test-runs/<spec-name>/`.

## Step 8: Commit phase

- On `(c) Continue` from Step 6 or Step 7 (clean suite OR recorded-as-concerns), invoke the commit skill with no explicit path restriction. The commit message is derived from the spec goal in Conventional Commits style — the commit skill drafts the message; the user confirms via its standard prompt.
- Test-runner failures, when surfaced as concerns, are tracked in orchestrator run state and surfaced in the final summary. They are **not** appended to the commit message — `docs/test-runs/<spec-name>/full-suite.log` is the audit trail.
- Capture `HEAD_SHA = git rev-parse HEAD` after the commit succeeds.

## Step 9: Refine-code phase

Invoke the refine-code skill with these inputs (matching the documented interface in `skills/refine-code/SKILL.md` Step 1):

- `BASE_SHA` from Step 3.
- `HEAD_SHA` from Step 8.
- Description = the spec goal.
- `--plan-contents` = path to the spec file (for spec-path inputs) or the idea body written to a tmp file (for idea-ID inputs).
- `--max-iterations 3` (or the user-customized value from `(r) Refine-code iterations` in Step 2's customize submenu — i.e., the run-state field `refine_max_iterations`).
- `--review-output-path docs/reviews/<spec-name>-fastlane-review`.
  The `-fastlane-review` namespacing distinguishes fastlane review artifacts from deep-workflow review artifacts targeting the same spec.

Refine-code's existing menu on `STATUS: not_approved_within_budget` ((c) Continue refining code / (p) Proceed with issues / (x) Stop execution) stays as-is — fastlane introduces no override. Refine-code's existing provenance validation (`validate-review-provenance.py`) runs as normal.

Fastlane proceeds to Step 10 (idea closure) on:
- `STATUS: approved`
- `STATUS: approved_with_concerns`
- `STATUS: not_approved_within_budget` with the user choosing `(p) Proceed with issues`

On `(c) Stop`, fastlane exits without idea closure or branch completion; `docs/test-runs/<spec-name>/` is preserved.

## Step 10: Idea closure

Mirror `skills/execute-plan/SKILL.md` Step 16.2:

1. Determine the idea ID:
   - If the original input to fastlane was an idea ID, use it directly.
   - Else extract `Source: IDEA-<id>` from the spec preamble using a bounded `head -n 40`.
   - Else skip silently.

2. Read the idea via the built-in `idea` tool (`action: "read"`, `id: "<id>"`). If missing or already status `closed`, skip silently.

3. Call the built-in `idea` tool with `action: "update"`, `id: "<id>"`, `status: "closed"`, and `body: "<existing body + \nCompleted via fastlane: <commit SHA>, spec: <spec path>>"` (or, when no spec was involved (input was an idea ID): `body: "<existing body + \nCompleted via fastlane: <commit SHA>, spec: (input was idea)>"`).

## Step 11: Post-completion

- On a feature branch (i.e., not in `{main, master, develop}`), invoke the finishing-a-development-branch skill verbatim. Its existing 4-option menu (merge / push+PR / keep / discard) gives the user explicit control over what happens next.
- On `main`/`master`/`develop`, the `finishing-a-development-branch` skill is skipped by its existing protected-branch gate. Fastlane reports the run summary and ends; the user runs `git push` manually if desired. Fastlane introduces **no** automatic push.

## Step 12: Artifacts and cleanup

- **Preserve** all `docs/test-runs/<spec-name>/` artifacts (`full-suite.log`, optional `baseline.log`, optional `baseline-failures.json`) on any stop exit:
  - Verification `(x)` (Step 6).
  - Baseline-stash-conflict hard-stop (Step 7).
  - Coder BLOCKED (Step 5).
  - Refine-code budget-exhaustion `(c) Stop` (Step 9).

- **On successful completion** (refine-code returns `approved` / `approved_with_concerns` / `(p) Proceed with issues`, AND idea closure complete, AND post-completion done), clean up the per-spec test-runs directory:

  ~~~
  pi-flow helper _shared/cleanup-test-runs docs/test-runs/<spec-name>
  ~~~

  The helper's argument validation refuses any path outside `<cwd>/docs/test-runs/` — see `pi-flow helper _shared/cleanup-test-runs` for the exact contract.

- Refine-code review artifacts at `docs/reviews/<spec-name>-fastlane-review-v<ERA>.md` follow refine-code's existing retention policy (kept).

- The checklist remains ephemeral — no on-disk artifact is written for it at any point.

- Post-helper bookkeeping: any Python bytecode caches (`__pycache__`) left behind by helper invocations under `skills/fastlane/scripts/` are removed on successful completion:

  ~~~
  pi-flow helper _shared/cleanup-pycache skills/fastlane/scripts
  ~~~

## Edge cases

- **Dirty working tree at preflight** — covered by Step 3 (commit-then-continue or stop).
- **Protected-branch start** (`main`/`master`/`develop`) — covered by Step 3 (warning-only, auto-proceeds; no confirmation prompt).
- **Coder NEEDS_CONTEXT cycle** — one retry, then a second NEEDS_CONTEXT or any BLOCKED falls through to the BLOCKED handler. Covered by Step 5.
- **Stash-pop conflict** during baseline comparison — hard-stop with the stash ref preserved. Covered by Step 7.
- **Refine-code dispatch failure** — helper stderr forwarded verbatim to the user; fastlane stops. Covered by Step 9.
- **Idea missing or already done** at closure — skip silently. Covered by Step 10.
- **Protected branch at post-completion** — `finishing-a-development-branch`'s existing gate skips it; fastlane introduces no automatic push. Covered by Step 11.
