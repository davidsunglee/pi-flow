#!/usr/bin/env python3
"""
resolve-coordinator-dispatch — validate the coordinatorSubagentDispatch section of flow.json.

Coordinator agents (plan-refiner, code-refiner) must run under the `pi` CLI because
nested orchestration tools (subagent_run_serial) exist only there. The Pi requirement
is a system invariant, not user configuration: the output hardcodes cli "pi" and
there is no cli key in the config. modelChain entries are exact model identifiers
passed verbatim to subagent_run_serial — no provider-prefix extraction and no
subagentDispatch[<prefix>] lookup occurs for coordinator dispatch. Unknown extra keys
inside coordinatorSubagentDispatch are ignored.

Inputs:
  --agent        Coordinator agent name used in error messages
                 (e.g. "plan-refiner", "code-refiner")
  --flow-config  Explicit flow config path override (default: resolve project-local then user/global)
  --working-dir  Workflow workspace root for project-local flow config resolution (default: cwd)

Output (stdout, JSON) on success:
  {
    "modelChain":      ["<exact model id>", ...],
    "cli":             "pi",
    "executionPolicy": "guarded" | "unrestricted"
  }

Failure templates (written to stderr, exit 1):
  Template 1 — file missing or unreadable (shared with resolve-model-dispatch.py):
    flow.json missing or unreadable; searched <locations> — cannot dispatch <agent>.
  Missing section — coordinatorSubagentDispatch absent or not a JSON object:
    flow.json has no coordinatorSubagentDispatch section — cannot dispatch <agent>.
  No usable modelChain — modelChain missing, not an array, empty, or containing any
  non-string or empty entry (rejected wholesale, no entry-skipping):
    flow.json coordinatorSubagentDispatch has no usable modelChain — cannot dispatch <agent>.
  Template 5 — executionPolicy missing or invalid (shared with resolve-model-dispatch.py):
    flow.json has no usable executionPolicy ("guarded" or "unrestricted") — cannot dispatch <agent>.
"""
import argparse
import json
import sys
from flow_config_resolution import resolve_flow_config, FlowConfigError, missing_config_clause


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
        "--flow-config",
        default=None,
        help="Explicit flow config path override (default: resolve project-local then user/global)",
    )
    parser.add_argument(
        "--working-dir",
        default=None,
        help="Workflow workspace root for project-local flow config resolution (default: cwd)",
    )
    args = parser.parse_args()

    try:
        config_path, _scope, searched = resolve_flow_config(
            working_dir=args.working_dir,
            flow_config_override=args.flow_config,
        )
    except FlowConfigError as exc:
        die(f"{missing_config_clause(exc.searched)} — cannot dispatch {args.agent}.")

    try:
        with open(config_path) as f:
            data = json.load(f)
    except (IOError, OSError, json.JSONDecodeError):
        die(f"{missing_config_clause(searched)} — cannot dispatch {args.agent}.")

    section = data.get("coordinatorSubagentDispatch") if isinstance(data, dict) else None
    if not isinstance(section, dict):
        die(f"flow.json has no coordinatorSubagentDispatch section — cannot dispatch {args.agent}.")

    chain = section.get("modelChain")
    if (
        not isinstance(chain, list)
        or not chain
        or any(not isinstance(entry, str) or not entry for entry in chain)
    ):
        die(
            f"flow.json coordinatorSubagentDispatch has no usable modelChain — "
            f"cannot dispatch {args.agent}."
        )

    policy = data.get("executionPolicy")
    if policy not in ("guarded", "unrestricted"):
        die(
            'flow.json has no usable executionPolicy ("guarded" or "unrestricted") '
            f"— cannot dispatch {args.agent}."
        )

    print(json.dumps({"modelChain": chain, "cli": "pi", "executionPolicy": policy}))


if __name__ == "__main__":
    main()
