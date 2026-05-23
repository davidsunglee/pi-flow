#!/usr/bin/env python3
"""
detect-mux-backend.py — Adapter that delegates runtime multiplexer detection
to `pi-mux-detect` (from `@aphotic/pi-mux-subagents`) and maps the result
onto the define-spec helper contract.

Evaluation order:

  1. If `--user-input` contains an inline-override substring
     (case-insensitive), return the inline-override result immediately
     WITHOUT invoking the detector. This lets users force inline mode even
     when `pi-mux-detect` is missing or broken.
  2. Otherwise invoke `pi-mux-detect` (resolved on `PATH` first, then via
     `node_modules/.bin/pi-mux-detect` discovered by walking upward from
     the current working directory and this script's directory) and map its
     JSON payload:
       - `backend == "pane"`     → `branch="mux"`,    `backend=<mux>`
                                   (e.g. "herdr", "cmux", "tmux",
                                   "zellij", "wezterm")
       - `backend == "headless"` → `branch="inline"`, `backend=null`

Stdout success contract:
  Exactly one JSON object terminated by a single newline. Schema:
    {
      "branch":         "mux" | "inline",
      "backend":        <string or null>,
      "reason":         <string>,
      "status_message": <string>
    }

Status messages (preserved across the refactor):
  mux branch:        Running spec design in subagent pane (mux detected, no override).
  inline (no mux):   Running spec design in this session (no multiplexer detected).
  inline (override): Running spec design in this session (per user override: --no-subagent or equivalent).

--user-input override substrings (case-insensitive, first match wins):
  --no-subagent, without a subagent, without subagent, no subagent, skip subagent

Failure contract:
  On detector resolution failure, detector execution failure, detector
  emitting non-JSON output, missing/invalid `backend` field, or unknown
  `backend` value, exit non-zero and write a single-line JSON object with
  a `failure` field to stderr. The helper does NOT silently fall back to
  `inline` on detector failure — a broken peer dependency should be
  surfaced loudly rather than masked as a "no mux" decision.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

MSG_MUX = "Running spec design in subagent pane (mux detected, no override)."
MSG_INLINE_NO_MUX = "Running spec design in this session (no multiplexer detected)."
MSG_INLINE_OVERRIDE = "Running spec design in this session (per user override: --no-subagent or equivalent)."

OVERRIDE_SUBSTRINGS = [
    "--no-subagent",
    "without a subagent",
    "without subagent",
    "no subagent",
    "skip subagent",
]


def _find_override(user_input: str):
    for substring in OVERRIDE_SUBSTRINGS:
        if re.search(r"(?i)" + re.escape(substring), user_input):
            return substring
    return None


def _ancestor_dirs(start: str):
    current = os.path.abspath(start)
    while True:
        yield current
        parent = os.path.dirname(current)
        if parent == current:
            return
        current = parent


def _resolve_detector():
    on_path = shutil.which("pi-mux-detect")
    if on_path:
        return on_path

    search_roots = [os.getcwd(), os.path.dirname(__file__)]
    seen = set()
    for root in search_roots:
        for current in _ancestor_dirs(root):
            if current in seen:
                continue
            seen.add(current)
            candidate = os.path.join(current, "node_modules", ".bin", "pi-mux-detect")
            if os.path.exists(candidate) and os.access(candidate, os.X_OK):
                return candidate

    return None


def _fail(failure: str, **extra) -> None:
    payload = {"failure": failure}
    payload.update(extra)
    sys.stderr.write(json.dumps(payload) + "\n")
    sys.exit(1)


def _invoke_detector() -> dict:
    detector = _resolve_detector()
    if detector is None:
        _fail(
            "pi-mux-detect not found on PATH or in any node_modules/.bin searched from cwd/script ancestors",
            hint="Install @aphotic/pi-mux-subagents (peer dependency of pi-flow-core).",
        )

    try:
        completed = subprocess.run(
            [detector],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        _fail(
            "pi-mux-detect failed to execute",
            detector=detector,
            error=str(exc),
        )

    if completed.returncode != 0:
        _fail(
            "pi-mux-detect exited with nonzero status",
            detector=detector,
            exit_code=completed.returncode,
            stderr=completed.stderr.strip(),
        )

    raw = completed.stdout.strip()
    if not raw:
        _fail(
            "pi-mux-detect produced empty stdout",
            detector=detector,
            stderr=completed.stderr.strip(),
        )

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        _fail(
            "pi-mux-detect produced invalid JSON",
            detector=detector,
            error=str(exc),
            stdout=raw[:200],
        )

    if not isinstance(payload, dict) or "backend" not in payload:
        _fail(
            "pi-mux-detect payload missing required 'backend' field",
            detector=detector,
        )

    return payload


def detect(user_input: str) -> dict:
    override = _find_override(user_input)
    if override is not None:
        return {
            "branch": "inline",
            "backend": None,
            "reason": f"user_input_override_{override}",
            "status_message": MSG_INLINE_OVERRIDE,
        }

    payload = _invoke_detector()
    backend = payload.get("backend")
    mux = payload.get("mux")
    detector_reason = payload.get("reason")

    if backend == "pane":
        return {
            "branch": "mux",
            "backend": mux,
            "reason": detector_reason or "pi_mux_detect_pane",
            "status_message": MSG_MUX,
        }

    if backend == "headless":
        return {
            "branch": "inline",
            "backend": None,
            "reason": detector_reason or "pi_mux_detect_headless",
            "status_message": MSG_INLINE_NO_MUX,
        }

    _fail(
        "pi-mux-detect returned unknown backend value",
        backend=backend,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--user-input",
        default="",
        metavar="TEXT",
        help=(
            "User slash-command input to scan for inline-branch override substrings: "
            "--no-subagent, 'without a subagent', 'without subagent', "
            "'no subagent', 'skip subagent' (case-insensitive). When an override "
            "matches, the helper returns the inline-override result without "
            "invoking pi-mux-detect."
        ),
    )
    args = parser.parse_args()

    result = detect(args.user_input)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
