#!/usr/bin/env python3
"""Fill placeholders in the refine-plan prompt template.

Supports thirteen placeholders:
  {PLAN_PATH}, {TASK_ARTIFACT}, {SOURCE_TODO}, {SOURCE_SPEC}, {SCOUT_BRIEF},
  {ORIGINAL_SPEC_INLINE}, {STRUCTURAL_ONLY_NOTE}, {MAX_ITERATIONS},
  {STARTING_ERA}, {REVIEW_OUTPUT_PATH}, {WORKING_DIR}, {MODEL_MATRIX},
  {CARRY_OVER_REVIEW}
"""

import argparse
import json
import re
import sys
from pathlib import Path


def read_file_or_stdin(value, field_name):
    """Read from file if value is a path, or from stdin if value is '-'."""
    if value == "-":
        return sys.stdin.read()
    try:
        with open(value, "r") as f:
            return f.read()
    except (FileNotFoundError, IOError):
        emit_error("input missing or unreadable", field_name)


def emit_error(failure, input_field):
    """Emit error as JSON to stderr and exit with code 2."""
    error = {"failure": failure, "input": input_field}
    print(json.dumps(error), file=sys.stderr)
    sys.exit(2)


def emit_error_exit_1(failure):
    """Emit error as JSON to stderr and exit with code 1."""
    error = {"failure": failure}
    print(json.dumps(error), file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Fill placeholders in the refine-plan prompt template.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Placeholders:
  PLAN_PATH - Path to the plan file
  TASK_ARTIFACT - Task artifact content
  SOURCE_TODO - Source TODO content
  SOURCE_SPEC - Source specification content
  SCOUT_BRIEF - Scout brief content
  ORIGINAL_SPEC_INLINE - Original spec inline (path or -)
  STRUCTURAL_ONLY_NOTE - Structural-only note (path or -)
  MAX_ITERATIONS - Maximum iterations (integer)
  STARTING_ERA - Starting era (integer)
  REVIEW_OUTPUT_PATH - Review output path
  WORKING_DIR - Working directory
  MODEL_MATRIX - Model matrix content (path or -)
  CARRY_OVER_REVIEW - Path to a prior era's review file (or empty string)
        """,
    )

    parser.add_argument(
        "--template",
        default=str(Path(__file__).parent.parent / "refine-plan-prompt.md"),
        help="Path to the template file",
    )
    parser.add_argument("--plan-path", required=True, help="Plan file path")
    parser.add_argument(
        "--task-artifact", required=True, help="Task artifact content"
    )
    parser.add_argument(
        "--source-todo", required=True, help="Source TODO content"
    )
    parser.add_argument(
        "--source-spec", required=True, help="Source specification content"
    )
    parser.add_argument(
        "--scout-brief", required=True, help="Scout brief content"
    )
    parser.add_argument(
        "--original-spec-inline",
        required=True,
        help="Original spec inline (path or -)",
    )
    parser.add_argument(
        "--structural-only-note",
        required=True,
        help="Structural-only note (path or -)",
    )
    parser.add_argument(
        "--max-iterations",
        required=True,
        type=int,
        help="Maximum iterations",
    )
    parser.add_argument(
        "--starting-era",
        required=True,
        type=int,
        help="Starting era",
    )
    parser.add_argument(
        "--review-output-path",
        required=True,
        help="Review output path",
    )
    parser.add_argument(
        "--working-dir",
        required=True,
        help="Working directory",
    )
    parser.add_argument(
        "--model-matrix",
        required=True,
        help="Model matrix content (path or -)",
    )
    parser.add_argument(
        "--carry-over-review",
        required=True,
        help="Path to a prior era's review file (empty string or path; threaded through as-is)",
    )
    parser.add_argument(
        "--output", required=True, help="Output file path"
    )

    args = parser.parse_args()

    # Read template
    try:
        with open(args.template, "r") as f:
            content = f.read()
    except (FileNotFoundError, IOError):
        emit_error("input missing or unreadable", "template")

    # Read values that must be file paths or stdin
    original_spec_inline = read_file_or_stdin(args.original_spec_inline, "original-spec-inline")
    structural_only_note = read_file_or_stdin(args.structural_only_note, "structural-only-note")
    model_matrix = read_file_or_stdin(args.model_matrix, "model-matrix")
    carry_over_review = args.carry_over_review

    # Build the placeholder map
    placeholders = {
        "{PLAN_PATH}": args.plan_path,
        "{TASK_ARTIFACT}": args.task_artifact,
        "{SOURCE_TODO}": args.source_todo,
        "{SOURCE_SPEC}": args.source_spec,
        "{SCOUT_BRIEF}": args.scout_brief,
        "{ORIGINAL_SPEC_INLINE}": original_spec_inline,
        "{STRUCTURAL_ONLY_NOTE}": structural_only_note,
        "{MAX_ITERATIONS}": str(args.max_iterations),
        "{STARTING_ERA}": str(args.starting_era),
        "{REVIEW_OUTPUT_PATH}": args.review_output_path,
        "{WORKING_DIR}": args.working_dir,
        "{MODEL_MATRIX}": model_matrix,
        "{CARRY_OVER_REVIEW}": carry_over_review,
    }

    # refine-plan-prompt.md intentionally documents downstream placeholders
    # used by the plan-refiner when it fills reviewer prompts. This helper owns
    # only the thirteen placeholders above; values may also contain literal
    # {TOKENS} from specs/plans. Fail only when the input template itself
    # contains an unknown placeholder outside these sets.
    owned = {placeholder.strip("{}") for placeholder in placeholders}
    allowed_downstream = {
        "OUTPUT_PATH",
        "PLAN_ARTIFACT",
        "REVIEWER_PROVENANCE",
        "REVIEW_FINDINGS",
    }
    template_placeholders = set(
        re.findall(r"\{([A-Z_][A-Z0-9_]*)\}", content)
    )
    unreplaced = sorted(template_placeholders - owned - allowed_downstream)
    if unreplaced:
        print(
            json.dumps(
                {"failure": "unreplaced placeholders remain", "unreplaced": unreplaced}
            ),
            file=sys.stderr,
        )
        sys.exit(1)

    # Apply single-pass literal substitution over the original template. Values
    # are returned verbatim, so placeholder-looking text inside inputs is not
    # expanded by later replacements.
    def substitute(match):
        key = match.group(1)
        placeholder = "{" + key + "}"
        if placeholder in placeholders:
            return str(placeholders[placeholder])
        return match.group(0)

    content = re.sub(r"\{([A-Z_][A-Z0-9_]*)\}", substitute, content)

    # Write output
    if args.output == "-":
        sys.stdout.write(content)
        return
    try:
        with open(args.output, "w") as f:
            f.write(content)
    except (IOError, OSError):
        print(
            json.dumps(
                {"failure": "cannot write output file"}
            ),
            file=sys.stderr,
        )
        sys.exit(2)


if __name__ == "__main__":
    main()
