#!/usr/bin/env python3
"""Assemble a filled verifier prompt from the verify-task-prompt.md template."""

import argparse
import json
import os
import re
import sys


def read_input(value):
    """Read content from a file path or '-' for stdin."""
    if value == "-":
        return sys.stdin.read()
    with open(value) as f:
        return f.read()


def format_acceptance_criteria(criteria):
    lines = []
    for i, item in enumerate(criteria, start=1):
        lines.append(f"{i}. {item['text']}")
        lines.append(f"   Verify: {item['verify']}")
    return "\n".join(lines)


def format_phase1_recipes(recipes):
    lines = []
    for item in recipes:
        lines.append(f"[Recipe for Criterion {item['criterion_n']}] {item['recipe']}")
    return "\n".join(lines)


def deduplicate_lines(text):
    seen = set()
    result = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and stripped not in seen:
            seen.add(stripped)
            result.append(stripped)
    return "\n".join(result)


def fill_template(template, replacements):
    # Single-pass literal substitution: a placeholder that appears in a
    # replacement value is NOT re-expanded.
    def _sub(match):
        key = match.group(1)
        if key in replacements:
            return replacements[key]
        return match.group(0)

    return re.sub(r'\{([A-Z_][A-Z0-9_]*)\}', _sub, template)


def find_unreplaced_template_placeholders(template, replacements):
    """Return placeholders present in the template that have no replacement.

    Scans the template (not the filled output) so that literal `{...}` text
    inside replacement values is not mistaken for an unfilled placeholder.
    """
    keys_in_template = re.findall(r'\{([A-Z_][A-Z0-9_]*)\}', template)
    missing = [k for k in keys_in_template if k not in replacements]
    return ["{" + k + "}" for k in missing]


def main():
    default_template = os.path.join(
        os.path.dirname(__file__),
        "..",
        "verify-task-prompt.md",
    )

    parser = argparse.ArgumentParser(
        description="Assemble a filled verifier prompt from the verify-task-prompt.md template.",
    )
    parser.add_argument(
        "--template",
        default=default_template,
        help="Path to the template file (default: verify-task-prompt.md)",
    )
    parser.add_argument(
        "--task-spec",
        required=True,
        metavar="PATH_OR_DASH",
        help="Path or '-' for stdin: TASK_SPEC text",
    )
    parser.add_argument(
        "--criteria-json",
        required=True,
        metavar="PATH_OR_DASH",
        help="Path or '-' for stdin: JSON array of {text, verify} objects for ACCEPTANCE_CRITERIA_WITH_VERIFY",
    )
    parser.add_argument(
        "--phase1-recipes-json",
        required=True,
        metavar="PATH_OR_DASH",
        help="Path or '-' for stdin: JSON array of {criterion_n, recipe} objects for PHASE_1_RECIPES",
    )
    parser.add_argument(
        "--modified-files",
        required=True,
        metavar="PATH_OR_DASH",
        help="Path or '-' for stdin: newline-separated file paths for MODIFIED_FILES (deduplicated)",
    )
    parser.add_argument(
        "--diff-context",
        required=True,
        metavar="PATH_OR_DASH",
        help="Path or '-' for stdin: diff text for DIFF_CONTEXT",
    )
    parser.add_argument(
        "--working-dir",
        required=True,
        help="Working directory string for WORKING_DIR",
    )
    parser.add_argument(
        "--output",
        default="-",
        help="Output file path or '-' for stdout (default: stdout)",
    )

    args = parser.parse_args()

    # Read template
    with open(args.template) as f:
        template = f.read()

    # Read and parse inputs
    task_spec = read_input(args.task_spec)

    criteria_raw = read_input(args.criteria_json)
    try:
        criteria = json.loads(criteria_raw)
    except json.JSONDecodeError as exc:
        print(
            json.dumps({"error": "criteria-json parse failure", "detail": str(exc)}),
            file=sys.stderr,
        )
        sys.exit(1)

    recipes_raw = read_input(args.phase1_recipes_json)
    try:
        recipes = json.loads(recipes_raw)
    except json.JSONDecodeError as exc:
        print(
            json.dumps({"error": "phase1-recipes-json parse failure", "detail": str(exc)}),
            file=sys.stderr,
        )
        sys.exit(1)

    modified_raw = read_input(args.modified_files)
    diff_context = read_input(args.diff_context)

    # Format values
    acceptance_criteria_text = format_acceptance_criteria(criteria)
    phase1_recipes_text = format_phase1_recipes(recipes)
    modified_files_text = deduplicate_lines(modified_raw)

    replacements = {
        "TASK_SPEC": task_spec.rstrip("\n"),
        "ACCEPTANCE_CRITERIA_WITH_VERIFY": acceptance_criteria_text,
        "PHASE_1_RECIPES": phase1_recipes_text,
        "MODIFIED_FILES": modified_files_text,
        "DIFF_CONTEXT": diff_context.rstrip("\n"),
        "WORKING_DIR": args.working_dir,
    }

    # Check for unreplaced placeholders in the template before filling, so
    # literal `{KEY}` text inside replacement values isn't flagged.
    remaining = find_unreplaced_template_placeholders(template, replacements)

    # Fill template (single-pass, non-recursive)
    filled = fill_template(template, replacements)

    if remaining:
        print(
            json.dumps({
                "error": "unreplaced_placeholders",
                "tokens": remaining,
            }),
            file=sys.stderr,
        )
        sys.exit(1)

    # Write output
    if args.output == "-":
        sys.stdout.write(filled)
    else:
        with open(args.output, "w") as f:
            f.write(filled)


if __name__ == "__main__":
    main()
