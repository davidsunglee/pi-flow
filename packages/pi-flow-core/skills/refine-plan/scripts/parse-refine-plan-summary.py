#!/usr/bin/env python3
"""
parse-refine-plan-summary.py — parse a refine-plan Step 11 summary block.

On success, emits JSON to stdout:
  {"status": ..., "commit": ..., "plan_path": ..., "review_paths": [...],
   "structural_only": <bool>, "failure_reason": "<text or null>"}

On failure, emits JSON to stderr and exits 1:
  {"failure": "<label>", "detail": "<short description>"}

Failure labels:
  status_missing            — STATUS: line not found
  status_unrecognized       — STATUS value not in the allowed set
  commit_missing            — COMMIT: line not found
  plan_path_missing         — PLAN_PATH: line not found
  review_paths_block_missing — REVIEW_PATHS: line not found
  structural_only_missing   — STRUCTURAL_ONLY: line not found
  structural_only_malformed — STRUCTURAL_ONLY value is not yes or no
  missing_failure_reason    — STATUS is failed but FAILURE_REASON: is absent
  unexpected_failure_reason — STATUS is not failed but FAILURE_REASON: is present
"""

import argparse
import json
import sys

VALID_STATUSES = {"approved", "approved_with_concerns", "not_approved_within_budget", "failed"}


def fail(label, detail):
    json.dump({"failure": label, "detail": detail}, sys.stderr)
    sys.stderr.write("\n")
    sys.exit(1)


def parse(content):
    lines = content.splitlines()

    status = None
    commit = None
    plan_path = None
    review_paths = None
    structural_only_raw = None
    failure_reason = None

    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("STATUS: "):
            status = line[len("STATUS: "):]
        elif line.startswith("COMMIT: "):
            commit = line[len("COMMIT: "):]
        elif line.startswith("PLAN_PATH: "):
            plan_path = line[len("PLAN_PATH: "):]
        elif line == "REVIEW_PATHS:" or line.startswith("REVIEW_PATHS: "):
            # Collect subsequent `- <path>` lines
            review_paths = []
            i += 1
            while i < len(lines) and lines[i].startswith("- "):
                review_paths.append(lines[i][2:])
                i += 1
            continue  # don't advance i again at end of loop
        elif line.startswith("STRUCTURAL_ONLY: "):
            structural_only_raw = line[len("STRUCTURAL_ONLY: "):]
        elif line.startswith("FAILURE_REASON: "):
            failure_reason = line[len("FAILURE_REASON: "):]
        i += 1

    # Validate required fields
    if status is None:
        fail("status_missing", "STATUS: line not found")
    if status not in VALID_STATUSES:
        fail("status_unrecognized", f"STATUS value '{status}' not in allowed set")
    if commit is None:
        fail("commit_missing", "COMMIT: line not found")
    if plan_path is None:
        fail("plan_path_missing", "PLAN_PATH: line not found")
    if review_paths is None:
        fail("review_paths_block_missing", "REVIEW_PATHS: line not found")
    if structural_only_raw is None:
        fail("structural_only_missing", "STRUCTURAL_ONLY: line not found")
    if structural_only_raw not in ("yes", "no"):
        fail("structural_only_malformed", f"STRUCTURAL_ONLY value '{structural_only_raw}' must be yes or no")

    # Validate FAILURE_REASON
    if status == "failed" and failure_reason is None:
        fail("missing_failure_reason", "STATUS is failed but FAILURE_REASON: line is absent")
    if status != "failed" and failure_reason is not None:
        fail("unexpected_failure_reason", "FAILURE_REASON: present but STATUS is not failed")

    result = {
        "status": status,
        "commit": commit,
        "plan_path": plan_path,
        "review_paths": review_paths,
        "structural_only": structural_only_raw == "yes",
        "failure_reason": failure_reason,
    }
    return result


def main():
    parser = argparse.ArgumentParser(
        description="Parse a refine-plan Step 11 summary block.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Failure labels emitted to stderr JSON on exit 1:\n"
            "  status_missing            STATUS: line not found\n"
            "  status_unrecognized       STATUS value not in the allowed set\n"
            "  commit_missing            COMMIT: line not found\n"
            "  plan_path_missing         PLAN_PATH: line not found\n"
            "  review_paths_block_missing REVIEW_PATHS: line not found\n"
            "  structural_only_missing   STRUCTURAL_ONLY: line not found\n"
            "  structural_only_malformed STRUCTURAL_ONLY value is not yes or no\n"
            "  missing_failure_reason    STATUS is failed but FAILURE_REASON: is absent\n"
            "  unexpected_failure_reason STATUS is not failed but FAILURE_REASON: is present\n"
        ),
    )
    parser.add_argument(
        "--summary",
        required=True,
        metavar="PATH_OR_DASH",
        help="Path to the summary file, or - to read from stdin",
    )
    args = parser.parse_args()

    if args.summary == "-":
        content = sys.stdin.read()
    else:
        try:
            with open(args.summary, "r") as f:
                content = f.read()
        except OSError as exc:
            json.dump(
                {
                    "failure": "input missing or unreadable",
                    "input": "summary",
                    "path": args.summary,
                    "error": str(exc),
                },
                sys.stderr,
            )
            sys.stderr.write("\n")
            sys.exit(2)

    result = parse(content)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
