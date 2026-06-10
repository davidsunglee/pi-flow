# Plan: test-runner file-write contract fix + verifier protocol-tolerant PASS path

## Goal

Remove two false-failure sources in the pi-flow execution pipeline in one coordinated change. **Part A** makes the `test-runner` agent definition and its dispatched prompt internally consistent about file writes: it deletes the conflicting "write the command to a temporary script file" recommendation, makes feeding the command to `bash` via stdin/heredoc the sole sanctioned execution mechanism (with delimiter-collision guidance and the existing byte-preservation guarantee retained), and resolves the latent "no other command" ambiguity so a literal reader cannot conclude that invoking `bash` is forbidden. **Part B** adds a deterministic, fully-enumerated tolerant classification pass inside `parse-verifier-report.py` so a verifier report that presents complete, unambiguous PASS evidence for every acceptance criterion is accepted as a semantic PASS (with protocol warnings) instead of being rejected — and a retry burned — solely for syntactic deviations; the orchestrator accepts that outcome automatically and surfaces the warnings, and Step 13 gains a user-gated `Verify:`-recipe amendment escape hatch. Both parts keep the fail-closed posture: ambiguous, missing, or substantively-defective evidence still fails, and no LLM or orchestrator judgment is introduced in either path.

## Architecture summary

The two parts are independent subsystems that share no code, so they proceed in parallel and are gated by the same per-wave integration suite.

- **Part A (instruction + guardrail).** `agents/test-runner.md` is appended to the subagent's system prompt; `skills/_shared/test-runner-prompt.md` is the dispatched task body. Both are visible to the subagent at once, so they must agree. The fix edits the agent's `## Execution` step 2 and `## Rules`, and the prompt's `## Task` and `## Rules`, then adds a Python guardrail (`TestFileWriteContract`) to the existing `test_marker_emit_contract.py` that reads both files and asserts the forbidden temp-file phrase is absent and the single-artifact-write rule is present in each. The artifact format, `parse-test-runner-artifact.py`, the `TEST_RESULT_ARTIFACT` marker/completion protocol, and the four-input dispatch contract are untouched.
- **Part B (in-parser tolerance + routing docs).** `parse-verifier-report.py` keeps its strict parse as the primary path (byte-for-byte unchanged output for strict-format reports) and gains a deterministic second pass, `classify_report_tolerant`, invoked only when strict parsing found defects. The second pass classifies every defect as protocol-only or substantive against a closed enumeration and grants a semantic PASS iff all defects are protocol-only **and** every criterion has complete, unambiguous PASS evidence (every command-style criterion's `command` matches its recipe after surrounding-whitespace strip, with integer `exit_code == 0`). The new outcome is a distinct `verdict` value (`PASS_WITH_PROTOCOL_WARNINGS`) plus a `protocol_warnings` array; exit code 0. `execute-plan/SKILL.md` Step 11.2 routes the three outcomes (auto-accepting the tolerant one and surfacing warnings), Step 13 adds the user-gated recipe-amendment option, `acceptance-criteria-verification.md` step f and `orchestrator-verification-boundary.md` are updated to match, and `__tests__/guardrail-strings.test.mjs` pins the new routing strings.

The two parts land across two dependency waves. Wave 1 commits the Part A instruction edits and the atomic Part B parser+fixtures+tests change together; both keep the full `@aphotic/pi-flow-core` suite green at the post-wave integration gate. Wave 2 commits the additive Part A guardrail test and the Part B routing/boundary documentation (plus its guardrail-string pins), which assert state already established in wave 1.

## Tech stack

- **Python 3** — helper scripts (`parse-verifier-report.py`, `extract-plan-tasks.py`) and `unittest` test suites under `skills/**/scripts/tests/`, discovered and run by `scripts/run-helper-tests.ts` (the `test:helpers` npm script).
- **Node.js (node:test)** — `__tests__/guardrail-strings.test.mjs` (the `test:node` script).
- **Markdown** — agent definitions (`agents/*.md`), shared prompt templates and docs (`skills/_shared/*.md`), and skill docs (`skills/execute-plan/*.md`).
- **Shared parsing utilities** — `skills/_shared/scripts/fence_aware.py` (`compute_in_fence_lines`, `split_h2_sections`, `FENCE_RE`), imported by both parsers; the tolerant pass reuses it so fenced payload is never treated as structure.
- **pnpm workspace** — `@aphotic/pi-flow-core` package; tests run via `pnpm --filter @aphotic/pi-flow-core test` (`test:node` + `test:helpers`).

**Spec:** `docs/specs/2026-06-09-create-one-combined-implementation-spec-for-idea-99deb337.md`

Scout briefs consulted (referenced by the spec; not in this plan's provenance block): `docs/briefs/IDEA-99deb337-brief.md` (Part A) and `docs/briefs/IDEA-4e20148e-brief.md` (Part B).

## File Structure

- `packages/pi-flow-core/agents/test-runner.md` (Modify) — Rewrite `## Execution` step 2 to make stdin/heredoc the sole execution mechanism (no temp file), add heredoc-delimiter-collision guidance, retain the byte-preservation guarantee; clarify the `## Rules` "no other command" line so invoking `bash` to run the supplied command is sanctioned, not forbidden.
- `packages/pi-flow-core/skills/_shared/test-runner-prompt.md` (Modify) — Clarify `## Task` and `## Rules` so they explicitly resolve the "no other command" ambiguity (stdin/heredoc sanctioned; no file written other than the artifact); no temp-file mention.
- `packages/pi-flow-core/skills/_shared/scripts/tests/test_marker_emit_contract.py` (Modify) — Add a `TestFileWriteContract` class asserting both files lack the temp-script-file phrase and both carry the single-artifact-write rule and document a stdin/heredoc mechanism.
- `packages/pi-flow-core/skills/execute-plan/scripts/parse-verifier-report.py` (Modify) — Add `classify_report_tolerant(...)`; restructure `main()` into strict-clean vs. tolerant-second-pass branches; emit the `PASS_WITH_PROTOCOL_WARNINGS` verdict and `protocol_warnings` field for the tolerant outcome only; preserve byte-for-byte output and exit codes for strict PASS and every FAIL.
- `packages/pi-flow-core/skills/execute-plan/scripts/tests/fixtures/verifier-report-protocol-warnings.md` (Create) — Constructed `f6eac473`-style fixture: every criterion explicitly PASS, successful command evidence, multiple protocol-only formatting defects.
- `packages/pi-flow-core/skills/execute-plan/scripts/tests/test_parse_verifier_report.py` (Modify) — Update the now-tolerated existing tests; add tolerant-outcome tests for each enumerated protocol-only variant; add hard-FAIL preservation tests; assert three-way output distinguishability.
- `packages/pi-flow-core/skills/execute-plan/SKILL.md` (Modify) — Step 11.2 three-outcome routing with automatic acceptance + warning surfacing; Step 13 user-gated recipe-amendment menu option and procedure.
- `packages/pi-flow-core/skills/execute-plan/acceptance-criteria-verification.md` (Modify) — Step f updated from "treat any protocol errors as FAIL" to the tolerant-aware routing.
- `packages/pi-flow-core/skills/_shared/orchestrator-verification-boundary.md` (Modify) — Add the narrow user-directed recipe-amendment carve-out as the sole sanctioned plan edit during orchestration.
- `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs` (Modify) — Pin the new Step 11.2 / Step 13 routing strings and the boundary carve-out heading.

## Tasks

### Task 1 — Fix test-runner.md execution + rules wording (Part A)

**Files:**
- Modify: `packages/pi-flow-core/agents/test-runner.md`

**Steps:**

- [ ] **Step 1: Orient.** Read `packages/pi-flow-core/agents/test-runner.md`, focusing on `## Execution` step 2 (lines ~33-37) and the `## Rules` line "Do NOT modify any source file; do NOT run `git` commands; do NOT run any command other than the supplied `## Test Command`." (line ~139). Do NOT touch `## Execution` step 4, the `## Rules` "Perform exactly ONE write to `## Artifact Output Path` per dispatch." line, `## Artifact Format`, the marker lines, or the completion-protocol managed region (the `<!-- BEGIN completion-protocol:marker-core -->` block).

- [ ] **Step 2: Replace Execution step 2.** Replace the entire step-2 bullet (the paragraph plus the two "Recommended approaches" sub-bullets) with text that makes stdin/heredoc the sole mechanism, creates no filesystem artifact, retains byte preservation, and adds delimiter-collision guidance. Use exactly this replacement:

~~~~
2. Execute `## Test Command` exactly as supplied in a `bash` shell, capturing combined stdout and stderr and the exit code. Do NOT wrap the supplied command in single quotes (or any other quoting) — quoting the command can corrupt commands that themselves contain quote characters (e.g. `pytest -k 'not slow'`). Instead, feed the supplied command text verbatim to `bash` on standard input, creating no temporary file and no other filesystem artifact. The sanctioned mechanism is a heredoc whose body is exactly `## Test Command` with stderr merged into stdout:

   ~~~
   bash 2>&1 <<'PI_TEST_CMD_EOF'
   <## Test Command, verbatim and unmodified>
   PI_TEST_CMD_EOF
   ~~~

   Choose a heredoc delimiter that does not appear anywhere in `## Test Command`; if `PI_TEST_CMD_EOF` could collide with the command text, pick a longer collision-resistant variant so the heredoc body is never truncated early. Invoking `bash` this way to run the supplied command is the sanctioned execution mechanism — it is NOT a forbidden "other command" (see `## Rules`). The bytes of `## Test Command` MUST reach `bash` unchanged — no surrounding quotes added, no characters escaped, no substitutions performed, and no script file written. Record the combined stream as the run-output and record the integer exit code.
~~~~

  Format constraint: the inner heredoc example above is shown with a `~~~` fence inside the step. In the actual file, render the example as a normal fenced block consistent with the file's existing `~~~` examples; do NOT introduce backtick code fences that could collide with surrounding fences. Do NOT use the three-word sequence "temporary script file" anywhere — the Task 3 guardrail asserts its absence (case-insensitively).

- [ ] **Step 3: Clarify the Rules "no other command" line.** Replace the `## Rules` bullet "- Do NOT modify any source file; do NOT run `git` commands; do NOT run any command other than the supplied `## Test Command`." with:

```
- Do NOT modify any source file, and do NOT create or write any file other than the single artifact at `## Artifact Output Path`. Do NOT run `git`, `mkdir`, ad hoc file reads, or any command unrelated to executing the supplied `## Test Command`. Running the supplied command by feeding it to `bash` on standard input / via a heredoc (per `## Execution` step 2) is the sanctioned execution mechanism, not a forbidden "other command"; ephemeral shell constructs that create no filesystem artifact are permitted.
```

- [ ] **Step 4: Confirm no contradiction remains.** Re-read the file end-to-end and confirm: (a) the temp-script-file recommendation is gone, (b) `## Execution` step 4 and the `## Rules` single-write line are intact, (c) the "no other command" clarification does not contradict the single-write rule, and (d) the three-word sequence "temporary script file" appears nowhere.

**Acceptance criteria:**

- `agents/test-runner.md` no longer recommends, mentions, or permits writing the test command to a temporary script file or any path other than the artifact; the three-word sequence "temporary script file" is absent.
  Verify: run `grep -ci "temporary script file" packages/pi-flow-core/agents/test-runner.md` and confirm it prints `0`.
- `## Execution` step 2 makes stdin/heredoc the sole execution mechanism, retains the byte-preservation guarantee (bytes reach `bash` unchanged, stderr merged into stdout), and includes heredoc-delimiter-collision guidance.
  Verify: open `packages/pi-flow-core/agents/test-runner.md` and confirm `## Execution` step 2 (1) describes feeding `## Test Command` to `bash` on stdin/heredoc with no temporary file, (2) states the bytes must reach `bash` unchanged with stderr merged into stdout, and (3) tells the reader to choose a heredoc delimiter that cannot collide with the command text.
- The `## Rules` "no other command" line explicitly states that invoking `bash` to run the supplied command via stdin/heredoc is sanctioned (not a forbidden other command), while still prohibiting unrelated commands (`git`, `mkdir`, ad hoc reads).
  Verify: open `packages/pi-flow-core/agents/test-runner.md` and confirm the edited `## Rules` bullet names `bash` stdin/heredoc as the sanctioned execution mechanism and still forbids `git`/`mkdir`/ad hoc reads.
- The single-artifact-write rule and artifact format are unchanged.
  Verify: run `grep -c "exactly ONE write to \`## Artifact Output Path\`" packages/pi-flow-core/agents/test-runner.md` and confirm it prints `1` (the `## Rules` line is intact).
- The existing `_shared` Python test suite (marker contract, completion protocol, prompt assembly, artifact parser) still passes against the edited file.
  Verify: run `python3 -m unittest discover -s packages/pi-flow-core/skills/_shared/scripts/tests -p 'test_*.py'` and confirm exit code 0.

**Model recommendation:** standard

### Task 2 — Fix test-runner-prompt.md task + rules wording (Part A)

**Files:**
- Modify: `packages/pi-flow-core/skills/_shared/test-runner-prompt.md`

**Steps:**

- [ ] **Step 1: Orient.** Read `packages/pi-flow-core/skills/_shared/test-runner-prompt.md`, focusing on the `## Task` section (the paragraph beginning "Write the artifact exactly once …" with "Do NOT modify any other file. Do NOT run `git`, `mkdir`, or any other command beyond the supplied test command.") and the `## Rules` bullet "Do NOT modify any source file; do NOT run `git` commands; do NOT run any command other than the supplied test command from `## Test Command`." Do NOT touch the `## Output`, `## Completion protocol`, or marker lines, and do NOT change the "Perform exactly ONE write to `## Artifact Output Path` per dispatch." rule.

- [ ] **Step 2: Clarify the `## Task` file-write + command sentence.** Replace the sentence "Do NOT modify any other file. Do NOT run `git`, `mkdir`, or any other command beyond the supplied test command." with:

```
Do NOT create or modify any file other than the artifact at `## Artifact Output Path` — in particular, do not write the test command to a scratch file or any other path. Running the supplied test command by feeding it to `bash` on standard input / via a heredoc (the sanctioned mechanism documented in your agent definition's `## Execution` step 2) is NOT a forbidden "other command"; ephemeral shell constructs that create no filesystem artifact are permitted. Do NOT run `git`, `mkdir`, ad hoc file reads, or any command unrelated to the supplied test command.
```

- [ ] **Step 3: Clarify the `## Rules` "no other command" bullet.** Replace "- Do NOT modify any source file; do NOT run `git` commands; do NOT run any command other than the supplied test command from `## Test Command`." with:

```
- Do NOT modify any source file, and do NOT create or write any file other than the artifact at `## Artifact Output Path`. Running the supplied test command via `bash` standard input / heredoc (per your agent definition's `## Execution` step 2) is the sanctioned execution mechanism, not a forbidden "other command"; ephemeral shell constructs that create no filesystem artifact are permitted. Do NOT run `git`, `mkdir`, ad hoc reads, or any command unrelated to the supplied test command from `## Test Command`.
```

- [ ] **Step 4: Confirm.** Re-read the file and confirm the single-write rule is intact, the stdin/heredoc mechanism is named as sanctioned in both the `## Task` and `## Rules` sections, and the three-word sequence "temporary script file" appears nowhere.

**Acceptance criteria:**

- `skills/_shared/test-runner-prompt.md` contains no temp-script-file guidance; the three-word sequence "temporary script file" is absent.
  Verify: run `grep -ci "temporary script file" packages/pi-flow-core/skills/_shared/test-runner-prompt.md` and confirm it prints `0`.
- Both the `## Task` and `## Rules` sections explicitly state that running the supplied command via `bash` stdin/heredoc is the sanctioned mechanism, not a forbidden "other command", while still forbidding unrelated commands.
  Verify: open `packages/pi-flow-core/skills/_shared/test-runner-prompt.md` and confirm both the `## Task` paragraph and the `## Rules` "no other command" bullet name `bash` stdin/heredoc as sanctioned and still forbid `git`/`mkdir`/ad hoc reads.
- The single-artifact-write rule is unchanged.
  Verify: run `grep -c "exactly ONE write to \`## Artifact Output Path\`" packages/pi-flow-core/skills/_shared/test-runner-prompt.md` and confirm it prints `1`.
- The existing `_shared` Python test suite still passes against the edited prompt.
  Verify: run `python3 -m unittest discover -s packages/pi-flow-core/skills/_shared/scripts/tests -p 'test_*.py'` and confirm exit code 0.

**Model recommendation:** standard

### Task 3 — Add the test-runner file-write contract guardrail (Part A)

**Files:**
- Modify (Test): `packages/pi-flow-core/skills/_shared/scripts/tests/test_marker_emit_contract.py`

**Steps:**

- [ ] **Step 1: Orient.** Read `packages/pi-flow-core/skills/_shared/scripts/tests/test_marker_emit_contract.py`. Note the existing module-level `read(rel_path)` helper (reads a repo-relative path against `REPO_ROOT`) and that the file already names `packages/pi-flow-core/agents/test-runner.md` and `packages/pi-flow-core/skills/_shared/test-runner-prompt.md`. Reuse `read()`; do NOT add new helpers or imports.

- [ ] **Step 2: Add the `TestFileWriteContract` class.** Append a new `unittest.TestCase` subclass before the `if __name__ == "__main__":` guard. It must reference both files via module constants and assert three things, using `subTest` per file:

```python
class TestFileWriteContract(unittest.TestCase):
    """The test-runner agent and prompt must agree: exactly one durable write
    (the artifact), no temp-script-file guidance, and a documented stdin/heredoc
    execution mechanism. Guards against re-introducing the resolved conflict."""

    FILES = [
        ("packages/pi-flow-core/agents/test-runner.md", "agent"),
        ("packages/pi-flow-core/skills/_shared/test-runner-prompt.md", "prompt"),
    ]

    def test_no_temp_script_file_guidance(self):
        for rel_path, kind in self.FILES:
            with self.subTest(file=rel_path, kind=kind):
                body = read(rel_path).lower()
                self.assertNotIn(
                    "temporary script file", body,
                    msg=f"{rel_path} ({kind}) must not recommend a temporary script file",
                )

    def test_single_artifact_write_rule_present(self):
        for rel_path, kind in self.FILES:
            with self.subTest(file=rel_path, kind=kind):
                body = read(rel_path)
                self.assertIn(
                    "exactly ONE write to `## Artifact Output Path`", body,
                    msg=f"{rel_path} ({kind}) must keep the single-artifact-write rule",
                )

    def test_stdin_or_heredoc_mechanism_documented(self):
        for rel_path, kind in self.FILES:
            with self.subTest(file=rel_path, kind=kind):
                body = read(rel_path).lower()
                self.assertTrue(
                    "heredoc" in body or "stdin" in body or "standard input" in body,
                    msg=f"{rel_path} ({kind}) must document a stdin/heredoc execution mechanism",
                )
```

- [ ] **Step 3: Run the new class red-then-green check.** Run `python3 -m unittest discover -s packages/pi-flow-core/skills/_shared/scripts/tests -p test_marker_emit_contract.py` and confirm it passes (exit 0). Because Tasks 1 and 2 have already removed the forbidden phrase and added the mechanism, the new class is green; if it fails, the cause is an incomplete Part A edit — report it rather than weakening the assertions.

**Acceptance criteria:**

- A regression test fails if temp-script-file guidance is reintroduced into either file and asserts both files carry the single-artifact-write rule and a stdin/heredoc mechanism.
  Verify: run `python3 -m unittest discover -s packages/pi-flow-core/skills/_shared/scripts/tests -p test_marker_emit_contract.py` and confirm exit code 0 and that the output includes `TestFileWriteContract` test runs (e.g. via `-v`: `python3 -m unittest discover -s packages/pi-flow-core/skills/_shared/scripts/tests -p test_marker_emit_contract.py -v` shows `test_no_temp_script_file_guidance` and `test_single_artifact_write_rule_present` as `ok`).
- The guardrail reads both the agent and the prompt (single-pass check that both agree), reusing the existing `read()` helper without new imports.
  Verify: open `packages/pi-flow-core/skills/_shared/scripts/tests/test_marker_emit_contract.py` and confirm `TestFileWriteContract.FILES` lists both `packages/pi-flow-core/agents/test-runner.md` and `packages/pi-flow-core/skills/_shared/test-runner-prompt.md`, and that the class calls `read(...)` (no added `import`).
- The full existing `_shared` test suite still passes with the new class added.
  Verify: run `python3 -m unittest discover -s packages/pi-flow-core/skills/_shared/scripts/tests -p 'test_*.py'` and confirm exit code 0.

**Model recommendation:** cheap

### Task 4 — In-parser tolerant classification + tests + fixture (Part B core)

**Files:**
- Modify: `packages/pi-flow-core/skills/execute-plan/scripts/parse-verifier-report.py`
- Create (Test fixture): `packages/pi-flow-core/skills/execute-plan/scripts/tests/fixtures/verifier-report-protocol-warnings.md`
- Modify (Test): `packages/pi-flow-core/skills/execute-plan/scripts/tests/test_parse_verifier_report.py`

This task is intentionally a single atomic unit: the parser change flips the expected outcome of several existing tests, so the parser, fixtures, and test updates must commit together to keep the integration suite green at the post-wave gate. Build it test-first.

- [ ] **Step 1: Orient.** Read `parse-verifier-report.py` end-to-end. Note: `parse_evidence_blocks` / `parse_evidence_fields` (returns blocks `{N: {command, exit_code, stdout, stderr}}` plus error strings like `verifier phase-1 evidence block malformed at criterion N: <key> field missing`), `parse_per_criterion_verdicts`, `parse_overall_verdict`, `validate_phase1_recipes` (byte-equal command check), `_extract_reason`, and the `main()` final-verdict block. Note the fence helpers imported from `fence_aware`: `compute_in_fence_lines`, `FENCE_RE`, `split_h2_sections`. Read `test_parse_verifier_report.py` and the fixtures `verifier-report-pass.md`, `verifier-report-fail.md`, `verifier-report-malformed.md`, `verifier-report-evidence-malformed.md`, `verifier-report-fenced-payload.md`.

- [ ] **Step 2: Create the `f6eac473`-style fixture.** Write `packages/pi-flow-core/skills/execute-plan/scripts/tests/fixtures/verifier-report-protocol-warnings.md` with exactly this content (every criterion explicitly PASS, successful command evidence, multiple protocol-only defects: case-only verdict on criterion 1, trailing annotation on criterion 2, missing `stderr:` label on criterion 1's evidence, case-only overall verdict):

```
## Phase 1 Evidence

[Evidence for Criterion 1]
command: python3 myscript.py --help
exit_code: 0
stdout: usage: myscript.py [-h]

[Evidence for Criterion 2]
command: python3 myscript.py --check
exit_code: 0
stdout: all checks passed
stderr:

## Per-Criterion Verdicts

[Criterion 1] pass
reason: The --help flag exits 0 and shows usage.

[Criterion 2] PASS — all checks passed
reason: The check command exits 0 with no errors.

## Overall Verdict

VERDICT: pass
```

- [ ] **Step 3: Write the tolerant-outcome tests (red).** In `test_parse_verifier_report.py`, add a `write_temp_recipes`-backed helper recipes list `[{"criterion_n": 1, "recipe": "python3 myscript.py --help"}, {"criterion_n": 2, "recipe": "python3 myscript.py --check"}]` and add these tests:
  - `TestSemanticPassFixture`: run the script on `verifier-report-protocol-warnings.md` with `--criteria-count 2` and the recipes file; assert exit code 0, `data["verdict"] == "PASS_WITH_PROTOCOL_WARNINGS"`, `data["protocol_errors"] == []`, `len(data["protocol_warnings"]) >= 1`, `len(data["per_criterion"]) == 2` with both verdicts `"PASS"`.
  - `TestTolerantCaseOnlyVerdict`: inline report, K=1, `[Criterion 1] pass`, `VERDICT: PASS`, no recipes → exit 0, verdict `PASS_WITH_PROTOCOL_WARNINGS`, warnings non-empty.
  - `TestTolerantTrailingAnnotation`: inline report, K=1, `[Criterion 1] PASS — confirmed`, `VERDICT: PASS`, no recipes → tolerant pass.
  - `TestTolerantVerdictPrefix`: run on `verifier-report-malformed.md` (`[Criterion 1] verdict: PASS`, `VERDICT: PASS`), K=1, no recipes → tolerant pass.
  - `TestTolerantOverallCaseAndAnnotation`: inline report, K=1, `[Criterion 1] PASS`, `VERDICT: pass  (all good)` → tolerant pass.
  - `TestTolerantMissingEvidenceLabel`: run on `verifier-report-evidence-malformed.md` (evidence block missing `stderr:`), K=1, recipes `[{"criterion_n":1,"recipe":"python3 myscript.py --help"}]` → tolerant pass; assert `protocol_warnings` mentions the missing field (substring `stderr` or `field`).
  - `TestTolerantCommandSurroundingWhitespace`: inline report with an evidence `command:   python3 myscript.py --help  ` (leading/trailing spaces) vs recipe `python3 myscript.py --help`, K=1, `[Criterion 1] PASS`, `VERDICT: PASS` → tolerant pass.

- [ ] **Step 4: Write the hard-FAIL preservation tests (red/already-failing intent).** Add tests asserting these remain hard FAIL (`verdict == "FAIL"`, exit 1, `protocol_errors` non-empty, never `PASS_WITH_PROTOCOL_WARNINGS`):
  - `TestSubstantiveAmbiguousToken`: `[Criterion 1] passed` and separately `[Criterion 1] OK` (K=1, `VERDICT: PASS`, no recipes) → FAIL.
  - `TestSubstantiveParaphrasedCommand`: reuse the existing `TestCommandNotMatchingRecipe` scenario (`--wrong-flag` vs `--help`) and additionally assert `data["verdict"] != "PASS_WITH_PROTOCOL_WARNINGS"`.
  - `TestSubstantiveNonZeroExit`: inline report, K=1, `[Criterion 1] PASS`, evidence `command: python3 myscript.py --help` / `exit_code: 1`, recipe `python3 myscript.py --help`, `VERDICT: PASS` → FAIL (non-zero exit is substantive).
  - `TestSubstantiveMissingEvidenceStaysFail`: extend the existing `TestMissingEvidenceBlock` scenario with `assert data["verdict"] != "PASS_WITH_PROTOCOL_WARNINGS"`.
  - `TestSubstantivePerCriterionFailStaysFail`: extend `TestPerCriterionFailOverridesOverallPass` with `assert data["verdict"] != "PASS_WITH_PROTOCOL_WARNINGS"`.

- [ ] **Step 5: Update the now-tolerated existing tests.** Rewrite these existing tests to assert the new tolerant outcome (per spec B9 — these variants are now protocol-only):
  - `TestMalformedHeader` (fixture `verifier-report-malformed.md`, K=1): change all three methods to assert exit code 0, `data["verdict"] == "PASS_WITH_PROTOCOL_WARNINGS"`, and `len(data["protocol_warnings"]) >= 1` (the `verdict:` prefix is protocol-only with unambiguous PASS).
  - `TestLowercaseVerdict.test_lowercase_pass_is_protocol_error`: rename intent to assert exit 0, `verdict == "PASS_WITH_PROTOCOL_WARNINGS"`, warnings non-empty.
  - `TestExtraTokensAfterVerdict.test_extra_token_after_pass_is_protocol_error`: rewrite to assert exit 0, `verdict == "PASS_WITH_PROTOCOL_WARNINGS"`, `len(data["per_criterion"]) == 1` with verdict `"PASS"`, warnings non-empty. Leave `test_extra_token_after_fail_is_protocol_error` (FAIL token → substantive, stays FAIL) and `test_trailing_whitespace_after_verdict_is_accepted` (strict PASS) unchanged.
  - `TestEvidenceBlockMissingField.test_missing_stderr_field_protocol_error`: rewrite to assert exit 0, `verdict == "PASS_WITH_PROTOCOL_WARNINGS"`, and that `protocol_warnings` mentions the missing `stderr` field.
  - `TestPhase1RecipesPathInvalid.test_phase1_recipes_array_shape_accepted` (uses `verifier-report-evidence-malformed.md`): update to assert exit code 0 and `verdict == "PASS_WITH_PROTOCOL_WARNINGS"`, while keeping the assertion that no `protocol_errors` entry contains `phase1-recipes-json invalid` (the array shape is still accepted). Leave the other two methods in that class (`test_phase1_recipes_missing_file_protocol_error`, `test_phase1_recipes_object_shape_protocol_error`) unchanged — recipes-load errors still hard-fail before parsing.

- [ ] **Step 6: Add distinguishability tests.** Add `TestOutcomeDistinguishability`: (a) strict pass fixture `verifier-report-pass.md` (K=2) yields `verdict == "PASS"` and has no `protocol_warnings` key (`"protocol_warnings" not in data`); (b) the protocol-warnings fixture yields `verdict == "PASS_WITH_PROTOCOL_WARNINGS"` with a non-empty `protocol_warnings` list and empty `protocol_errors`; (c) a hard-FAIL inline report yields `verdict == "FAIL"` with non-empty `protocol_errors`.

- [ ] **Step 7: Run the suite (expect failures).** Run `python3 -m unittest discover -s packages/pi-flow-core/skills/execute-plan/scripts/tests -p test_parse_verifier_report.py`; confirm the new/updated tests fail (parser not yet tolerant). This proves the tests exercise the new behavior.

- [ ] **Step 8: Implement `classify_report_tolerant`.** Add a module-level function that performs the deterministic second pass. It receives the already-parsed strict `evidence_blocks` and `evidence_errors`, the raw section texts for criteria and overall, `k`, the `recipes` dict, and a `recipes_provided` bool, and returns `(semantic_pass: bool, per_criterion: list, phase1_evidence: dict, protocol_warnings: list)`. Algorithm (fence-aware throughout via `compute_in_fence_lines`; any deviation it cannot account for as an enumerated protocol-only defect sets a `substantive = True` flag that forces `semantic_pass = False`):

  1. **Criteria recovery.** Split `criteria_section` into lines, compute `in_fence`. For each non-fenced line matching `^\[Criterion (\d+)\]\s*(.*)$`: take `N`, `rest = group(2).strip()`. If `rest` starts with the literal `verdict:` prefix, strip it (record a verdict-prefix warning candidate) and use the remainder. Tokenize on whitespace: `first = tokens[0]` if any; `trailing = tokens[1:]`. If `first.upper() == "PASS"`: verdict is PASS — add a case warning when `first != "PASS"`, a trailing-annotation warning when `trailing` is non-empty, and the verdict-prefix warning when applicable. If `first.upper() == "FAIL"`: set `substantive = True` (per-criterion FAIL never tolerated). Otherwise (`passed`, `OK`, empty, etc.): `substantive = True`. Record duplicates (`N` seen twice) and out-of-range (`N < 1 or N > k`) as `substantive = True`. After scanning, any `N` in `1..k` not recovered as PASS → `substantive = True`. Recover each criterion's `reason` with `_extract_reason` over the lines between consecutive `[Criterion N]` headers (reuse the existing helper and its `in_fence` argument).

  2. **Overall recovery.** On non-fenced lines of `overall_section`, match `^VERDICT:\s*(.*)$`; take `val = group(1).strip()`, tokenize. If `tokens[0].upper() == "PASS"`: overall PASS — case warning when `tokens[0] != "PASS"`, trailing-annotation warning when `tokens[1:]` non-empty. Otherwise (FAIL, ambiguous, or no `VERDICT:` line) → `substantive = True`.

  3. **Evidence classification.** For each string in `evidence_errors`: if it matches `evidence block malformed at criterion \d+: (stdout|stderr) field missing`, record it as a protocol warning; otherwise (command/exit_code field missing, field out of order, anything else) → `substantive = True`. When `recipes_provided`, for each `(n, recipe)` in `recipes`: if `n not in evidence_blocks` → `substantive = True`; else let `cmd = evidence_blocks[n].get("command", "")`. If `cmd.strip() == recipe.strip()`: it matches — add a surrounding-whitespace warning when `cmd != recipe`. Otherwise → `substantive = True`. Parse `evidence_blocks[n].get("exit_code", "")` with `int(...)`; on `ValueError` or a non-zero value → `substantive = True`. Also reject extra evidence commands: for any `n` in `evidence_blocks` not in `recipes`, if `evidence_blocks[n].get("command", "").strip()` is not in `{r.strip() for r in recipes.values()}` → `substantive = True`.

  4. **Decision.** `semantic_pass = (not substantive) and (len(protocol_warnings) > 0)`. Requiring at least one warning ensures a report that strict parsing flagged but the tolerant pass cannot account for (zero warnings, no substantive flag) falls through to FAIL — conservative by construction. When `semantic_pass`, build `per_criterion = [{"criterion": n, "verdict": "PASS", "reason": <recovered reason or "">} for n in range(1, k+1)]` and `phase1_evidence = evidence_blocks`. Return.

- [ ] **Step 9: Restructure `main()`.** After computing `evidence_blocks` / `evidence_errors`, `per_criterion` / `crit_errors`, `overall_verdict` / `verdict_errors`, the recipe errors, and `any_criterion_fail`, replace the final-verdict + print block with:

```python
    strict_clean = (not protocol_errors) and (not any_criterion_fail)

    if strict_clean:
        final_verdict = overall_verdict if overall_verdict else "FAIL"
        result = {
            "verdict": final_verdict,
            "per_criterion": per_criterion,
            "phase1_evidence": {str(n): block for n, block in evidence_blocks.items()},
            "protocol_errors": protocol_errors,
        }
        print(json.dumps(result, indent=2))
        sys.exit(0 if final_verdict == "PASS" else 1)

    semantic_pass, tol_per_criterion, tol_evidence, protocol_warnings = classify_report_tolerant(
        criteria_section, overall_section, evidence_blocks, evidence_errors,
        k, recipes, bool(args.phase1_recipes_json),
    )
    if semantic_pass:
        result = {
            "verdict": "PASS_WITH_PROTOCOL_WARNINGS",
            "per_criterion": tol_per_criterion,
            "phase1_evidence": {str(n): block for n, block in tol_evidence.items()},
            "protocol_errors": [],
            "protocol_warnings": protocol_warnings,
        }
        print(json.dumps(result, indent=2))
        sys.exit(0)

    result = {
        "verdict": "FAIL",
        "per_criterion": per_criterion,
        "phase1_evidence": {str(n): block for n, block in evidence_blocks.items()},
        "protocol_errors": protocol_errors,
    }
    print(json.dumps(result, indent=2))
    sys.exit(1)
```

  Keep the section-splitting (`split_h2_sections`) and the three strict parse calls exactly as they are; `criteria_section` and `overall_section` are the same locals already computed. Do NOT add a `protocol_warnings` key to the strict-clean or hard-FAIL `result` dicts — those two outputs must stay byte-for-byte identical to today.

- [ ] **Step 10: Run the targeted suite (green).** Run `python3 -m unittest discover -s packages/pi-flow-core/skills/execute-plan/scripts/tests -p test_parse_verifier_report.py` and confirm exit code 0 with all tests passing, including the preserved fence-aware tests (`TestFencedPayload`, `TestFencedSectionDelimiter`, `TestFencedReasonExtraction`).

- [ ] **Step 11: Run the full package suite (no regressions).** Run `pnpm --filter @aphotic/pi-flow-core test` and confirm exit code 0.

**Acceptance criteria:**

- Strict-format fixtures produce the same verdicts, JSON, and exit codes as before: `verifier-report-pass.md` → `PASS` exit 0, `verifier-report-fail.md` → `FAIL` exit 1, and neither output contains a `protocol_warnings` key.
  Verify: run `python3 -m unittest discover -s packages/pi-flow-core/skills/execute-plan/scripts/tests -p test_parse_verifier_report.py -k "TestPassReport or TestFailReport or TestOutcomeDistinguishability"` and confirm exit code 0.
- The constructed `f6eac473`-style fixture parses as a semantic PASS with protocol warnings (exit 0, distinct verdict, warnings listed, no errors), with every criterion recovered as PASS.
  Verify: run `python3 -m unittest discover -s packages/pi-flow-core/skills/execute-plan/scripts/tests -p test_parse_verifier_report.py -k TestSemanticPassFixture` and confirm exit code 0.
- Each enumerated protocol-only variant (case-only verdict, trailing annotation, `verdict:` prefix with unambiguous PASS, case/trailing overall verdict, missing stdout/stderr label with successful command evidence, surrounding-whitespace command difference) yields the tolerant outcome.
  Verify: run `python3 -m unittest discover -s packages/pi-flow-core/skills/execute-plan/scripts/tests -p test_parse_verifier_report.py -k "TestTolerant"` and confirm exit code 0.
- Each enumerated substantive defect (ambiguous token such as `passed`/`OK`, paraphrased command, missing evidence block, non-zero exit code, per-criterion FAIL, duplicate, out-of-range, missing criterion) stays hard FAIL and never reaches the tolerant outcome.
  Verify: run `python3 -m unittest discover -s packages/pi-flow-core/skills/execute-plan/scripts/tests -p test_parse_verifier_report.py -k "TestSubstantive or TestDuplicateCriterion or TestMissingCriterion or TestOutOfRangeCriterion or TestCommandNotMatchingRecipe or TestExtraEvidenceCommand or TestPerCriterionFailOverridesOverallPass"` and confirm exit code 0.
- Parser output distinguishes the three outcomes mechanically (strict PASS has no `protocol_warnings`; tolerant pass has a non-empty `protocol_warnings` and empty `protocol_errors`; hard FAIL has non-empty `protocol_errors`).
  Verify: run `python3 -m unittest discover -s packages/pi-flow-core/skills/execute-plan/scripts/tests -p test_parse_verifier_report.py -k TestOutcomeDistinguishability` and confirm exit code 0.
- Fence-aware parsing is preserved (fenced payload is never treated as structure) and the whole verifier-report suite passes.
  Verify: run `python3 -m unittest discover -s packages/pi-flow-core/skills/execute-plan/scripts/tests -p test_parse_verifier_report.py` and confirm exit code 0 and zero failures/errors reported.
- The full `@aphotic/pi-flow-core` suite (node + Python helpers) passes with the change.
  Verify: run `pnpm --filter @aphotic/pi-flow-core test` and confirm exit code 0.

**Model recommendation:** capable

### Task 5 — Route the tolerant outcome + recipe-amendment menu + boundary docs (Part B)

**Files:**
- Modify: `packages/pi-flow-core/skills/execute-plan/SKILL.md`
- Modify: `packages/pi-flow-core/skills/execute-plan/acceptance-criteria-verification.md`
- Modify: `packages/pi-flow-core/skills/_shared/orchestrator-verification-boundary.md`
- Modify (Test): `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs`

**Steps:**

- [ ] **Step 1: Orient.** Read `SKILL.md` Step 11.2 (the "Parse verifier output and gate the wave" paragraph, ~line 347) and Step 13 (the retry rules + exhaustion menu, ~lines 419-446); read `acceptance-criteria-verification.md` step f (~line 37); read `orchestrator-verification-boundary.md` (the "The orchestrator MUST NOT" list); read `__tests__/guardrail-strings.test.mjs`. Preserve the existing boundary blockquotes (lines containing `> ` and `MUST NOT`) and the Step 12 menu strings — do not edit those.

- [ ] **Step 2: Rewrite SKILL.md Step 11.2 routing.** Replace the Step 11.2 paragraph (currently: "Parse each report with `pi-flow helper execute-plan/parse-verifier-report`. Route `VERDICT: PASS` as passing. Route `VERDICT: FAIL` (including malformed output or Phase 1 protocol errors) into Step 13 with the per-criterion `FAIL` entries and `reason:` text. Protocol errors never pass and are never silently interpreted as `PASS`.") with:

~~~
2. **Parse verifier output and gate the wave (compatibility: Step 11.3 parser gate).** Parse each report with `pi-flow helper execute-plan/parse-verifier-report` and route on the parsed `.verdict` field:
   - `PASS` — passing; proceed to Step 12.
   - `PASS_WITH_PROTOCOL_WARNINGS` — the report carried only protocol-only formatting defects while presenting complete, unambiguous PASS evidence for every criterion. The deterministic enumeration of which defects are protocol-only lives entirely in `parse-verifier-report.py`. Accept it **automatically as passing — no user confirmation gate** — and surface the `.protocol_warnings` entries prominently for that task:

     ```
     ⚠️ Task <N> verified PASS with protocol warnings (auto-accepted; evidence complete):
       - <warning>
     ```

   - `FAIL` — route into Step 13 with the per-criterion `FAIL` entries and `reason:` text.

   The parser is the sole sanctioned classifier of protocol-only vs. substantive defects. The orchestrator may only run `parse-verifier-report.py` over the verifier-produced report and route its `.verdict`; it MUST NOT inspect implementation files, re-interpret an ambiguous or substantively-defective report as a pass, or synthesize evidence. A `FAIL` — missing, ambiguous, or substantively-defective evidence — never passes.
~~~

- [ ] **Step 3: Add the Step 13 recipe-amendment menu option + procedure.** In Step 13's exhaustion menu, replace the two-option block with this three-option block:

```
Options:
(r) Retry again            — optionally with a different model or more context. Resets the per-task budget back to 3 for that task only.
(a) Amend Verify: recipe   — only when the verifier evidence shows the `Verify:` recipe itself is defective (it ran byte-equal and still failed for recipe reasons, or the verifier reports it unrunnable). You supply or approve a corrected recipe; the orchestrator updates the plan file's `Verify:` line for that criterion and re-dispatches the verifier with it. Resets the per-task budget back to 3.
(x) Stop execution         — halt the plan; prior wave commits remain in git history
```

  Immediately after the menu, add this procedure paragraph:

```
**Recipe amendment (`(a)`) is the only sanctioned plan edit during execution and is user-directed.** Show the `(a)` option only when the failure evidence indicates the `Verify:` recipe — not the implementation — is at fault. On `(a)`: present the criterion text and its current `Verify:` recipe, take the user's corrected recipe (or explicit approval of a suggested one), update that single `Verify:` line in the plan file under `docs/plans/`, re-run `pi-flow helper execute-plan/extract-plan-tasks` to refresh the `--phase1-recipes-json` set, and re-dispatch the verifier (Step 11) with the corrected recipe; this resets the per-task retry budget to 3 (mirroring `(r)`). The user authorizes the change to what "verified" means; the orchestrator inspects no implementation files and forms no verdict of its own. See [`../_shared/orchestrator-verification-boundary.md`](../_shared/orchestrator-verification-boundary.md).
```

- [ ] **Step 4: Update acceptance-criteria-verification.md step f.** Replace step f ("Parse the dispatched final message via `pi-flow helper execute-plan/parse-verifier-report`. Treat any protocol errors the parser surfaces as `VERDICT: FAIL`.") with:

```
f. **Parse the result.** Parse the dispatched final message via `pi-flow helper execute-plan/parse-verifier-report` and route the parser's `.verdict`: `PASS` and `PASS_WITH_PROTOCOL_WARNINGS` are passing outcomes — the latter carries only protocol-only formatting defects alongside complete, unambiguous PASS evidence and is accepted automatically while its `.protocol_warnings` are surfaced; `FAIL` (including missing, ambiguous, or substantively-defective evidence) is treated as a failure for the caller's retry loop. The parser is the only sanctioned classifier; the caller never re-interprets a `FAIL` report as a pass, inspects implementation files, or synthesizes evidence.
```

  Also update the `## Output` list in that file so it notes the parser may emit `protocol_warnings` alongside the existing `verdict` / `per_criterion` / `phase1_evidence` / `protocol_errors` fields (add a `protocol_warnings` bullet noting it is present only on the `PASS_WITH_PROTOCOL_WARNINGS` outcome).

- [ ] **Step 5: Add the boundary-doc carve-out.** In `orchestrator-verification-boundary.md`, immediately after the "The orchestrator MUST NOT:" bulleted list (after the "Edit the artifact under judgment …" bullet), add:

```
**Sole exception — user-directed recipe amendment.** When verification fails because a plan's `Verify:` recipe is itself defective, the user may direct the orchestrator to amend that recipe (execute-plan Step 13 `(a)`). The orchestrator then mechanically updates the single `Verify:` line in the plan file with the user-approved text and re-dispatches the verifier. This is the only sanctioned plan edit during orchestration: it is user-formed, not orchestrator-formed, and the orchestrator still never inspects implementation files, synthesizes evidence, or overrides the parser's verdict.
```

- [ ] **Step 6: Pin the new routing strings in guardrail-strings.test.mjs.** Add a `node:test` block that reads `skillPath('execute-plan')`, `skillPath('execute-plan', 'acceptance-criteria-verification.md')`, and `sharedPath('orchestrator-verification-boundary.md')` and asserts presence of:
  - In execute-plan SKILL.md: `PASS_WITH_PROTOCOL_WARNINGS`, `⚠️ Task <N> verified PASS with protocol warnings (auto-accepted; evidence complete):`, and `(a) Amend Verify: recipe`.
  - In acceptance-criteria-verification.md: `PASS_WITH_PROTOCOL_WARNINGS`.
  - In orchestrator-verification-boundary.md: `Sole exception — user-directed recipe amendment.`
  - And assert ABSENCE in execute-plan SKILL.md of the old unconditional sentence `Protocol errors never pass and are never silently interpreted as`.

  Use the existing `skillPath` / `sharedPath` helpers (note `skillPath` accepts an optional second `file` argument). Example shape:

```javascript
test('execute-plan tolerant-verifier routing strings are present', () => {
  const skill = readFileSync(skillPath('execute-plan'), 'utf8');
  for (const s of [
    'PASS_WITH_PROTOCOL_WARNINGS',
    '⚠️ Task <N> verified PASS with protocol warnings (auto-accepted; evidence complete):',
    '(a) Amend Verify: recipe',
  ]) {
    assert.ok(skill.includes(s), `execute-plan SKILL.md must contain: ${s}`);
  }
  assert.ok(
    !skill.includes('Protocol errors never pass and are never silently interpreted as'),
    'execute-plan SKILL.md must not retain the unconditional protocol-error-fail claim'
  );
  const acv = readFileSync(skillPath('execute-plan', 'acceptance-criteria-verification.md'), 'utf8');
  assert.ok(acv.includes('PASS_WITH_PROTOCOL_WARNINGS'), 'acceptance-criteria-verification.md must route the tolerant verdict');
  const boundary = readFileSync(sharedPath('orchestrator-verification-boundary.md'), 'utf8');
  assert.ok(
    boundary.includes('Sole exception — user-directed recipe amendment.'),
    'orchestrator-verification-boundary.md must document the user-directed recipe-amendment carve-out'
  );
});
```

- [ ] **Step 7: Run the node + package suites.** Run `pnpm --filter @aphotic/pi-flow-core run test:node` and confirm exit code 0 (existing guardrails — verifier-dispatch boundary blockquote, Step 12 menus — still pass alongside the new block), then run `pnpm --filter @aphotic/pi-flow-core test` and confirm exit code 0.

**Acceptance criteria:**

- SKILL.md Step 11.2 documents the three outcomes, auto-accepts `PASS_WITH_PROTOCOL_WARNINGS` with no user gate, surfaces the warnings, and no longer claims all protocol errors unconditionally fail.
  Verify: open `packages/pi-flow-core/skills/execute-plan/SKILL.md` Step 11.2 and confirm it lists `PASS`, `PASS_WITH_PROTOCOL_WARNINGS` (auto-accepted, warnings surfaced), and `FAIL` routes, and run `grep -c "Protocol errors never pass and are never silently interpreted as" packages/pi-flow-core/skills/execute-plan/SKILL.md` to confirm it prints `0`.
- SKILL.md Step 13 offers the user-gated `(a) Amend Verify: recipe` option (shown only when evidence indicates the recipe is defective) and documents the mechanical plan-file update + verifier re-dispatch as user-directed.
  Verify: run `grep -n "(a) Amend Verify: recipe" packages/pi-flow-core/skills/execute-plan/SKILL.md` and confirm at least one match, then open that section and confirm the procedure paragraph states the amendment is user-directed, updates the single `Verify:` line, and re-dispatches the verifier.
- acceptance-criteria-verification.md step f routes `PASS_WITH_PROTOCOL_WARNINGS` as passing and no longer says "treat any protocol errors … as `VERDICT: FAIL`" unconditionally.
  Verify: run `grep -c "PASS_WITH_PROTOCOL_WARNINGS" packages/pi-flow-core/skills/execute-plan/acceptance-criteria-verification.md` (confirm `>= 1`) and `grep -c "Treat any protocol errors the parser surfaces as" packages/pi-flow-core/skills/execute-plan/acceptance-criteria-verification.md` (confirm `0`).
- orchestrator-verification-boundary.md records the user-directed recipe amendment as the sole sanctioned plan edit, reaffirming no implementation inspection / evidence synthesis / verdict override.
  Verify: run `grep -c "Sole exception — user-directed recipe amendment." packages/pi-flow-core/skills/_shared/orchestrator-verification-boundary.md` and confirm it prints `1`.
- The new and existing node guardrails pass, and the existing verifier-dispatch boundary blockquote and Step 12 menu guardrails are unaffected.
  Verify: run `pnpm --filter @aphotic/pi-flow-core run test:node` and confirm exit code 0.

**Model recommendation:** standard

## Dependencies

- Task 1 depends on: (none)
- Task 2 depends on: (none)
- Task 3 depends on: Task 1, Task 2
- Task 4 depends on: (none)
- Task 5 depends on: Task 4

This yields two waves: Wave 1 = {Task 1, Task 2, Task 4}; Wave 2 = {Task 3, Task 5}.

## Risk Assessment

- **Integration-suite consistency at the per-wave commit gate.** execute-plan commits per dependency wave and runs the full integration suite (`## Test Command`) after each commit. The Part B parser change flips the expected outcome of several existing tests, so the parser, fixtures, and test edits MUST land in one commit. Mitigation: Part B core is a single atomic task (Task 4) — the parser and its tests can never be committed apart. Part A's guardrail (Task 3) is purely additive and asserts state already established by Tasks 1/2, so it can safely land in a later wave without making any intermediate commit red.
- **Reintroducing the forbidden phrase in prohibitive prose.** The Task 3 guardrail asserts the absence of "temporary script file" (case-insensitive). A naive prohibition ("do not write to a temporary script file") would trip it. Mitigation: Tasks 1/2 phrase prohibitions without that exact three-word sequence (e.g. "temporary file", "scratch file"), and the steps call this out explicitly.
- **Backward-compatibility breakage in parser JSON.** B1 requires strict-format reports to produce byte-for-byte identical JSON and exit codes. Mitigation: the strict parse functions are untouched; `main()` keeps the existing 4-key result dict and exit codes for both strict PASS and every FAIL path, and only the new tolerant branch adds the `protocol_warnings` key and the `PASS_WITH_PROTOCOL_WARNINGS` verdict. A distinguishability test asserts strict PASS has no `protocol_warnings` key.
- **Fail-closed regression in the tolerant pass.** The central safety invariant is that missing, ambiguous, failing, paraphrased, or duplicated evidence must never reach the tolerant pass. Mitigation: the classifier sets `substantive = True` on any deviation it cannot account for as an enumerated protocol-only defect and additionally requires at least one recorded warning, so an unaccounted strict defect falls through to FAIL. Dedicated hard-FAIL tests cover every substantive defect class, including per-criterion FAIL overriding overall PASS.
- **Fence-aware discipline in the second pass.** A tolerant recognizer that treated fenced payload as structure could recover a fake criterion from inside a code fence. Mitigation: `classify_report_tolerant` reuses `compute_in_fence_lines` for criteria, overall, and (via the existing helpers) evidence; the preserved `TestFencedPayload` / `TestFencedSectionDelimiter` / `TestFencedReasonExtraction` tests guard this.
- **Boundary-doc consistency for the new plan edit.** B8 introduces a user-directed plan edit, which could appear to contradict the boundary doc's "MUST NOT edit the artifact under judgment" rule. Mitigation: Task 5 adds an explicit, narrow carve-out framing the amendment as user-formed (not orchestrator-formed), and the existing boundary blockquotes and Step 12 menu guardrails are left untouched so no other guarantee is weakened.
- **Open question (retry-budget semantics for B8).** The spec leaves it to the implementer whether a recipe-amendment re-dispatch resets or consumes the Step 13 budget. This plan chooses to reset it (mirroring `(r)`), since the amendment changes what "verified" means and is a fresh start; the SKILL.md procedure states this explicitly.

## Test Command

```bash
pnpm --filter @aphotic/pi-flow-core test
```

---

### Self-review

**Spec coverage.**
- A1 (no temp-file; stdin/heredoc sole mechanism) → Task 1 Step 2. A2 (byte-preservation retained) → Task 1 Step 2 + criterion 2. A3 (delimiter-collision guidance) → Task 1 Step 2 + criterion 2. A4 (both files resolve the "no other command" ambiguity) → Task 1 Step 3, Task 2 Steps 2-3. A5 (no remaining contradiction; one durable write) → Task 1 Step 4, Task 2 Step 4, Task 3 guardrail. A6 (artifact format/parser/marker unchanged) → Tasks 1/2 leave those sections untouched; Task 1/2 criteria assert the single-write rule intact. A7 (regression test: forbidden-phrase absence + single-write presence, minimal brittleness) → Task 3. A8 (backend-neutral wording) → Tasks 1/2 use only `bash`/`write`/`read` constructs.
- B1 (strict path byte-for-byte) → Task 4 Step 9 + first acceptance criterion. B2 (deterministic second pass, no new script/subagent) → Task 4 Step 8. B3 (substantive-evidence bar) → Task 4 Step 8 decision rules. B4 (closed protocol-only enumeration; substantive set) → Task 4 Steps 3-4-8. B5 (command match = byte-equal after surrounding-whitespace strip) → Task 4 Step 8.3. B6 (three distinguishable outcomes) → Task 4 Step 6 + distinguishability criterion. B7 (auto-accept + warning surfacing; doc updates; boundary reaffirmed) → Task 5 Steps 2/4/5. B8 (user-gated recipe amendment) → Task 5 Step 3. B9 (test matrix incl. f6eac473 fixture, each tolerated variant, hard-FAIL preservation, updated flipped tests, fence tests preserved) → Task 4 Steps 2-7.
- Constraints: fail-closed (Risk Assessment + Task 4 Step 8.4); boundary not weakened (Task 5 Step 5); backward compat (Task 4 Step 9); fence discipline (Task 4 Step 8); test-runner artifact/parser/dispatch unchanged (Tasks 1/2 scope); edits in source package only (all paths under `packages/pi-flow-core/`); `verify-task-prompt.md` "BYTE-EQUAL VERBATIM" untouched (not in any task's file list).
- Non-goals respected: no `Verify:` field split, no LLM repair, no ad hoc orchestrator verification, no artifact-format/dispatch changes, no node_modules edits — none of these appear in any task.

**Placeholder scan.** No "TBD"/"TODO"/"implement later"/"similar to Task N". Every acceptance criterion is immediately followed by its own `Verify:` line with a concrete, reproducible recipe (grep with expected count, named-file inspection with the specific content to confirm, or a targeted `unittest`/`pnpm` run with the success condition).

**Type/identifier consistency.** The new verdict literal `PASS_WITH_PROTOCOL_WARNINGS` and the new JSON key `protocol_warnings` are used identically across Task 4 (parser + tests), Task 5 (SKILL.md, acceptance-criteria-verification.md, guardrail-strings.test.mjs). `classify_report_tolerant`'s signature in Step 8 matches its call in Step 9. Reused helpers (`compute_in_fence_lines`, `_extract_reason`, `parse_evidence_blocks`, `read`, `skillPath`, `sharedPath`) match their existing definitions.

PLAN_ARTIFACT: /Users/david/Code/pi-flow/docs/plans/2026-06-10-create-one-combined-implementation-spec-for-idea-99deb337.md
