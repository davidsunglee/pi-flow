#!/usr/bin/env python3
"""
Parse a test-runner artifact file and emit structured JSON.

Reads a structured artifact written by the test-runner subagent. Validates
headers in the required order, parses the FAILING_IDENTIFIERS and
NON_RECONCILABLE_FAILURES blocks, and emits a JSON summary to stdout.

Failure labels (emitted in stderr JSON .failure on non-zero exit):
  artifact_missing_or_empty  -- artifact file missing or zero-byte
  header_missing             -- a required header is absent from the file
  header_out_of_order        -- headers appear in the wrong order
  exit_code_malformed        -- EXIT_CODE value is not an integer
  count_field_malformed      -- FAILING_IDENTIFIERS_COUNT or NON_RECONCILABLE_COUNT not an integer
  failing_identifiers_count_mismatch  -- raw line count != FAILING_IDENTIFIERS_COUNT
  non_reconcilable_count_mismatch     -- entry count != NON_RECONCILABLE_COUNT
  raw_output_marker_missing  -- '--- RAW RUN OUTPUT BELOW ---' line absent

When --freshness-baseline is supplied together with --final-message and --expected-path,
a missing-marker fallback is performed: if the on-disk artifact is fresh (mtime > baseline)
and non-empty, the missing marker is accepted and the artifact's structural-format
validation is then run as today.

Success JSON output includes a top-level 'used_fallback' boolean:
  true  -- the missing-marker fallback was used for the marker portion of the parse
  false -- the marker was present and valid, or the handoff invocation was skipped
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path


RAW_MARKER = "--- RAW RUN OUTPUT BELOW ---"

KNOWN_VALUE_HEADERS = {
    "PHASE", "COMMAND", "WORKING_DIRECTORY", "EXIT_CODE",
    "TIMESTAMP", "FAILING_IDENTIFIERS_COUNT", "NON_RECONCILABLE_COUNT",
}
KNOWN_BARE_HEADERS = {
    "FAILING_IDENTIFIERS:", "END_FAILING_IDENTIFIERS",
    "NON_RECONCILABLE_FAILURES:", "END_NON_RECONCILABLE_FAILURES",
}


def _fail(failure, artifact, detail=""):
    json.dump({"failure": failure, "artifact": artifact, "detail": detail}, sys.stderr)
    sys.stderr.write("\n")
    sys.exit(1)


def _is_known_header(line):
    for name in KNOWN_VALUE_HEADERS:
        if line.startswith(f"{name}: ") or line == name:
            return True
    return line in KNOWN_BARE_HEADERS or line == RAW_MARKER


def _mismatch_label(expected, lines, current_index):
    """Return header_out_of_order if the expected header appears later; else header_missing."""
    remaining = lines[current_index:]
    for line in remaining:
        if line == expected or line.startswith(f"{expected}: "):
            return "header_out_of_order"
    return "header_missing"


def _expect_value(name, lines, i, artifact):
    """Consume line i as '<name>: <value>'. Returns (value, i+1) or calls _fail."""
    if i >= len(lines):
        _fail("header_missing", artifact, name)
    line = lines[i]
    prefix = f"{name}: "
    if line.startswith(prefix):
        return line[len(prefix):], i + 1
    label = _mismatch_label(name, lines, i)
    _fail(label, artifact, f"expected {name!r}, got {line!r}")


def _expect_bare(name, lines, i, artifact):
    """Consume line i as exactly 'name'. Returns i+1 or calls _fail."""
    if i >= len(lines):
        _fail("header_missing", artifact, name)
    line = lines[i]
    if line == name:
        return i + 1
    label = _mismatch_label(name, lines, i)
    _fail(label, artifact, f"expected {name!r}, got {line!r}")


def _split_non_reconcilable_entries(lines, expected_count=None):
    """Split lines on blank-line boundaries into multi-line entries.

    When the artifact declares exactly one non-reconcilable failure, treat the
    entire block as a single composite evidence entry even if the excerpt
    contains internal blank lines. The test-runner contract explicitly allows a
    one-entry composite failure when the runner cannot enumerate distinct
    events; stack traces and package-manager errors often contain blank lines.
    """
    entries = []
    current = []
    for line in lines:
        if line == "":
            if current:
                entries.append("\n".join(current))
                current = []
        else:
            current.append(line)
    if current:
        entries.append("\n".join(current))
    if expected_count == 1 and len(entries) > 1:
        return ["\n".join(lines)]
    return entries


def parse_artifact(path):
    try:
        with open(path, "r") as f:
            content = f.read()
    except OSError:
        _fail("artifact_missing_or_empty", path)

    if not content.strip():
        _fail("artifact_missing_or_empty", path)

    lines = content.splitlines()
    i = 0

    # PHASE: is optional — absent means phase=None; malformed (no value) is an error
    if i < len(lines) and lines[i].startswith("PHASE: "):
        phase = lines[i][len("PHASE: "):]
        i += 1
    elif i < len(lines) and (lines[i] == "PHASE" or lines[i] == "PHASE:"):
        _fail("header_missing", path, "PHASE header present but has no value")
    else:
        phase = None
    command, i = _expect_value("COMMAND", lines, i, path)
    working_directory, i = _expect_value("WORKING_DIRECTORY", lines, i, path)
    exit_code_raw, i = _expect_value("EXIT_CODE", lines, i, path)
    timestamp, i = _expect_value("TIMESTAMP", lines, i, path)
    failing_count_raw, i = _expect_value("FAILING_IDENTIFIERS_COUNT", lines, i, path)
    i = _expect_bare("FAILING_IDENTIFIERS:", lines, i, path)

    # Collect FAILING_IDENTIFIERS block lines
    failing_lines = []
    while i < len(lines) and lines[i] != "END_FAILING_IDENTIFIERS":
        failing_lines.append(lines[i])
        i += 1
    i = _expect_bare("END_FAILING_IDENTIFIERS", lines, i, path)

    non_rec_count_raw, i = _expect_value("NON_RECONCILABLE_COUNT", lines, i, path)
    i = _expect_bare("NON_RECONCILABLE_FAILURES:", lines, i, path)

    # Collect NON_RECONCILABLE_FAILURES block lines
    non_rec_lines = []
    while i < len(lines) and lines[i] != "END_NON_RECONCILABLE_FAILURES":
        non_rec_lines.append(lines[i])
        i += 1
    i = _expect_bare("END_NON_RECONCILABLE_FAILURES", lines, i, path)

    # Expect blank line then RAW_MARKER
    # Skip optional blank line
    if i < len(lines) and lines[i] == "":
        i += 1
    if i >= len(lines) or lines[i] != RAW_MARKER:
        _fail("raw_output_marker_missing", path)

    # Validate EXIT_CODE
    try:
        exit_code = int(exit_code_raw)
    except ValueError:
        _fail("exit_code_malformed", path, exit_code_raw)

    # Validate counts
    try:
        failing_count = int(failing_count_raw)
    except ValueError:
        _fail("count_field_malformed", path, f"FAILING_IDENTIFIERS_COUNT: {failing_count_raw}")

    try:
        non_rec_count = int(non_rec_count_raw)
    except ValueError:
        _fail("count_field_malformed", path, f"NON_RECONCILABLE_COUNT: {non_rec_count_raw}")

    # Validate FAILING_IDENTIFIERS count
    if len(failing_lines) != failing_count:
        _fail(
            "failing_identifiers_count_mismatch",
            path,
            f"declared {failing_count}, found {len(failing_lines)}",
        )

    # Deduplicate identifiers preserving first-occurrence order
    seen = set()
    failing_identifiers = []
    for ident in failing_lines:
        if ident not in seen:
            seen.add(ident)
            failing_identifiers.append(ident)

    # Parse non-reconcilable entries
    non_rec_entries = _split_non_reconcilable_entries(non_rec_lines, non_rec_count)
    if len(non_rec_entries) != non_rec_count:
        _fail(
            "non_reconcilable_count_mismatch",
            path,
            f"declared {non_rec_count}, found {len(non_rec_entries)}",
        )

    return {
        "phase": phase,
        "command": command,
        "working_directory": working_directory,
        "exit_code": exit_code,
        "timestamp": timestamp,
        "failing_identifiers_count": failing_count,
        "failing_identifiers": failing_identifiers,
        "non_reconcilable_count": non_rec_count,
        "non_reconcilable_failures": non_rec_entries,
    }


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Failure labels (in stderr JSON .failure):
  artifact_missing_or_empty          artifact file missing or zero-byte
  header_missing                     a required header is absent from the file
  header_out_of_order                headers appear in the wrong order
  exit_code_malformed                EXIT_CODE value is not an integer
  count_field_malformed              FAILING_IDENTIFIERS_COUNT or NON_RECONCILABLE_COUNT not an integer
  failing_identifiers_count_mismatch raw line count != FAILING_IDENTIFIERS_COUNT
  non_reconcilable_count_mismatch    entry count != NON_RECONCILABLE_COUNT
  raw_output_marker_missing          '--- RAW RUN OUTPUT BELOW ---' line absent

Success JSON output includes 'used_fallback' boolean: true when the missing-marker
fallback was used, false when the marker was present and valid or the handoff
invocation was skipped.
""",
    )
    parser.add_argument("--artifact", required=True, metavar="PATH",
                        help="Path to the test-runner artifact file to parse.")
    parser.add_argument("--final-message", metavar="PATH",
                        help="Path to the subagent final-message file (used with --expected-path).")
    parser.add_argument("--expected-path", metavar="PATH",
                        help="Expected artifact path extracted from --final-message.")
    parser.add_argument("--freshness-baseline", metavar="UNIX_MTIME",
                        help="Pre-dispatch mtime of the expected artifact. When supplied together with --final-message and --expected-path, a missing TEST_RESULT_ARTIFACT marker is acceptable if the on-disk artifact is fresh (mtime > baseline) and non-empty.")
    args = parser.parse_args()

    used_fallback = False
    if args.final_message and args.expected_path:
        handoff_script = Path(__file__).resolve().parent / "parse-artifact-handoff.py"
        argv = [
            sys.executable, str(handoff_script),
            "--marker", "TEST_RESULT_ARTIFACT",
            "--final-message", args.final_message,
            "--expected-path", args.expected_path,
            "--check-existence",
            "--check-non-empty",
        ]
        if args.freshness_baseline is not None:
            argv.extend(["--freshness-baseline", args.freshness_baseline])
        result = subprocess.run(
            argv,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            sys.stderr.write(result.stderr)
            sys.exit(result.returncode)
        handoff_data = json.loads(result.stdout)
        used_fallback = bool(handoff_data.get("used_fallback", False))

    data = parse_artifact(args.artifact)
    data["used_fallback"] = used_fallback
    print(json.dumps(data, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
