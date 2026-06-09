# Plan Generation Task

<!-- Completion source: packages/pi-flow-core/skills/_shared/completion-protocol.md -->

Analyze the codebase at `{WORKING_DIR}` and produce a structured implementation plan.

## Task

{TASK_DESCRIPTION}

## Provenance

{TASK_ARTIFACT}

{SOURCE_IDEA}

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

Completion is tool-first: the `subagent_done` tool call — not the file write, not the visible marker line — is the completion signal.

After the plan write succeeds:

1. Set DONE_MESSAGE to:

   ```
   PLAN_ARTIFACT: {OUTPUT_PATH}
   ```

   The path is character-for-character identical to the supplied `{OUTPUT_PATH}` above.

2. Emit DONE_MESSAGE visibly on its own line as the very last visible line of your output — no surrounding backticks on the line itself, no trailing commentary on the same line — immediately before the tool call.

3. Then call `subagent_done(message=DONE_MESSAGE)` — i.e. `subagent_done(message="PLAN_ARTIFACT: {OUTPUT_PATH}")` — as your terminal tool action. The `message` argument must be byte-equal to the visible marker line.

The file write tool result alone is insufficient. The orchestrator's watcher prefers the `subagent_done` sentinel when present, then falls back to the transcript's last assistant message; emitting both channels ensures the marker reaches the parent, which parses it to validate the plan write before handing off to refine-plan.

<!-- BEGIN completion-protocol:marker-core (generated from packages/pi-flow-core/skills/_shared/completion-protocol.md; regenerate with skills/_shared/scripts/sync-completion-protocol.py --apply) -->
The `subagent_done` tool call is the completion signal: the visible marker line alone is not completion. Do not end the session by sending a final answer alone, and do not emit further output after `subagent_done`. If this environment's `subagent_done` tool has no `message` argument, call `subagent_done()` immediately after the visible marker line.
<!-- END completion-protocol:marker-core -->
