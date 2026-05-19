#!/usr/bin/env python3
"""
Parse a refine-code coordinator summary and emit structured JSON.

Failure labels emitted by this script (to stderr as JSON):
  status_missing
  status_unrecognized
  summary_block_missing
  summary_field_missing
  summary_field_malformed
  review_file_missing
  review_file_block_empty
  unexpected_remaining_issues
  unexpected_failure_reason
  missing_failure_reason

Section bodies are extracted with the shared fence-aware H2 splitter; embedded
fenced `## ` lines (e.g., copied reviewer markdown inside `## Remaining Issues`)
are not mistaken for real section boundaries.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared", "scripts"))
from fence_aware import compute_in_fence_lines, split_h2_sections

VALID_STATUSES = {"approved", "approved_with_concerns", "not_approved_within_budget", "failed"}

ISSUES_FOUND_RE = re.compile(
    r"^Issues found: (\d+) \((\d+) Critical, (\d+) Important, (\d+) Minor\)$"
)


def fail(label, detail=None):
    err = {"failure": label}
    if detail is not None:
        err["detail"] = detail
    print(json.dumps(err), file=sys.stderr)
    sys.exit(1)


def parse_summary_block(block_text):
    """Parse the ## Summary block. Returns dict or calls fail().

    Fence-aware: lines inside a fenced code block within the Summary section are
    ignored, so fake `Iterations:` / `Issues found:` / etc. labels embedded in a
    fenced payload cannot overwrite the real field values.
    """
    raw_lines = block_text.splitlines(keepends=True)
    in_fence = compute_in_fence_lines(raw_lines)
    lines = [
        raw.strip()
        for idx, raw in enumerate(raw_lines)
        if idx not in in_fence and raw.strip()
    ]
    fields = {}
    for line in lines:
        if line.startswith("Iterations:"):
            fields["iterations"] = line[len("Iterations:"):].strip()
        elif line.startswith("Issues found:"):
            fields["issues_found_line"] = line
        elif line.startswith("Issues fixed:"):
            fields["issues_fixed"] = line[len("Issues fixed:"):].strip()
        elif line.startswith("Issues remaining:"):
            fields["issues_remaining"] = line[len("Issues remaining:"):].strip()

    if "iterations" not in fields:
        fail("summary_field_missing", "iterations field missing from Summary block")

    try:
        iterations = int(fields["iterations"])
    except ValueError:
        fail("summary_field_malformed", f"iterations value is not an integer: {fields['iterations']!r}")

    if "issues_found_line" not in fields:
        fail("summary_field_missing", "issues found field missing from Summary block")

    m = ISSUES_FOUND_RE.match(fields["issues_found_line"])
    if not m:
        fail("summary_field_malformed", f"Issues found line malformed: {fields['issues_found_line']!r}")
    total, critical, important, minor = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))

    if "issues_fixed" not in fields:
        fail("summary_field_missing", "issues_fixed field missing from Summary block")
    try:
        issues_fixed = int(fields["issues_fixed"])
    except ValueError:
        fail("summary_field_malformed", f"issues_fixed value is not an integer: {fields['issues_fixed']!r}")

    if "issues_remaining" not in fields:
        fail("summary_field_missing", "issues_remaining field missing from Summary block")
    try:
        issues_remaining = int(fields["issues_remaining"])
    except ValueError:
        fail("summary_field_malformed", f"issues_remaining value is not an integer: {fields['issues_remaining']!r}")

    return {
        "iterations": iterations,
        "issues_found_total": total,
        "issues_found_critical": critical,
        "issues_found_important": important,
        "issues_found_minor": minor,
        "issues_fixed": issues_fixed,
        "issues_remaining": issues_remaining,
    }


def parse_review_file_block(block_text):
    """Parse the ## Review File block. Returns the path string or calls fail()."""
    for line in block_text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    fail("review_file_block_empty", "## Review File block present but no path line found")


def parse_failure_reason_block(block_text):
    """Parse the ## Failure Reason block. Returns the one-line text."""
    for line in block_text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return None


def parse_remaining_issues_block(block_text):
    """Return verbatim content of ## Remaining Issues block (stripped of leading/trailing blank lines)."""
    return block_text.strip()


def main():
    parser = argparse.ArgumentParser(
        description="Parse a refine-code coordinator summary and emit structured JSON.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Failure labels (emitted as JSON to stderr on non-zero exit):
  status_missing              — no STATUS: line found as first non-empty line
  status_unrecognized         — STATUS value not in {approved, approved_with_concerns, not_approved_within_budget, failed}
  summary_block_missing       — ## Summary section absent
  summary_field_missing       — a required field is absent within ## Summary
  summary_field_malformed     — a field value cannot be parsed (e.g. non-integer)
  review_file_missing         — ## Review File section absent
  review_file_block_empty     — ## Review File present but no path line
  unexpected_remaining_issues — ## Remaining Issues present for a non-not_approved_within_budget status
  unexpected_failure_reason   — ## Failure Reason present for a non-failed status
  missing_failure_reason      — STATUS: failed but ## Failure Reason section absent
""",
    )
    parser.add_argument(
        "--summary",
        required=True,
        help="Path to the summary file, or '-' to read from stdin",
    )
    args = parser.parse_args()

    if args.summary == "-":
        text = sys.stdin.read()
    else:
        try:
            with open(args.summary, "r") as f:
                text = f.read()
        except OSError as exc:
            print(json.dumps({
                "failure": "input missing or unreadable",
                "input": "summary",
                "path": args.summary,
                "error": str(exc),
            }), file=sys.stderr)
            sys.exit(2)

    lines = text.splitlines()

    # Find STATUS line as first non-empty line
    status = None
    status_line_idx = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped:
            m = re.match(r"^STATUS: (.+)$", stripped)
            if m:
                status = m.group(1).strip()
                status_line_idx = i
            break

    if status is None:
        fail("status_missing", "no STATUS: line found as first non-empty line")

    if status not in VALID_STATUSES:
        fail("status_unrecognized", f"unrecognized status value: {status!r}")

    # Reconstruct the content after the STATUS line for section parsing
    body = "\n".join(lines[status_line_idx + 1:])
    sections = split_h2_sections(body)

    # Validate required ## Summary block
    if "Summary" not in sections:
        fail("summary_block_missing", "## Summary section is missing")

    summary = parse_summary_block(sections["Summary"])

    # Validate ## Review File block
    if "Review File" not in sections:
        fail("review_file_missing", "## Review File section is missing")

    review_file = parse_review_file_block(sections["Review File"])

    # Parse optional blocks. The coordinator prompt documents the heading as
    # "## Remaining Issues (only if not_approved_within_budget)"; accept either
    # that exact heading or the bare "## Remaining Issues" form.
    remaining_issues = None
    for key in sections:
        if key == "Remaining Issues" or key.startswith("Remaining Issues "):
            remaining_issues = parse_remaining_issues_block(sections[key])
            break

    failure_reason = None
    if "Failure Reason" in sections:
        failure_reason = parse_failure_reason_block(sections["Failure Reason"])

    # Per-status semantic validation
    if status != "not_approved_within_budget" and remaining_issues is not None:
        fail("unexpected_remaining_issues", f"## Remaining Issues present but status is {status!r}")

    if status != "failed" and failure_reason is not None:
        fail("unexpected_failure_reason", f"## Failure Reason present but status is {status!r}")

    if status == "failed" and failure_reason is None:
        fail("missing_failure_reason", "STATUS: failed but ## Failure Reason section is absent or empty")

    result = {
        "status": status,
        **summary,
        "review_file": review_file,
        "remaining_issues": remaining_issues if remaining_issues else None,
        "failure_reason": failure_reason,
    }

    print(json.dumps(result, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
