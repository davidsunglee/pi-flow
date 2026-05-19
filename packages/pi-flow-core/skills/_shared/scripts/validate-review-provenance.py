#!/usr/bin/env python3
"""
validate-review-provenance — verify the **Reviewer:** line in a review file
matches an allowed model tier.

Inputs:
  --review-file    Path to the review markdown file
  --allowed-tiers  Comma-separated tier paths (e.g. "crossProvider.capable,capable")
  --model-tiers    Path to model-tiers JSON file (default: ~/.pi/agent/model-tiers.json)

Outputs (stdout, JSON on success):
  {"provider_model": "<provider>/<model>", "cli": "<cli>", "matched_tier": "<tier>"}

Failure labels (written to stderr as JSON {"failure": "<label>"}, exit 1):
  first non-empty line missing
  format mismatch
  inline-substring forbidden
  model/cli mismatch (expected <pairs> got <observed>)
  model-tiers.json missing or unreadable
"""
import argparse
import json
import os
import re
import sys

REVIEWER_RE = re.compile(r"^\*\*Reviewer:\*\* [^/]+/[^ ]+ via [a-zA-Z0-9_-]+$")


def fail(label):
    sys.stderr.write(json.dumps({"failure": label}) + "\n")
    sys.exit(1)


def resolve_tier(data, tier):
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
        epilog=(
            "Canonical failure labels:\n"
            "  first non-empty line missing\n"
            "  format mismatch\n"
            "  inline-substring forbidden\n"
            "  model/cli mismatch (expected <pairs> got <observed>)\n"
            "  model-tiers.json missing or unreadable\n"
        ),
    )
    parser.add_argument("--review-file", required=True, help="Path to the review markdown file")
    parser.add_argument(
        "--allowed-tiers",
        required=True,
        help="Comma-separated tier paths (e.g. 'crossProvider.capable,capable')",
    )
    parser.add_argument(
        "--model-tiers",
        default="~/.pi/agent/model-tiers.json",
        help="Path to model-tiers JSON file (default: ~/.pi/agent/model-tiers.json)",
    )
    args = parser.parse_args()

    try:
        with open(args.review_file) as f:
            lines = f.readlines()
    except (IOError, OSError):
        fail("review file missing or unreadable")

    first_line = None
    for line in lines:
        stripped = line.strip()
        if stripped:
            first_line = stripped
            break

    if first_line is None:
        fail("first non-empty line missing")

    if not REVIEWER_RE.match(first_line):
        fail("format mismatch")

    if "inline" in first_line.lower():
        fail("inline-substring forbidden")

    # Extract provider/model and cli from the line
    # Format: **Reviewer:** <provider>/<model> via <cli>
    after_prefix = first_line[len("**Reviewer:** "):]
    parts = after_prefix.split(" via ", 1)
    observed_model = parts[0]
    observed_cli = parts[1]

    path = os.path.expanduser(args.model_tiers)
    try:
        with open(path) as f:
            data = json.load(f)
    except (IOError, OSError, json.JSONDecodeError):
        fail("model-tiers.json missing or unreadable")

    dispatch = data.get("dispatch", {})
    tiers = [t.strip() for t in args.allowed_tiers.split(",") if t.strip()]

    expected_pairs = []
    matched_tier = None

    for tier in tiers:
        resolved_model = resolve_tier(data, tier)
        if not resolved_model:
            continue
        provider = resolved_model.split("/", 1)[0]
        expected_cli = dispatch.get(provider)
        if not expected_cli:
            continue
        expected_pairs.append(f"{resolved_model} via {expected_cli}")
        if resolved_model == observed_model and expected_cli == observed_cli:
            matched_tier = tier
            break

    if matched_tier is None:
        expected_str = ", ".join(expected_pairs)
        observed_str = f"{observed_model} via {observed_cli}"
        fail(f"model/cli mismatch (expected {expected_str} got {observed_str})")

    print(json.dumps({
        "provider_model": observed_model,
        "cli": observed_cli,
        "matched_tier": matched_tier,
    }))


if __name__ == "__main__":
    main()
