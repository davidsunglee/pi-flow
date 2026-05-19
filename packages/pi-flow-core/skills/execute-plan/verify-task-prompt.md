# Verify Task Prompt

Prompt template dispatched to `verifier` subagents for a single plan task. Fill placeholders before sending. Do not add sections beyond what this template defines.

## Task Spec

{TASK_SPEC}

## Acceptance Criteria

{ACCEPTANCE_CRITERIA_WITH_VERIFY}

## Phase 1 Verification Recipes

The orchestrator has extracted every command-style `Verify:` recipe from the `## Acceptance Criteria` section above and listed them below, numbered to match the criterion index in that section. In Phase 1 of your dispatch you MUST execute each recipe BYTE-EQUAL VERBATIM from `## Working Directory` via `bash`, capture stdout + stderr + exit code (per the per-stream 200-line / 20 KB truncation rule documented in your agent definition), and emit one `[Evidence for Criterion N]` block per recipe under a top-level `## Phase 1 Evidence` heading in your response.

Recipe-verbatim discipline (per your agent definition): you MAY run commands ONLY when they exactly match a recipe text byte-equal from this section. You MUST NOT run any other commands. You MUST NOT re-run a command after capturing its output. You MUST NOT add flags, expand variables, or otherwise transform the recipe text.

{PHASE_1_RECIPES}

If this section is empty, the task has no command-style recipes — skip Phase 1 entirely and proceed to Phase 2 judgment using `## Verifier-Visible Files` and any files explicitly named by file-inspection / prose-inspection recipes.

## Verifier-Visible Files

The orchestrator has assembled the list below as the authoritative file set for this verification. It is the deduplicated union of:

1. The task's declared `**Files:**` scope from the plan (authoritative — the task is on the hook for every file it claimed),
2. The worker's self-reported `## Files Changed` (informative but NOT authoritative on its own), and
3. Orchestrator-observed changes in the working tree for this task (via `git status --porcelain` and `git diff HEAD`).

Do NOT treat this list as a worker self-report. A worker that omits a file from its own `## Files Changed` cannot narrow this set, and a file declared in the task's `**Files:**` scope always appears here even if the worker claims it was untouched.

For file-inspection recipes, read only these files plus any files explicitly named by a specific `Verify:` recipe. Do not browse the codebase.

{MODIFIED_FILES}

## Diff Context

The orchestrator may have truncated this diff if it exceeded a size threshold. If you see a truncation marker line in the diff — any single line indicating that diff content was omitted — note this in your per-criterion `reason:` where it affects judgment, and fall back to reading the file(s) in `## Verifier-Visible Files` directly for any file-inspection criterion whose relevant code may lie in the truncated window.

{DIFF_CONTEXT}

## Working Directory

Operate from: `{WORKING_DIR}`

All paths in this prompt are relative to that directory unless otherwise stated.

## Rules

- Two-phase: in Phase 1 you MAY run bash, but ONLY to execute command-style `Verify:` recipes from `## Phase 1 Verification Recipes` byte-equal verbatim. In Phase 2 (judgment) you do NOT run any commands; you cite the Phase 1 evidence blocks for command-style criteria and read files in `## Verifier-Visible Files` (plus recipe-named files) for file-inspection / prose-inspection criteria.
- Do NOT read files outside `## Verifier-Visible Files` unless a `Verify:` recipe explicitly names them by path.
- Every criterion gets a binary verdict: `PASS` or `FAIL`. Any `FAIL` means the overall verdict is `FAIL`.
- If evidence is missing, return `FAIL` with `reason:` explaining what is missing. Do not guess.

## Report Format

Use this exact structure:

Omit the `## Phase 1 Evidence` heading entirely when no command-style recipes ran. The `## Per-Criterion Verdicts` and `## Overall Verdict` sections always appear and their format is unchanged byte-for-byte.

```
## Phase 1 Evidence

[Evidence for Criterion N]
  command: <exact recipe text>
  exit_code: <integer>
  stdout:
    ```
    <captured>
    ```
  stderr:
    ```
    <captured>
    ```

## Per-Criterion Verdicts

[Criterion 1] <PASS | FAIL>
  recipe: <the Verify: recipe text>
  evidence: <Evidence for Criterion N, file path + line range, or diff hunk>
  reason: <one or two sentences>

[Criterion 2] <PASS | FAIL>
  recipe: ...
  evidence: ...
  reason: ...

## Overall Verdict

VERDICT: <PASS | FAIL>
summary: <one paragraph>
```
