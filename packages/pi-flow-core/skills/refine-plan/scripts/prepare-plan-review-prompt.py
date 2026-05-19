#!/usr/bin/env python3
"""Prepare a filled plan-review prompt and return prompt metadata as JSON."""

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path


DEFAULT_TEMPLATE = Path(__file__).resolve().parents[1] / ".." / "generate-plan" / "review-plan-prompt.md"


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
    missing = sorted({key for key in keys_in_template if key not in replacements})
    return missing


def compute_review_path(working_dir, review_output_path, current_era):
    base = Path(review_output_path)
    if not base.is_absolute():
        base = Path(working_dir) / base
    return str(base.resolve()) + f"-v{current_era}.md"


def write_temp_prompt(content):
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".md",
        prefix="prepare-plan-review-prompt-",
        delete=False,
    ) as handle:
        handle.write(content)
        return handle.name


def main():
    parser = argparse.ArgumentParser(
        description="Prepare a filled review-plan prompt and emit JSON metadata.",
    )
    parser.add_argument(
        "--template",
        default=str(DEFAULT_TEMPLATE),
        help="Path to review-plan-prompt.md",
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
    parser.add_argument(
        "--structural-only-note",
        required=True,
        help="Path to structural-only note text, or '-' for stdin",
    )
    parser.add_argument(
        "--review-output-path",
        required=True,
        help="Era-less review output base path",
    )
    parser.add_argument("--working-dir", required=True, help="Working directory")
    parser.add_argument("--current-era", required=True, type=int, help="Current era number")
    parser.add_argument("--reviewer-model", required=True, help="Resolved reviewer model")
    parser.add_argument("--reviewer-cli", required=True, help="Resolved reviewer cli")
    args = parser.parse_args()

    try:
        template = Path(args.template).read_text()
    except OSError:
        emit_error("input missing or unreadable", input="template")

    original_spec_inline = read_file_or_stdin(args.original_spec_inline, "original-spec-inline")
    structural_only_note = read_file_or_stdin(args.structural_only_note, "structural-only-note")

    reviewer_provenance = f"**Reviewer:** {args.reviewer_model} via {args.reviewer_cli}"
    review_path = compute_review_path(args.working_dir, args.review_output_path, args.current_era)

    replacements = {
        "PLAN_ARTIFACT": f"Plan artifact: {args.plan_path}",
        "TASK_ARTIFACT": args.task_artifact,
        "SOURCE_TODO": args.source_todo,
        "SOURCE_SPEC": args.source_spec,
        "SCOUT_BRIEF": args.scout_brief,
        "ORIGINAL_SPEC_INLINE": original_spec_inline,
        "STRUCTURAL_ONLY_NOTE": structural_only_note,
        "REVIEW_OUTPUT_PATH": review_path,
        "REVIEWER_PROVENANCE": reviewer_provenance,
    }

    unreplaced = find_unreplaced_placeholders(template, replacements)
    if unreplaced:
        emit_protocol_error("unreplaced placeholders remain", unreplaced=unreplaced)

    filled = fill_template(template, replacements)
    prompt_path = write_temp_prompt(filled)

    print(json.dumps({
        "prompt_path": prompt_path,
        "review_path": review_path,
        "reviewer_provenance": reviewer_provenance,
    }))


if __name__ == "__main__":
    main()
