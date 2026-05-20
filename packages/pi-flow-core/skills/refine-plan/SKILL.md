---
name: refine-plan
description: "Iterative plan review and edit loop. Dispatches a plan-refiner that alternates between reviewing and editing until approved or budget exhausted. Owns the plan-artifact commit gate. Usable standalone or from generate-plan."
---

# Refine Plan

Automated review-edit cycle for a written plan. Dispatches a `plan-refiner` subagent that drives the inner loop, reports back, and lets this skill own the commit gate.

**Precondition:** Must be in a git repository. If `git rev-parse --git-dir` fails, stop with: "refine-plan requires a git repository."

## Step 1: Gather inputs

Collect the following from the caller (user, `generate-plan`, or another skill):

| Input | Required | Default | Source |
|-------|----------|---------|--------|
| `PLAN_PATH` | yes | — | Caller positional argument (path to the plan file) |
| `TASK_ARTIFACT` | no | derived from plan preamble | Auto-discovered from the plan's `**Spec:**` line; override with `--task-artifact <path>` |
| `TASK_DESCRIPTION` | no | empty | Set via `--task-description <text>` — the inline body of the original spec/todo. Used as the coverage source when no on-disk task artifact is available; callers like `generate-plan` pass this through for todo/freeform inputs |
| `SOURCE_SPEC` | no | derived from plan preamble | Auto-discovered from the plan's `**Spec:**` line; supplementary metadata and, when the file exists, the default source for `TASK_ARTIFACT` |
| `SOURCE_TODO` | no | derived from plan preamble | Auto-discovered from the plan's `**Source:**` line; override with `--source-todo TODO-<id>`. Supplementary metadata only — not a coverage source on its own |
| `SCOUT_BRIEF` | no | derived from plan preamble | Auto-discovered from the plan's `**Scout brief:**` line; override with `--scout-brief <path>`. Supplementary reference context, not a coverage source on its own |
| `STRUCTURAL_ONLY` | no | `false` | Set true via `--structural-only` to opt in to a coverage-blind review |
| `MAX_ITERATIONS` | no | 3 | Caller flag |
| `AUTO_COMMIT_ON_APPROVAL` | no | `false` | Set true by callers like `generate-plan` so the commit gate runs without prompting |
| `WORKING_DIR` | no | cwd | Caller flag |
| `CARRY_OVER_REVIEW` | no | empty | Path to a prior era's review file. Internally re-set by Step 10 § not_approved_within_budget (c) re-entry. May also be supplied directly by a caller for standalone "edit-then-review" use against a hand-crafted review file (see spec Part C "Standalone-use bonus"). |

If `PLAN_PATH` is missing, stop with: "refine-plan: PLAN_PATH is required."

## Step 2: Validate plan path

Run `test -s <PLAN_PATH>` (file exists and is non-empty regular file). On failure, stop with:

```
refine-plan: plan file <PLAN_PATH> missing or empty.
```

## Step 3: Auto-discover provenance from plan preamble

Read a bounded preamble from the plan file (e.g., `head -n 40 <PLAN_PATH>`) and apply strict exact-match rules. Lines that count:

- `**Spec:** ` followed by `` `docs/specs/<filename>` `` (with surrounding backticks; also accept the same path written without backticks) → set `SOURCE_SPEC = "Source spec: docs/specs/<filename>"`, and (if not already set) set `TASK_ARTIFACT = "docs/specs/<filename>"`.
- `**Source:** TODO-<id>` → set `SOURCE_TODO = "Source todo: TODO-<id>"`.
- `**Scout brief:** ` followed by `` `docs/briefs/<filename>` `` → set `SCOUT_BRIEF = "Scout brief: docs/briefs/<filename>"`.

Apply CLI overrides (`--task-artifact`, `--source-todo`, `--scout-brief`) on top of any auto-discovered values — overrides win.

After resolution, verify each referenced on-disk path exists (`TASK_ARTIFACT`, `SCOUT_BRIEF`). If a referenced file does not exist, drop that field with a warning:

```
Provenance file <path> referenced in plan preamble not found — proceeding without it.
```

Continue without that field.

## Step 4: Gate on coverage source availability

After Step 3, the skill must have a usable coverage source for the plan reviewer unless `STRUCTURAL_ONLY` is `true`. A coverage source is one of:

- (a) a non-empty `TASK_ARTIFACT` resolved to an existing on-disk file, or
- (b) a non-empty `TASK_DESCRIPTION` (inline body of the original spec/todo).

If `STRUCTURAL_ONLY` is `false` AND both `TASK_ARTIFACT` and `TASK_DESCRIPTION` are empty, stop with:

```
refine-plan: no coverage source available and --structural-only not set. Provide --task-artifact <path>, --task-description <text>, or pass --structural-only to opt in to a coverage-blind review.
```

`SOURCE_TODO`, `SOURCE_SPEC`, and `SCOUT_BRIEF` are pointer/metadata fields and do **not** satisfy this gate on their own — the reviewer needs an actual body (`TASK_DESCRIPTION`) or an on-disk artifact (`TASK_ARTIFACT`) to perform Spec/Todo Coverage. Otherwise proceed.

## Step 5: Read model matrix

```bash
cat ~/.pi/agent/model-tiers.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), indent=2))"
```

If the file is missing or unreadable, stop with: "refine-plan requires ~/.pi/agent/model-tiers.json — see model matrix configuration."

### Dispatch resolution

Read [skills/_shared/coordinator-dispatch.md](../_shared/coordinator-dispatch.md) and follow it to resolve the coordinator `(model, cli)` pair before Step 8. The shared file is the single authority for the four-tier chain, the skip-silently rule for non-`pi` tiers, and the two hard-stop conditions with their exact error messages. Do not duplicate that procedure here.

## Step 6: Allocate starting era

Compute:

- `PLAN_BASENAME` = basename of `PLAN_PATH` with the `.md` extension stripped.
- `REVIEW_OUTPUT_PATH` = `docs/plans/reviews/<PLAN_BASENAME>-plan-review` (no version suffix or `.md` — `plan-refiner` adds those).

Create `docs/plans/reviews/` if it does not exist.

Scan the reviews directory for the highest existing era number for this plan:

```bash
ls docs/plans/reviews/ 2>/dev/null \
  | grep -E "^${PLAN_BASENAME}-plan-review-v[0-9]+\.md$" \
  | sed -E 's/.*-v([0-9]+)\.md$/\1/' \
  | sort -n \
  | tail -1
```

Set `STARTING_ERA = max_existing + 1`. If no matches found, `STARTING_ERA = 1`.

## Step 7: Assemble coordinator prompt

Read [refine-plan-prompt.md](refine-plan-prompt.md) in this directory.

Fill `refine-plan-prompt.md` by invoking `pi-flow helper refine-plan/fill-refine-plan-prompt --plan-path "<PLAN_PATH from Step 1>" --task-artifact "<Task artifact line or empty>" --source-todo "<Source todo line or empty>" --source-spec "<Source spec line or empty>" --scout-brief "<Scout brief line or empty>" --original-spec-inline <path-to-task-description-text-or--for-stdin> --structural-only-note <path-to-structural-only-note-text-or--for-stdin> --max-iterations <MAX_ITERATIONS> --starting-era <STARTING_ERA> --review-output-path <REVIEW_OUTPUT_PATH> --working-dir <WORKING_DIR> --model-matrix <path-to-model-matrix-json> --carry-over-review "<CARRY_OVER_REVIEW or empty>" --output <filled-prompt-path>`. The helper enforces single-pass literal substitution and fails closed on any unreplaced placeholder. Pass the `CARRY_OVER_REVIEW` value (path or empty string) unchanged — whatever value Step 1 received (caller-set or internally re-set by Step 10) is threaded through verbatim.

### Step 7.5: Compose structural-only note

Before invoking the Step 7 helper, write the note below to a temp file and pass it via `--structural-only-note` when `STRUCTURAL_ONLY` is true; pass an empty file or `/dev/null` when false. Do not manually replace `{STRUCTURAL_ONLY_NOTE}` after the helper runs.

```
This is a structural-only review run. No original spec or todo is available. The plan-reviewer must skip the Spec/Todo Coverage check and include the literal phrase "Structural-only review — no spec/todo coverage check performed." inside the `### Outcome` section's `**Reasoning:**` line (the Summary section no longer exists in the new output format).
```

## Step 8: Dispatch plan-refiner

Use the `(model, cli)` pair returned by the shared `coordinator-dispatch.md` procedure (Step 5). If the procedure hard-stopped, do not dispatch — surface the error from the shared file's `## Hard-stop conditions` section to the caller, set `STATUS = failed` with reason `coordinator-dispatch: <verbatim error message>`, and skip to Step 11.

```
subagent_run_serial { tasks: [
  { name: "plan-refiner", agent: "plan-refiner", task: "<filled refine-plan-prompt.md>", model: "<resolved model from coordinator-dispatch.md>", cli: "<resolved cli from coordinator-dispatch.md — guaranteed pi>" }
]}
```

## Step 9: Parse and validate coordinator result

Read `results[0].finalMessage`. Parse:

- The `STATUS:` line (`approved`, `approved_with_concerns`, `not_approved_within_budget`, or `failed`).
- The `## Plan File` block — exactly one path.
- The `## Review Files` block — a list of one path per `plan-refiner` invocation (one invocation = one era).
- The optional `## Structural-Only Label` block — used to record whether the run was structural-only.

Validate every parsed path with `test -s <path>` (non-empty regular file). On any path validation failure, set `STATUS = failed` with reason `coordinator returned <path> but file is missing or empty` and skip to Step 11.

## Step 9.5: Validate review provenance

Run this validation only on `STATUS: approved`, `STATUS: approved_with_concerns`, or `STATUS: not_approved_within_budget`; skip on `STATUS: failed` (no review file is guaranteed to exist on failure).

For each review file path in the `## Review Files` list parsed in Step 9, invoke `pi-flow helper _shared/validate-review-provenance --review-file <path> --allowed-tiers crossProvider.capable,capable`. On non-zero exit, set `STATUS = failed` with reason `review provenance validation failed at <path>: <specific check>` (where `<specific check>` is the `failure` field from the script's stderr JSON) and skip to Step 11. Do NOT proceed to Step 10's commit gate after a validation failure.

When all paths pass validation, proceed to Step 9.7.

## Step 9.7: Executable-plan parseability guardrail

Run this validation only when the parsed `STATUS` is `approved` or `approved_with_concerns`; skip for `not_approved_within_budget` and `failed`. The intent: a reviewed plan that this skill is about to declare approved must be parseable by the same parser `execute-plan` uses, so that any downstream caller (the user invoking `refine-plan` standalone, or `generate-plan` consuming this skill's summary) receives an approved status only when the plan is actually executable. Reviewers occasionally bless plans whose required-section labels use formatting the executable-plan parser does not yet accept; catching that here keeps the approved verdict honest across both standalone and orchestrated use.

Run:

```bash
pi-flow helper execute-plan/extract-plan-tasks --plan "<PLAN_PATH from Step 1>" > /dev/null
```

Plan parsing via `extract-plan-tasks.py` is a sanctioned mechanical activity per [`skills/_shared/orchestrator-verification-boundary.md`](../_shared/orchestrator-verification-boundary.md) — this is parseability validation, not a re-judgment of the plan-refiner's verdict.

On non-zero exit, set `STATUS = failed` with reason `approved plan is not executable: <verbatim parser stderr>` (preserve the parser's structured `{"errors": [...]}` JSON in the reason so the caller can surface it to the user). Do NOT proceed to Step 10's commit gate; skip directly to Step 11 with `COMMIT = not_attempted`. The originally-approved review files have already been written to disk by the `plan-refiner`; they remain in place for inspection but are left uncommitted by this skill.

On exit 0, proceed to Step 10.

### Boundary: orchestrator MUST NOT re-judge the plan-refiner's verdict

> Between parsing the `plan-refiner`'s `finalMessage` (Step 9), validating each review
> file's provenance (Step 9.5), running the executable-plan parseability guardrail
> (Step 9.7), and routing on `STATUS:` to the commit gate (Step 10), the orchestrator
> MUST NOT:
>
> - Read the review files (`docs/plans/reviews/<PLAN_BASENAME>-plan-review-v<ERA>.md`) or
>   the plan content (`PLAN_PATH`) to form an independent verdict on the plan.
> - Override or recompute the `STATUS:` line returned by the `plan-refiner` (`approved`,
>   `approved_with_concerns`, `not_approved_within_budget`, `failed`) on any grounds other
>   than the mechanical gate failures defined in Steps 9, 9.5, and 9.7 (path validation,
>   provenance validation, and executable-plan parseability — each of which may only
>   downgrade `STATUS` to `failed` with the reason string specified by that step).
> - Run local checks (grep, ad hoc Python scripts, additional `Read` calls on the plan or
>   reviews) to second-guess the coordinator's judgment. The sanctioned mechanical
>   validators in Steps 9.5 and 9.7 (`validate-review-provenance.py` and
>   `extract-plan-tasks.py`) are not "local checks" in this sense — they are explicitly
>   permitted parseability/provenance gates per
>   [`skills/_shared/orchestrator-verification-boundary.md`](../_shared/orchestrator-verification-boundary.md).
> - Edit the plan file directly, or invent extra refinement dispatches outside the
>   documented loop. Iteration is owned by the `plan-refiner`'s internal review-edit cycle;
>   the only sanctioned re-entry from this skill is the (c) Continue refining plan choice on
>   `not_approved_within_budget`, which re-runs from Step 6 onward with `STARTING_ERA`
>   recomputed.
>
> The sanctioned post-coordinator paths are: parse `finalMessage` (Step 9), validate each
> review file's provenance via `pi-flow helper _shared/validate-review-provenance`
> (Step 9.5), validate executable-plan parseability via
> `pi-flow helper execute-plan/extract-plan-tasks` (Step 9.7), and route on
> `STATUS:` to Step 10's commit gate. Step 9.7 MUST run before any `approved` or
> `approved_with_concerns` verdict reaches Step 10, so that a plan declared approved by
> this skill is always executable by the same parser `execute-plan` uses. See
> `skills/_shared/orchestrator-verification-boundary.md` for the shared statement,
> including its "Plan parsing via `extract-plan-tasks.py`" allowance.
>
> Post-helper bookkeeping: any Python bytecode caches (`__pycache__`) left behind by
> helper-script invocations under `skills/refine-plan/scripts/` are removed via
> `pi-flow helper _shared/cleanup-pycache <path>`, never via ad hoc
> `find … -exec rm` commands.

## Step 10

Handle `STATUS` as follows.

### `STATUS: approved`

If `AUTO_COMMIT_ON_APPROVAL` is true, jump directly to the commit invocation in Step 10a. Otherwise, prompt the user:

```
refine-plan: plan approved. Commit plan + review artifacts? (y/n)
```

On `Y` or empty, run Step 10a. On `n`, set `COMMIT = left_uncommitted` and skip to Step 11.

### `STATUS: approved_with_concerns`

Same handling as `STATUS: approved`, with the prompt updated to surface the waiver:

```
refine-plan: plan approved with concerns (Important findings waived — see Review Notes appended to the plan). Commit plan + review artifacts? (y/n)
```

Behavior is identical to `STATUS: approved` from here: on `Y` or empty (or with `AUTO_COMMIT_ON_APPROVAL` true), run Step 10a; on `n`, set `COMMIT = left_uncommitted` and skip to Step 11. The plan file already has the `## Review Notes` section appended by the `plan-refiner` per `refine-plan-prompt.md` Step 9 — Step 10a's commit will include that edit.

### `STATUS: not_approved_within_budget`

Present the budget-exhaustion menu exactly as:

- **(c) Continue refining plan** — Commit current era's plan + review artifacts (via Step 10a), then keep iterating into era v`<STARTING_ERA + 1>` with a fresh iteration budget. Internally re-set `CARRY_OVER_REVIEW = <era-N review file path that was just committed in Step 10a>` and re-enter Step 6 with `STARTING_ERA` recomputed by re-scanning `docs/plans/reviews/` (the rule remains `max(existing_N) + 1`).
- **(r) Save plan for manual review** — Commit current era's plan + review artifacts (via Step 10a), then exit `refine-plan` with `STATUS: not_approved_within_budget` and `COMMIT: committed` (plus the existing `PLAN_PATH` / `REVIEW_PATHS` / `STRUCTURAL_ONLY` summary fields).
- **(x) Stop execution** — Leave the plan and all current-era review artifacts uncommitted on disk; exit `refine-plan` with `STATUS: not_approved_within_budget` and `COMMIT: left_uncommitted`. No files are deleted from disk; the user inspects or removes them manually.

**This menu is always presented on `not_approved_within_budget` regardless of `AUTO_COMMIT_ON_APPROVAL`.** The user's choice itself encodes the commit decision; `AUTO_COMMIT_ON_APPROVAL` does not bypass or pre-select any of the three options. (`AUTO_COMMIT_ON_APPROVAL` continues to govern the `approved` and `approved_with_concerns` paths unchanged.)

**On `(c) Continue refining plan`:** Run Step 10a (commit current era). Step 10a MUST succeed (`COMMIT = committed`) before the next era is dispatched. If Step 10a sets `COMMIT = not_attempted` (commit failed for any reason — pre-commit hook failure, dirty index, underlying error), STOP refinement immediately: preserve `STATUS = not_approved_within_budget` and the `COMMIT = not_attempted [reason]` value from Step 10a, do **NOT** dispatch the next era, and skip directly to Step 11. Only when Step 10a sets `COMMIT = committed` may the skill re-run from Step 6 onward — with `STARTING_ERA` recomputed by re-scanning `docs/plans/reviews/` (it will now reflect the just-committed file plus any uncommitted files; the rule remains `max(existing_N) + 1`) and `CARRY_OVER_REVIEW = <era-N review file path that was just committed in Step 10a>` so the next plan-refiner dispatch performs a carry-over edit pass against era N's findings. Loop until either `STATUS: approved` / `STATUS: approved_with_concerns` (proceed normally) or the user picks `(r)` or `(x)`.

**On `(r) Save plan for manual review`:** Run Step 10a (commit current era). On success, set `COMMIT = committed` (with the SHA reported by the commit skill when available). On Step 10a failure, set `COMMIT = not_attempted [reason]`. Either way, proceed to Step 11 — do NOT dispatch the next era. The summary surfaces `STATUS: not_approved_within_budget` plus the resolved `COMMIT` value.

**On `(x) Stop execution`:** Set `COMMIT = left_uncommitted`. Do NOT invoke Step 10a. Do NOT delete any files from disk. Proceed to Step 11. The summary surfaces `STATUS: not_approved_within_budget` and `COMMIT: left_uncommitted`.

### `STATUS: failed`

Skip the commit gate entirely. Set `COMMIT = not_attempted`. Proceed to Step 11.

## Step 10a: Invoke commit skill

Invoke the `commit` skill with **concrete file paths only**: the plan path and the list of concrete review paths written during the current `refine-plan` run (collected across any iteration loops in Step 10). No globs, no wildcards, no older-version review files from prior standalone runs.

Pass the file paths as arguments along with a commit message of the form `chore(plan): refine <PLAN_BASENAME>` (or `feat(plan): ...` if appropriate — defer to the `commit` skill's conventional-commits inference).

On `commit` skill failure (non-zero exit, pre-commit hook failure, dirty index), capture the error message and set `COMMIT = not_attempted` with the underlying error stored for Step 11.

On success, set `COMMIT = committed`. The actual SHA is reported by the `commit` skill itself; the refine-plan summary surfaces `committed` plus the SHA when available.

## Step 11: Report result

Output exactly:

```
STATUS: <approved | approved_with_concerns | not_approved_within_budget | failed>
COMMIT: <committed [sha] | left_uncommitted | not_attempted [reason]>
PLAN_PATH: <path>
REVIEW_PATHS:
- <path1>
- <path2>
STRUCTURAL_ONLY: <yes | no>
```

Do **NOT** include full review text. Do **NOT** include per-iteration findings inline.

If `STATUS: failed`, include an additional line:

```
FAILURE_REASON: <one-line reason>
```

The `REVIEW_PATHS` list contains every review file written during the entire `refine-plan` run (one per era that ran, including any era-(r) decisions and option-(c) commit-and-continue eras).

## Edge Cases

- **`commit` skill not present**: stop with a clear error pointing at `skills/commit/SKILL.md`.
- **Coordinator dispatch CLI is not `pi`**: defer to the shared `coordinator-dispatch.md` procedure. The shared file's two hard-stop conditions ("no tier resolves to `pi`" and "all `pi`-eligible tiers failed") are the only sanctioned outcomes here; the prior cross-reference to `refine-code` is removed because the shared file is the single authority for both skills. Surface the shared file's verbatim error message to the caller, set `STATUS = failed` with the verbatim error as the reason, and exit.
- **Plan path is in `docs/plans/done/` or another archived location**: proceed normally; era allocation still scans `docs/plans/reviews/` keyed by `PLAN_BASENAME`.
- **Coordinator returns paths outside `docs/plans/reviews/`**: treat as `STATUS: failed` with reason `coordinator returned review path outside docs/plans/reviews/`.
