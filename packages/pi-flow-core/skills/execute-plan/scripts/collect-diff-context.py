#!/usr/bin/env python3
"""
collect-diff-context.py — collect git diff output for a set of files.

For each file:
  - Untracked (?? in git status): git diff --no-index /dev/null -- <file>
  - Tracked with modifications: git diff HEAD -- <file>
  - Clean tracked (no porcelain entry): git diff HEAD -- <file> (empty output)

If output exceeds --limit-lines or --limit-bytes, truncates to first 300 lines
+ marker line + last 100 lines.

Truncation marker text:
  [diff truncated — <N> lines, <B> bytes total; verifier should note this and
  fall back to reading the named files for file-inspection criteria whose
  relevant code may lie in the truncated window]

Always emits a JSON summary to stderr:
  {"truncated": bool, "total_lines": N, "total_bytes": B, "files_observed": [...]}
"""
import argparse
import json
import os
import subprocess
import sys


TRUNCATION_MARKER_TEMPLATE = (
    "[diff truncated — {n} lines, {b} bytes total; verifier should note this "
    "and fall back to reading the named files for file-inspection criteria "
    "whose relevant code may lie in the truncated window]"
)

FIRST_LINES = 300
LAST_LINES = 100


def run(cmd, cwd, check=False):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, check=check)


def collect_diff_for_file(filename, working_dir):
    """Return diff text for a single file."""
    status_result = run(
        ["git", "status", "--porcelain", "--", filename], cwd=working_dir
    )
    if status_result.returncode != 0:
        error = {
            "error": "git_status_failed",
            "file": filename,
            "detail": status_result.stderr.strip(),
        }
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)

    porcelain = status_result.stdout
    is_untracked = any(
        line.startswith("??") for line in porcelain.splitlines()
    )

    if is_untracked:
        abs_path = os.path.join(working_dir, filename)
        result = run(
            ["git", "diff", "--no-index", "/dev/null", "--", abs_path],
            cwd=working_dir,
        )
        return result.stdout

    # No porcelain entry: could be clean tracked or an unknown path
    if not porcelain.strip():
        ls_result = run(
            ["git", "ls-files", "--error-unmatch", "--", filename],
            cwd=working_dir,
        )
        if ls_result.returncode != 0:
            error = {
                "error": "file_not_tracked_and_not_untracked",
                "file": filename,
                "detail": ls_result.stderr.strip(),
            }
            print(json.dumps(error), file=sys.stderr)
            sys.exit(1)
        # Clean tracked file — git diff HEAD emits empty output
        result = run(["git", "diff", "HEAD", "--", filename], cwd=working_dir)
        return result.stdout

    # Tracked with modifications (M, A, D, R, C, U, etc.)
    result = run(["git", "diff", "HEAD", "--", filename], cwd=working_dir)
    return result.stdout


def truncate(text, limit_lines, limit_bytes):
    lines = text.splitlines(keepends=True)
    total_lines = len(lines)
    total_bytes = len(text.encode("utf-8"))

    if total_lines <= limit_lines and total_bytes <= limit_bytes:
        return text, False, total_lines, total_bytes

    marker = TRUNCATION_MARKER_TEMPLATE.format(n=total_lines, b=total_bytes)
    head = lines[:FIRST_LINES]
    tail = lines[max(0, total_lines - LAST_LINES):]
    truncated_text = "".join(head) + marker + "\n" + "".join(tail)
    return truncated_text, True, total_lines, total_bytes


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Truncation marker text (byte-equal):\n"
            "  " + TRUNCATION_MARKER_TEMPLATE.format(n="<N>", b="<B>") + "\n"
            "\n"
            "Example marker:\n"
            "  [diff truncated — 1234 lines, 56789 bytes total; verifier should "
            "note this and fall back to reading the named files for "
            "file-inspection criteria whose relevant code may lie in the "
            "truncated window]"
        ),
    )
    parser.add_argument(
        "--working-dir",
        default=os.getcwd(),
        help="Git repo root to run git commands from (default: cwd)",
    )
    parser.add_argument(
        "--files",
        help="Comma-separated list of file paths relative to --working-dir",
    )
    parser.add_argument(
        "--files-json",
        help="Path to a JSON file containing an array of file paths "
             "(alternative to --files)",
    )
    parser.add_argument(
        "--limit-lines",
        type=int,
        default=500,
        help="Max lines before truncation (default: 500)",
    )
    parser.add_argument(
        "--limit-bytes",
        type=int,
        default=40960,
        help="Max bytes before truncation (default: 40960 = 40KB)",
    )
    parser.add_argument(
        "--output",
        default="-",
        help="Output file path, or - for stdout (default: -)",
    )
    args = parser.parse_args()

    if args.files_json:
        try:
            with open(args.files_json, "r") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            error = {
                "error": "files_json_invalid",
                "path": args.files_json,
                "detail": str(e),
            }
            print(json.dumps(error), file=sys.stderr)
            sys.exit(1)
        if not isinstance(data, list) or not all(
            isinstance(x, str) for x in data
        ):
            error = {
                "error": "files_json_invalid",
                "path": args.files_json,
                "detail": "expected JSON array of file path strings",
            }
            print(json.dumps(error), file=sys.stderr)
            sys.exit(1)
        files = data
    elif args.files:
        files = [f.strip() for f in args.files.split(",") if f.strip()]
    else:
        parser.error("One of --files or --files-json is required")

    working_dir = os.path.abspath(args.working_dir)

    # Verify we're inside a git repo
    check_git = run(["git", "rev-parse", "--git-dir"], cwd=working_dir)
    if check_git.returncode != 0:
        error = {
            "error": "not_a_git_repo",
            "working_dir": working_dir,
            "detail": check_git.stderr.strip(),
        }
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)

    segments = []
    for filename in files:
        diff_text = collect_diff_for_file(filename, working_dir)
        segments.append(diff_text)

    combined = "".join(segments)
    output_text, was_truncated, total_lines, total_bytes = truncate(
        combined, args.limit_lines, args.limit_bytes
    )

    if args.output == "-":
        sys.stdout.write(output_text)
    else:
        with open(args.output, "w") as f:
            f.write(output_text)

    summary = {
        "truncated": was_truncated,
        "total_lines": total_lines,
        "total_bytes": total_bytes,
        "files_observed": files,
    }
    print(json.dumps(summary), file=sys.stderr)


if __name__ == "__main__":
    main()
