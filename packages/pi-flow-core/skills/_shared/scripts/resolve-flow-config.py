#!/usr/bin/env python3
"""resolve-flow-config — print the active flow config path, scope, and searched list.

See skills/_shared/flow-config-resolution.md for the resolution contract.

Output (stdout, JSON on success):
  {"path": "<abs>", "scope": "explicit|project|user", "searched": ["<abs>", ...]}

Failure (stderr, exit 1) when no config is usable or an explicit override is
unreadable:
  flow.json missing or unreadable; searched <locations>.
"""
import argparse
import json
import sys

from flow_config_resolution import (
    FlowConfigError,
    missing_config_clause,
    resolve_flow_config,
)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--working-dir",
        default=None,
        help="Workflow workspace root for project-local resolution (default: cwd)",
    )
    parser.add_argument(
        "--flow-config",
        default=None,
        help="Explicit flow config path override (bypasses project/user resolution)",
    )
    args = parser.parse_args()

    try:
        path, scope, searched = resolve_flow_config(
            working_dir=args.working_dir,
            flow_config_override=args.flow_config,
        )
    except FlowConfigError as exc:
        sys.stderr.write(missing_config_clause(exc.searched) + ".\n")
        sys.exit(1)

    print(json.dumps({"path": path, "scope": scope, "searched": searched}))


if __name__ == "__main__":
    main()
