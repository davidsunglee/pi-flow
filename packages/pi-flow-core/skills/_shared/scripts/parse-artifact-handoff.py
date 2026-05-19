#!/usr/bin/env python3
"""
parse-artifact-handoff.py - Extract artifact path from subagent final message.

Extracts the marker only when it appears as the exact last non-empty line of the
final message, in column 1, with no leading whitespace, quote (`>`), or backtick
characters. Earlier marker-shaped lines anywhere else in the message are ignored.

Supported markers: BRIEF_ARTIFACT, SPEC_ARTIFACT, PLAN_ARTIFACT, REVIEW_ARTIFACT, TEST_RESULT_ARTIFACT

Options:
  --marker MARKER               Artifact marker to extract.
  --final-message PATH          Path to the subagent final-message file, or '-' to read from stdin.
  --expected-path PATH          Assert the extracted path exactly equals this value.
  --freshness-baseline UNIX_MTIME
                                Unix mtime captured before dispatch; pass 0 if the expected file
                                did not exist. When supplied together with --expected-path, a missing
                                marker is acceptable if the expected file exists, is non-empty, and
                                has mtime strictly greater than this value.
  --check-existence             Verify the extracted path exists on disk.
  --check-non-empty             Verify the extracted path is a file with non-whitespace content.
  --require-path-suffix SUFFIX  Verify the extracted path ends with this string (e.g., '.md').
  --require-path-prefix ABS_DIR Verify the extracted path's realpath starts with the realpath of
                                this absolute directory followed by '/'.

Canonical failure labels (appear in stderr JSON .failure):
  missing <MARKER> marker
  path mismatch: expected <X> got <Y>
  missing or empty at <path>
  path suffix mismatch: expected suffix <X> for path <Y>
  path prefix mismatch: expected prefix <X> for path <Y>

On-disk fallback:
  When both --expected-path and --freshness-baseline are supplied and the terminal
  line is not a valid marker, the script attempts a fallback: if the expected file
  exists, is non-empty, and has an mtime strictly greater than --freshness-baseline,
  the missing marker is accepted and the success JSON includes "used_fallback": true.
  This fallback is REJECTED if a marker-shaped line appears in a malformed context
  (indented, >-quoted, backtick-wrapped, or inside a fenced code block).

Success JSON output fields:
  path          - The resolved artifact path.
  marker        - The marker name.
  checks        - List of checks that passed (e.g., ["marker"], ["marker", "existence"]).
  used_fallback - True if the on-disk freshness fallback was used; False otherwise.
"""

import argparse
import json
import os
import re
import sys

VALID_MARKERS = [
    "BRIEF_ARTIFACT",
    "SPEC_ARTIFACT",
    "PLAN_ARTIFACT",
    "REVIEW_ARTIFACT",
    "TEST_RESULT_ARTIFACT",
]


def fail(message: str) -> None:
    json.dump({"failure": message}, sys.stderr)
    sys.stderr.write("\n")
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog=(
            "Marker recognition: only a line of the form `<MARKER>: <path>` that is "
            "the exact last non-empty line of the final message, anchored at column "
            "1, is accepted. Indented, quoted (`> `), or backtick-wrapped "
            "marker-shaped lines are rejected with `missing <MARKER> marker`."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--marker",
        required=True,
        choices=VALID_MARKERS,
        metavar="MARKER",
        help=(
            f"Artifact marker to extract. Supported choices: "
            f"{', '.join(VALID_MARKERS)}"
        ),
    )
    parser.add_argument(
        "--final-message",
        required=True,
        metavar="PATH",
        help="Path to the subagent final-message file, or '-' to read from stdin",
    )
    parser.add_argument(
        "--expected-path",
        metavar="PATH",
        help="Assert the extracted path exactly equals this value",
    )
    parser.add_argument(
        "--freshness-baseline",
        metavar="UNIX_MTIME",
        type=float,
        help=(
            "Unix mtime captured before dispatch; pass 0 if the expected file did not exist. "
            "When supplied together with --expected-path, a missing marker is acceptable if "
            "the expected file exists, is non-empty, and has mtime strictly greater than this value."
        ),
    )
    parser.add_argument(
        "--check-existence",
        action="store_true",
        help="Verify the extracted path exists on disk",
    )
    parser.add_argument(
        "--check-non-empty",
        action="store_true",
        help="Verify the extracted path is a file with non-whitespace content",
    )
    parser.add_argument(
        "--require-path-suffix",
        metavar="SUFFIX",
        help="Verify the extracted path ends with this string (e.g., '.md').",
    )
    parser.add_argument(
        "--require-path-prefix",
        metavar="ABS_DIR",
        help="Verify the extracted path's realpath starts with the realpath of this absolute directory followed by '/'.",
    )

    args = parser.parse_args()

    if args.final_message == "-":
        content = sys.stdin.read()
    else:
        with open(args.final_message, "r") as fh:
            content = fh.read()

    lines = content.split("\n")
    terminal_line = None
    terminal_index = None
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip() != "":
            terminal_line = lines[i]
            terminal_index = i
            break

    if terminal_line is None:
        fail(f"missing {args.marker} marker")

    # Determine whether the terminal line sits inside an open fenced block.
    # A terminal marker emitted inside an unclosed fence is malformed and
    # must be rejected (both for direct acceptance and for fallback).
    fence_open_at_terminal = False
    _in_fence_scan = False
    for i in range(terminal_index):
        if lines[i].strip().startswith("```"):
            _in_fence_scan = not _in_fence_scan
    fence_open_at_terminal = _in_fence_scan

    pattern = re.compile(r"^" + re.escape(args.marker) + r": (.+)$")
    match = None if fence_open_at_terminal else pattern.match(terminal_line)
    marker_match = match

    used_fallback = False

    if marker_match is None:
        # Fallback decision block: scan for malformed marker attempts
        malformed_marker_re_outside_fence = re.compile(
            r"^[ \t>`]+" + re.escape(args.marker) + r":\s*\S"
        )
        marker_shape_re = re.compile(r"^" + re.escape(args.marker) + r":\s*\S")

        in_fence = False
        malformed_marker_seen = False

        for line in content.split("\n"):
            stripped = line.strip()
            if stripped.startswith("```"):
                in_fence = not in_fence
                continue

            if malformed_marker_re_outside_fence.match(line):
                malformed_marker_seen = True
            elif in_fence and marker_shape_re.match(line):
                malformed_marker_seen = True
            elif not in_fence and marker_shape_re.match(line) and line != terminal_line:
                # Non-terminal column-1 marker-shaped line outside a fence
                m = pattern.match(line)
                if m and args.expected_path is not None:
                    extracted_path = m.group(1)
                    if extracted_path != args.expected_path:
                        fail(f"path mismatch: expected {args.expected_path} got {extracted_path}")

        if malformed_marker_seen:
            fail(f"missing {args.marker} marker")

        if args.expected_path is None or args.freshness_baseline is None:
            fail(f"missing {args.marker} marker")

        # On-disk freshness fallback
        try:
            with open(args.expected_path, "r") as fh:
                file_content = fh.read()
        except OSError:
            fail(f"missing or empty at {args.expected_path}")

        if file_content.strip() == "":
            fail(f"missing or empty at {args.expected_path}")

        current_mtime = os.path.getmtime(args.expected_path)
        if current_mtime <= args.freshness_baseline:
            fail(f"missing {args.marker} marker")

        path = args.expected_path
        used_fallback = True
    else:
        path = marker_match.group(1)

        if args.expected_path is not None and path != args.expected_path:
            fail(f"path mismatch: expected {args.expected_path} got {path}")

    checks = ["marker"]

    if args.check_existence:
        if not os.path.exists(path):
            fail(f"missing or empty at {path}")
        checks.append("existence")

    if args.check_non_empty:
        try:
            with open(path, "r") as fh:
                body = fh.read()
            if not body.strip():
                fail(f"missing or empty at {path}")
        except OSError:
            fail(f"missing or empty at {path}")
        checks.append("non-empty")

    if args.require_path_suffix and not path.endswith(args.require_path_suffix):
        fail(f"path suffix mismatch: expected suffix {args.require_path_suffix} for path {path}")
    if args.require_path_suffix:
        checks.append("path-suffix")

    if args.require_path_prefix:
        resolved_path = os.path.realpath(path)
        resolved_prefix = os.path.realpath(args.require_path_prefix).rstrip("/") + "/"
        if not resolved_path.startswith(resolved_prefix):
            fail(f"path prefix mismatch: expected prefix {args.require_path_prefix} for path {path}")
        checks.append("path-prefix")

    json.dump({"path": path, "marker": args.marker, "checks": checks, "used_fallback": used_fallback}, sys.stdout)
    sys.stdout.write("\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
