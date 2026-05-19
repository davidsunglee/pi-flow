# Plan Generation Task

Analyze the codebase at `{WORKING_DIR}` and produce a structured implementation plan.

## Task

{TASK_DESCRIPTION}

## Provenance

{TASK_ARTIFACT}

{SOURCE_TODO}

{SOURCE_SPEC}

{SCOUT_BRIEF}

## Artifact Reading Contract

- If a `Task artifact:` line appears in `## Provenance`, that file on disk is the authoritative task specification. Read it in full from disk before planning. The orchestrator has NOT inlined its contents into this prompt — do not assume the task body is quoted in `## Task` above.
- If a `Scout brief:` line appears in `## Provenance`, read that brief file from disk as well and treat it as primary context alongside the task artifact. Its contents are also NOT inlined here.
- If a referenced scout brief file is missing on disk, note it in your analysis and continue planning without it.
- If neither `Task artifact:` nor `Scout brief:` is present, the task body is fully contained in the `## Task` section above.

## Output

Write the plan to `{OUTPUT_PATH}`.

Create the directory if it doesn't exist.

## Completion contract

After the plan write succeeds, your final assistant message MUST end with a single anchored line on its own line as the very last line of output:

```
PLAN_ARTIFACT: {OUTPUT_PATH}
```

Requirements for this line:
- No surrounding backticks on the line itself.
- No trailing commentary on the same line.
- The path is character-for-character identical to the supplied `{OUTPUT_PATH}` above.

In addition to the final-assistant-message marker line above, call `subagent_done(message="PLAN_ARTIFACT: {OUTPUT_PATH}")` as your terminal tool action. The two strings — the final-assistant-message marker line and the `subagent_done` message — must be byte-equal. The orchestrator's watcher prefers the `subagent_done` sentinel when present, then falls back to the transcript's last assistant message; emitting both ensures the marker reaches the parent regardless of which channel the watcher reads.

The orchestrator parses this line to validate the plan write before handing off to refine-plan. The file write tool result alone is insufficient — the marker line must reach the parent through at least one of the two channels.
