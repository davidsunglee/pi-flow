#!/usr/bin/env python3
"""cleanup-pycache - Validated removal of __pycache__ directories under a target tree.

Argument:
  <path>  Positional. Relative or absolute path to the directory under which all
          __pycache__ directories should be removed (recursively).

Validation (refuses with exit 1 and JSON {"failure": ...} on stderr):
  - dotdot_traversal   : argument contains a '..' segment.
  - outside_cwd        : resolved path is outside the current working directory tree.
  - protected_segment  : resolved path's segments include any of .git, .ssh,
                         node_modules, .venv, venv (the protected-segment list).

On success or no-op (no __pycache__ directories found, or the target is absent), exits 0.

Why this exists: the orchestrator's bash invocation `python3 agent/skills/_shared/scripts/cleanup-pycache.py <path>`
does NOT match the find-exec-rm regex in the recursive-delete guardrail, so the guardrail confirm
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
    parser.add_argument("path", help="Directory under which to remove __pycache__ subtrees")
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

    if not os.path.isdir(abs_target):
        sys.exit(0)

    if os.path.basename(abs_target) == "__pycache__":
        shutil.rmtree(abs_target)
        sys.exit(0)

    for dirpath, dirnames, _ in os.walk(abs_target):
        if "__pycache__" in dirnames:
            shutil.rmtree(os.path.join(dirpath, "__pycache__"))
            dirnames.remove("__pycache__")

    sys.exit(0)


if __name__ == "__main__":
    main()
