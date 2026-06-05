---
name: define-spec
description: "Interactive spec writing from an idea, an existing spec under docs/specs/, or freeform text. Dispatches a spec-designer subagent in a multiplexer pane when one is available, falling back to running the procedure on the main agent. Writes a structured spec to docs/specs/ and gates the commit on user review."
---

# Define Spec

This skill is a thin orchestrator. The full spec-design procedure lives in `skills/define-spec/spec-design-procedure.md` and is the single source of truth for both branches. This skill probes the environment, picks a branch, dispatches (or runs the procedure on the main agent), validates completion, and gates the commit on user review.

## Step 1: Detect branch (mux vs inline)

Decide which branch to run **without** prompting the user.

Run `pi-flow helper define-spec/detect-mux-backend` (passing `--user-input <slash-command-text>` when the user invoked the skill with arguments). Parse the JSON output. Print the returned `status_message` to the user as the informational status line. Route on `branch`: `mux` → Step 3a; `inline` → Step 3b. The helper delegates runtime multiplexer detection to `pi-mux-detect` (from `@aphotic/pi-mux-subagents`) — that is the single source of truth for backend precedence, mode forcing, and the supported mux set (currently `herdr`, `cmux`, `tmux`, `zellij`, `wezterm`). The helper only (a) checks `--user-input` for define-spec's inline-override substrings before invoking the detector and (b) adapts the detector's JSON output into define-spec's `{branch, backend, reason, status_message}` shape. See the helper's `--help` for the contract. Do NOT prompt the user during probing.

## Step 2: Read `spec-design-procedure.md` fresh from disk

Read `skills/define-spec/spec-design-procedure.md` in full. This is the procedure body that drives the chosen branch.

If the file is missing or unreadable, fail with:

> `skills/define-spec/spec-design-procedure.md` missing or unreadable — cannot run define-spec. Restore the file before retrying.

Stop. Do not dispatch with an empty or truncated procedure.

## Step 3: Run the procedure

### 3a. Mux branch — dispatch `spec-designer`

**Pre-dispatch absolute output-path resolution (for the missing-marker fallback).** Before dispatching, the orchestrator resolves an absolute `SPEC_OUTPUT_PATH` for ALL three input shapes so the parser invocation in Step 4 can pass `--expected-path` uniformly per spec criterion 11. Detect the input shape locally by running the same regex used in `spec-design-procedure.md` Step 1 against the orchestrator's raw user input:

- **Idea ID:** input (after `strip().lower()`) matches `^IDEA-[0-9a-f]{8}$`. Extract `<raw-id>` (the 8-char hex without the `IDEA-` prefix). Read `docs/ideas/<raw-id>.md` from disk. Derive a kebab-case `<slug>` from the file's first `# `-prefixed H1 line: lowercase the title, replace each run of non-alphanumeric characters with a single `-`, strip leading/trailing `-`, and truncate to the first 60 characters (then strip any trailing `-` left by truncation). If no `# `-prefixed H1 line is present in the idea file, fall back to `<slug> = <raw-id>` (the raw idea hex itself). Resolve `SPEC_OUTPUT_PATH = <working-dir>/docs/specs/<YYYY-MM-DD>-<slug>.md` using today's UTC date in `YYYY-MM-DD` form. `<working-dir>` is the orchestrator's current working directory (absolute).
- **Existing-spec path:** input ends in `.md` AND is either a relative path beginning with `docs/specs/` or an absolute path containing the segment `/docs/specs/`, AND the file exists on disk. Resolve `SPEC_OUTPUT_PATH = os.path.abspath(<input-spec-path>)` against `<working-dir>` — this is the absolute resolution of the user-supplied path. The single canonical `SPEC_OUTPUT_PATH` is used for BOTH `--expected-path` AND baseline capture, so byte-equal matching against the spec-designer's `SPEC_ARTIFACT:` marker (which is always emitted as an absolute path per `spec-design-procedure.md` Step 9) is guaranteed regardless of whether the user supplied a relative or absolute input path.
- **Freeform:** anything else. Derive a kebab-case `<slug>` from the input text: take the first 60 characters of the input, lowercase, replace each run of non-alphanumeric characters with a single `-`, strip leading/trailing `-`. If the result is empty (e.g., input is only whitespace), use `<slug> = "freeform"` as a deterministic fallback. Resolve `SPEC_OUTPUT_PATH = <working-dir>/docs/specs/<YYYY-MM-DD>-<slug>.md` using today's UTC date.

Bind `SPEC_OUTPUT_PATH` (always absolute) in skill state. The slug-derivation rules are deterministic and pre-dispatch-knowable, so the orchestrator computes the path before dispatching the spec-designer.

**Baseline-capture for the missing-marker fallback (uniform across all three branches).** Capture the pre-dispatch mtime of `SPEC_OUTPUT_PATH`:

```bash
SPEC_BASELINE=$(python3 -c "import os, sys; p=sys.argv[1]; print(os.path.getmtime(p) if os.path.exists(p) else 0)" "$SPEC_OUTPUT_PATH")
```

A value of `0` indicates the file did not exist before dispatch (typical for idea/freeform; possible for existing-spec when the user passed a path that does not yet exist). Any positive value indicates the file's mtime at dispatch time. Hold both `SPEC_OUTPUT_PATH` and `SPEC_BASELINE` in skill state across the dispatch.

**Substitute `{SPEC_OUTPUT_PATH}` into the procedure body.** The `systemPrompt:` field carries the body of `spec-design-procedure.md` (loaded in Step 2). Before passing it to `subagent_run_serial`, perform a string replacement: every occurrence of the literal token `{SPEC_OUTPUT_PATH}` in the loaded body is replaced with the absolute path computed in the path-resolution paragraph above. The procedure's Step 8 and Step 9 reference this token to direct the spec-designer to write to the orchestrator-supplied absolute path on all three branches.

Run `pi-flow helper _shared/resolve-model-dispatch --tier modelTiers.capable --agent spec-designer`. On non-zero exit, surface the stderr message byte-equal per [`skills/_shared/dispatch-contract.md`](../_shared/dispatch-contract.md) and stop. Do not dispatch. Do not fall back to a CLI default.

Then dispatch (note: `wait` is a top-level orchestration option, not a per-task field):

```
subagent_run_serial {
  tasks: [
    {
      name: "spec-designer",
      agent: "spec-designer",
      task: "<raw user input — idea ID, docs/specs/<path>.md, or freeform text>",
      systemPrompt: "<full body of spec-design-procedure.md from Step 2>",
      model: "<modelTiers.capable from flow.json>",
      cli: "<resolved dispatch cli>",
      executionPolicy: "<resolved executionPolicy>"
    }
  ],
  wait: true
}
```

Notes:
- **Do NOT pass a `skills:` parameter.** The procedure is delivered exclusively via `systemPrompt:` so delivery is symmetric across pi and Claude CLIs (the agent's `system-prompt: append` frontmatter makes the runtime treat `systemPrompt:` as a real system prompt on both paths).
- **`model:`, `cli:`, and `executionPolicy:` come from `flow.json`, not from agent frontmatter.** `spec-designer.md` has no `model:` field by design (R1) — without an explicit per-call `model:` the CLI default would be used and the Opus tier would be lost.
- The pane spawns; the user types their answers directly into the pane. The dispatch blocks until the subagent completes (top-level `wait: true`).

Read `results[0].finalMessage`, `results[0].exitCode`, `results[0].state`, `results[0].error`, and `results[0].transcriptPath` from the orchestration result. `error` is populated when the runtime captured an error string for a non-clean exit (process crash, signal, runtime error); it may be empty or undefined on clean exits. Proceed to Step 4.

### 3b. Inline branch — follow the procedure in this session

Treat the body of `spec-design-procedure.md` (read in Step 2) as if it were addressed to you, the orchestrator. Execute Steps 1 through 8 of the procedure in this session. The user's raw input is the seed for the procedure's Step 1 input-shape detection.

When you reach the procedure's Step 9, follow the **inline branch** subsection of that step: do **not** emit `SPEC_ARTIFACT: <path>` and do **not** exit. Capture the absolute path of the spec file you just wrote and return here. The completion line and process exit at the end of Step 9 are for the subagent / mux branch only; on the inline branch you are the orchestrator, so emitting the line and exiting would skip the review-and-commit gate below.

Skip Step 4 of this orchestrator (it parses the subagent's `finalMessage`) and jump straight to Step 5 with the absolute path you just captured.

## Step 4: Validate `SPEC_ARTIFACT:` (mux branch only)

Evaluate the subagent's `finalMessage`, `exitCode`, `state`, `error`, and `transcriptPath` from `results[0]` in the order below. The first matching case wins, except case (2a) may perform conservative transcript-backed recovery and proceed to Step 5. Do not retry. Do not surface the Step 5 review choices during validation — they are only for the user review gate.

**Exit-code-first contract.** Evaluate case (1) before invoking the parser helper or running any fallback / recovery logic. The helper invocation, its on-disk freshness fallback, and the transcript-backed recovery described below are only relevant when `exitCode == 0`. If `exitCode != 0`, jump directly to case (1) and stop — do **not** write `finalMessage` to a temp file, do **not** invoke `parse-artifact-handoff.py`, and do **not** consult the transcript. A nonzero exit means dispatch failed (process crash, signal, runtime error) and must be surfaced verbatim rather than reinterpreted as a missing-marker outcome.

Transcript-backed recovery is a narrow salvage path for the known failure mode where the subagent successfully wrote the spec but ended its session on the write/edit tool call instead of sending the final `SPEC_ARTIFACT:` text message. It must never scan for the newest file in `docs/specs/` or guess from filesystem state alone. It may recover only from successful write/edit evidence in `transcriptPath`, and it still proceeds through the normal user review gate before any commit.

Cases (evaluated in this order):

- **(1) `exitCode != 0`.** Report:
  > Spec design failed (`exitCode: <N>`, `state: <state>`<if `error` is non-empty, append `, error: <error>`>). Transcript: `<transcriptPath>`. No commit attempted.

  If a `SPEC_ARTIFACT: <path>` line is also present in `finalMessage`, append `Reported path: <path> (commit not attempted because the subagent exited with a nonzero status).` so the user can see the partial output. Then stop.

  Checking exit code first ensures dispatch failures (process crash, signal, runtime error) are surfaced with the exit code and error text the runtime captured, instead of being misreported as a missing completion line.

- **(2) `exitCode == 0`.** Build the helper invocation. The argument set is identical across all three input shapes:

  `pi-flow helper _shared/parse-artifact-handoff --marker SPEC_ARTIFACT --final-message <temp-file> --expected-path <SPEC_OUTPUT_PATH> --check-existence --check-non-empty --require-path-suffix .md --require-path-prefix <working-dir>/docs/specs/ --freshness-baseline <SPEC_BASELINE>`

  `SPEC_OUTPUT_PATH` and `SPEC_BASELINE` were bound in Step 3a per the absolute-path resolution and baseline-capture rules. Write `results[0].finalMessage` to a temp file, then run the helper invocation above. The helper performs four checks atomically — marker presence, file existence, non-empty content, path-shape (`.md` suffix + `<working-dir>/docs/specs/` prefix). The helper also performs the missing-marker on-disk fallback when the marker is absent but the on-disk file at `SPEC_OUTPUT_PATH` exists, is non-empty, and has mtime strictly greater than `SPEC_BASELINE`. When `used_fallback` is `true` in the script's stdout JSON, log a one-line warning to the user noting that the on-disk file at `SPEC_OUTPUT_PATH` was used as the spec artifact even though the spec-designer did not emit a `SPEC_ARTIFACT:` terminal marker. The transcript-backed recovery in case (2a) below is a secondary salvage path — it only runs when the missing-marker fallback did NOT accept (for example, the spec-designer wrote to a path other than `SPEC_OUTPUT_PATH`, leaving `SPEC_OUTPUT_PATH` stale or missing at parse time). On any check failing, the helper exits non-zero with a JSON `failure` field on stderr; surface the failure verbatim and stop. Exit 0: read `.path` from stdout JSON and proceed to Step 5. `missing SPEC_ARTIFACT marker` (and on-disk fallback rejected) → case (2a). `missing or empty at <path>` → report `Spec design reported SPEC_ARTIFACT: <path> but <path> does not exist on disk. Transcript: <transcriptPath>. No commit attempted.` and stop. `path suffix mismatch: ...` or `path prefix mismatch: ...` → report `Spec design reported SPEC_ARTIFACT: <path> but the path is not a valid docs/specs/*.md path under <working-dir>. Transcript: <transcriptPath>. No commit attempted.` and stop. Do not perform transcript-backed recovery on path-shape failures — the marker emission was malformed (wrong path shape), not missing. Recovery is only for case (2a) missing SPEC_ARTIFACT marker when the on-disk fallback did not accept.

- **(2a) `finalMessage` lacks a `SPEC_ARTIFACT:` line (and the on-disk fallback above did not accept).** Attempt **Transcript-backed recovery**:

  1. Read `transcriptPath`. If it is missing or unreadable, report:
     > Spec design did not complete: `spec-designer` exited without emitting `SPEC_ARTIFACT: <path>`, and transcript-backed recovery could not read `<transcriptPath>`. No validated spec path, no commit attempted.

     Stop.

  2. From successful tool-result records only (not proposed tool calls), identify candidate spec paths written by the subagent. Accept success evidence such as Claude Code `toolUseResult.filePath` records with `type: "create"` / `"update"`, or tool-result text like `File created successfully at:` / `File updated successfully at:`. A candidate path must end in `.md` and be either an absolute path under the current repo's `docs/specs/` directory or a relative path beginning with `docs/specs/`.

  3. Normalize relative candidates against the current repo root. Recovery succeeds only if there is exactly one unique candidate path, the file exists on disk, and the file is non-empty. Apply input-shape validation where available:
     - Idea input (`IDEA-<id>`): the candidate file must contain the exact provenance line `Source: IDEA-<id>`.
     - Existing-spec input: the candidate path must normalize to the same path as the input spec path.
     - Freeform input: no provenance line is required.

  4. If recovery succeeds, surface:
     > `spec-designer` exited without emitting `SPEC_ARTIFACT: <path>`, but the transcript shows it successfully wrote `<path>`. Treating that as the candidate spec. Review before commit.

     Then proceed to Step 5 with the recovered absolute path.

  5. If recovery finds zero candidates, multiple candidates, a candidate outside the repo's `docs/specs/`, an empty/missing file, or a provenance/path mismatch, report:
     > Spec design did not complete: `spec-designer` exited without emitting `SPEC_ARTIFACT: <path>`, and transcript-backed recovery did not find exactly one valid written spec path. Transcript: `<transcriptPath>`. No validated spec path, no commit attempted.

     Stop.

## Step 5: Pause for user review

Surface to the user:

> Spec written to `<path>`. Review it, then choose:
>
> **(c) Commit** — commit the spec to git.
> **(r) Refine** — re-run `define-spec` with this draft as input. The procedure overwrites the same path.
> **(x) Stop** — leave `<path>` uncommitted on disk for manual editing and committing later.

Wait for the user's reply. The orchestrator does **not** read the spec file into its own context — the user reads it directly.

Possible user responses:

- **(c) Commit / commit it / yes** → Step 6 (commit).
- **(r) Refine / refine** → Step 7 (refine).
- **(x) Stop / stop / no** → Step 7 (stop).

## Step 6: Commit (on user OK)

Invoke the `commit` skill with the exact spec path captured in Step 4 (or Step 3b on inline). Specify the path explicitly so only the spec file is committed.

If the `commit` skill fails, report the error verbatim and stop. Leave the file on disk uncommitted. Do **not** auto-retry. The user resolves the underlying issue (e.g. pre-commit hook failure) and re-runs `/define-spec` or commits manually.

## Step 7: Handle review choices (on Refine or Stop)

Behavior per choice:

- **(r) Refine:** invoke `/define-spec <path>` recursively, passing the captured spec path as-is (typically the absolute path from the original `SPEC_ARTIFACT: <absolute path>` line). The procedure's input-shape detector accepts both relative `docs/specs/<name>.md` and absolute paths containing `/docs/specs/`, so the existing-spec branch fires on the recursive run and overwrites the draft with preamble preservation. On the recursive run, the same orchestrator probe + dispatch + validate + commit-gate flow applies.
- **(x) Stop:** emit `Leaving <path> uncommitted. Edit and commit yourself.` and stop.

## Step 8: Offer fastlane or deep workflow

After a successful commit (Step 6), make an LLM-native advisory recommendation between fastlane and deep workflow, then render the three-option continuation menu. The recommendation is advisory — the user can always override it by choosing any of the three menu options.

**Read the committed spec into context.** Read the spec file at the path captured in Step 4 (or Step 3b on inline) into your own context. Do not delegate this judgment to `recommend-workflow.py`; the helper still exists for legacy/compatibility use, but its shallow markdown-shape heuristic is not authoritative for this menu. You may glance at the helper's output as one optional signal, but the recommendation you surface to the user must be your own spec-based judgment.

**Assess scope and risk from the actual spec content.** Look at the Goal, Context (including any "Surveyed files:" list), Requirements, Acceptance Criteria, Non-Goals, and any Approach section — not just markdown counts. Judge what the implementation will actually involve.

Recommend **deep workflow** (`generate-plan` → `execute-plan`) when the spec indicates any of the following:

- multiple workflow skills, agents, or subsystems are affected;
- parser, protocol, artifact-handoff, provenance, trust-boundary, or freshness semantics are involved;
- fallback, validation, migration, security, compatibility, or orchestration behavior is changing;
- git, commit, worktree, branch-completion, or workflow-boundary behavior is affected;
- requirements or acceptance criteria span several independent concerns;
- implementation likely needs dependency decomposition, parallelizable work, verifier gates, or integration reconciliation;
- you are uncertain whether fastlane is sufficient.

Recommend **fastlane** only when the spec is clearly localized and low risk:

- likely 1–3 files or one narrow subsystem;
- small requirement and acceptance surface;
- no cross-skill, multi-agent, parser/protocol, provenance/trust, or orchestration semantics;
- no broad compatibility or migration concerns;
- a single coder plus standard tests/refinement is likely enough.

**When uncertain, recommend deep workflow** and say so in the rationale.

**Worked regression example.** A spec like `docs/specs/2026-05-11-harden-workflow-boundaries.md` (IDEA-40e342b9) spans multiple workflow skills (`execute-plan`, `refine-plan`, `refine-code`, `define-spec`, `scout`, `generate-plan`), touches parser/protocol boundaries (`parse-artifact-handoff.py`, `parse-coder-report.py`, `extract-provenance-preamble.py`, `parse-test-runner-artifact.py`), changes provenance/trust/freshness semantics (missing-marker on-disk fallback with a freshness baseline), and has acceptance criteria across many independent concerns. Recommend **deep workflow** for any spec of this shape — even though it lacks an `## Approach` section and has a short top-level Requirements bullet count, the legacy `recommend-workflow.py` heuristic would mis-route it to fastlane. Do not reproduce that error: this kind of spec is the canonical deep-workflow case.

**Render the menu.** Use this exact shape, substituting `<fastlane | deep workflow>` with your recommendation and `<rationale>` with a concise (one phrase or one sentence) rationale grounded in the spec content you just read:

> Spec committed at <path>. Recommended next step: <fastlane | deep workflow> because <rationale>.
>
> Options:
> (f) fastlane      — use checklist, serial execution, essential gates
> (d) deep workflow — run full plan, parallel execution, all gates
> (x) stop          — leave the workflow for later

The user can pick either option regardless of the recommendation.

Routing on the user's response:

- `(f) / fast / fastlane` → invoke `/fastlane <spec-path>`.
- `(d) / deep / deep workflow / generate-plan` → invoke `/generate-plan <spec-path>`.
- `(x) / stop / no` → exit silently. The spec has already been committed in Step 6 and stays committed; the user is just deferring the implementation workflow.

## Edge cases

- **`spec-design-procedure.md` missing.** Fail at Step 2 with the message specified there.
- **`flow.json` missing / no `modelTiers.capable` model / no `subagentDispatch.<provider>` mapping / no usable `executionPolicy`.** Fail at Step 3a per the canonical procedure in `skills/_shared/dispatch-contract.md` — emit the corresponding template (1)–(5) byte-equal with `<agent> = spec-designer`, `<tier> = modelTiers.capable` and stop. Do not fall back to a CLI default — the explicit resolution keeps dispatch on the Opus-tier / Claude-CLI route.
- **Mux probe wrong (false positive / false negative).** The helper delegates detection to `pi-mux-detect`, which is the same code path `@aphotic/pi-mux-subagents` uses at dispatch time, so the helper and the runtime cannot drift on backend selection or supported mux set. A divergence would have to come from `pi-mux-detect` itself returning a wrong answer (e.g. detector env var set without the matching CLI on PATH, or a future detector regression). If the runtime later disagrees, users can force the inline branch with `PI_SUBAGENT_MODE=headless` or one of the override phrases. If `pi-mux-detect` is missing or unable to run, the helper fails loudly rather than silently routing to `inline`, because that masks a broken peer dependency.
- **User-input override false positive.** If the user's input contains "subagent" without meaning override (e.g. "build a subagent thing"), the substring match will trigger inline mode. Mitigation is the specific phrase set in Step 1b. Residual risk is documented; users wanting subagent dispatch can rephrase.
- **Inline-branch session terminated mid-procedure.** No spec written, no commit, nothing to recover. User re-runs `/define-spec`. If a partial spec was written before termination, it stays on disk; user can delete or edit manually.
- **Subagent wrote a spec but missed `SPEC_ARTIFACT:`.** Step 4 case (2a) covers this with conservative transcript-backed recovery. Recovery is allowed only from successful write/edit evidence in the transcript and only when exactly one valid `docs/specs/*.md` path can be validated; otherwise fail closed with no commit.
- **`commit` skill failure.** Step 6 covers this. Report and stop; user resolves the underlying issue.
- **Multi-subsystem input, user insists on a single spec.** The procedure's Step 3 scope-decomposition check handles this — user override is honored, an Open Question is recorded, and the spec is written. Downstream `generate-plan` may produce a coarse plan.
