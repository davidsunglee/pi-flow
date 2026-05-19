#!/usr/bin/env python3
"""Extract provenance metadata from the preamble of spec or brief files.

Supported line shapes (scanned within the bounded preamble region):
  Source: TODO-<8 hex chars>        — captured as source_todo (spec mode)
    (also accepted as **Source:** TODO-<8 hex chars>)
  Scout brief: docs/briefs/<file>   — captured as scout_brief (spec mode)
    (also accepted as **Scout brief:** docs/briefs/<file>)
  Git SHA: <40 hex chars>           — captured as git_sha (brief mode)
    (also accepted as **Git SHA:** <40 hex chars>)

Bound modes:
  --mode spec   : scan lines[0:min(first_h2_index, 40)]; first H2 is the
                  first line starting with '## ' that is NOT inside a fenced
                  code block, or line 40.
                  Fenced `## ` lines (backticks or tildes, length 3+, indented
                  or not) inside the bounded preamble do not terminate the
                  scan, and `Source:` / `Scout brief:` / `Git SHA:` lines that
                  appear inside fenced blocks are ignored for extraction.
  --mode brief  : scan lines[0:8]

A malformed Git SHA: line (value not exactly 40 lowercase hex chars) causes
exit 1 with a JSON error on stderr. Source: and Scout brief: lines that do
not match their expected shapes are silently ignored.
"""
import argparse
import json
import re
import sys

# colocated with this script in the same scripts directory
from fence_aware import compute_in_fence_lines


_RE_SOURCE = re.compile(r"^(?:Source:|\*\*Source:\*\*) (TODO-[0-9a-f]{8})$")
_RE_SCOUT = re.compile(r"^(?:Scout brief:|\*\*Scout brief:\*\*) (docs/briefs/[^/]+)$")
_RE_GIT_SHA_LINE = re.compile(r"^(?:Git SHA:|\*\*Git SHA:\*\*) (.+)$")
_RE_GIT_SHA_VALUE = re.compile(r"^[0-9a-f]{40}$")


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--file", required=True, help="Path to the markdown file")
    parser.add_argument(
        "--mode",
        required=True,
        choices=["spec", "brief"],
        help=(
            "--mode spec scans up to the first '## ' heading (not inside a fence) or line 40; "
            "--mode brief scans the first 8 lines"
        ),
    )
    args = parser.parse_args()

    try:
        region = []
        max_lines = 40 if args.mode == "spec" else 8
        with open(args.file, "rb") as fh:
            for _ in range(max_lines):
                raw = fh.readline()
                if raw == b"":
                    break
                try:
                    line = raw.decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise OSError(f"utf-8 decode failed in bounded preamble: {exc}") from exc
                region.append(line)
        if args.mode == "spec":
            in_fence = compute_in_fence_lines(region)
            for i, line in enumerate(region):
                if line.startswith("## ") and i not in in_fence:
                    region = region[:i]
                    break
    except OSError as exc:
        json.dump(
            {
                "failure": "input missing or unreadable",
                "input": "file",
                "path": args.file,
                "error": str(exc),
            },
            sys.stderr,
        )
        sys.stderr.write("\n")
        sys.exit(2)

    source_todo = None
    scout_brief = None
    git_sha = None

    in_fence_for_extraction = compute_in_fence_lines(region)

    for idx, raw in enumerate(region):
        if idx in in_fence_for_extraction:
            continue
        line = raw.rstrip("\n")

        m = _RE_SOURCE.match(line)
        if m:
            source_todo = m.group(1)
            continue

        m = _RE_SCOUT.match(line)
        if m:
            scout_brief = m.group(1)
            continue

        m = _RE_GIT_SHA_LINE.match(line)
        if m:
            value = m.group(1)
            if _RE_GIT_SHA_VALUE.match(value):
                git_sha = value
            else:
                json.dump(
                    {"failure": "git_sha_malformed", "value": value, "mode": args.mode},
                    sys.stderr,
                )
                sys.stderr.write("\n")
                sys.exit(1)

    json.dump(
        {
            "source_todo": source_todo,
            "scout_brief": scout_brief,
            "git_sha": git_sha,
            "mode": args.mode,
        },
        sys.stdout,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
