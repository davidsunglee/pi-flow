---
name: refine-code
description: "Iterative code review and remediation loop. Dispatches a code-refiner that alternates between reviewing and fixing until approved/approved_with_concerns or budget exhaustion. Usable standalone or from execute-plan."
---

# Refine Code

Automated review-remediate cycle. Dispatches a `code-refiner` subagent that drives the inner loop and reports back.

**Precondition:** Must be in a git repository. If `git rev-parse --git-dir` fails, stop with: "refine-code requires a git repository."

## Step 1: Gather inputs

Collect the following from the caller (coder, user, or another skill):

| Input | Required | Default | Source |
|-------|----------|---------|--------|
| `BASE_SHA` | yes | — | Caller provides (e.g., pre-refining SHA) |
| `HEAD_SHA` | yes | — | Caller provides or `git rev-parse HEAD` |
| Description | yes | — | What was implemented |
| Requirements/plan | no | empty | Plan file contents or spec |
| Max iterations | no | 3 | Caller or execution settings |
| Working directory | no | cwd | Worktree or project root |
| Review output path | no | `docs/reviews/<name>-code-review` | Derived from plan name or caller-specified |
| Carry-over review | no | empty | Path to a prior era's review file. Internally re-set on (c) Continue refining code re-entry from Step 5. May also be supplied directly by a caller for standalone "fix this set of findings, then verify" use against a hand-crafted review file (see spec Part C "Standalone-use bonus"). |

If `BASE_SHA` or `HEAD_SHA` is not provided, stop with an error — the skill cannot infer these.

## Step 2: Read model matrix

```bash
cat ~/.pi/agent/model-tiers.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), indent=2))"
```

The model matrix provides tier mappings used by the coordinator:
- `crossProvider.capable` — first-pass and final verification reviews
- `crossProvider.standard` — coordinator model (pi-backed orchestration path)
- `standard` — hybrid re-reviews
- `capable` — remediator

### Dispatch resolution

Read [skills/_shared/coordinator-dispatch.md](../_shared/coordinator-dispatch.md) and follow it to resolve the coordinator `(model, cli)` pair before Step 4. The shared file is the single authority for the four-tier chain, the skip-silently rule for non-`pi` tiers, and the two hard-stop conditions with their exact error messages. Do not duplicate that procedure here.

If the file doesn't exist or is unreadable, stop with: "refine-code requires ~/.pi/agent/model-tiers.json — see model matrix configuration."

## Step 3: Assemble coordinator prompt

Invoke `pi-flow helper refine-code/fill-refine-code-prompt --plan-goal <path|-> --plan-contents <path|-> --base-sha <BASE_SHA> --head-sha <HEAD_SHA> --review-output-path <REVIEW_OUTPUT_PATH> --max-iterations <MAX_ITERATIONS> --model-matrix <path> --working-dir <WORKING_DIR> --carry-over-review "<carry-over review path or empty>" --output <filled-prompt-path>`. It performs single-pass substitution and fails closed on unreplaced placeholders.

## Step 4: Dispatch code-refiner

Use the `(model, cli)` pair returned by the shared `coordinator-dispatch.md` procedure (Step 2). If the procedure hard-stopped, do not dispatch — surface the error from the shared file's `## Hard-stop conditions` section to the caller and exit.

```
subagent_run_serial { tasks: [
  { name: "code-refiner", agent: "code-refiner", task: "<filled refine-code-prompt.md>", model: "<resolved model from coordinator-dispatch.md>", cli: "<resolved cli from coordinator-dispatch.md — guaranteed pi>" }
]}
```

## Step 5: Handle code-refiner result

Parse `results[0].finalMessage` from the code-refiner for the STATUS line and stash the parsed outcome locally. **Do not report success to the caller in this step** — caller-facing success reporting is deferred until Step 6's provenance validation passes.

Determine the stashed outcome:

**`STATUS: approved`**
- Stash: review passed, iteration count, and review file path — to be reported to the caller only after Step 6 succeeds.

**`STATUS: approved_with_concerns`**
- Stash: review passed with waived Important findings, iteration count, review file path, and a note that the review file contains the waiver rationale in its `### Outcome` reasoning — to be reported to the caller only after Step 6 succeeds. No menu (this is a success-path status).

**`STATUS: not_approved_within_budget`**
- Stash: remaining findings and the choice menu below — to be presented to the caller only after Step 6 succeeds.
- Choices to offer (after Step 6 passes):
  - **(c) Continue refining code** — re-invoke this skill from Step 3 with the same inputs but `HEAD_SHA` updated to current HEAD AND --carry-over-review set to the prior era's review file path (so code-refiner runs a carry-over remediation pass against the prior era's findings before the next review). Budget resets, new cycle.
  - **(p) Proceed with issues** — caller continues with known issues noted
  - **(x) Stop execution** — caller halts

For any other outcome (`STATUS: failed`, dispatch failure, unexpected status), surface it directly to the caller per the Edge Cases section; Step 6 is skipped.

The caller (execute-plan or user) makes the decision. This skill does not auto-continue. Proceed to Step 6 before reporting anything to the caller.

### Boundary: orchestrator MUST NOT re-judge the code-refiner's verdict

> Between parsing the `code-refiner`'s `finalMessage` (Step 5) and forwarding it verbatim to
> the caller (Step 6), the orchestrator MUST NOT:
>
> - Read the review file or the diff under `BASE_SHA..HEAD_SHA` to form an independent
>   verdict on the change.
> - Override or recompute the `STATUS:` line returned by the `code-refiner` (`approved`,
>   `approved_with_concerns`, `not_approved_within_budget`, `failed`).
> - Run local checks (grep, the test command, additional `Read` calls on implementation
>   files, ad hoc Python scripts) to second-guess the coordinator's judgment.
> - Dispatch ad hoc remediation subagents outside the documented loop. Iteration is owned by
>   the `code-refiner`'s internal review-remediate cycle; the only sanctioned re-entry from
>   this skill is the (c) continue-refining choice on `not_approved_within_budget`.
>
> The only sanctioned post-coordinator path is: parse `finalMessage` for the `STATUS:` line,
> validate provenance via `pi-flow helper _shared/validate-review-provenance`
> (Step 6), and forward the coordinator's output verbatim. See
> `skills/_shared/orchestrator-verification-boundary.md` for the shared statement.
>
> Post-helper bookkeeping: any Python bytecode caches (`__pycache__`) left behind by
> helper-script invocations under `skills/refine-code/scripts/` are removed via
> `pi-flow helper _shared/cleanup-pycache <path>`, never via ad hoc
> `find … -exec rm` commands.

## Step 6: Validate review provenance

Run this validation only on `STATUS: approved`, `STATUS: approved_with_concerns`, or `STATUS: not_approved_within_budget`; skip on any other outcome (including `STATUS: failed`).

Use the path the coordinator reported in its `## Review File` block (the latest versioned `<REVIEW_OUTPUT_PATH>-v<ERA>.md`) as `<path>`.

- On `STATUS: approved` or `STATUS: approved_with_concerns`: invoke `pi-flow helper _shared/validate-review-provenance --review-file <path> --allowed-tiers crossProvider.capable`.
- On `STATUS: not_approved_within_budget`: invoke `pi-flow helper _shared/validate-review-provenance --review-file <path> --allowed-tiers crossProvider.capable,standard`.

On non-zero exit, surface `refine-code: review provenance validation failed at <path>: <specific check>` to the caller and do not report the stashed success.

When validation passes, forward the code-refiner `finalMessage` verbatim. Preserve [refine-code-prompt.md](refine-code-prompt.md)'s compact `STATUS:` / `## Summary` / `## Review File` format because `execute-plan` parses it with `parse-refine-code-summary.py`; do not wrap or summarize it.

Per-status additions: `approved` — none; `approved_with_concerns` — add a note pointing to the review file's `### Outcome` waiver reasoning; `not_approved_within_budget` — add the (c)/(p)/(x) menu after the forwarded blocks.

This is the only point at which Step 5's success outcome may reach the caller.

## Edge Cases

- **No changes in range** (`BASE_SHA` equals `HEAD_SHA`): Stop with "No changes to review."
- **Code-refiner fails to dispatch** (model unavailable, transport error, no `pi` tier resolves): defer to the shared `coordinator-dispatch.md` procedure. The shared file's two hard-stop conditions ("no tier resolves to `pi`" and "all `pi`-eligible tiers failed") are the only sanctioned outcomes here; do NOT declare a separate two-tier or three-tier fallback chain in this skill. Surface the shared file's verbatim error message to the caller and exit without dispatch.
- **Empty requirements**: Review is purely quality-focused — no spec compliance check. The code-refiner handles this (it passes empty `{PLAN_CONTENTS}` through to the reviewer).
