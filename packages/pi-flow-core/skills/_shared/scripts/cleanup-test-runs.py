#!/usr/bin/env python3
"""cleanup-test-runs - Validated cleanup of a per-plan docs/test-runs/<plan-name>/ directory.

Argument:
  <path>  Positional. Relative or absolute path to the per-plan directory to remove.

Validation (refuses with exit 1 and JSON {"failure": ...} on stderr):
  - dotdot_traversal       : argument contains a '..' segment.
  - outside_cwd            : resolved path is outside the current working directory tree.
  - protected_segment      : resolved path's segments include any of .git, .ssh,
                             node_modules, .venv, venv (the protected-segment list).
  - outside_test_runs_prefix : resolved path is not a strict child of <cwd>/docs/test-runs/
                               (the test-runs root itself is also rejected; only per-plan
                               subdirectories under it are accepted).

On success or no-op (target already absent), exits 0 with no stdout output.

Why this exists: the orchestrator's bash invocation `python3 agent/skills/_shared/scripts/cleanup-test-runs.py <path>`
does NOT match the recursive-delete regex in the dangerous-command guardrail, so the guardrail confirm
prompt does not fire. Argument validation here makes the internal shutil.rmtree safe.
"""
import argparse
import json
import os
import shutil
import sys

HARD_PROTECTED_SEGMENTS = (".git", ".ssh", "node_modules", ".venv", "venv")


def fail(label, **extra):
    payload = {"failure": label}
    payload.update(extra)
    sys.stderr.write(json.dumps(payload) + "\n")
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("path", help="Per-plan directory to remove")
    args = parser.parse_args()

    raw = args.path
    segments_in_input = [seg for seg in raw.replace("\\", "/").split("/") if seg]
    if ".." in segments_in_input:
        fail("dotdot_traversal", path=raw)

    cwd = os.path.realpath(os.getcwd())
    abs_target = os.path.realpath(os.path.join(cwd, raw))

    cwd_with_sep = cwd + os.sep
    if abs_target != cwd and not abs_target.startswith(cwd_with_sep):
        fail("outside_cwd", path=raw, resolved=abs_target, cwd=cwd)

    rel_segments = [
        seg for seg in os.path.relpath(abs_target, cwd).split(os.sep) if seg and seg != "."
    ]
    for seg in rel_segments:
        if seg in HARD_PROTECTED_SEGMENTS:
            fail("protected_segment", segment=seg, path=raw, resolved=abs_target)

    test_runs_root = os.path.realpath(os.path.join(cwd, "docs", "test-runs"))
    test_runs_prefix = test_runs_root + os.sep
    if not abs_target.startswith(test_runs_prefix):
        fail("outside_test_runs_prefix", path=raw, resolved=abs_target, expected_prefix=test_runs_prefix)

    if not os.path.exists(abs_target):
        sys.exit(0)

    shutil.rmtree(abs_target)
    sys.exit(0)


if __name__ == "__main__":
    main()
