#!/usr/bin/env python3
"""
resolve-model-dispatch — look up the CLI and model string for a given tier and agent.

Inputs:
  --tier         Dot-separated path into model-tiers.json
                 (e.g. "capable", "crossProvider.capable")
  --agent        Agent name used in error messages (e.g. "coder", "verifier")
  --model-tiers  Path to model-tiers JSON file (default: ~/.pi/agent/model-tiers.json)

Outputs (stdout, JSON):
  {
    "model":    "<provider>/<model-name>",
    "cli":      "<cli-binary>",
    "provider": "<provider>",
    "tier":     "<tier>"
  }

Failure templates (written to stderr, exit 1):
  Template 1 — file missing or unreadable:
    ~/.pi/agent/model-tiers.json missing or unreadable — cannot dispatch <agent>.
  Template 2 — tier key absent or value empty:
    model-tiers.json has no usable "<tier>" model — cannot dispatch <agent>.
  Template 3 — dispatch map absent:
    model-tiers.json has no dispatch map — cannot dispatch <agent>.
  Template 4 — provider entry absent in dispatch:
    model-tiers.json has no dispatch.<provider> mapping for <tier> model <model> — cannot dispatch <agent>.
"""
import argparse
import json
import os
import sys


def die(msg):
    sys.stderr.write(msg + "\n")
    sys.exit(1)


def resolve_tier(data, tier):
    """Walk dot-separated tier path. Returns the value or None if missing."""
    parts = tier.split(".", 1)
    node = data.get(parts[0])
    if node is None:
        return None
    if len(parts) == 1:
        return node
    if not isinstance(node, dict):
        return None
    return node.get(parts[1])


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--tier",
        required=True,
        help="Dot-separated tier path (e.g. 'capable', 'crossProvider.capable')",
    )
    parser.add_argument(
        "--agent",
        required=True,
        help="Agent name for error messages (e.g. 'coder')",
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

    model = resolve_tier(data, args.tier)
    if not model:
        die(f'model-tiers.json has no usable "{args.tier}" model — cannot dispatch {args.agent}.')

    dispatch = data.get("dispatch")
    if not dispatch:
        die(f"model-tiers.json has no dispatch map — cannot dispatch {args.agent}.")

    provider = model.split("/", 1)[0]
    cli = dispatch.get(provider)
    if not cli:
        die(
            f"model-tiers.json has no dispatch.{provider} mapping for "
            f"{args.tier} model {model} — cannot dispatch {args.agent}."
        )

    print(json.dumps({"model": model, "cli": cli, "provider": provider, "tier": args.tier}))


if __name__ == "__main__":
    main()
