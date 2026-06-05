---
name: generate-plan
description: "Generates a structured implementation plan from an idea or spec file. Dispatches the planner subagent for deep codebase analysis, then runs an iterative review-edit loop. Use when the user wants to plan work before executing it."
---

Dispatch the `planner` subagent to analyze the codebase and produce a structured plan file in `docs/plans/`, then review and refine the plan through an iterative review-edit loop.

## Step 1: Determine the input source

The user will provide one of three input sources. **Idea and freeform inputs are inlined into the planner prompt as before. File inputs are passed by path** — the orchestrator must not read and embed the full file body into the planner prompt, because that pollutes the orchestrator's own context window on large specs, RFCs, and design docs.

### 1a. Idea ID (e.g., `IDEA-7ef7d441`)

Use the built-in `idea` tool (`action: "read"`, `id: "<id>"`) to fetch the artifact and read `details.body` as the full body. The planner subagent does not have the `idea` tool, so you must inline the body.

- Set `{TASK_DESCRIPTION}` to the idea body text.
- Set `{TASK_ARTIFACT}` to an empty string.
- Set `{SOURCE_IDEA}` to `Source idea: IDEA-<id>`.
- Leave `{SOURCE_SPEC}` and `{SCOUT_BRIEF}` empty.

### 1b. File path (spec, RFC, design doc, etc.)

Pass the file by path. **Do NOT load the full file contents into `{TASK_DESCRIPTION}`.** The planner will read the file from disk.

Run `pi-flow helper _shared/extract-provenance-preamble --file <input-path> --mode spec` to extract `Source:` and `Scout brief:` lines from the preamble. Use `source_idea` from the JSON output to set `{SOURCE_IDEA}` to `Source idea: <source_idea>` (else empty). Use `scout_brief` to set `{SCOUT_BRIEF}` to `Scout brief: <scout_brief>` ONLY after verifying the referenced file exists on disk; if the file does not exist, warn the user (`Scout brief referenced in spec not found at <path> — proceeding without it.`) and leave `{SCOUT_BRIEF}` empty. The three supported line shapes and the bounded-read rule are documented in the helper's `--help`.

**Only when `scout_brief` was extracted AND the referenced file exists on disk** (i.e., `{SCOUT_BRIEF}` was set in the previous paragraph), run `pi-flow helper _shared/classify-workflow-drift --brief-path <brief-path> --working-dir <cwd>`. If `scout_brief` is null, or the referenced file is missing, skip the classifier entirely and continue with the remaining field population below — there is no brief to classify against. Parse the JSON output. The helper classifies workflow-only paths using the allowlist in [`skills/_shared/workflow-artifact-paths.md`](../_shared/workflow-artifact-paths.md); keep this cross-reference in the skill so future maintainers know the allowlist's source of truth. On `outcome: silent_continue`, proceed silently to the next preamble rule. On any other outcome, print the helper's `message_body` field verbatim to the user. For `workflow_only`, this is informational — continue plan generation. For `mixed_changes`, `uninspectable_a`, `uninspectable_b`, and `uninspectable_c`, the message is a `(c)`/`(x)` menu — wait for the user's reply and route per the menu response handling preserved below. If the helper exits non-zero with a structured `{"failure": ...}` JSON on stderr, surface that failure to the user and stop — this indicates an unexpected helper/I/O problem rather than a workflow-drift outcome.

`Menu response handling (applies to all four menu variants):` Recognize on letter shortcut and word alias. **(c) Continue / continue / yes** → continue Step 1b's remaining preamble work — populate `{SCOUT_BRIEF}` with `Scout brief: docs/briefs/<filename>` if not already populated, then proceed to the next preamble rule and on to Step 2 of the skill. The brief stays load-bearing for the planner dispatch. **(x) Stop / stop / no** → stop `generate-plan` immediately before Step 2. Do not dispatch the planner. Do not invoke `refine-plan`. Emit the verbatim terminal status message: `Plan generation stopped — scout brief / HEAD difference unresolved.` Then halt the skill — do not fall through to Step 2. Unrecognized responses re-prompt with the same menu body. Do not auto-default to either `(c)` or `(x)`.

Then populate the remaining fields:

- Set `{TASK_ARTIFACT}` to `Task artifact: <input path>`.
- Set `{TASK_DESCRIPTION}` to an empty string (the artifact on disk IS the task description).
- If the input path is under `docs/specs/`, set `{SOURCE_SPEC}` to `Source spec: docs/specs/<filename>`. For other file inputs (RFCs, design docs at arbitrary paths), leave `{SOURCE_SPEC}` empty.

### 1c. Freeform description

Use the text as-is.

- Set `{TASK_DESCRIPTION}` to the freeform text.
- Set `{TASK_ARTIFACT}` to an empty string.
- Leave `{SOURCE_IDEA}`, `{SOURCE_SPEC}`, and `{SCOUT_BRIEF}` empty.

## Step 2: Resolve model tiers

Tier-role assignment: plan generation uses `modelTiers.capable`. Run the model-dispatch helper:

```bash
pi-flow helper _shared/resolve-model-dispatch --tier modelTiers.capable --agent planner
```

On non-zero exit, surface its stderr output byte-equal (canonical Templates (1)–(5) from `_shared/dispatch-contract.md`) and stop.

## Step 3: Generate the plan

1. Read [generate-plan-prompt.md](generate-plan-prompt.md) in this directory.
2. Fill placeholders:
   - `{TASK_DESCRIPTION}` — for idea and freeform inputs, the inlined text from Step 1. For file inputs, an empty string (the artifact on disk is the task description).
   - `{TASK_ARTIFACT}` — for file inputs, `Task artifact: <input path>`. For idea and freeform inputs, an empty string.
   - `{WORKING_DIR}` — absolute path to cwd
   - `{OUTPUT_PATH}` — absolute path of the form `<working-dir>/docs/plans/yyyy-MM-dd-<short-description>.md` (substitute `{WORKING_DIR}` from above to produce a fully-resolved absolute path before filling the prompt; Step 3.4's `--expected-path` validation and the planner prompt's byte-equal `PLAN_ARTIFACT: {OUTPUT_PATH}` emission both require this to be absolute).
     - For **file inputs**, derive `<short-description>` from the **input filename** (basename without extension, e.g., `docs/specs/reduce-context.md` → `reduce-context`). Do NOT derive it from the document body — the body is not loaded into the orchestrator prompt.
       - **Date-prefix normalization (required).** If the basename already starts with a `YYYY-MM-DD-` prefix (regex `^\d{4}-\d{2}-\d{2}-`), strip that leading prefix before applying today's date. For example, a spec created yesterday at `docs/specs/2026-05-18-reduce-context.md` becomes `<short-description> = reduce-context`, and today's plan path becomes `docs/plans/2026-05-19-reduce-context.md` — NOT `docs/plans/2026-05-19-2026-05-18-reduce-context.md`. Basenames that do not begin with a `YYYY-MM-DD-` prefix are used as-is (e.g., `reduce-context.md` → `reduce-context`).
     - For **idea inputs**, derive from the idea title.
     - For **freeform inputs**, derive from the task text.
   - `{SOURCE_IDEA}` — `Source idea: IDEA-<id>` when a source idea ID is available — either directly (input was an idea ID) or indirectly (extracted from a file's preamble `Source: IDEA-<id>` line during provenance extraction in Step 1). Empty string otherwise.
   - `{SOURCE_SPEC}` — `Source spec: docs/specs/<filename>` if the input file path is under `docs/specs/`, empty string otherwise.
   - `{SCOUT_BRIEF}` — `Scout brief: docs/briefs/<filename>` if a scout brief was extracted from the file preamble and the brief file exists on disk, empty string otherwise.
3. Dispatch `planner` agent synchronously:

   **Baseline-capture for the missing-marker fallback.** Immediately before dispatching the planner, capture the pre-dispatch mtime of `{OUTPUT_PATH}` so Step 3.4 can validate that any on-disk plan is fresh even if the marker line is missing. Run:

   ```bash
   PLAN_BASELINE=$(python3 -c "import os, sys; p=sys.argv[1]; print(os.path.getmtime(p) if os.path.exists(p) else 0)" "{OUTPUT_PATH}")
   ```

   Hold `PLAN_BASELINE` in skill state across the dispatch. A value of `0` indicates the file did not exist before dispatch; any positive value indicates the file's mtime at dispatch time.

   ```
   subagent_run_serial { tasks: [
     { name: "planner", agent: "planner", task: "<filled template>", model: "<model from Step 2>", cli: "<cli from Step 2>", executionPolicy: "<executionPolicy from Step 2>" }
   ]}
   ```
   Read the planner's output from results[0].finalMessage — the planner writes the plan to disk; this result is the return message.

4. Validate the planner's marker handoff. Write `results[0].finalMessage` to a temp file and run `pi-flow helper _shared/parse-artifact-handoff --marker PLAN_ARTIFACT --final-message <temp-file> --expected-path <{OUTPUT_PATH} from Step 3 (absolute path)> --check-existence --check-non-empty --freshness-baseline <PLAN_BASELINE>`. When `used_fallback` is `true` in the script's stdout JSON, log a one-line warning to the user noting that the on-disk file at `{OUTPUT_PATH}` was used as the plan even though the planner did not emit a `PLAN_ARTIFACT:` terminal marker. On non-zero exit, surface the script's stderr (a JSON blob with a `failure` field) verbatim to the user, prefix it with `generate-plan: planner artifact handoff failed —`, and stop the skill. Do NOT proceed to Step 4 (refine-plan handoff). On exit 0, read `.path` from stdout JSON; this is the validated plan path used by Step 4.

5. Harden the validated plan against ambiguous fenced examples. Run:
   ```
   pi-flow helper _shared/plan_fence_hardening --plan "<validated plan path>" --rewrite-in-place
   ```
   On non-zero exit, surface the error to the user, prefix it with `generate-plan: fence hardening failed —`, and stop the skill. Do NOT proceed to Step 4 (refine-plan handoff). On exit 0, continue.

## Step 4: Refine the plan

After Step 3 produces the initial plan, invoke the `refine-plan` skill to run the review-edit loop and commit gate. `refine-plan` owns reviewer/editor dispatch, on-disk review artifacts, finding extraction, and version tracking — `generate-plan` does none of that itself.

Invoke `refine-plan` with these arguments:

- `PLAN_PATH = <plan path from Step 3>` — pass the plan file produced by the planner as the positional `PLAN_PATH` argument (e.g., `<plan path from Step 3>`), not as a flag.
- **Coverage source** (exactly one of):
  - **File-based inputs (Step 1b):** pass `--task-artifact <input path>`. The on-disk artifact is the coverage source.
  - **Idea inputs (Step 1a):** pass `--task-description "<idea body from {TASK_DESCRIPTION} in Step 3>"` AND `--source-idea IDEA-<id>`. The inline body is the coverage source; the source-idea line is supplementary metadata.
  - **Freeform inputs (Step 1c):** pass `--task-description "<freeform text from {TASK_DESCRIPTION} in Step 3>"`. The inline body is the coverage source.
- `--scout-brief <path>` — only if a valid scout brief was extracted in Step 1 AND still exists on disk at refinement time. Omit otherwise.
- `--max-iterations 3`.
- `--auto-commit-on-approval` — always set when invoked from `generate-plan`.

`--structural-only` is NEVER passed by `generate-plan`. Every generate-plan input source has a coverage source: the file artifact for 1b, the inline body for 1a/1c (idea and freeform).

`refine-plan` returns a compact summary (with `STATUS`, `COMMIT`, `PLAN_PATH`, `REVIEW_PATHS`, and optionally `STRUCTURAL_ONLY` and `FAILURE_REASON`). Step 5 consumes that summary.

## Step 5: Report result

Run `pi-flow helper refine-plan/parse-refine-plan-summary --summary <path-to-finalMessage-or--for-stdin>` against the `refine-plan` summary returned in Step 4. Display the parsed `status`, `commit`, `plan_path`, and `review_paths` fields to the user. When `structural_only == true`, also display the `STRUCTURAL_ONLY: yes` line.

### Step 5a: Executable-plan parseability guardrail

**Only when the parsed `status` is `approved` or `approved_with_concerns`**, validate that the plan file is executable by the same parser `execute-plan` would use before offering it to the user. `refine-plan` Step 9.7 already runs this same check before reporting an approved status, so under normal operation this is defense-in-depth — but `generate-plan` re-runs it locally so the execute-plan offer is gated on a fresh check against the on-disk plan (the plan-refiner may have made further edits during the commit gate, and the summary parsing path is permissive). Reviewers occasionally bless plans whose required-section labels use formatting that the executable-plan parser does not yet accept (e.g., legitimate content but a stray label-variant change); catching that here keeps the offer honest. Run:

```bash
pi-flow helper execute-plan/extract-plan-tasks --plan "<PLAN_PATH from refine-plan summary>" > /dev/null
```

Plan parsing via `extract-plan-tasks.py` is a sanctioned mechanical activity per [`skills/_shared/orchestrator-verification-boundary.md`](../_shared/orchestrator-verification-boundary.md) — this is parseability validation, not a re-judgment of the plan-refiner's verdict. On non-zero exit, surface the parser's stderr (a JSON `{"errors": [...]}` blob) verbatim to the user, prefix it with `generate-plan: approved plan is not executable —`, and skip the execute-plan offer. Report the refine-plan summary (status, commit, plan_path, review_paths, structural_only) so the user can inspect and re-refine. On exit 0, proceed to the offer below.

Then, **only when the parsed `status` is `approved` or `approved_with_concerns`** and the Step 5a parseability check passed, offer execute-plan:

> Plan written to `<PLAN_PATH>`. Want me to run execute-plan with this plan?

If `COMMIT: left_uncommitted` (which can happen on the approved paths only in standalone-style runs; auto-commit mode always commits on the approved path), prepend this note to the offer:

> Note: plan was left uncommitted. Proceeding with an uncommitted plan means edits made by execute-plan will land on top of an unstaged plan file.

Require explicit user confirmation before invoking execute-plan in that case. Do not auto-invoke execute-plan.

**When the parsed `status` is `not_approved_within_budget`** (whether `COMMIT: committed` from `(r) Save plan for manual review` or `COMMIT: left_uncommitted` from `(x) Stop execution`), do NOT offer execute-plan. Report the parsed summary (status, commit, plan_path, review_paths, structural_only) and stop. The user inspects the saved plan and review files manually; if they want to execute the unapproved plan, they invoke `execute-plan` themselves.

**When the parsed `status` is `failed`**, surface the `FAILURE_REASON` line to the user and skip the execute-plan offer until the underlying issue is resolved. Do not retry refine-plan automatically.

## Edge cases

- **Idea ID provided:** Read the idea body first with the built-in `idea` tool (`action: "read"`) and inline the full body in `{TASK_DESCRIPTION}`. The planner subagent does not have the `idea` tool, so the ID alone is not enough.
- **File path provided:** Pass by path via `{TASK_ARTIFACT}`. Do NOT inline the file body into `{TASK_DESCRIPTION}`. Only do a bounded preamble read (e.g., `head -n 40`) for provenance extraction. The planner reads the full artifact from disk.
- **Scout brief referenced but missing on disk:** Warn the user and continue planning without it. Do not block.
- **Refine-plan failures:** when refine-plan returns `STATUS: failed` (e.g. plan file missing, dispatch failure, review write failure), surface the `FAILURE_REASON` line to the user and skip the execute-plan offer until the underlying issue is resolved. Do not retry refine-plan automatically.
- **`docs/plans/` missing:** The subagent handles creating the directory; no action needed from the main agent.

## Scope note on path-based handoff

Path-based handoff in this skill applies to the initial `generate-plan -> planner` dispatch (Step 3); review/edit dispatches are now owned by `refine-plan` and follow `refine-plan`'s own handoff contract (which itself uses path-based handoff for the plan, task artifact, and scout brief). For the Step 3 dispatch, large durable artifacts — the original task artifact and any scout brief — are passed by filesystem path rather than inlined into the prompt. The planner reads them from disk per its input contract.

What remains inline:

- For idea and freeform runs, the original task description itself is inline in `{TASK_DESCRIPTION}` (Step 3). No temp artifact files are created just to force path-based handoff — idea/freeform inputs are not durable artifacts.
- Minimal provenance / safety metadata (`{SOURCE_IDEA}`, `{SOURCE_SPEC}`, `{SCOUT_BRIEF}`) stays inline.

`execute-plan` and `execute-plan -> coder` are out of scope for this handoff contract.
