# Plan Edit Task

Surgically edit the existing plan below based on the review findings. Preserve correct sections — only modify what the findings call out.

## Review Findings

The following errors were identified by the plan reviewer. Address each one:

{REVIEW_FINDINGS}

## Provenance

{PLAN_ARTIFACT}

{TASK_ARTIFACT}

{SOURCE_TODO}

{SOURCE_SPEC}

{SCOUT_BRIEF}

## Original Spec (inline)

{ORIGINAL_SPEC_INLINE}

## Artifact Reading Contract

- A `Plan artifact: <path>` line in `## Provenance` is always present. Read the existing plan file in full from disk before editing — this is the plan you are editing in place. The plan body is NOT inlined here.
- If a `Task artifact: <path>` line appears in `## Provenance`, that file on disk is the authoritative original task specification. Read it in full from disk for reference. Do not assume its body is quoted anywhere in this prompt.
- If a `Scout brief: docs/briefs/<filename>` line appears in `## Provenance`, read that brief from disk as well and treat it as primary reference context. If the brief file is missing on disk, note it and continue — do not abort.
- If no `Task artifact:` line appears, the original task description is contained inline in `## Original Spec (inline)` above (todo/freeform case).
- If both `Task artifact:` is present and `## Original Spec (inline)` is non-empty, prefer the on-disk artifact as authoritative and ignore the inline section.

## Output

Write the edited plan to `{OUTPUT_PATH}` (overwrite the existing file).

## Instructions

1. Read each finding carefully
2. Make the minimum change needed to resolve each error
3. Do NOT rewrite sections that are not flagged
4. Do NOT add new tasks unless a finding explicitly identifies a missing task
5. Do NOT remove tasks unless a finding explicitly identifies scope creep
6. If a finding cites a missing `Verify:` line on an acceptance criterion, add a concrete `Verify:` recipe on the next line under that criterion using the strict two-line structure defined in the planner contract (one criterion → one `Verify:` line). Do not delete the criterion, and do not add a stub recipe like `Verify: check this`.
7. If a finding cites a placeholder `Verify:` recipe ("check the file", "verify manually", "looks right", "confirm it works"), replace it with a recipe that names the artifact and the success condition (command + expected exit, grep pattern + expected match, file + expected content, or an explicit prose inspection).
8. **Fenced example authoring rule:** When an example payload in a step or criterion contains triple backticks (` ``` `), prefer `~~~` for the outer fence. If the payload already contains `~~~` runs, use a backtick fence strictly longer than the longest backtick run in the payload (e.g., ```` ```` ```` when the payload contains ` ``` `).
