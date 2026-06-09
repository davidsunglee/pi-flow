# Scout Brief: Add verifier protocol-repair path for clear substantive PASS evidence

Source: IDEA-4e20148e
Generated at: 2026-06-09T23:31:19Z
Git SHA: 8831fb0e682bbcd955f30a3f86a60bdb9e4e085f
Model: anthropic/claude-sonnet-4-6

## Relevant Files

**Core parser (primary change target):**
- `packages/pi-flow-core/skills/execute-plan/scripts/parse-verifier-report.py` — All strictness lives here: `parse_per_criterion_verdicts`, `parse_overall_verdict`, `parse_evidence_blocks`, `validate_phase1_recipes`, and the final `if protocol_errors or any_criterion_fail → FAIL` gate.

**Prompt assembly (recipe source):**
- `packages/pi-flow-core/skills/execute-plan/scripts/assemble-verifier-prompt.py` — Builds the verifier prompt; formats `[Recipe for Criterion N] <recipe>` lines in `{PHASE_1_RECIPES}`. The `recipe` value (= `Verify:` prose from the plan) is what `parse-verifier-report.py` byte-compares against.
- `packages/pi-flow-core/skills/execute-plan/verify-task-prompt.md` — Template instructing the verifier to run each recipe "BYTE-EQUAL VERBATIM." Defines the exact `## Phase 1 Evidence`, `## Per-Criterion Verdicts`, and `## Overall Verdict` sections.

**Skill documentation (routing and boundary statements):**
- `packages/pi-flow-core/skills/execute-plan/SKILL.md` — Step 11.2 says: "Route `VERDICT: FAIL` (including malformed output or Phase 1 protocol errors) into Step 13 … Protocol errors never pass and are never silently interpreted as `PASS`."
- `packages/pi-flow-core/skills/execute-plan/acceptance-criteria-verification.md` — Step f: "Treat any protocol errors the parser surfaces as `VERDICT: FAIL`."
- `packages/pi-flow-core/skills/_shared/orchestrator-verification-boundary.md` — Lists `parse-verifier-report.py` as a sanctioned helper; forbids orchestrator from synthesizing or overriding verdicts.

**Shared utilities:**
- `packages/pi-flow-core/skills/_shared/scripts/fence_aware.py` — `compute_in_fence_lines`, `split_h2_sections`; imported by `parse-verifier-report.py`.

**Tests and fixtures:**
- `packages/pi-flow-core/skills/execute-plan/scripts/tests/test_parse_verifier_report.py` — Comprehensive test suite; many tests assert that formatting defects produce `FAIL`.
- `packages/pi-flow-core/skills/execute-plan/scripts/tests/fixtures/verifier-report-pass.md` — Canonical strict-format PASS report.
- `packages/pi-flow-core/skills/execute-plan/scripts/tests/fixtures/verifier-report-fail.md` — Canonical strict-format FAIL report.
- `packages/pi-flow-core/skills/execute-plan/scripts/tests/fixtures/verifier-report-malformed.md` — Single criterion using `[Criterion 1] verdict: PASS` (forbidden pattern).
- `packages/pi-flow-core/skills/execute-plan/scripts/tests/fixtures/verifier-report-evidence-malformed.md` — Evidence block with missing `stderr:` field.
- `packages/pi-flow-core/skills/execute-plan/scripts/tests/fixtures/verifier-report-fenced-payload.md` — Verifies that heading-like content inside code fences is not mis-parsed.

**Plan extraction (criteria source, potential change point for `Verify:` split):**
- `packages/pi-flow-core/skills/execute-plan/scripts/extract-plan-tasks.py` — Emits `{"text": "...", "verify": "..."}` per criterion; `verify` is the full prose string passed downstream to both `assemble-verifier-prompt.py` and the orchestrator's `--phase1-recipes-json` argument.
- `packages/pi-flow-core/skills/execute-plan/scripts/tests/test_assemble_verifier_prompt.py` — Tests for prompt assembly, including recipe formatting and deduplication.

## Key Interfaces and Types

**`parse-verifier-report.py` CLI contract:**
```
python3 parse-verifier-report.py \
  --report <path>               # verifier report .md
  --criteria-count <int>        # K: total acceptance criteria
  [--phase1-recipes-json <path>] # JSON array [{criterion_n: int, recipe: str}]
```

**Output JSON shape (stdout):**
```json
{
  "verdict": "PASS" | "FAIL",
  "per_criterion": [
    {"criterion": <N>, "verdict": "PASS"|"FAIL", "reason": "<text>"}
  ],
  "phase1_evidence": {
    "<N>": {"command": "...", "exit_code": "...", "stdout": "...", "stderr": "..."}
  },
  "protocol_errors": ["<error message>", ...]
}
```

**Current final-verdict logic:**
```python
if protocol_errors or any_criterion_fail:
    final_verdict = "FAIL"
else:
    final_verdict = overall_verdict if overall_verdict else "FAIL"
```
There is no `"PASS_WITH_WARNINGS"` or `"REPAIRABLE"` state today.

**`validate_phase1_recipes` byte-equal contract:**
```python
if actual_command != recipe:   # byte-equal string comparison
    errors.append("verifier ran command not matching any phase-1 recipe: <actual>")
```
`recipe` is the literal `Verify:` line from the plan; `actual_command` is the `command:` field in the verifier's evidence block.

**Criterion header parsing (strict regex):**
```python
m = re.match(r"^\[Criterion (\d+)\]\s+(\S+)(.*)$", stripped)
# token must be exactly "PASS" or "FAIL", trailing.strip() must be empty
```

**Overall verdict parsing (strict regex):**
```python
m = re.match(r"^VERDICT:\s+(\S+)$", stripped)
# token must be exactly "PASS" or "FAIL"
```

**Plan criterion shape (from `extract-plan-tasks.py`):**
```json
{"text": "The script exits 0 on a clean plan.", "verify": "python3 scripts/foo.py --help"}
```
`verify` is a single prose string; there is no separate machine-command field. The orchestrator decides command-style vs. inspection-style at the `acceptance-criteria-verification.md` step b classification, which is not encoded in any script.

## Dependency / Call Graph

```
Plan file
  ↓ extract-plan-tasks.py (criteria[].verify = full Verify: prose)
  ↓
Orchestrator (execute-plan SKILL.md Step 11)
  ↓ classifies Verify: as command-style or inspection-style (no script; orchestrator judgment)
  ↓
assemble-verifier-prompt.py
  --phase1-recipes-json [{criterion_n, recipe}]   ← same recipe string as plan's Verify:
  → verify-task-prompt.md filled template
  ↓
verifier subagent (dispatched by orchestrator)
  → verifier report (.md): ## Phase 1 Evidence / ## Per-Criterion Verdicts / ## Overall Verdict
  ↓
parse-verifier-report.py
  --report <verifier-report.md>
  --criteria-count <K>
  --phase1-recipes-json <same array>   ← used for byte-equal command validation
  → JSON {verdict, per_criterion, phase1_evidence, protocol_errors}
  ↓
SKILL.md Step 11.2
  PASS  → Step 12 (commit)
  FAIL  → Step 13 (retries/escalation)
```

**No repair/tolerant bypass exists anywhere in this chain today.** Every `protocol_errors` entry triggers `FAIL` in the parser's final logic, and SKILL.md Step 11.2 routes `FAIL` + protocol errors identically to a genuine substantive failure.

## Patterns and Conventions

- **Fail-closed everywhere:** `parse-verifier-report.py` defaults to `FAIL` whenever any parse error, missing field, or byte-mismatch is found. The principle is explicit in SKILL.md Step 11.2: "Protocol errors never pass and are never silently interpreted as `PASS`."
- **Fence-aware parsing:** Both `parse-verifier-report.py` and `fence_aware.py` protect against heading-like or criterion-like content inside code fences being mis-parsed as structure. Any repair/tolerant path must inherit the same `compute_in_fence_lines` discipline.
- **Single-pass substitution:** `assemble-verifier-prompt.py` uses a single-pass non-recursive literal substitution so placeholder content in replacement values is never re-expanded. This convention should be preserved in any new scripts.
- **JSON-only stderr errors:** Protocol errors from scripts go to stdout as part of the structured JSON (`protocol_errors` array), with `sys.exit(1)` on failure. New scripts should follow the same stdout-JSON pattern.
- **`--phase1-recipes-json` is optional:** The parser accepts `None` for the flag; it only validates evidence blocks when the flag is provided. A tolerant path can similarly be opt-in.
- **Split H2 sections:** `split_h2_sections` from `fence_aware.py` is the canonical way to split a verifier report into `Phase 1 Evidence`, `Per-Criterion Verdicts`, and `Overall Verdict`. Used in `parse-verifier-report.py` `main()`. Any reformatter must use the same utility.
- **`_shared` import pattern:** Scripts in `skills/execute-plan/scripts/` add the `_shared/scripts` directory to `sys.path` to import `fence_aware`. New scripts should follow the same `sys.path.insert(0, ...)` pattern.
- **Test fixtures for each protocol variant:** Every distinct report shape has its own `scripts/tests/fixtures/verifier-report-*.md`. New protocol shapes (tolerant, repaired) should each get a dedicated fixture file.
- **Recipe classification is orchestrator-only, not scripted:** The decision of which `Verify:` recipe is command-style vs. inspection-style is made by the orchestrator at runtime per `acceptance-criteria-verification.md` step b. No script performs this classification. If the task adds a machine-command field, `extract-plan-tasks.py` would need to detect and emit it.

## Existing Tests and Test Patterns

All tests are in `packages/pi-flow-core/skills/execute-plan/scripts/tests/test_parse_verifier_report.py`. Tests run the script as a subprocess and parse JSON stdout.

**Currently passing (strict format) tests:**
- `TestPassReport` — fixture `verifier-report-pass.md`, 2 criteria, exit 0, `"PASS"`.
- `TestFailReport` — fixture `verifier-report-fail.md`, per-criterion FAIL, exit 1, `"FAIL"`.
- `TestMalformedHeader` — fixture `verifier-report-malformed.md` (`verdict:` prefix), exit 1, protocol errors non-empty.

**Tests that assert strict FAIL on formatting defects (would need new cases for tolerant path):**
- `TestLowercaseVerdict` — `[Criterion 1] pass` → protocol error, exit 1.
- `TestExtraTokensAfterVerdict` — `[Criterion 1] PASS extra` → protocol error, `per_criterion == []`, exit 1.
- `TestDuplicateCriterion` — duplicate `[Criterion 1]` header → error.
- `TestMissingCriterion` — missing `[Criterion 2]` out of 3 → error.
- `TestOutOfRangeCriterion` — `[Criterion 4]` when K=3 → error.
- `TestEvidenceBlockMissingField` — missing `stderr:` field in evidence block → error.
- `TestMissingEvidenceBlock` — no evidence block for command criterion → error.
- `TestCommandNotMatchingRecipe` — `python3 myscript.py --wrong-flag` vs. recipe `python3 myscript.py --help` → byte-mismatch error.
- `TestExtraEvidenceCommand` — evidence block command not in any recipe → error.
- `TestPerCriterionFailOverridesOverallPass` — per-criterion FAIL forces final FAIL even with `VERDICT: PASS`.

**Tests for advanced fence handling (must be preserved):**
- `TestFencedPayload` — heading-like content inside fences is not parsed as structure.
- `TestFencedSectionDelimiter` — fenced `## Fake Section` doesn't split sections.
- `TestFencedReasonExtraction` — fenced `[Criterion N] FAIL` inside reason doesn't create a criterion.

**Absent test coverage (gap for this task):**
- Human-readable PASS format with clear unambiguous evidence (the `f6eac473` scenario).
- Common real-world formatting variants: `[Criterion 1] PASS — all checks passed` (extra tokens), `verdict: pass` lowercase, mixed-case overall `VERDICT: pass`.
- Command-field paraphrase: verifier ran effectively the same command but not byte-equal (e.g., surrounding whitespace, equivalent path).
- Semantic-pass-with-protocol-warnings output shape in parser JSON.
- Repair helper: input of non-conforming report + recipe list → output of strict-format report with verbatim evidence preserved.
- Repairable vs. non-repairable distinction: reports with missing evidence or FAIL evidence must not pass through the tolerant path.

## Risk Areas

1. **Safety regression: tolerant path accepting ambiguous or partial evidence.** The most critical invariant is that a verifier report with any missing criterion, missing evidence for a command-style criterion, failing exit code, or ambiguous PASS/FAIL wording must not be accepted silently. The tolerant path must enumerate precisely which defects are "protocol-only" (formatting) vs. substantive (missing/failing evidence). The current list of protocol errors mixes both: `verifier phase-1 evidence block malformed at criterion N: stderr field missing` is protocol-only, but `verifier missing evidence block for command-style criterion N` is substantive (evidence is genuinely absent).

2. **Byte-equal command matching vs. command-field paraphrase.** The `validate_phase1_recipes` check is strict by design: the verifier's `command:` field must be byte-equal to the recipe. The root failure in `f6eac473` may be the verifier slightly reformatting the command (e.g., trimming a path, substituting a shell variable, or altering quoting). A tolerant path that normalizes whitespace or canonicalizes paths would need to be defined very carefully to avoid silently passing a verifier that ran a different command than intended.

3. **Coverage completeness in the tolerant path.** The tolerant parser must still verify that every criterion from 1..K is present and has an unambiguous PASS verdict. If criterion 2 is simply absent from a human-formatted report, that must remain a hard error, not a warning.

4. **Orchestrator-verification boundary compliance.** Any mechanical report reformatter must stay within the boundary defined in `orchestrator-verification-boundary.md`: it must reformat structure without creating or changing evidence, and must be listed as a sanctioned helper. The reformatter must not inspect implementation files or synthesize any evidence. If implemented as a subagent, it must not run commands.

5. **`protocol_errors` field semantics change.** Current callers of `parse-verifier-report.py` (the orchestrator in SKILL.md Step 11.2) treat any non-empty `protocol_errors` as a hard `FAIL`. Adding a `semantic_pass_with_protocol_warnings` path changes this contract: the orchestrator will need to distinguish "protocol errors that forced FAIL" from "protocol warnings that were overridden by clear evidence." The JSON output shape and SKILL.md routing must be updated atomically.

6. **`--phase1-recipes-json` flag is optional; tolerant path must handle its absence.** When `--phase1-recipes-json` is not provided, there is no recipe set to validate commands against. The tolerant path for command-field mismatch only applies when the flag is present. The no-flag path should remain unchanged.

7. **Fence-aware parsing must be preserved in any new script.** The existing `compute_in_fence_lines` discipline prevents heading-like lines inside code fences from being treated as structure. A repair script that re-emits a reformatted report must not strip or alter fenced content.

8. **Test suite backward compatibility.** Many existing tests assert strict `FAIL` on formatting defects (lowercase, extra tokens, command mismatch). If the tolerant path promotes some of these to warnings, these tests must be updated carefully: tests for _truly ambiguous_ defects (e.g., missing criterion) must still assert FAIL, while tests for _purely formatting_ defects (e.g., extra trailing token after PASS) could move to assert `PASS_WITH_WARNINGS` or similar, only when all evidence is clearly present. The boundary between the two categories must be explicit and tested.

## Possible Misses

1. **Recipe classification script absent.** `acceptance-criteria-verification.md` step b says the orchestrator "classifies" each `Verify:` recipe as command-style or inspection-style, but no script performs this. The orchestrator LLM does it at runtime. If the root cause of recipe mismatch is the orchestrator misclassifying a prose recipe as command-style when it isn't (passing a natural-language sentence as `--phase1-recipes-json`), the fix may be at this classification step rather than in the parser.

2. **`f6eac473` is in a different repo.** The `f6eac473` reference in the idea points to `pi-mux-subagents`, not `pi-flow`. The exact Wave 1 verifier reports from that failure are not present in this repo as test fixtures. A true regression fixture for the `f6eac473` scenario would need to be constructed from the idea description (clear per-criterion PASS evidence with protocol formatting defects), not extracted from `pi-mux-subagents`.

3. **`per_criterion` is only populated for well-formed headers.** In `parse_per_criterion_verdicts`, a header with a malformed token is added to `errors` but NOT to `seen`, so `per_criterion` is empty for that criterion. A tolerant path would need to separately record "fuzzy-matched PASS/FAIL" criteria vs. "failed to parse" to make a safety determination.

4. **Verifier prompt's "BYTE-EQUAL VERBATIM" instruction.** The template `verify-task-prompt.md` explicitly tells the verifier to run recipes "BYTE-EQUAL VERBATIM." If this instruction is followed, command mismatch should not occur in practice. Mismatch likely occurs when the verifier's model doesn't faithfully copy the recipe text, possibly because the recipe contains prose mixed with a command and the model extracts only the command portion. Splitting `Verify:` into separate `command:` and `success_condition:` fields would fix the mismatch at source by giving the verifier an unambiguous machine-runnable field.

5. **`assemble-verifier-prompt.py` formats recipes as `[Recipe for Criterion N] <recipe>`** — if the `recipe` value is full prose like `"Run the script and check exit code is zero"`, the verifier is instructed to run that as a bash command BYTE-EQUAL. This is likely a source of failures for inspection-style criteria that the orchestrator incorrectly classifies as command-style. The tolerant path alone won't fix this root case.

6. **The existing `TestExtraTokensAfterVerdict` test asserts `per_criterion == []`** for `[Criterion 1] PASS extra`. Any tolerant path that fuzzy-matches such a header would need to change this assertion. This test is protecting against a genuine risk (criterion-level verdicts should not be fabricated from ambiguous tokens), so the tolerant path must be carefully scoped to cases where PASS is unambiguous.

## Open Questions / Ambiguities

1. **Where should tolerance live?** Three candidate locations: (a) add fuzzy parsing and a `semantic_pass_with_protocol_warnings` result field inside `parse-verifier-report.py`; (b) add a new `repair-verifier-report.py` script that mechanically reformats a non-conforming report into strict format, preserving evidence verbatim, before passing it through the strict parser; (c) add orchestrator routing in SKILL.md Step 11.2 that invokes a `report-reformatter` subagent when the strict parser returns only protocol-formatting errors. Each approach has different atomicity and safety tradeoffs.

2. **Is user confirmation required before accepting a semantic PASS with protocol warnings?** The idea asks this explicitly. Automatic acceptance is ergonomically superior; gated acceptance is safer. The answer affects SKILL.md routing (Step 11.2) and the UX of the retry loop.

3. **Should `Verify:` be split into separate machine-command and success-condition fields?** This change would touch: `extract-plan-tasks.py` (output schema), `assemble-verifier-prompt.py` (formatting), `verify-task-prompt.md` (template), `acceptance-criteria-verification.md` (step b classification), and the `generate-plan` skill (criterion authoring instructions). It is the most thorough fix for command-field mismatch but is also the highest-impact change.

4. **Exactly which protocol errors are "protocol-only formatting defects" vs. substantive failures?** The task does not enumerate this precisely. Candidates for "protocol-only" (repairable): lowercase `[Criterion N] pass`, extra trailing tokens (`[Criterion N] PASS — confirmed`), mixed-case `verdict: pass` overall. Candidates that must remain hard FAIL: missing criterion header, missing evidence block for a command criterion, failing exit code in evidence, duplicate criterion, out-of-range criterion. The boundary must be documented and tested.

5. **Should the mechanical reformatter be a Python script (deterministic) or a subagent (LLM-powered)?** A Python script can only handle specific known variant patterns; an LLM-powered reformatter can handle arbitrary human-readable prose but introduces non-determinism and a potential for evidence alteration. The orchestrator-verification boundary requires that evidence is preserved verbatim.

6. **Does the tolerant path need to handle the no-`--phase1-recipes-json` case?** When no recipes file is provided, there is nothing to byte-compare commands against. The tolerant path for command mismatch is only meaningful when the recipes flag is present. The no-flag path must be unaffected.
