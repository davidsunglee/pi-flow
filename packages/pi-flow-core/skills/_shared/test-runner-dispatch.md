# Test-runner dispatch

## Why this exists

This file documents the four-input test-runner dispatch contract used today by `execute-plan` Step 7 (baseline capture), Step 12.2 (post-wave reconcile), Step 12 Debugger-first re-test, and Step 16 (final-gate reconcile), and plausibly by other future skills. Placement under `_shared/` (rather than `execute-plan/`) signals cross-skill reusability without committing to a public top-level Skill surface; promotion to a discoverable skill is deferred until a non-`execute-plan` caller exists.

## Inputs

The caller supplies exactly four inputs:

- **`test_command`** (string, required) — The bash command to run. Passed verbatim to test-runner; no flag injection, no expansion, no splitting.
- **`working_dir`** (absolute path, required) — Directory to run the command from.
- **`artifact_path`** (absolute path, required) — Where test-runner writes its single artifact. The caller owns the naming scheme.
- **`phase_label`** (string, optional) — When supplied and non-empty, filled into the artifact's `PHASE:` header line and into the dispatched prompt's phase section. When omitted or empty string, the dispatched prompt drops the phase section entirely and the artifact omits the `PHASE:` header line. Empty string is treated identically to omitted.

## Behavior

The caller follows this protocol in fixed order:

1. **Ensure parent directory exists.** Run `mkdir -p` on the parent directory of `artifact_path` before dispatch.
1.5. **Capture freshness baseline.** Immediately after `mkdir -p`, capture the pre-dispatch mtime of `artifact_path` so step 5 can validate that any on-disk artifact is fresh even if the marker line is missing. Bash form:

```bash
ARTIFACT_BASELINE=$(python3 -c "import os, sys; p=sys.argv[1]; print(os.path.getmtime(p) if os.path.exists(p) else 0)" "<artifact_path>")
```

Hold `ARTIFACT_BASELINE` across the dispatch.

2. **Resolve the dispatch envelope `(model, cli, executionPolicy)`.** Invoke `pi-flow helper _shared/resolve-model-dispatch --model-tier crossProviderModelTiers.efficient --agent test-runner --working-dir <working_dir>`. The tier is hardcoded as `crossProviderModelTiers.efficient`; it is not caller-configurable. On resolution failure, surface byte-equal canonical Templates (1)–(5) per `skills/_shared/dispatch-contract.md` and stop the call site.
3. **Fill the prompt template.** Fill `skills/_shared/test-runner-prompt.md` from the four inputs. Conditionally include the phase section based on `phase_label` presence/non-emptiness: the caller fills `{PHASE_SECTION}` with the literal block `## Phase Label\n\n<phase_label>\n` when supplied and non-empty, or with the empty string when omitted or empty.
4. **Dispatch.** Call `subagent_run_serial { tasks: [{ name: "test-runner: <phase label or 'no-phase'>", agent: "test-runner", task: <filled prompt>, model: <resolved>, cli: <resolved>, executionPolicy: <resolved> }] }`.
5. **Validate handoff and parse the artifact.** Validate the artifact handoff marker, then parse the artifact via `pi-flow helper _shared/parse-test-runner-artifact --artifact <artifact_path> --final-message <path-to-finalMessage-or-stdin> --expected-path <artifact_path> --freshness-baseline <ARTIFACT_BASELINE>`. When the parser's stdout JSON includes `used_fallback: true` (i.e., the test-runner did not emit a `TEST_RESULT_ARTIFACT:` terminal marker but the on-disk artifact is fresh and well-formed), the caller logs a one-line warning to the user. Additionally, when the parser's stdout JSON includes `exit0_override: true` — the test command exited `0` (an authoritative pass) but the test-runner reported non-empty `FAILING_IDENTIFIERS`/`NON_RECONCILABLE_FAILURES` buckets, which the deterministic layer discarded as contradictory per the exit-0 ⇒ empty-buckets contract — the caller logs a one-line warning to the user naming the discarded counts (`discarded_failing_identifiers_count`, `discarded_non_reconcilable_count`), for example: `⚠️ test-runner exited 0 (pass) but reported <D_f> stable + <D_n> non-reconcilable failure(s); treating the run as an authoritative pass and ignoring the contradictory buckets.`

## Output on success

The parser script returns a structured result with:

- **`exit_code`** (int) — Exit code from the test command.
- **`failing_identifiers`** (list) — Stable suite-native identifiers, parsed verbatim from the artifact.
- **`non_reconcilable_failures`** (list) — Evidence entries, parsed verbatim from the artifact.
- **`phase`** (string or null) — Phase label as recorded in the artifact; `null` when `phase_label` was omitted (the field is always present).
- **`command`** (string) — The test command as recorded in the artifact.
- **`working_directory`** (string) — Working directory as recorded in the artifact.
- **`timestamp`** (string) — Timestamp as recorded in the artifact.
- **`failing_identifiers_count`** (int) — Reconciled count.
- **`non_reconcilable_count`** (int) — Reconciled count.

When the exit-0 override fires, the parser additionally emits `exit0_override` (bool, present and `true` only when an `EXIT_CODE: 0` artifact carried non-empty buckets that were discarded), plus `discarded_failing_identifiers_count`, `discarded_non_reconcilable_count`, `discarded_failing_identifiers`, and `discarded_non_reconcilable_failures` for audit. `reconcile-test-run.py` propagates `exit0_override` and the two discarded counts into its capture/reconcile output. None of these fields appear when the exit code is non-zero or when the buckets were already empty — a passing run with no contradiction produces byte-for-byte today's output.

The parser does not echo `artifact_path` in its output; the caller already knows that path from the dispatch inputs.

A non-zero `exit_code` from the test command is **NOT** a protocol failure. It flows through to the caller as a successful protocol output for caller-side classification: the protocol succeeded; the test suite reported failures.

## Output on failure

Failures are reported as one of these structured reasons (label-style, not free-form prose):

- **`dispatch_unavailable`** — `subagent_run_serial` is not exposed in this environment.
- **`dispatch_failed`** — Test-runner dispatch returned an error (model unavailable, transport error, etc.).
- **`handoff_missing`** — No anchored `TEST_RESULT_ARTIFACT:` line in the dispatched final message AND the on-disk artifact at `artifact_path` is missing/empty/stale (the freshness-baseline fallback did not accept).
- **`handoff_path_mismatch`** — Marker path does not equal `artifact_path`.
- **`artifact_missing`** — File does not exist or is empty.
- **`artifact_malformed`** — `parse-test-runner-artifact.py` checks fail (header order, integer-parse, count reconciliation, raw-output marker, etc.). This also covers the `nonzero_exit_without_failure_evidence` protocol violation: a structurally valid artifact reporting `EXIT_CODE != 0` with both `FAILING_IDENTIFIERS` and `NON_RECONCILABLE_FAILURES` empty is rejected deterministically (it cannot be accepted as a clean baseline / pass), since the test-runner contract requires exactly one composite non-reconcilable entry whenever a command exits non-zero with no extractable stable identifier.

## Callers

Current callers, all in `skills/execute-plan/SKILL.md`:

- **Step 7** — baseline capture
- **Step 12.2** — post-wave reconcile
- **Step 12 Debugger-first re-test**
- **Step 16** — final-gate reconcile

Each caller owns the `artifact_path` naming scheme.
