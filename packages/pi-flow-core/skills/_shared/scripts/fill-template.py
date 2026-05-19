#!/usr/bin/env python3
"""
fill-template: Replace placeholders in a template file.

A placeholder is an uppercase identifier surrounded by curly braces, e.g. {IDENTIFIER}.
The script reads a JSON map of key-value pairs and replaces each {KEY} in the template
with its corresponding value.

Extra JSON keys whose {KEY} does not appear in the template are silently ignored.

If --require-all-replaced is set, the script checks the final output for any remaining
placeholders matching the pattern {IDENTIFIER}. If found, it emits a structured error to
stderr and exits non-zero. Unused JSON keys never trigger this check.
"""

import argparse
import json
import re
import sys


def main():
    parser = argparse.ArgumentParser(
        description="Replace placeholders in a template file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Replace a single placeholder from a JSON file
  fill-template.py --template template.md --placeholders-json data.json --output output.md

  # Read JSON from stdin
  echo '{"NAME": "world"}' | fill-template.py --template template.md --placeholders-json - --output -

  # Ensure all placeholders in the template are replaced
  fill-template.py --template template.md --placeholders-json data.json --output output.md --require-all-replaced

Placeholder Grammar:
  Placeholders are identifiers in curly braces: {IDENTIFIER}
  Valid identifiers start with an uppercase letter or underscore, followed by uppercase letters, digits, or underscores.
  Example: {NAME}, {PLAN_PATH}, {_INTERNAL}

Placeholder Semantics:
  - Each {KEY} in the template is replaced with the value of KEY from the JSON map
  - Replacement is literal (not recursive): if a value contains {OTHER}, it stays as-is
  - Extra JSON keys whose {KEY} does not appear in the template are silently ignored
  - When --require-all-replaced is set, the output is scanned for remaining placeholders
    matching the pattern {IDENTIFIER}. If found, a structured error is emitted to stderr
    and the script exits non-zero. Unused JSON keys never trigger this check.
        """
    )

    parser.add_argument(
        "--template",
        required=True,
        help="Path to the template file"
    )
    parser.add_argument(
        "--placeholders-json",
        required=True,
        help="Path to JSON file with placeholders, or '-' to read from stdin"
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path to output file, or '-' to write to stdout"
    )
    parser.add_argument(
        "--require-all-replaced",
        action="store_true",
        help="If set, fail if any placeholders remain unreplaced in the output"
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

        # Read JSON placeholders
        try:
            if args.placeholders_json == "-":
                json_text = sys.stdin.read()
            else:
                with open(args.placeholders_json, 'r') as f:
                    json_text = f.read()
        except OSError as e:
            sys.stderr.write(json.dumps({
                "failure": "placeholders-json missing or unreadable",
                "path": args.placeholders_json,
                "error": str(e),
            }) + "\n")
            sys.exit(2)

        try:
            placeholders = json.loads(json_text)
        except json.JSONDecodeError as e:
            sys.stderr.write(json.dumps({
                "failure": "placeholders-json malformed",
                "path": args.placeholders_json,
                "error": str(e),
            }) + "\n")
            sys.exit(2)

        # Replace placeholders in template in a single pass over the original
        # template, so values that happen to contain {OTHER_KEY} are NOT
        # re-expanded (literal, non-recursive substitution).
        str_placeholders = {k: str(v) for k, v in placeholders.items()}

        def _sub(match):
            key = match.group(1)
            if key in str_placeholders:
                return str_placeholders[key]
            return match.group(0)

        output_content = re.sub(
            r'\{([A-Z_][A-Z0-9_]*)\}', _sub, template_content
        )

        # Check for unreplaced placeholders if required
        if args.require_all_replaced:
            # Match {IDENTIFIER} where IDENTIFIER starts with uppercase or underscore
            # and continues with uppercase, digits, or underscores
            unreplaced_pattern = r'\{([A-Z_][A-Z0-9_]*)\}'
            matches = re.findall(unreplaced_pattern, output_content)

            if matches:
                # Sort and deduplicate
                unreplaced = sorted(set(matches))
                error_json = {
                    "failure": "unreplaced placeholders remain",
                    "unreplaced": unreplaced
                }
                sys.stderr.write(json.dumps(error_json) + "\n")
                sys.exit(1)

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
