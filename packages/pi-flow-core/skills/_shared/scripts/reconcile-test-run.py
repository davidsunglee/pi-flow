#!/usr/bin/env python3
"""
reconcile-test-run.py — Baseline capture and per-run reconciliation helper.

Two modes:

  capture    (Step 7 baseline): Runs parse-test-runner-artifact.py against the
             artifact and emits a baseline snapshot JSON. That JSON is itself a
             valid baseline file for later reconcile mode. Classifies the run as
             clean, stable-failures-only, or contains-non-reconcilable-evidence.

  reconcile  (Steps 12.2/14/16): Compares current run against a saved baseline
             and reports whether any new failures appear.

Protocol error labels (emitted in stderr JSON .failure on non-zero exit):
  baseline_failures_invalid          -- baseline JSON missing, malformed, or wrong shape
  artifact_missing_or_empty          -- propagated from parse-test-runner-artifact.py
  header_missing                     -- propagated from parse-test-runner-artifact.py
  header_out_of_order                -- propagated from parse-test-runner-artifact.py
  exit_code_malformed                -- propagated from parse-test-runner-artifact.py
  count_field_malformed              -- propagated from parse-test-runner-artifact.py
  failing_identifiers_count_mismatch -- propagated from parse-test-runner-artifact.py
  non_reconcilable_count_mismatch    -- propagated from parse-test-runner-artifact.py
  raw_output_marker_missing          -- propagated from parse-test-runner-artifact.py
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

PARSE_SCRIPT = Path(__file__).resolve().parent / "parse-test-runner-artifact.py"


def _fail(failure, detail=""):
    json.dump({"failure": failure, "detail": detail}, sys.stderr)
    sys.stderr.write("\n")
    sys.exit(1)


def _parse_artifact(artifact_path):
    result = subprocess.run(
        [sys.executable, str(PARSE_SCRIPT), "--artifact", artifact_path],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        sys.exit(result.returncode)
    return json.loads(result.stdout)


def _load_baseline(path):
    try:
        with open(path, "r") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        _fail("baseline_failures_invalid", f"could not parse {path}")

    if not isinstance(data, dict):
        _fail("baseline_failures_invalid", "baseline must be a JSON object")
    if "failing_identifiers" in data:
        baseline = data["failing_identifiers"]
    elif "baseline_failures" in data:
        baseline = data["baseline_failures"]
    else:
        _fail("baseline_failures_invalid", "missing key: failing_identifiers or baseline_failures")

    if not isinstance(baseline, list):
        _fail("baseline_failures_invalid", "baseline failures must be a list")
    if not all(isinstance(x, str) for x in baseline):
        _fail("baseline_failures_invalid", "baseline failures must contain only strings")

    return baseline


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Protocol error labels (in stderr JSON .failure):
  baseline_failures_invalid          baseline JSON missing, malformed, or wrong shape
  artifact_missing_or_empty          artifact file missing or zero-byte
  header_missing                     a required header is absent from the file
  header_out_of_order                headers appear in the wrong order
  exit_code_malformed                EXIT_CODE value is not an integer
  count_field_malformed              FAILING_IDENTIFIERS_COUNT or NON_RECONCILABLE_COUNT not an integer
  failing_identifiers_count_mismatch raw line count != FAILING_IDENTIFIERS_COUNT
  non_reconcilable_count_mismatch    entry count != NON_RECONCILABLE_COUNT
  raw_output_marker_missing          '--- RAW RUN OUTPUT BELOW ---' line absent
""",
    )
    parser.add_argument("--artifact", required=True, metavar="PATH",
                        help="Path to the test-runner artifact file to parse.")
    parser.add_argument("--mode", required=True, choices=["capture", "reconcile"],
                        help="Operation mode: 'capture' to record baseline, 'reconcile' to compare.")
    parser.add_argument("--baseline-failures", metavar="PATH",
                        help="Path to baseline failures JSON (required when --mode reconcile).")
    args = parser.parse_args()

    if args.mode == "reconcile" and not args.baseline_failures:
        parser.error("--baseline-failures is required when --mode reconcile")

    parsed = _parse_artifact(args.artifact)
    failing_identifiers = parsed["failing_identifiers"]
    non_reconcilable_failures = parsed["non_reconcilable_failures"]
    exit_code = parsed["exit_code"]

    if args.mode == "capture":
        if non_reconcilable_failures:
            classification = "contains-non-reconcilable-evidence"
        elif failing_identifiers:
            classification = "stable-failures-only"
        else:
            classification = "clean"

        result = {
            "mode": "capture",
            "failing_identifiers": failing_identifiers,
            "baseline_failures": failing_identifiers,
            "non_reconcilable_at_baseline": non_reconcilable_failures,
            "classification": classification,
        }
        print(json.dumps(result, indent=2))
        sys.exit(0)

    # reconcile mode
    baseline_failures = _load_baseline(args.baseline_failures)
    baseline_set = set(baseline_failures)

    current_failing_stable = failing_identifiers
    current_non_reconcilable = non_reconcilable_failures
    current_non_baseline_stable = [
        x for x in current_failing_stable if x not in baseline_set
    ]

    if current_non_baseline_stable or current_non_reconcilable:
        classification = "fail"
    else:
        classification = "pass"

    result = {
        "mode": "reconcile",
        "current_failing_stable": current_failing_stable,
        "current_non_reconcilable": current_non_reconcilable,
        "current_non_baseline_stable": current_non_baseline_stable,
        "classification": classification,
    }
    print(json.dumps(result, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
