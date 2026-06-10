# Test Runner Prompt

<!-- Completion source: packages/pi-flow-core/skills/_shared/completion-protocol.md -->

Prompt template dispatched to `test-runner` subagents for executing a test suite and capturing failing-test identifiers. Fill placeholders before sending. Do not add sections beyond what this template defines.

## Test Command

{TEST_COMMAND}

## Working Directory

{WORKING_DIR}

## Artifact Output Path

{ARTIFACT_PATH}

{PHASE_SECTION}

## Task

Run the test command from `## Test Command` exactly as supplied, from the directory in `## Working Directory`, via `bash`. Capture combined stdout+stderr and the exit code.

Apply the Step 7 identifier-extraction contract (per the verbatim documentation in your agent definition) to derive the set of failing-test identifiers. Your agent definition is the source of truth for what counts as a stable suite-native identifier, including any narrow per-runner exceptions documented there (e.g. the Go package-qualified `<package>.<TestName>` construction). Apply NO normalization (no lowercasing, no reordering, no whitespace fixups beyond stripping surrounding whitespace) and invent NO ad-hoc identifiers beyond what the contract explicitly permits. For any failure with no stable suite-native identifier under that contract (e.g. a crash before test names, a build / collection error), record the failure under `NON_RECONCILABLE_FAILURES:` per the contract in your agent definition rather than inventing an identifier.

Write the artifact exactly once to the path in `## Artifact Output Path` using the format documented in your agent definition (`## Artifact Format`) — including BOTH the `FAILING_IDENTIFIERS:` block (stable identifiers) and the `NON_RECONCILABLE_FAILURES:` block (non-reconcilable evidence) in the documented order, with the value from `## Phase Label` filled into the `PHASE:` header line when that section is present; if the `## Phase Label` section is absent in this prompt, omit the `PHASE:` header line from the artifact entirely. Do NOT create or modify any file other than the artifact at `## Artifact Output Path` — in particular, do not write the test command to a scratch file or any other path. Running the supplied test command by feeding it to `bash` on standard input / via a heredoc (the sanctioned mechanism documented in your agent definition's `## Execution` step 2) is NOT a forbidden "other command"; ephemeral shell constructs that create no filesystem artifact are permitted. Do NOT run `git`, `mkdir`, ad hoc file reads, or any command unrelated to the supplied test command. The orchestrator has already created the parent directory for the artifact path.

## Output

Completion is tool-first: the `subagent_done` tool call — not the artifact write, not the visible marker line — is the completion signal.

Set DONE_MESSAGE to `TEST_RESULT_ARTIFACT: <absolute path>` where `<absolute path>` is character-for-character identical to the path in `## Artifact Output Path`. Emit DONE_MESSAGE visibly as exactly one anchored line on its own line, as the very last visible line of your output, immediately before the tool call.

Then call `subagent_done(message=DONE_MESSAGE)` — i.e. `subagent_done(message="TEST_RESULT_ARTIFACT: <absolute path>")` — as your terminal tool action. The `message` argument MUST be byte-equal to the visible marker line. The visible marker line alone is not completion. Do not end the session by sending a final answer alone, and do not emit further output after `subagent_done`. Emitting both channels ensures the marker reaches the orchestrator regardless of which channel the watcher reads. If this environment's `subagent_done` tool has no `message` argument, call `subagent_done()` immediately after the visible marker line.

Do not emit any other structured markers in your response (no `STATUS:`, no other anchored lines).

## Rules

- Run the test command from `## Test Command` exactly as supplied — do NOT add flags, expand variables, paraphrase, or split commands.
- Run from `## Working Directory` only.
- Perform exactly ONE write to `## Artifact Output Path` per dispatch.
- Do NOT consult or mention `baseline_failures`, prior runs, or any cross-wave state.
- Record any failure that has no stable suite-native identifier under NON_RECONCILABLE_FAILURES per the contract — never as a raw line in FAILING_IDENTIFIERS.
- Do NOT classify the run as pass/fail. Reconciliation is the caller's responsibility.
- Do NOT modify any source file, and do NOT create or write any file other than the artifact at `## Artifact Output Path`. Running the supplied test command via `bash` standard input / heredoc (per your agent definition's `## Execution` step 2) is the sanctioned execution mechanism, not a forbidden "other command"; ephemeral shell constructs that create no filesystem artifact are permitted. Do NOT run `git`, `mkdir`, ad hoc reads, or any command unrelated to the supplied test command from `## Test Command`.
- Visible output ends with the DONE_MESSAGE marker line `TEST_RESULT_ARTIFACT: <absolute path>` emitted immediately before the tool call, AND `subagent_done(message=DONE_MESSAGE)` is the terminal tool call. Both strings byte-equal. The tool call is the completion signal; the visible marker line alone is not completion. No other structured markers anywhere in the response.

## Completion protocol

<!-- BEGIN completion-protocol:marker-core (generated from packages/pi-flow-core/skills/_shared/completion-protocol.md; regenerate with skills/_shared/scripts/sync-completion-protocol.py --apply) -->
The `subagent_done` tool call is the completion signal: the visible marker line alone is not completion. Do not end the session by sending a final answer alone, and do not emit further output after `subagent_done`. If this environment's `subagent_done` tool has no `message` argument, call `subagent_done()` immediately after the visible marker line.
<!-- END completion-protocol:marker-core -->
