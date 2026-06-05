#!/usr/bin/env python3
"""
resolve-coordinator-dispatch — validate the coordinatorDispatch section of model-tiers.json.

Coordinator agents (plan-refiner, code-refiner) must run under the `pi` CLI because
nested orchestration tools (subagent_run_serial) exist only there. The Pi requirement
is a system invariant, not user configuration: the output hardcodes cli "pi" and
there is no cli key in the config. modelChain entries are exact model identifiers
passed verbatim to subagent_run_serial — no provider-prefix extraction and no
dispatch[<prefix>] lookup occurs for coordinator dispatch. Unknown extra keys inside
coordinatorDispatch are ignored.

Inputs:
  --agent        Coordinator agent name used in error messages
                 (e.g. "plan-refiner", "code-refiner")
  --model-tiers  Path to model-tiers JSON file (default: ~/.pi/agent/model-tiers.json)

Output (stdout, JSON) on success:
  {
    "modelChain": ["<exact model id>", ...],
    "cli":        "pi"
  }

Failure templates (written to stderr, exit 1):
  Template 1 — file missing or unreadable (shared with resolve-model-dispatch.py):
    ~/.pi/agent/model-tiers.json missing or unreadable — cannot dispatch <agent>.
  Missing section — coordinatorDispatch absent or not a JSON object:
    model-tiers.json has no coordinatorDispatch section — cannot dispatch <agent>.
  No usable modelChain — modelChain missing, not an array, empty, or containing any
  non-string or empty entry (rejected wholesale, no entry-skipping):
    model-tiers.json coordinatorDispatch has no usable modelChain — cannot dispatch <agent>.
"""
import argparse
import json
import os
import sys


def die(msg):
    sys.stderr.write(msg + "\n")
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--agent",
        required=True,
        help="Coordinator agent name for error messages (e.g. 'plan-refiner')",
    )
    parser.add_argument(
        "--model-tiers",
        default="~/.pi/agent/model-tiers.json",
        help="Path to model-tiers JSON file (default: ~/.pi/agent/model-tiers.json)",
    )
    args = parser.parse_args()

    path = os.path.expanduser(args.model_tiers)
    try:
        with open(path) as f:
            data = json.load(f)
    except (IOError, OSError, json.JSONDecodeError):
        die(f"~/.pi/agent/model-tiers.json missing or unreadable — cannot dispatch {args.agent}.")

    section = data.get("coordinatorDispatch") if isinstance(data, dict) else None
    if not isinstance(section, dict):
        die(f"model-tiers.json has no coordinatorDispatch section — cannot dispatch {args.agent}.")

    chain = section.get("modelChain")
    if (
        not isinstance(chain, list)
        or not chain
        or any(not isinstance(entry, str) or not entry for entry in chain)
    ):
        die(
            f"model-tiers.json coordinatorDispatch has no usable modelChain — "
            f"cannot dispatch {args.agent}."
        )

    print(json.dumps({"modelChain": chain, "cli": "pi"}))


if __name__ == "__main__":
    main()
