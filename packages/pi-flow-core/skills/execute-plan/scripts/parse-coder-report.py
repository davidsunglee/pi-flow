#!/usr/bin/env python3
"""
Parse a coder subagent report and emit structured JSON.

Output fields:
  status             — one of DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT
  files_changed      — list of file paths extracted from ## Files Changed bullets
  concerns_block     — verbatim text under ## Concerns / Needs / Blocker
  blocker_text       — concerns_block when status is BLOCKED, else null
  needs_text         — concerns_block when status is NEEDS_CONTEXT, else null
  tests_block        — verbatim text under ## Tests
  completed_block    — verbatim text under ## Completed
  self_review_block  — verbatim text under ## Self-Review Findings
  protocol_warnings  — list of non-fatal warning labels

Protocol-error labels (emitted to stderr as JSON, exit 1):
  status_line_missing    — no line matching ^#{0,6}\\s*STATUS:\\s*(\\S+) found
  status_token_invalid   — token not in {DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT}
  report_unreadable      — file could not be opened (OSError)

Warning labels (included in protocol_warnings in stdout JSON, exit 0):
  concerns_block_missing — DONE_WITH_CONCERNS but ## Concerns / Needs / Blocker is empty

Find STATUS line — Optional Markdown heading prefix (# to ######) before STATUS: is accepted.
STATUS line may optionally be prefixed with one to six Markdown heading markers (# to ######),
e.g., `## STATUS: DONE`, `###STATUS: DONE`, and bare `STATUS: DONE` all parse. Fenced and
prose-paraphrased variants still fail.

Section bodies are extracted with the shared fence-aware H2 splitter; `## `-prefixed lines
inside fenced code blocks are treated as opaque content and do not truncate the surrounding
section.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared", "scripts"),
)
from fence_aware import compute_in_fence_lines, split_h2_sections

VALID_STATUSES = {"DONE", "DONE_WITH_CONCERNS", "BLOCKED", "NEEDS_CONTEXT"}


def _get_section(sections, name):
    """Return the named section body from a precomputed sections dict, stripped of trailing newlines."""
    return sections.get(name, "").rstrip("\n")


def _extract_files_changed(section_body):
    """Extract backtick-delimited paths from a precomputed ## Files Changed section body.

    Fence-aware: bullets that appear inside a fenced code block are skipped, so a
    fenced sample/output payload cannot inject paths into the changed-file set.
    """
    lines = section_body.splitlines(keepends=True)
    in_fence = compute_in_fence_lines(lines)
    paths = []
    for idx, line in enumerate(lines):
        if idx in in_fence:
            continue
        m = re.match(r"^- `(?P<path>[^`]+)`", line.rstrip("\n"))
        if m:
            paths.append(m.group("path"))
    return paths


def main():
    parser = argparse.ArgumentParser(
        description="Parse a coder subagent report and emit structured JSON.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Protocol-error labels (emitted to stderr as JSON, exit 1):
  status_line_missing    no line matching ^#{0,6}\\s*STATUS:\\s*(\\S+) found (with optional Markdown heading prefix)
  status_token_invalid   token not in {DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT}
  report_unreadable      file could not be opened (OSError)

Warning label (in stdout JSON protocol_warnings, exit 0):
  concerns_block_missing DONE_WITH_CONCERNS but ## Concerns / Needs / Blocker is empty
""",
    )
    parser.add_argument(
        "--report",
        required=True,
        metavar="PATH_OR_DASH",
        help="Path to coder report .md file, or - to read from stdin",
    )
    args = parser.parse_args()

    if args.report == "-":
        text = sys.stdin.read()
    else:
        try:
            with open(args.report, "r") as f:
                text = f.read()
        except OSError:
            json.dump({"failure": "report_unreadable", "path": args.report}, sys.stderr)
            sys.stderr.write("\n")
            sys.exit(1)

    # Find STATUS line — fence-aware so a fenced fake STATUS: cannot satisfy
    # or override the protocol status (fail closed if no real STATUS: exists).
    raw_lines = text.splitlines(keepends=True)
    in_fence = compute_in_fence_lines(raw_lines)
    status_match = None
    for idx, line in enumerate(raw_lines):
        if idx in in_fence:
            continue
        m = re.match(r"^#{0,6}\s*STATUS:\s*(\S+)", line.rstrip("\n"))
        if m:
            status_match = m
            break

    if status_match is None:
        json.dump({"failure": "status_line_missing"}, sys.stderr)
        sys.stderr.write("\n")
        sys.exit(1)

    token = status_match.group(1)
    if token not in VALID_STATUSES:
        json.dump({"failure": "status_token_invalid", "token": token}, sys.stderr)
        sys.stderr.write("\n")
        sys.exit(1)

    status = token

    sections = split_h2_sections(text)

    tests_block = _get_section(sections, "Tests")
    completed_block = _get_section(sections, "Completed")
    self_review_block = _get_section(sections, "Self-Review Findings")
    concerns_block = _get_section(sections, "Concerns / Needs / Blocker")

    blocker_text = concerns_block if status == "BLOCKED" else None
    needs_text = concerns_block if status == "NEEDS_CONTEXT" else None

    protocol_warnings = []
    if status == "DONE_WITH_CONCERNS" and concerns_block.strip() == "":
        protocol_warnings.append("concerns_block_missing")

    files_changed = _extract_files_changed(_get_section(sections, "Files Changed"))

    result = {
        "status": status,
        "files_changed": files_changed,
        "concerns_block": concerns_block,
        "blocker_text": blocker_text,
        "needs_text": needs_text,
        "tests_block": tests_block,
        "completed_block": completed_block,
        "self_review_block": self_review_block,
        "protocol_warnings": protocol_warnings,
    }

    print(json.dumps(result, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
