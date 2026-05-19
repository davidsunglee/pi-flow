# Integration regression gate

## Why this exists

This file is the single canonical definition of the baseline-only integration tracking model + reconciliation algorithm + canonical user-facing summary format AND the gate procedure that uses them. It documents the data model, identifier contract, per-run inputs and reconciliation rules, pass/fail classification, user-facing summary format, worked examples, and the capture/reconcile gate modes invoked by `execute-plan` Steps 7, 12, and 16.

## Identifier contract

A **stable identifier** is the suite-native unique name for a single failing test, taken verbatim from the runner output. No normalization is applied: no lowercasing, no reordering of path components, no synthesis from multiple fields. The identifier is the exact string the runner emits to name the failing test.

**Narrow exception — Go.** `go test ./...` does not print a single line containing both the package path and the failing test name; instead, the package is printed on the trailing `FAIL\t<package>\t<duration>` summary line and the test name on a separate `--- FAIL: <TestName>` line. For Go, the canonical suite-native stable identifier is the package-qualified test name `<package>.<TestName>`, constructed by joining the package printed by `go test ./...` on its `FAIL\t<package>\t<duration>` summary line with the failing `<TestName>` from the corresponding `--- FAIL: <TestName>` line, separated by a single `.`. Both components are taken verbatim from the runner's output; only the `.` join is added. This is the only synthesis permitted by the contract, and the resulting string is treated as a fully stable identifier for byte-for-byte comparison. All other runners follow the strict no-synthesis rule above.

Any failure for which no stable suite-native identifier is available (panics before test execution, collection errors, process crashes) is a **non-reconcilable failure**. Non-reconcilable failures are recorded verbatim under the `NON_RECONCILABLE_FAILURES:` block of the test-runner artifact. They are never placed in `FAILING_IDENTIFIERS:` and never used as set members for comparison.

See `agent/agents/test-runner.md` for the per-runner extraction rules that produce `FAILING_IDENTIFIERS:` and `NON_RECONCILABLE_FAILURES:`.

**Using an arbitrary output line as a stand-in identifier is forbidden.** A synthesized or ad-hoc identifier derived from raw failure output re-introduces the unreliable equality problem that the non-reconcilable bucket exists to solve.

All consumers — Step 7, Step 12, the Debugger-first re-test, Step 16 — compare stable identifiers byte-for-byte and never apply a normalization step.

## Tracked state

Exactly one set is tracked persistently across waves:

**`baseline_failures`** — the set of stable identifiers captured by the baseline run. Frozen at the end of Step 7. Never mutated thereafter, regardless of what any later integration run produces.

This is the ONLY persistent set across waves. There is no persistent set of deferred regressions, no persistent set of regressions discovered after some earlier continuation, and no persistent non-reconcilable state.

Each later integration run (Step 12, Step 16) is judged solely by comparing that run's artifact against `baseline_failures`. When a user selects `(c) Continue despite failures` on an intermediate wave, this does NOT mutate `baseline_failures` and does NOT persist any other identifier set across waves.

## Per-run inputs and reconciliation

After every integration test run, compute three transient values from the run artifact, classify pass/fail, then discard them:

- **`current_failing_stable`** := the contents of `FAILING_IDENTIFIERS:` in the run artifact.
- **`current_non_reconcilable`** := the contents of `NON_RECONCILABLE_FAILURES:` in the run artifact. Treated as an opaque list of evidence entries. Never used as set members for comparison.
- **`current_non_baseline_stable`** := `current_failing_stable \ baseline_failures` (set difference, byte-for-byte). This is the set of stable failures in the current run that were not present at baseline.

`current_non_reconcilable` is never compared, intersected, or subtracted against any other set. Its only role is to gate the pass/fail outcome and populate the non-reconcilable section of the user-facing summary.

**Rationale:** Comparing non-reconcilable evidence by raw-line equality is unreliable. Two runs of the same underlying crash or collection error will often emit differently formatted stack traces, differing line numbers, or different timing data, causing a byte-for-byte comparison to report a spurious "new" failure. The non-reconcilable bucket prevents this by keeping such evidence entirely out of the identifier comparison path.

## Pass/fail classification

**Post-wave (Step 12):**

- **Pass:** `current_non_baseline_stable` is empty AND `current_non_reconcilable` is empty. Proceed to the next wave (or the final gate if this was the last wave). Format the user-facing summary per the [User-facing summary format](#user-facing-summary-format) section below.
- **Fail:** `current_non_baseline_stable` is non-empty OR `current_non_reconcilable` is non-empty. Present the three-section report followed by the failure menu.
  - For waves before the final wave: `(d) Debug failures now / (c) Continue despite failures / (x) Stop plan execution`
  - For the final wave: `(d) Debug failures now / (x) Stop plan execution`

**Final gate (Step 16):**

- **Pass:** `current_non_baseline_stable` is empty AND `current_non_reconcilable` is empty.
- **Fail:** `current_non_baseline_stable` is non-empty OR `current_non_reconcilable` is non-empty. Present the three-section report followed by the menu: `(d) Debug failures now / (x) Stop execution`.

A non-empty `current_non_reconcilable` alone is sufficient to fail the gate, even when `current_non_baseline_stable` is empty (zero stable failures but a crash or collection error still blocks the gate).

## User-facing summary format

**Fully clean** — `current_failing_stable`, `current_non_reconcilable`, and `baseline_failures ∩ current_failing_stable` are all empty. Render:

```
✅ Integration tests pass after wave <N> (no failures).
```

Do not render the three-section block.

**Not fully clean** — render the three-section block in this order, with these exact section headings:

```
<header line — see below>

### Baseline failures
<list of stable identifiers in baseline_failures ∩ current_failing_stable, or `(none)` if empty>

### Current non-baseline failures
<list of stable identifiers in current_non_baseline_stable, or `(none)` if empty>

### Current non-reconcilable failures
<list of evidence entries from current_non_reconcilable, or `(none)` if empty>
```

Header line variants:

- **Pass path** (both `current_non_baseline_stable` and `current_non_reconcilable` are empty, but `baseline_failures ∩ current_failing_stable` is non-empty):
  `✅ Integration tests pass after wave <N> (no new failures; baseline failures remain — see below).`
- **Fail path (Step 12):**
  `❌ Integration tests failed after wave <N>.`
- **Fail path (Step 16 final gate):**
  `❌ Integration tests failed at final gate.`

All three sections MUST be present even when empty. Empty sections render as `(none)` — one line, the literal string `(none)`. The section headings MUST be the exact strings `Baseline failures`, `Current non-baseline failures`, and `Current non-reconcilable failures`.

## Gate procedure

The callers of this file invoke one of two modes.

### Capture mode (Step 7's caller)

- **Inputs:** `(test_command, working_dir, artifact_path)`.
- **Behavior:** invoke the test-runner-dispatch protocol once (per `skills/_shared/test-runner-dispatch.md`); on success, classify the baseline as one of `clean` / `stable-failures-only` / `contains-non-reconcilable-evidence` per the existing rules in [Pass/fail classification](#passfail-classification); record `baseline_failures` from the artifact's `FAILING_IDENTIFIERS:` block.
- **Output:** `(classification, baseline_failures)`.
- **Freeze contract:** `baseline_failures` is never mutated for the rest of the run; this file is the source of truth for the freeze rule.

### Reconcile mode (Steps 12 / 12-debugger / 16 callers)

- **Inputs:** `(test_command, working_dir, artifact_path, baseline_failures)`.
- **Behavior:** invoke the test-runner-dispatch protocol; compute `current_failing_stable`, `current_non_reconcilable`, `current_non_baseline_stable := current_failing_stable \ baseline_failures`; classify pass/fail per the existing rules in [Pass/fail classification](#passfail-classification); render the canonical three-section user-facing summary string per the existing [User-facing summary format](#user-facing-summary-format) section.
- **Output:** `(classification, summary_string, current_non_baseline_stable, current_non_reconcilable)`.

## Out of scope (caller's responsibility)

This file documents the data model + summary + capture/reconcile mechanics. UX sits in callers (typically `execute-plan/SKILL.md`). The following are explicitly NOT this file's concern:

1. **Menus** — intermediate-wave `(d)/(c)/(x)`, final-wave `(d)/(x)`, final-gate `(d)/(x)` prompts and their wording.
2. **Post-wave commit semantics** — when and how the orchestrator commits after a wave.
3. **Debug-vs-continue-vs-stop UX** — how the orchestrator interprets and routes the user's menu selection.
4. **Retry-budget interactions** — how repeated debug attempts interact with any retry budget.

## Callers

Known callers and the mode each invokes:

- `execute-plan` Step 7 — **capture mode**.
- `execute-plan` Step 12.2 post-wave — **reconcile mode**.
- `execute-plan` Step 12 Debugger-first re-test — **reconcile mode**.
- `execute-plan` Step 16 final-gate — **reconcile mode**.

The integration-regression-debugging.md flow's success condition is "re-enter reconcile mode and assert both `current_non_baseline_stable` and `current_non_reconcilable` are empty."

## Worked examples

### Go (`go test ./...`)

```
--- FAIL: TestFoo (0.01s)
    foo_test.go:42: expected 1, got 2
FAIL    github.com/example/myrepo/pkg/foo    0.012s
```

```
FAILING_IDENTIFIERS_COUNT: 1
FAILING_IDENTIFIERS:
github.com/example/myrepo/pkg/foo.TestFoo
END_FAILING_IDENTIFIERS
NON_RECONCILABLE_COUNT: 0
NON_RECONCILABLE_FAILURES:
END_NON_RECONCILABLE_FAILURES
```

The identifier is `<package>.<TestName>`, constructed per the Go exception in the [Identifier contract](#identifier-contract) above: the package portion (`github.com/example/myrepo/pkg/foo`) is the module path the runner prints verbatim after `FAIL\t` on the summary line, the test-name portion (`TestFoo`) is taken verbatim from the `--- FAIL: TestFoo` line, and the two components are joined with a single `.`. The combined string is NOT printed directly on the `--- FAIL:` line; the join is the narrow synthesis the contract explicitly permits for Go. `NON_RECONCILABLE_FAILURES:` has no lines between its markers because `NON_RECONCILABLE_COUNT` is `0`.

### pytest

```
FAILED tests/test_foo.py::TestX::test_bar - AssertionError: expected True
```

```
FAILING_IDENTIFIERS_COUNT: 1
FAILING_IDENTIFIERS:
tests/test_foo.py::TestX::test_bar
END_FAILING_IDENTIFIERS
NON_RECONCILABLE_COUNT: 0
NON_RECONCILABLE_FAILURES:
END_NON_RECONCILABLE_FAILURES
```

The identifier is the pytest nodeid as printed: `tests/test_foo.py::TestX::test_bar`.

### cargo test

```
failures:
    tests::name_of_test

test result: FAILED. 0 passed; 1 failed
```

```
FAILING_IDENTIFIERS_COUNT: 1
FAILING_IDENTIFIERS:
tests::name_of_test
END_FAILING_IDENTIFIERS
NON_RECONCILABLE_COUNT: 0
NON_RECONCILABLE_FAILURES:
END_NON_RECONCILABLE_FAILURES
```

The identifier is the module path as listed in the `failures:` block, taken verbatim.

### Jest / Vitest

```
FAIL src/foo.test.ts
  ✕ describe block > it should X (12 ms)
```

```
FAILING_IDENTIFIERS_COUNT: 1
FAILING_IDENTIFIERS:
src/foo.test.ts > describe block > it should X
END_FAILING_IDENTIFIERS
NON_RECONCILABLE_COUNT: 0
NON_RECONCILABLE_FAILURES:
END_NON_RECONCILABLE_FAILURES
```

The identifier is the file path and the full nested test name, joined with ` > ` exactly as the runner prints it.

### Crash / collection-failure (no stable identifier)

Two example shapes that produce non-reconcilable failures:

**(a) Go panic before any test-name line:**
```
panic: runtime error: index out of range [3] with length 2
goroutine 1 [running]:
github.com/example/myrepo/pkg/foo.init(...)
    /src/foo.go:10
```

**(b) pytest collection error:**
```
ERROR tests/test_x.py - ImportError: cannot import name 'bar' from 'mymodule'
    tests/test_x.py:5: in <module>
        from mymodule import bar
```

Both are recorded as one entry each in `NON_RECONCILABLE_FAILURES:` (verbatim multi-line evidence is permitted). `FAILING_IDENTIFIERS:` does NOT include any synthesized or ad-hoc fallback identifier for them.

```
FAILING_IDENTIFIERS_COUNT: 0
FAILING_IDENTIFIERS:
END_FAILING_IDENTIFIERS
NON_RECONCILABLE_COUNT: 2
NON_RECONCILABLE_FAILURES:
panic: runtime error: index out of range [3] with length 2
goroutine 1 [running]:
github.com/example/myrepo/pkg/foo.init(...)
    /src/foo.go:10

ERROR tests/test_x.py - ImportError: cannot import name 'bar' from 'mymodule'
    tests/test_x.py:5: in <module>
        from mymodule import bar
END_NON_RECONCILABLE_FAILURES
```

`FAILING_IDENTIFIERS:` has no lines between its markers because `FAILING_IDENTIFIERS_COUNT` is `0`. Each non-reconcilable entry spans multiple lines and entries are separated from each other by a single blank line.

Because `current_non_reconcilable` is non-empty, the orchestrator presents the menu defined in `## Pass/fail classification` for the appropriate phase rather than treating the failures as comparable to baseline.
