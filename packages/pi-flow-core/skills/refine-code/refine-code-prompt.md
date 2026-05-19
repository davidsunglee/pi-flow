# Review-Remediate Loop

You are the code refiner. Drive the review-remediate cycle for the changes described below.

## What Was Implemented

{PLAN_GOAL}

## Requirements/Plan

{PLAN_CONTENTS}

## Carry-Over Review

{CARRY_OVER_REVIEW}

## Git Range

**Base (pre-implementation):** {BASE_SHA}
**Head (post-implementation):** {HEAD_SHA}

## Configuration

- **Max iterations:** {MAX_ITERATIONS}
- **Review output base path:** {REVIEW_OUTPUT_PATH}
- **Working directory:** {WORKING_DIR}

### Model Matrix

{MODEL_MATRIX}

Model tier assignments:
- `crossProvider.capable` — first-pass full review and final verification review
- `standard` — hybrid re-reviews (cheaper, scoped to remediation diff)
- `capable` — remediator (coder fixing code)

### Dispatch resolution

For each subagent dispatch, run `resolve-model-dispatch.py --tier <tier> --agent <agent>` to resolve `(model, cli)`. Tier comes from the Model tier assignments above; `<agent>` is `code-reviewer` for review dispatches and `coder` for the remediator. On any of the four failure conditions (templates (1)–(4)), emit the canonical template byte-equal and `STATUS: failed` with the reason from `## Failure Modes`; never silently fall back to any CLI default. Always pass `cli` explicitly.

## Protocol

### Hard rules (read first)

These rules govern the entire protocol below. They are NOT edge cases; they are unconditional.

1. **No inline review on coordinator-tool unavailability.** If `subagent_run_serial` is unavailable in your session — for any reason, at any iteration — you MUST emit `STATUS: failed` with reason `coordinator dispatch unavailable`, MUST NOT write any review file, and MUST NOT perform an inline review as a substitute. The calling skill (`refine-code`) is responsible for fallback decisions; you do not improvise.
2. **No inline review on worker-dispatch exhaustion.** If every dispatch attempt for a `code-reviewer` (first-pass, hybrid re-review, or final-verification) or for a `coder` (remediator) fails — model unavailable, transport error, repeated empty results — you MUST emit `STATUS: failed` with reason `worker dispatch failed: <which worker>` and MUST NOT write any review file written after the failure. Inline-review fallback is forbidden in all cases. There is no exception for "I could just write the review myself"; that path produces silently degraded artifacts and is the failure mode this protocol exists to prevent.
3. **No improvised review file or inline review on artifact-handoff failure.** If a `code-reviewer`'s response (full review, hybrid re-review, or final verification) is missing the `REVIEW_ARTIFACT:` marker, OR the artifact file is missing/empty/path-mismatched, OR the on-disk first-line provenance is malformed, you MUST emit `STATUS: failed` with the specific reason from the `## Failure Modes` list (`reviewer artifact handoff failed: missing REVIEW_ARTIFACT marker`, `reviewer artifact handoff failed: missing or empty at <path>`, `reviewer artifact handoff failed: path mismatch: expected <X> got <Y>`, or `reviewer artifact handoff failed: provenance malformed at <path>: <specific check>`) and exit. You MUST NOT improvise the review file or fall back to inline review. This mirrors the existing "no inline review on dispatch failure" rules above.

All three rules are duplicated as standing identity rules in `agent/agents/code-refiner.md` `## Rules`. The duplication is intentional — these rules apply unconditionally regardless of the per-invocation prompt.

### Reviewer provenance stamping

Every persisted review file MUST begin with a `**Reviewer:**` provenance line as its first non-empty line. The format is exact:

```
**Reviewer:** <provider>/<model> via <cli>
```

- `<provider>/<model>` MUST be the EXACT model string you passed to `subagent_run_serial` for that pass's `code-reviewer` dispatch (e.g., `openai-codex/gpt-5.5`).
- `<cli>` MUST be the EXACT cli string you passed to `subagent_run_serial` for that same dispatch (e.g., `pi`).
- The line is followed by a single blank line, then the review body.
- The value MUST NOT contain `inline` or any synonym (`improvised`, `local`, `fallback`).

**You do not write the review file.** The reviewer writes it, using the verbatim provenance line you supply in its task prompt as `{REVIEWER_PROVENANCE}` and the absolute output path you supply as `{REVIEW_OUTPUT_PATH}`. Your role is to:

1. **Construct** the verbatim `**Reviewer:** <provider>/<model> via <cli>` line at dispatch time, using the exact `model` and `cli` values you are passing to THIS pass's `subagent_run_serial` task. Re-construct per pass — first-pass uses `crossProvider.capable`, hybrid re-review uses `standard`, final-verification uses `crossProvider.capable`. Each constructed line uses that pass's specific pair.
2. **Embed** that line as `{REVIEWER_PROVENANCE}` in the filled review-code-prompt.md, and embed the absolute era-versioned path as `{REVIEW_OUTPUT_PATH}`. Use the SAME absolute path across first-pass, hybrid re-reviews, and final-verification within one era — the file is overwritten in place by each successive reviewer.
3. **Validate** the on-disk first non-empty line on read-back as a fail-fast check (see Iteration 1 Step 3 below). The primary check: the line MUST be BYTE-EQUAL to the EXACT `{REVIEWER_PROVENANCE}` string you supplied for THIS dispatch. As defense-in-depth, run `validate-review-provenance.py --review-file <reviewer_path> --allowed-tiers <tier>`; your fail-fast check is additive (and stricter, since it pins to your supplied value), not a replacement.

Apply this contract to first-pass full reviews, hybrid re-reviews, and final-verification reviews — every reviewer dispatch in this protocol uses it.

### Era handling

An "era" is one full pass of the loop (Iteration 1 → hybrid re-reviews → Final Verification) keyed to a single versioned review file path. Era handling is concrete:

- **First era starts at `ERA=1`.** The first reviewer dispatch in this protocol uses the path `{WORKING_DIR}/{REVIEW_OUTPUT_PATH}-v1.md`. Iteration 1, all hybrid re-reviews within this era, and Final Verification all reuse this same `v1` path — the reviewer overwrites the file in place each pass.
- **Subsequent eras increment `ERA` only when Final Verification surfaces Critical/Important issues.** When Final Verification finds issues, set `ERA = ERA + 1` and re-enter the remediation loop; the very next reviewer dispatch (Iteration 1 of the new era) is given the next versioned path `{WORKING_DIR}/{REVIEW_OUTPUT_PATH}-v<ERA>.md` (e.g., `-v2.md`, `-v3.md`). Within each new era the same overwrite-in-place rule applies.
- **The coordinator never creates the versioned review file directly.** New versioned files come into existence solely as a result of the next reviewer dispatch (which writes to the new path you supply as `{REVIEW_OUTPUT_PATH}`). You compute and pass the next `-v<ERA>.md` path; the reviewer creates the file on disk.

### Carry-over remediation pass (era handoff)

When `{CARRY_OVER_REVIEW}` is non-empty, perform one targeted code-edit pass against that review file's findings BEFORE entering the Iteration 1 Full Review loop:

1. Read the carry-over review file at `{CARRY_OVER_REVIEW}`.
2. Extract Critical + Important findings (skip Minor — non-blocking).
3. Dispatch `coder` (remediator) per the existing Iteration 1 Step 6 remediation procedure with `{REVIEW_FINDINGS}` populated from the extracted findings, scoped to the files referenced by the carry-over findings.
4. Commit the remediation per Iteration 1 Step 7's commit shape (`fix(review): carry-over — <summary>`).
5. Set `HEAD_SHA = git rev-parse HEAD` after that carry-over remediation commit.
6. Begin Iteration 1 Full Review against that post-remediation HEAD. The carry-over remediation pass does NOT consume an iteration of the new era's `{MAX_ITERATIONS}` budget.

When `{CARRY_OVER_REVIEW}` is empty (first-era runs, etc.), skip the carry-over remediation pass entirely and begin Iteration 1 Full Review as today.

### Iteration 1: Full Review

1. **Read the review template** at `~/.pi/agent/skills/requesting-code-review/review-code-prompt.md`.

2. **Fill placeholders** for a full review:
   - `{WHAT_WAS_IMPLEMENTED}` — the Plan Goal above
   - `{PLAN_OR_REQUIREMENTS}` — the Requirements/Plan above
   - `{BASE_SHA}` — `{BASE_SHA}` from this prompt
   - `{HEAD_SHA}` — `HEAD_SHA`, using `{HEAD_SHA}` from this prompt when no carry-over remediation ran, or the updated `git rev-parse HEAD` value from the carry-over remediation pass when it did
   - `{DESCRIPTION}` — the Plan Goal above (same as `{WHAT_WAS_IMPLEMENTED}`)
   - `{RE_REVIEW_BLOCK}` — empty string (first pass)
   - `{REVIEW_OUTPUT_PATH}` — the absolute path `{WORKING_DIR}/{REVIEW_OUTPUT_PATH}-v<ERA>.md` (concatenate `{WORKING_DIR}` and the relative review-output base path supplied above, then append `-v<ERA>.md`). Use the SAME path across iteration 1, hybrid re-reviews, and final-verification within one era — the file is overwritten in place.
   - `{REVIEWER_PROVENANCE}` — the verbatim line `**Reviewer:** <provider>/<model> via <cli>` constructed from the EXACT `model` and `cli` you will pass to THIS pass's `subagent_run_serial` task in Step 3. For first-pass full reviews, this is `crossProvider.capable` and its dispatch CLI.

3. **Dispatch `code-reviewer`** with model `crossProvider.capable` and corresponding `cli` from the model matrix:

   **Capture freshness baseline.** Immediately before dispatching the reviewer, capture the pre-dispatch mtime of `{REVIEW_OUTPUT_PATH}` (the absolute era-versioned path constructed in Step 2). Bash form:

   ```bash
   REVIEW_BASELINE=$(python3 -c "import os, sys; p=sys.argv[1]; print(os.path.getmtime(p) if os.path.exists(p) else 0)" "<REVIEW_OUTPUT_PATH>")
   ```

   Hold `REVIEW_BASELINE` in your coordinator state across the dispatch. The fallback in Step 3a will compare the reviewer's on-disk write against this baseline.

   ```
   subagent_run_serial { tasks: [
     { name: "code-reviewer", agent: "code-reviewer", task: "<filled review-code-prompt.md>", model: "<crossProvider.capable from model-tiers.json>", cli: "<dispatch for crossProvider.capable>" }
   ]}
   ```
   Then extract and validate the reviewer's artifact handoff:

   - **3a–3c.** Run `parse-artifact-handoff.py --marker REVIEW_ARTIFACT --final-message <finalMessage-path> --expected-path {REVIEW_OUTPUT_PATH} --check-existence --check-non-empty --freshness-baseline <REVIEW_BASELINE>`; on any failure it emits the appropriate `STATUS: failed` reason from `## Failure Modes`. Capture the returned path as `<reviewer_path>`. When the parser's stdout JSON `used_fallback` field is `true`, treat the on-disk review file as authoritative (per the existing 3e contract) and continue with the BYTE-EQUAL provenance check and the `validate-review-provenance.py` defense-in-depth check. Failure of either provenance check still triggers `STATUS: failed` with the existing provenance malformed reason.
   - **3d. On-disk first-line provenance check.** Find the first non-empty line of `<reviewer_path>`. The primary check: the line MUST be BYTE-EQUAL to the EXACT `{REVIEWER_PROVENANCE}` string you supplied for THIS dispatch. As defense-in-depth, run `validate-review-provenance.py --review-file <reviewer_path> --allowed-tiers crossProvider.capable`; on failure emit `STATUS: failed` with reason `reviewer artifact handoff failed: provenance malformed at <reviewer_path>: <specific check>` and exit.
   - **3e. Read the file as the authoritative review.** On all checks passing, treat the on-disk file content as the authoritative review for verdict assessment, batching, remediator dispatch, and (downstream) hybrid re-review `{PREVIOUS_FINDINGS}` construction. Do NOT use `finalMessage` content beyond the marker line.

   Do NOT improvise the review file or perform an inline review on any failure above (Hard rule 3).

4. **Assess verdict** (from the on-disk review file). Find the line in the on-disk review beginning with `**Verdict:**` (inside the `### Outcome` section) and extract the verdict label. The label MUST be exactly one of `Approved`, `Approved with concerns`, or `Not approved`. If no `**Verdict:**` line is found, or the label does not match one of the three expected values, emit `STATUS: failed` with reason `reviewer artifact handoff failed: provenance malformed at <reviewer_path>: missing or unrecognized Verdict label` and exit. Then branch:
   - `Approved` or `Approved with concerns` → skip to **Final Verification**.
   - `Not approved` → continue to step 5.

When `Approved with concerns` triggers Final Verification, the reviewer's waived Important findings are final for this era — the refiner does NOT iterate to remediate them. The waived findings remain in the review file (no code-side `## Review Notes` analog exists; the diff plus the review file are the artifacts).

5. **Batch findings** — group related findings using your judgment:
   - Consider file proximity, logical coupling, conflict risk
   - Prefer smaller batches — one batch at a time, sequential dispatch
   - All Critical findings should be in early batches

6. **Dispatch remediator** for one batch — use model `capable` and corresponding `cli` from the model matrix:
   ```
   subagent_run_serial { tasks: [
     { name: "coder", agent: "coder", task: "<filled remediation prompt>", model: "<capable from model-tiers.json>", cli: "<dispatch for capable>" }
   ]}
   ```

   **Required content of the `<filled remediation prompt>`:**

   Each remediation prompt you build for a `coder` dispatch MUST include all of the following sections. Construct them from the on-disk review file (the authoritative source from Step 3e), not from `finalMessage`:

   - **Findings to fix.** Verbatim text of each batched finding from the review file (severity label, file:line references, and the reviewer's description). Do not paraphrase.
   - **Scope.** The exact set of files/functions/regions the coder is allowed to modify for this batch. Out-of-scope edits are rejected.
   - **TDD contract for production behavior changes.** For any finding that requires a production behavior change or bug fix, the coder MUST follow the `test-driven-development` skill on each behavior change in the batch:
     1. Write a failing regression/behavior test through a public interface (API, UI, CLI, service boundary, or persistence-facing interface) that exercises the real failure path or the intended observable behavior. Do not target private helpers or internal call sequences.
     2. Run the test and **verify RED** for the expected reason (the bug reproduces, or the desired behavior is absent). Fix typos/setup until the failure is meaningful.
     3. Apply the minimal production fix to make the test pass; no speculative features or "while I'm here" refactors.
     4. Run the targeted test and the relevant surrounding tests and **verify GREEN** with no unexpected errors or warnings.
     5. Mock only true external boundaries; use real internal collaborators.
   - **RED/GREEN evidence requirement.** The coder report MUST, for each production behavior change in the batch, include:
     - **RED:** the failing test added (or extended) and the expected failure reason.
     - **GREEN:** the test(s) now passing and confirmation the relevant suite still passes.

     Each line one or two sentences. Missing RED/GREEN evidence for a production behavior change is grounds for the next reviewer pass to flag the remediation as incomplete.
   - **TDD-not-applicable allowance.** For findings that change only documentation, configuration, comments, provenance/metadata, or other non-production-behavior content, the coder MAY write `TDD not applicable — <one-line reason>` in lieu of RED/GREEN evidence for that finding. The reason MUST be explicit (e.g. "docs-only correction in CONTRIBUTING.md", "config rename in tsconfig", "review-file provenance line update only"). This allowance does NOT apply to production behavior changes or bug fixes.

   These remediation-prompt requirements govern the coder dispatch only. They do NOT change the coordinator/reviewer artifact protocol (provenance stamping, REVIEW_ARTIFACT marker, file-existence and path-equality checks, era handling, or failure modes) defined elsewhere in this prompt.

7. **Commit remediation:**
   ```bash
   git add -A
   git commit -m "fix(review): iteration <N> — <summary>

   - Fixed: <finding 1 summary>
   - Fixed: <finding 2 summary>"
   ```

8. **Record in remediation log** — track what was fixed, deferred, or remaining.

9. **Repeat steps 5-8** if unbatched findings remain within this iteration.

### Iteration 2..N: Hybrid Re-Review

1. **Read the review template** (same as iteration 1).

2. **Read the re-review block** at `~/.pi/agent/skills/refine-code/review-fix-block.md`.

3. **Fill re-review block placeholders:**
   - `{PREVIOUS_FINDINGS}` — all findings from the previous review pass (full text)
   - `{PREV_HEAD}` — HEAD before the remediation commits
   - `{NEW_HEAD}` — current HEAD after remediation commits

4. **Fill the review template placeholders:**
   - Same as iteration 1, except:
   - `{BASE_SHA}` — the PREV_HEAD (only review remediation diff)
   - `{HEAD_SHA}` — the NEW_HEAD
   - `{RE_REVIEW_BLOCK}` — the filled re-review block content
   - `{DESCRIPTION}` — the Plan Goal above (same as iteration 1)
   - `{REVIEW_OUTPUT_PATH}` — the SAME absolute path used in Iteration 1 (no era change within the era — hybrid re-reviews overwrite the same file).
   - `{REVIEWER_PROVENANCE}` — the verbatim line `**Reviewer:** <provider>/<model> via <cli>` constructed from `standard` and its corresponding `cli`, freshly constructed for THIS hybrid re-review iteration.

5. **Capture freshness baseline.** Immediately before dispatching the reviewer, capture the pre-dispatch mtime of `{REVIEW_OUTPUT_PATH}` (the absolute era-versioned path constructed in Step 2). Bash form:

   ```bash
   REVIEW_BASELINE=$(python3 -c "import os, sys; p=sys.argv[1]; print(os.path.getmtime(p) if os.path.exists(p) else 0)" "<REVIEW_OUTPUT_PATH>")
   ```

   Hold `REVIEW_BASELINE` in your coordinator state across the dispatch. The fallback in Step 3a will compare the reviewer's on-disk write against this baseline.

   **Dispatch `code-reviewer`** with model `standard` and corresponding `cli` from the model matrix (hybrid re-reviews are scoped and cheaper). Then extract and validate the reviewer's artifact handoff using the SAME substeps 3a–3e procedure as Iteration 1 Step 3 (`parse-artifact-handoff.py --marker REVIEW_ARTIFACT --freshness-baseline <REVIEW_BASELINE>`, BYTE-EQUAL provenance check, `validate-review-provenance.py --allowed-tiers standard`). When the parser's stdout JSON `used_fallback` field is `true`, treat the on-disk review file as authoritative (per the existing 3e contract) and continue with the BYTE-EQUAL provenance check and the `validate-review-provenance.py` defense-in-depth check. Failure of either provenance check still triggers `STATUS: failed` with the existing provenance malformed reason. The reviewer overwrites the era-versioned file in place — the new first non-empty line reflects this iteration's `standard`-tier provenance.

6. **Track the iteration's remediation log entry in your coordinator state.** The reviewer is the sole writer of the review file under this contract; you do NOT write to the reviewer artifact. The remediation log is tracked in your coordinator state across iterations and surfaces in the final Output Format via `Issues fixed`/`Issues remaining` counts and (on `STATUS: not_approved_within_budget`) the `## Remaining Issues` section.

7. **Assess and remediate** — same as iteration 1 steps 4-9.

### Final Verification

When a review pass finds no Critical/Important issues (hybrid reviews converge):

1. **Capture freshness baseline.** Immediately before dispatching the reviewer, capture the pre-dispatch mtime of `{REVIEW_OUTPUT_PATH}` (the absolute era-versioned path constructed in Step 2). Bash form:

   ```bash
   REVIEW_BASELINE=$(python3 -c "import os, sys; p=sys.argv[1]; print(os.path.getmtime(p) if os.path.exists(p) else 0)" "<REVIEW_OUTPUT_PATH>")
   ```

   Hold `REVIEW_BASELINE` in your coordinator state across the dispatch. The fallback in Step 3a will compare the reviewer's on-disk write against this baseline.

   **Dispatch `code-reviewer`** with model `crossProvider.capable` and corresponding `cli` for a **full-diff** verification. Fill EVERY placeholder used by `review-code-prompt.md`:
   - `{WHAT_WAS_IMPLEMENTED}` — the same value used in Iteration 1 Step 2 (the implementation summary supplied to this protocol). Final Verification re-uses this content unchanged so the reviewer sees the original implementation context.
   - `{PLAN_OR_REQUIREMENTS}` — the same value used in Iteration 1 Step 2 (the plan or requirements text supplied to this protocol). Final Verification re-uses this content unchanged so the reviewer evaluates the post-remediation diff against the original plan/requirements.
   - `{BASE_SHA}` — original BASE_SHA from this prompt (pre-implementation)
   - `{HEAD_SHA}` — current HEAD (includes all remediations)
   - `{RE_REVIEW_BLOCK}` — empty string (full review, not re-review)
   - `{DESCRIPTION}` — the Plan Goal above
   - `{REVIEW_OUTPUT_PATH}` — the SAME absolute era-versioned path used by Iteration 1 and the hybrid re-reviews — the file is overwritten in place.
   - `{REVIEWER_PROVENANCE}` — the verbatim `**Reviewer:** <provider>/<model> via <cli>` constructed from `crossProvider.capable` and its corresponding `cli` for this final-verification dispatch.

   Every placeholder above MUST be filled before dispatch — leaving `{WHAT_WAS_IMPLEMENTED}` or `{PLAN_OR_REQUIREMENTS}` unfilled would dispatch the reviewer with literal `{WHAT_WAS_IMPLEMENTED}` / `{PLAN_OR_REQUIREMENTS}` strings in its task prompt and produce an unreliable final-verification verdict.

   Then extract and validate the reviewer's artifact handoff using the SAME substeps 3a–3e procedure as Iteration 1 Step 3 (`parse-artifact-handoff.py --marker REVIEW_ARTIFACT --freshness-baseline <REVIEW_BASELINE>`, BYTE-EQUAL provenance check, `validate-review-provenance.py --allowed-tiers crossProvider.capable`). When the parser's stdout JSON `used_fallback` field is `true`, treat the on-disk review file as authoritative (per the existing 3e contract) and continue with the BYTE-EQUAL provenance check and the `validate-review-provenance.py` defense-in-depth check. Failure of either provenance check still triggers `STATUS: failed` with the existing provenance malformed reason. On validation success, treat the on-disk file content as the authoritative final-verification review.

2. **Parse the final-verification verdict** from the on-disk review file (the same `**Verdict:**` line check as Iteration 1 Step 4). Branch:

   - **`Approved`:** Record `Result: Approved after N iterations.` in your coordinator state. Do NOT write to the reviewer artifact (the iteration count surfaces via the Output Format's `Iterations: <N>` line). Report `STATUS: approved`. Return the era-versioned path as the `## Review File` in your output. Do NOT produce an unversioned copy at `<REVIEW_OUTPUT_PATH>.md` — that legacy copy is dropped under this contract.

   - **`Approved with concerns`:** Record `Result: Approved with concerns after N iterations.` in your coordinator state. Do NOT write to the reviewer artifact (the waived Important findings remain in the review file as the reviewer wrote them). Report `STATUS: approved_with_concerns`. Return the era-versioned path as the `## Review File` in your output.

   - **`Not approved`:** Reset the iteration budget — start a new era by incrementing `ERA = ERA + 1`. Compute the next versioned path `{WORKING_DIR}/{REVIEW_OUTPUT_PATH}-v<ERA>.md` (e.g. `-v2.md`, `-v3.md`). Do NOT create or write to this file yourself — the next reviewer dispatch (Iteration 1 of the new era) will create it by writing to the path you supply as `{REVIEW_OUTPUT_PATH}`. Re-enter the remediation loop from Iteration 1 step 5 (assess + remediate). The next `code-reviewer` dispatch in the new era is given the new `-v<ERA>.md` path as `{REVIEW_OUTPUT_PATH}`.

### On Budget Exhaustion

When iterations reach MAX_ITERATIONS without convergence (i.e. the most-recent reviewer outcome is still `Not approved` and the budget is exhausted):

1. Track the cumulative remediation log in your coordinator state. Do NOT write to the reviewer artifact (the remaining issues are already in the file from the most recent reviewer write; the coordinator surfaces unfixed findings via the Output Format's `## Remaining Issues` section and surfaces fix counts via `Issues fixed`/`Issues remaining`).
2. Report `STATUS: not_approved_within_budget`.

### On Approved First Review

If the very first review's outcome is `Approved` or `Approved with concerns` (i.e. zero Critical findings), still run Final Verification (full-diff review) before reporting the success-path status. This ensures a cross-provider check even when the first pass is already approved.

## Failure Modes

All failure conditions produce `STATUS: failed` with a one-line reason string drawn from the four-category taxonomy below. The reason string appears in the `## Failure Reason` block of the Output Format.

| Category | Reason string template | Notes |
|---|---|---|
| Coordinator infra | `coordinator dispatch unavailable` | Emitted when `subagent_run_serial` is unavailable in this session. |
| Worker dispatch | `worker dispatch failed: <which worker>` | `<which worker>` ∈ `code-reviewer`, `coder`. Covers first-pass, hybrid re-review, final-verification reviewer dispatches and remediator (coder) dispatches. |
| Reviewer artifact handoff | `reviewer artifact handoff failed: <specific check>` | `<specific check>` ∈ `missing REVIEW_ARTIFACT marker`, `missing or empty at <path>`, `path mismatch: expected <X> got <Y>`, `provenance malformed at <path>: <sub-check>` (where `<sub-check>` ∈ `does not match supplied REVIEWER_PROVENANCE`, `format mismatch`, `inline-substring forbidden`, `missing or unrecognized Verdict label`). |

The Input artifact category from the plan side has no code-side analog — git tracks code state.

## Output Format

Report your final status using this exact format:

```
STATUS: approved | approved_with_concerns | not_approved_within_budget | failed

## Summary
Iterations: <N>
Issues found: <X> (<N> Critical, <N> Important, <N> Minor)
Issues fixed: <Y>
Issues remaining: <Z>

## Remaining Issues (only if not_approved_within_budget)
[Full text of unfixed Critical and Important findings with file:line references]

## Review File
<path to latest versioned review file>

## Failure Reason
<one-line reason; only present when STATUS: failed>
```
