#!/usr/bin/env python3
"""Assemble a filled coder prompt from the execute-task-prompt.md template."""

import argparse
import json
import os
import re
import sys


def read_input(value):
    """Read content from a file path or '-' for stdin."""
    if value == "-":
        return sys.stdin.read()
    try:
        with open(value) as f:
            return f.read()
    except (FileNotFoundError, IOError):
        return None


def fill_template(template, replacements):
    # Single-pass literal substitution: a placeholder that appears in a
    # replacement value is NOT re-expanded.
    def _sub(match):
        key = match.group(1)
        if key in replacements:
            return replacements[key]
        return match.group(0)

    return re.sub(r'\{([A-Z_][A-Z0-9_]*)\}', _sub, template)


def find_unreplaced_placeholders_in_template(template, replacements):
    """Find placeholders present in the template that have no replacement.

    Scans the template (not the filled output) so that literal `{...}` text
    inside replacement values is not mistaken for an unfilled placeholder.
    """
    keys_in_template = re.findall(r'\{([A-Z_][A-Z0-9_]*)\}', template)
    missing = [k for k in keys_in_template if k not in replacements]
    return sorted(set(missing))


def main():
    default_template = os.path.join(
        os.path.dirname(__file__),
        "..",
        "execute-task-prompt.md",
    )
    default_tdd_block_template = os.path.join(
        os.path.dirname(__file__),
        "..",
        "tdd-block.md",
    )

    parser = argparse.ArgumentParser(
        description="Assemble a filled coder prompt from the execute-task-prompt.md template. "
        "Placeholders replaced: TASK_SPEC, CONTEXT, WORKING_DIR, TDD_BLOCK. "
        "Failures: input missing or unreadable (exit 2), unreplaced placeholders remain (exit 1).",
    )
    parser.add_argument(
        "--template",
        default=default_template,
        help="Path to the template file (default: execute-task-prompt.md)",
    )
    parser.add_argument(
        "--task-spec",
        required=True,
        metavar="PATH_OR_DASH",
        help="Path or '-' for stdin: TASK_SPEC text",
    )
    parser.add_argument(
        "--context",
        required=True,
        metavar="PATH_OR_DASH",
        help="Path or '-' for stdin: CONTEXT text",
    )
    parser.add_argument(
        "--working-dir",
        required=True,
        help="Working directory string for WORKING_DIR",
    )
    parser.add_argument(
        "--tdd-block",
        required=True,
        choices=["enabled", "disabled"],
        help="Whether to include the TDD block (enabled or disabled)",
    )
    parser.add_argument(
        "--tdd-block-template",
        default=default_tdd_block_template,
        help="Path to the TDD block template (default: tdd-block.md)",
    )
    parser.add_argument(
        "--output",
        default="-",
        help="Output file path or '-' for stdout (default: stdout)",
    )

    args = parser.parse_args()

    # Read template
    try:
        with open(args.template) as f:
            template = f.read()
    except (FileNotFoundError, IOError) as e:
        print(
            json.dumps({
                "failure": "input missing or unreadable",
                "input": "template",
            }),
            file=sys.stderr,
        )
        sys.exit(2)

    # Read task spec
    task_spec = read_input(args.task_spec)
    if task_spec is None:
        print(
            json.dumps({
                "failure": "input missing or unreadable",
                "input": "task-spec",
            }),
            file=sys.stderr,
        )
        sys.exit(2)

    # Read context
    context = read_input(args.context)
    if context is None:
        print(
            json.dumps({
                "failure": "input missing or unreadable",
                "input": "context",
            }),
            file=sys.stderr,
        )
        sys.exit(2)

    # Read TDD block if enabled
    if args.tdd_block == "enabled":
        tdd_block = read_input(args.tdd_block_template)
        if tdd_block is None:
            print(
                json.dumps({
                    "failure": "input missing or unreadable",
                    "input": "tdd-block-template",
                }),
                file=sys.stderr,
            )
            sys.exit(2)
    else:
        tdd_block = ""

    # Build placeholder map
    replacements = {
        "TASK_SPEC": task_spec.rstrip("\n"),
        "CONTEXT": context.rstrip("\n"),
        "WORKING_DIR": args.working_dir,
        "TDD_BLOCK": tdd_block.rstrip("\n"),
    }

    # Check for unreplaced placeholders in the template before filling
    unreplaced = find_unreplaced_placeholders_in_template(template, replacements)
    if unreplaced:
        print(
            json.dumps({
                "failure": "unreplaced placeholders remain",
                "unreplaced": unreplaced,
            }),
            file=sys.stderr,
        )
        sys.exit(1)

    # Fill template (single-pass, non-recursive)
    filled = fill_template(template, replacements)

    # Write output
    if args.output == "-":
        sys.stdout.write(filled)
    else:
        with open(args.output, "w") as f:
            f.write(filled)


if __name__ == "__main__":
    main()
