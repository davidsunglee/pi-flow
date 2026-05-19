#!/usr/bin/env python3
"""
detect-mux-backend.py — Probe the environment and emit a JSON mux/backend decision.

Rules (first match wins):

  1. PI_SUBAGENT_MODE=headless (case-insensitive) → inline branch
  2. PI_SUBAGENT_MODE=pane    (case-insensitive) → mux branch
  3. PI_SUBAGENT_MUX=cmux|tmux|zellij|wezterm   → evaluate only that backend;
     available → mux; unavailable → inline (no fallback to other backends);
     empty or unrecognized → fall through to rule 4
  4. CMUX_SOCKET_PATH set + command -v cmux      → mux (cmux)
  5. TMUX set and non-empty + command -v tmux    → mux (tmux)
  6. (ZELLIJ or ZELLIJ_SESSION_NAME) + zellij    → mux (zellij)
  7. WEZTERM_UNIX_SOCKET set + command -v wezterm → mux (wezterm)
  8. Otherwise                                   → inline

Status messages:
  mux branch:            Running spec design in subagent pane (mux detected, no override).
  inline (no mux):       Running spec design in this session (no multiplexer detected).
  inline (override):     Running spec design in this session (per user override: --no-subagent or equivalent).

--user-input override substrings (case-insensitive, first match wins):
  --no-subagent, without a subagent, without subagent, no subagent, skip subagent
"""

import argparse
import json
import os
import re
import shutil
import sys

MSG_MUX = "Running spec design in subagent pane (mux detected, no override)."
MSG_INLINE_NO_MUX = "Running spec design in this session (no multiplexer detected)."
MSG_INLINE_OVERRIDE = "Running spec design in this session (per user override: --no-subagent or equivalent)."

PINNED_BACKENDS = {"cmux", "tmux", "zellij", "wezterm"}

OVERRIDE_SUBSTRINGS = [
    "--no-subagent",
    "without a subagent",
    "without subagent",
    "no subagent",
    "skip subagent",
]


def _cmd_available(name: str) -> bool:
    return shutil.which(name) is not None


def _check_backend(backend: str) -> bool:
    env = os.environ
    if backend == "cmux":
        return bool(env.get("CMUX_SOCKET_PATH", "")) and _cmd_available("cmux")
    if backend == "tmux":
        return bool(env.get("TMUX", "")) and _cmd_available("tmux")
    if backend == "zellij":
        zellij_set = bool(env.get("ZELLIJ", "")) or bool(env.get("ZELLIJ_SESSION_NAME", ""))
        return zellij_set and _cmd_available("zellij")
    if backend == "wezterm":
        return bool(env.get("WEZTERM_UNIX_SOCKET", "")) and _cmd_available("wezterm")
    return False


def _mux_probe() -> dict:
    env = os.environ
    pi_mode = env.get("PI_SUBAGENT_MODE", "").lower()

    if pi_mode == "headless":
        return {"branch": "inline", "backend": None, "reason": "pi_subagent_mode_headless",
                "status_message": MSG_INLINE_NO_MUX}

    if pi_mode == "pane":
        return {"branch": "mux", "backend": None, "reason": "pi_subagent_mode_pane",
                "status_message": MSG_MUX}

    pi_mux = env.get("PI_SUBAGENT_MUX", "").lower()
    if pi_mux in PINNED_BACKENDS:
        if _check_backend(pi_mux):
            return {"branch": "mux", "backend": pi_mux, "reason": "pi_subagent_mux_pinned",
                    "status_message": MSG_MUX}
        return {"branch": "inline", "backend": None, "reason": "pi_subagent_mux_pinned_unavailable",
                "status_message": MSG_INLINE_NO_MUX}

    for backend in ["cmux", "tmux", "zellij", "wezterm"]:
        if _check_backend(backend):
            return {"branch": "mux", "backend": backend, "reason": f"{backend}_detected",
                    "status_message": MSG_MUX}

    return {"branch": "inline", "backend": None, "reason": "no_mux_detected",
            "status_message": MSG_INLINE_NO_MUX}


def detect(user_input: str) -> dict:
    result = _mux_probe()

    for substring in OVERRIDE_SUBSTRINGS:
        if re.search(r"(?i)" + re.escape(substring), user_input):
            return {"branch": "inline", "backend": None,
                    "reason": f"user_input_override_{substring}",
                    "status_message": MSG_INLINE_OVERRIDE}

    return result


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
            "'no subagent', 'skip subagent' (case-insensitive)."
        ),
    )
    args = parser.parse_args()

    result = detect(args.user_input)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
