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
