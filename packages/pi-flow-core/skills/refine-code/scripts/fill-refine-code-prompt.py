#!/usr/bin/env python3
"""
fill-refine-code-prompt: Fill placeholders in the refine-code-prompt.md template.

This script reads the refine-code-prompt.md template and replaces nine required
placeholders with provided values. Text inputs (plan-goal, plan-contents, model-matrix)
accept file paths or '-' for stdin. Other inputs (SHAs, paths, integers) are literal values.
The carry-over-review input is a literal prior-review path or empty string.

The script performs single-pass literal substitution (no recursive expansion).
After substitution, it checks for any remaining {PLACEHOLDER} tokens and fails if found.
"""

import argparse
import json
import re
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="Fill placeholders in refine-code-prompt.md template.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Nine required placeholders:
  PLAN_GOAL — the implementation goal/summary
  PLAN_CONTENTS — the plan or requirements text
  BASE_SHA — pre-implementation git SHA
  HEAD_SHA — post-implementation git SHA
  REVIEW_OUTPUT_PATH — path where reviewer will write the review file
  MAX_ITERATIONS — maximum number of review iterations
  MODEL_MATRIX — JSON with model tier configurations
  WORKING_DIR — working directory for execution
  CARRY_OVER_REVIEW — prior era's review file path (empty string "" valid)

Text inputs (plan-goal, plan-contents, model-matrix) accept file paths or '-' for stdin.
Other inputs are literal values. CARRY_OVER_REVIEW is passed through literally.

Example:
  fill-refine-code-prompt.py \\
    --plan-goal /path/to/goal.md \\
    --plan-contents /path/to/plan.md \\
    --base-sha abc1234 \\
    --head-sha def5678 \\
    --review-output-path review.md \\
    --max-iterations 5 \\
    --model-matrix /path/to/models.json \\
    --working-dir /work \\
    --carry-over-review /path/to/review.txt \\
    --output output.md
        """
    )

    default_template = Path(__file__).parent.parent / "refine-code-prompt.md"

    parser.add_argument(
        "--template",
        default=str(default_template),
        help=f"Path to template file (default: {default_template})"
    )
    parser.add_argument(
        "--plan-goal",
        required=True,
        help="Path to file containing plan goal, or '-' for stdin"
    )
    parser.add_argument(
        "--plan-contents",
        required=True,
        help="Path to file containing plan/requirements, or '-' for stdin"
    )
    parser.add_argument(
        "--base-sha",
        required=True,
        help="Pre-implementation git SHA (literal)"
    )
    parser.add_argument(
        "--head-sha",
        required=True,
        help="Post-implementation git SHA (literal)"
    )
    parser.add_argument(
        "--review-output-path",
        required=True,
        help="Path for review output (literal)"
    )
    parser.add_argument(
        "--max-iterations",
        required=True,
        type=int,
        help="Maximum number of review iterations"
    )
    parser.add_argument(
        "--model-matrix",
        required=True,
        help="Path to model matrix JSON, or '-' for stdin"
    )
    parser.add_argument(
        "--working-dir",
        required=True,
        help="Working directory (literal)"
    )
    parser.add_argument(
        "--carry-over-review",
        required=True,
        help="Path to prior era's review file, or empty string"
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output file path"
    )

    args = parser.parse_args()

    try:
        # Read template file
        try:
            with open(args.template, 'r') as f:
                template_content = f.read()
        except OSError as e:
            sys.stderr.write(json.dumps({
                "failure": "template missing or unreadable",
                "path": args.template,
                "error": str(e),
            }) + "\n")
            sys.exit(2)

        # Helper function to read text input (file or stdin)
        def read_text_input(spec, input_name):
            try:
                if spec == "-":
                    return sys.stdin.read()
                else:
                    with open(spec, 'r') as f:
                        return f.read()
            except OSError as e:
                sys.stderr.write(json.dumps({
                    "failure": "input missing or unreadable",
                    "input": input_name,
                    "error": str(e),
                }) + "\n")
                sys.exit(2)

        # Read all inputs
        plan_goal = read_text_input(args.plan_goal, "plan-goal")
        plan_contents = read_text_input(args.plan_contents, "plan-contents")
        model_matrix = read_text_input(args.model_matrix, "model-matrix")

        # Carry-over review is a literal path string (or empty string).
        carry_over_review = args.carry_over_review

        # Build placeholder map with 9 required keys.
        placeholders = {
            "PLAN_GOAL": plan_goal,
            "PLAN_CONTENTS": plan_contents,
            "BASE_SHA": args.base_sha,
            "HEAD_SHA": args.head_sha,
            "REVIEW_OUTPUT_PATH": args.review_output_path,
            "MAX_ITERATIONS": str(args.max_iterations),
            "MODEL_MATRIX": model_matrix,
            "WORKING_DIR": args.working_dir,
            "CARRY_OVER_REVIEW": carry_over_review,
        }

        # refine-code-prompt.md intentionally documents downstream placeholders
        # used by the code-refiner when it fills reviewer/remediator prompts.
        # This helper owns only the eight placeholders above; values may also
        # contain literal {TOKENS} from plan text. Fail only when the input
        # template itself contains an unknown placeholder outside these sets.
        allowed_downstream_placeholders = {
            "DESCRIPTION",
            "NEW_HEAD",
            "PLAN_OR_REQUIREMENTS",
            "PREVIOUS_FINDINGS",
            "PREV_HEAD",
            "REVIEW_FINDINGS",
            "REVIEWER_PROVENANCE",
            "RE_REVIEW_BLOCK",
            "WHAT_WAS_IMPLEMENTED",
        }
        template_placeholders = set(
            re.findall(r'\{([A-Z_][A-Z0-9_]*)\}', template_content)
        )
        unreplaced = sorted(
            template_placeholders - set(placeholders) - allowed_downstream_placeholders
        )
        if unreplaced:
            sys.stderr.write(json.dumps({
                "failure": "unreplaced placeholders remain",
                "unreplaced": unreplaced,
            }) + "\n")
            sys.exit(1)

        # Single-pass literal substitution (no recursive expansion). Unknown
        # allowed downstream placeholders are preserved for the coordinator.
        def _sub(match):
            key = match.group(1)
            if key in placeholders:
                return str(placeholders[key])
            return match.group(0)

        output_content = re.sub(
            r'\{([A-Z_][A-Z0-9_]*)\}', _sub, template_content
        )

        # Write output
        if args.output == "-":
            sys.stdout.write(output_content)
        else:
            with open(args.output, 'w') as f:
                f.write(output_content)

        sys.exit(0)

    except Exception as e:
        sys.stderr.write(json.dumps({
            "failure": "unexpected error",
            "error": str(e),
            "type": type(e).__name__,
        }) + "\n")
        sys.exit(2)


if __name__ == "__main__":
    main()
