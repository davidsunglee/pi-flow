# Scout Brief: Resolve test-runner temp-file artifact contract conflict

Source: IDEA-99deb337
Generated at: 2026-06-09T23:31:19Z
Git SHA: 8831fb0e682bbcd955f30a3f86a60bdb9e4e085f
Model: anthropic/claude-sonnet-4-6

## Relevant Files

Primary files containing the conflict:

- `packages/pi-flow-core/agents/test-runner.md` — Agent definition for the `test-runner` subagent. Contains `## Execution` (steps 1–6), `## Identifier-Extraction Contract`, `## Artifact Format`, `## Rules`, and `## Output Contract`.
- `packages/pi-flow-core/skills/_shared/test-runner-prompt.md` — Template dispatched by callers to `test-runner` subagents. Sections: `## Test Command`, `## Working Directory`, `## Artifact Output Path`, `{PHASE_SECTION}`, `## Task`, `## Output`, `## Rules`, `## Completion protocol`.

Supporting files (not directly changed, but form the broader contract):

- `packages/pi-flow-core/skills/_shared/test-runner-dispatch.md` — Documents the four-input dispatch protocol (`test_command`, `working_dir`, `artifact_path`, `phase_label`) used by callers. Step 5 parses the artifact handoff.
- `packages/pi-flow-core/skills/_shared/scripts/parse-test-runner-artifact.py` — Parses the structured artifact. Validates header order, identifier counts, raw-output marker. Unchanged by this fix.
- `packages/pi-flow-core/skills/_shared/scripts/tests/test_test_runner_prompt_assembly.py` — Tests phase-section presence/absence via `fill-template.py`. Covers template filling, not file-write contract.
- `packages/pi-flow-core/skills/_shared/scripts/tests/test_marker_emit_contract.py` — Asserts `TEST_RESULT_ARTIFACT` marker naming and `subagent_done(message=DONE_MESSAGE)` in both the agent and prompt. Does NOT cover the file-write or temp-file contract.
- `packages/pi-flow-core/skills/_shared/scripts/tests/test_completion_protocol_contract.py` — Guards tool-first completion wording across all runtime agents/prompts. Does NOT cover file-write contract.
- `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs` — Node.js tests asserting guardrail strings in SKILL.md files. Does NOT currently assert anything about the test-runner agent or prompt file-write contract.
- `packages/pi-flow-core/skills/execute-plan/SKILL.md` — Primary caller; dispatches `test-runner` at Steps 7, 12.2, 12 (Debugger-first), and 16. The caller boundary is mentioned but not modified by this fix.

## Key Interfaces and Types

**Input contract** (`test-runner.md`, `## Input Contract`):
- `## Test Command` — exact shell command, must reach `bash` byte-for-byte.
- `## Working Directory` — absolute path, sole `cd` target.
- `## Artifact Output Path` — absolute path, **the one and only** permissible write destination per dispatch.
- `## Phase Label` — optional; written into `PHASE:` header when present.

**Conflicting execution guidance** (`test-runner.md`, `## Execution`, step 2):
```
Recommended approaches, in order of preference:
  - Write ## Test Command verbatim to a temporary script file and execute it
    with `bash <script>`, appending 2>&1 to merge stderr into stdout.
  - Or pipe the command verbatim into bash via stdin (e.g. a heredoc whose body
    is exactly ## Test Command followed by no transformation), again with stderr
    merged into stdout.
```
Option 1 (temp-file write) is listed as **preferred**. Option 2 (heredoc) is listed as fallback.

**File-write constraint** (`test-runner.md`, `## Rules`, line ~135):
```
Perform exactly ONE write to ## Artifact Output Path per dispatch.
Do not append, overwrite, or write to any other path.
```

**Additional command constraint** (`test-runner.md`, `## Rules`, line ~138):
```
Do NOT modify any source file; do NOT run `git` commands; do NOT run any
command other than the supplied ## Test Command.
```

**Prompt file-write constraint** (`test-runner-prompt.md`, `## Task` section):
```
Write the artifact exactly once to the path in ## Artifact Output Path …
Do NOT modify any other file. Do NOT run `git`, `mkdir`, or any other
command beyond the supplied test command.
```

**Prompt single-write rule** (`test-runner-prompt.md`, `## Rules`):
```
Perform exactly ONE write to ## Artifact Output Path per dispatch.
```

**Artifact format** (unchanged; defined in `test-runner.md`, `## Artifact Format`):
Structured plaintext with `COMMAND:`, `WORKING_DIRECTORY:`, `EXIT_CODE:`, `TIMESTAMP:`, `FAILING_IDENTIFIERS:…END_FAILING_IDENTIFIERS`, `NON_RECONCILABLE_FAILURES:…END_NON_RECONCILABLE_FAILURES`, `--- RAW RUN OUTPUT BELOW ---`. Optional `PHASE:` header when phase label is supplied.

**Artifact parser** (`parse-test-runner-artifact.py`): Validates structure via fixed header-order walk. The parser is unaffected by execution mechanism changes.

## Dependency / Call Graph

```
execute-plan/SKILL.md (Steps 7, 12.2, 12-debugger, 16)
  └─ test-runner-dispatch.md          ← dispatcher protocol
       ├─ fills test-runner-prompt.md ← dispatched task prompt
       │    └─ references test-runner.md (agent definition) as source of truth
       └─ calls subagent_run_serial { agent: "test-runner" }
            └─ agents/test-runner.md  ← agent system-prompt append
                 ├─ ## Execution step 2 → [CONFLICT: temp-file vs. single-write]
                 └─ ## Rules           → single write to Artifact Output Path

parse-test-runner-artifact.py         ← parses structured artifact (unaffected)
reconcile-test-run.py                 ← reconciles identifiers (unaffected)
```

The agent definition (`test-runner.md`) is appended to the system prompt via `system-prompt: append` in the YAML front-matter. The dispatched prompt (`test-runner-prompt.md`) is the task body. When a backend runs the `test-runner` agent, both files are visible to the subagent simultaneously, so they must be internally consistent.

## Patterns and Conventions

**Backend-neutrality:** All other agent prompts in this repo avoid assuming a specific invocation model. The test-runner agent similarly lists `tools: bash, write, read` without prescribing which backend provides them.

**Single-artifact-write as a blanket rule:** Every other agent/prompt pair (scout, spec-designer, planner, code-reviewer, etc.) enforces exactly one durable write per dispatch. The test-runner's own Rules section already codifies this. The conflict is that one instruction sub-section (step 2) contradicts this blanket rule.

**Guardrail test pattern:** `guardrail-strings.test.mjs` checks exact string presence/absence in skill and shared-path files using `content.includes(string)`. It uses helper functions `skillPath(skill)` and `sharedPath(file)` but no `agentPath` function — any new guardrail for agent files would need a new helper or inline path resolution.

**Python test pattern:** `test_marker_emit_contract.py` already reads both `packages/pi-flow-core/agents/test-runner.md` and `packages/pi-flow-core/skills/_shared/test-runner-prompt.md` via the `read(rel_path)` helper. This is the most natural extension point for a file-write contract guardrail, requiring no new file imports or helpers.

**Heredoc/stdin is the established safe pattern:** The agent already documents heredoc as a viable option (step 2, option 2). The principle that stdin/heredoc is a shell-level construct that does not write to the filesystem is well understood; no backend-specific wording should be required.

**`sync-completion-protocol.py` pattern:** Managed regions in runtime files are generated from a canonical source and tested via `test_completion_protocol_contract.py`. The file-write contract is not a managed region; it lives in the free-form body of both files and is tested by hand-authored guardrails.

## Existing Tests and Test Patterns

| Test file | Coverage | Covers file-write contract? |
|---|---|---|
| `scripts/tests/test_test_runner_prompt_assembly.py` | Phase-section placeholder fill | No |
| `scripts/tests/test_marker_emit_contract.py` | Marker naming (`TEST_RESULT_ARTIFACT`), `subagent_done(message=DONE_MESSAGE)` in both agent and prompt | No |
| `scripts/tests/test_completion_protocol_contract.py` | Tool-first completion wording, DONE_MESSAGE contract, shared snippet byte-equality | No |
| `scripts/tests/test_parse_test_runner_artifact.py` | Artifact parsing, format validation, freshness fallback | No |
| `__tests__/guardrail-strings.test.mjs` | Guardrail strings in SKILL.md files (does not currently read agent definitions) | No |

**Gap:** There is currently no test that:
1. Asserts the agent does NOT recommend temp-file writes (would catch re-introduction of the conflicting guidance).
2. Asserts the agent and prompt both carry the no-other-write rule.
3. Asserts both files agree that stdin/heredoc is the documented execution mechanism.

The most idiomatic location for this guardrail is a new `TestFileWriteContract` class added to `scripts/tests/test_marker_emit_contract.py`, which already has the `read(rel_path)` helper and imports both test-runner files as subjects.

## Risk Areas

1. **Ambiguity in "no other command"**: Both the agent's Rules section and the prompt's Task section say "do NOT run any command other than the supplied test command." A subagent may interpret `bash <<'EOF' … EOF` (heredoc) as "running another command" (`bash`) rather than as a single mechanism for executing the supplied command. The fix should explicitly state that invoking `bash` via stdin/heredoc is the sanctioned mechanism for executing the test command — not a separate "other command."

2. **Heredoc delimiter collision**: If the supplied test command contains the heredoc delimiter string (e.g. the command includes a literal `EOF`), the heredoc would terminate early and the command would be corrupted. The agent should recommend a randomised or well-chosen delimiter (e.g. `TESTCMD_EOF`) or the `bash -s` + `printf '%s'` pattern. This is a pre-existing risk (option 2 already exists) but the fix promotes it to the sole compliant mechanism, making this more visible.

3. **Test guardrail brittleness**: A simple `assertIn("heredoc", body)` or `assertNotIn("temporary script file", body)` may become stale if wording is paraphrased. Consider checking for the more specific phrase that must NOT appear (e.g. "temporary script file") rather than requiring a specific positive phrasing, to give authors flexibility in wording the compliant approach.

4. **Agent/prompt source-of-truth hierarchy**: The prompt's `## Task` section defers execution mechanics to the agent definition ("via `bash`" with no mechanism specified), while the agent's `## Execution` section contradicts its own `## Rules`. After the fix, the prompt still defers to the agent, which is correct — but the agent needs to be internally consistent first.

5. **No-op risk if only one file is updated**: Updating only the agent without updating the prompt (or vice versa) would leave partial conflicts. Both files must agree, and a single-pass test asserting both is the safest guard.

## Possible Misses

- **Installed node_modules copy**: `packages/pi-flow/node_modules/@aphotic/pi-flow-core/` is a separate installed copy of the package. Changes to the source under `packages/pi-flow-core/` do not automatically propagate to the installed copy. The guardrail tests and the runtime dispatch both use the installed copy via `pi-flow helper`. However, since the test suite under `packages/pi-flow-core/__tests__/` reads from the source package directory via `PKG_DIR`, the tests will validate the source. The installed copy is updated by `pnpm install`; this is out of scope for the fix itself but should be noted in the commit.

- **`_shared/test-runner-dispatch.md` caller notes**: This dispatch document describes the four inputs and says "passed verbatim to test-runner; no flag injection, no expansion, no splitting." It does not specify execution mechanism. It is not a source of conflict and does not need to change, but reviewers should confirm it doesn't need a cross-reference note.

- **Other dispatch patterns**: A search for callers of `test-runner-prompt.md` (by grep on `test-runner-prompt`) found only `test-runner-dispatch.md` as the documented dispatch layer. No non-`execute-plan` callers currently exist (per the dispatch doc). This is consistent with the claim that the fix is localized to the two primary files.

- **`test_test_runner_prompt_assembly.py` scope**: This test invokes `fill-template.py` on the prompt and checks output. After the fix, if the prompt's Task section is clarified to explicitly mention stdin/heredoc, the existing tests will continue to pass (they only check for `## Phase Label` presence/absence). No updates to this test are required.

## Open Questions / Ambiguities

1. **Recommended heredoc delimiter**: The fix needs to pick a specific heredoc delimiter recommendation that is unlikely to appear in real test commands. `TESTCMD_EOF` or `_END_TEST_COMMAND_` are candidates. Should the prompt include an example snippet, or leave the exact syntax to the agent definition?

2. **Explicit stdin/heredoc allowance in the prompt**: The prompt's `## Rules` says "Do NOT run any command other than the supplied test command." Should the fix add a sentence like "Running the supplied test command via `bash` stdin or heredoc is the sanctioned execution mechanism and is not considered a separate command"? Or is deferring to the agent definition (which already says "via `bash`") sufficient?

3. **Backend neutrality**: The `bash` tool is listed in the agent's YAML front-matter (`tools: bash, write, read`). The heredoc syntax is universally supported by bash. No backend-specific wording appears to be needed. Confirm this assumption holds for all pi-supported backends before finalizing.

4. **Scope of "no other command" in the agent's Rules**: After removing the temp-file recommendation, the rule "Do NOT run any command other than the supplied `## Test Command`" needs to be read carefully. Does this now mean the subagent cannot invoke `bash` at all except for the one test command? The intent is presumably "no other shell commands for unrelated purposes (git, mkdir, etc.)" rather than "do not invoke bash." The rule may need a small editorial clarification.

5. **Temp-file cleanup**: If a future author re-introduces a temp-file approach "for safety," should there be an explicit prohibition? A guardrail test asserting the absence of "temporary script file" (or similar) would close this loop without requiring the prohibition to be spelled out in prose in the file itself.
