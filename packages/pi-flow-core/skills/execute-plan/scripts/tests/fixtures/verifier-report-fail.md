## Phase 1 Evidence

[Evidence for Criterion 1]
command: python3 myscript.py --help
exit_code: 0
stdout: usage: myscript.py [-h]
stderr:

[Evidence for Criterion 2]
command: python3 myscript.py --report report.md --criteria-count 2
exit_code: 1
stdout: {"verdict": "FAIL"}
stderr: error: something went wrong

## Per-Criterion Verdicts

[Criterion 1] PASS
reason: The --help flag exits 0 and shows usage.

[Criterion 2] FAIL
reason: The script returned a non-zero exit code.

## Overall Verdict

VERDICT: FAIL
