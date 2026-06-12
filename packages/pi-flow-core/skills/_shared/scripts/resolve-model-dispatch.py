#!/usr/bin/env python3
"""
resolve-model-dispatch — look up the CLI and model string for a given tier and agent.

Inputs:
  --model-tier   Section-qualified dot path into flow.json
                 (e.g. "modelTiers.capable", "crossProviderModelTiers.capable")
  --agent        Agent name used in error messages (e.g. "coder", "verifier")
  --flow-config  Explicit flow config path override (default: resolve project-local then user/global)
  --working-dir  Workflow workspace root for project-local flow config resolution (default: cwd)

Outputs (stdout, JSON):
  {
    "model":           "<provider>/<model-name>",
    "cli":             "<cli-binary>",
    "provider":        "<provider>",
    "tier":            "<tier>",
    "executionPolicy": "guarded" | "unrestricted"
  }

Failure templates (written to stderr, exit 1):
  Template 1 — file missing or unreadable:
    flow.json missing or unreadable; searched <locations> — cannot dispatch <agent>.
  Template 2 — tier key absent or value empty:
    flow.json has no usable "<tier>" model — cannot dispatch <agent>.
  Template 3 — subagentDispatch map absent:
    flow.json has no subagentDispatch map — cannot dispatch <agent>.
  Template 4 — provider entry absent in subagentDispatch:
    flow.json has no subagentDispatch.<provider> mapping for <tier> model <model> — cannot dispatch <agent>.
  Template 5 — executionPolicy missing or invalid:
    flow.json has no usable executionPolicy ("guarded" or "unrestricted") — cannot dispatch <agent>.
"""
import argparse
import json
import sys
from flow_config_resolution import resolve_flow_config, FlowConfigError, missing_config_clause


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
        "--model-tier",
        default=None,
        help="Section-qualified tier path (e.g. 'modelTiers.capable', 'crossProviderModelTiers.capable')",
    )
    parser.add_argument(
        "--agent",
        required=True,
        help="Agent name for error messages (e.g. 'coder')",
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
    args, unknown = parser.parse_known_args()
    if unknown:
        parser.error(f"unrecognized arguments: {' '.join(unknown)}")
    if args.model_tier is None:
        parser.error("the following arguments are required: --model-tier")

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

    if not isinstance(data, dict):
        die(f'flow.json has no usable "{args.model_tier}" model — cannot dispatch {args.agent}.')

    model = resolve_tier(data, args.model_tier)
    if not isinstance(model, str) or "/" not in model:
        die(f'flow.json has no usable "{args.model_tier}" model — cannot dispatch {args.agent}.')
    provider, _, model_suffix = model.partition("/")
    if not provider or not model_suffix:
        die(f'flow.json has no usable "{args.model_tier}" model — cannot dispatch {args.agent}.')

    dispatch = data.get("subagentDispatch")
    if not isinstance(dispatch, dict) or not dispatch:
        die(f"flow.json has no subagentDispatch map — cannot dispatch {args.agent}.")

    cli = dispatch.get(provider)
    if not cli:
        die(
            f"flow.json has no subagentDispatch.{provider} mapping for "
            f"{args.model_tier} model {model} — cannot dispatch {args.agent}."
        )

    policy = data.get("executionPolicy")
    if policy not in ("guarded", "unrestricted"):
        die(
            'flow.json has no usable executionPolicy ("guarded" or "unrestricted") '
            f"— cannot dispatch {args.agent}."
        )

    print(json.dumps({"model": model, "cli": cli, "provider": provider, "tier": args.model_tier, "executionPolicy": policy}))


if __name__ == "__main__":
    main()
