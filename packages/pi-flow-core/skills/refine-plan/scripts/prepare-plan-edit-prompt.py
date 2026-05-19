#!/usr/bin/env python3
"""Prepare a filled plan-edit prompt and return prompt metadata as JSON."""

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path


DEFAULT_TEMPLATE = Path(__file__).resolve().parents[1] / ".." / "generate-plan" / "edit-plan-prompt.md"


def emit_error(failure, **extra):
    payload = {"failure": failure}
    payload.update(extra)
    print(json.dumps(payload), file=sys.stderr)
    sys.exit(2)


def emit_protocol_error(failure, **extra):
    payload = {"failure": failure}
    payload.update(extra)
    print(json.dumps(payload), file=sys.stderr)
    sys.exit(1)


def read_file_or_stdin(value, field_name):
    if value == "-":
        return sys.stdin.read()
    try:
        return Path(value).read_text()
    except OSError:
        emit_error("input missing or unreadable", input=field_name)


def fill_template(template, replacements):
    def substitute(match):
        key = match.group(1)
        if key in replacements:
            return replacements[key]
        return match.group(0)

    return re.sub(r"\{([A-Z_][A-Z0-9_]*)\}", substitute, template)


def find_unreplaced_placeholders(template, replacements):
    keys_in_template = re.findall(r"\{([A-Z_][A-Z0-9_]*)\}", template)
    return sorted({key for key in keys_in_template if key not in replacements})


def write_temp_prompt(content):
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".md",
        prefix="prepare-plan-edit-prompt-",
        delete=False,
    ) as handle:
        handle.write(content)
        return handle.name


def main():
    parser = argparse.ArgumentParser(
        description="Prepare a filled edit-plan prompt and emit JSON metadata.",
    )
    parser.add_argument(
        "--template",
        default=str(DEFAULT_TEMPLATE),
        help="Path to edit-plan-prompt.md",
    )
    parser.add_argument(
        "--review-findings",
        required=True,
        help="Path to blocking findings markdown, or '-' for stdin",
    )
    parser.add_argument("--plan-path", required=True, help="Plan path")
    parser.add_argument("--task-artifact", required=True, help="Task artifact line or empty string")
    parser.add_argument("--source-todo", required=True, help="Source todo line or empty string")
    parser.add_argument("--source-spec", required=True, help="Source spec line or empty string")
    parser.add_argument("--scout-brief", required=True, help="Scout brief line or empty string")
    parser.add_argument(
        "--original-spec-inline",
        required=True,
        help="Path to original spec inline text, or '-' for stdin",
    )
    parser.add_argument("--output-path", required=True, help="Planner output path")
    args = parser.parse_args()

    try:
        template = Path(args.template).read_text()
    except OSError:
        emit_error("input missing or unreadable", input="template")

    review_findings = read_file_or_stdin(args.review_findings, "review-findings")
    original_spec_inline = read_file_or_stdin(args.original_spec_inline, "original-spec-inline")

    replacements = {
        "REVIEW_FINDINGS": review_findings,
        "PLAN_ARTIFACT": f"Plan artifact: {args.plan_path}",
        "TASK_ARTIFACT": args.task_artifact,
        "SOURCE_TODO": args.source_todo,
        "SOURCE_SPEC": args.source_spec,
        "SCOUT_BRIEF": args.scout_brief,
        "ORIGINAL_SPEC_INLINE": original_spec_inline,
        "OUTPUT_PATH": args.output_path,
    }

    unreplaced = find_unreplaced_placeholders(template, replacements)
    if unreplaced:
        emit_protocol_error("unreplaced placeholders remain", unreplaced=unreplaced)

    filled = fill_template(template, replacements)
    prompt_path = write_temp_prompt(filled)

    print(json.dumps({
        "prompt_path": prompt_path,
        "output_path": args.output_path,
    }))


if __name__ == "__main__":
    main()
