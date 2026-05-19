# Test Runner Prompt

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

Write the artifact exactly once to the path in `## Artifact Output Path` using the format documented in your agent definition (`## Artifact Format`) — including BOTH the `FAILING_IDENTIFIERS:` block (stable identifiers) and the `NON_RECONCILABLE_FAILURES:` block (non-reconcilable evidence) in the documented order, with the value from `## Phase Label` filled into the `PHASE:` header line when that section is present; if the `## Phase Label` section is absent in this prompt, omit the `PHASE:` header line from the artifact entirely. Do NOT modify any other file. Do NOT run `git`, `mkdir`, or any other command beyond the supplied test command. The orchestrator has already created the parent directory for the artifact path.

## Output

End your final assistant message with exactly one anchored line on its own line, as the very last line of your output: `TEST_RESULT_ARTIFACT: <absolute path>` where `<absolute path>` is character-for-character identical to the path in `## Artifact Output Path`.

Then, as your terminal tool action, call `subagent_done(message="TEST_RESULT_ARTIFACT: <absolute path>")`. The `message` argument MUST be byte-equal to the final-assistant-message marker line above. Emitting both channels ensures the marker reaches the orchestrator regardless of which channel the watcher reads.

Do not emit any other structured markers in your response (no `STATUS:`, no other anchored lines).

## Rules

- Run the test command from `## Test Command` exactly as supplied — do NOT add flags, expand variables, paraphrase, or split commands.
- Run from `## Working Directory` only.
- Perform exactly ONE write to `## Artifact Output Path` per dispatch.
- Do NOT consult or mention `baseline_failures`, prior runs, or any cross-wave state.
- Record any failure that has no stable suite-native identifier under NON_RECONCILABLE_FAILURES per the contract — never as a raw line in FAILING_IDENTIFIERS.
- Do NOT classify the run as pass/fail. Reconciliation is the caller's responsibility.
- Do NOT modify any source file; do NOT run `git` commands; do NOT run any command other than the supplied test command from `## Test Command`.
- Final assistant message ends with `TEST_RESULT_ARTIFACT: <absolute path>`, AND `subagent_done(message="TEST_RESULT_ARTIFACT: <absolute path>")` is the terminal tool call. Both strings byte-equal. No other structured markers anywhere in the response.
