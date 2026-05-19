#!/usr/bin/env python3
"""Validate a review artifact handoff and parse verdict/count metadata from the review."""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


SHARED_SCRIPTS = Path(__file__).resolve().parents[2] / "_shared" / "scripts"
PARSE_HANDOFF = SHARED_SCRIPTS / "parse-artifact-handoff.py"
VALIDATE_PROVENANCE = SHARED_SCRIPTS / "validate-review-provenance.py"

sys.path.insert(0, str(SHARED_SCRIPTS))
from fence_aware import compute_in_fence_lines  # noqa: E402


VALID_VERDICTS = {"Approved", "Approved with concerns", "Not approved"}
SEVERITY_HEADINGS = [
    "Critical (Must Fix)",
    "Important (Should Fix)",
    "Minor (Nice to Have)",
]


def fail(failure, **extra):
    payload = {"failure": failure}
    payload.update(extra)
    print(json.dumps(payload), file=sys.stderr)
    sys.exit(1)


def run_helper(command):
    proc = subprocess.run(command, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        sys.exit(proc.returncode)
    return proc.stdout


def first_non_empty_line(text):
    for line in text.splitlines():
        if line.strip():
            return line
    return None


def split_markdown_sections(text, heading_prefix):
    lines = text.splitlines(keepends=True)
    in_fence = compute_in_fence_lines(lines)
    heading_re = re.compile(rf"^{re.escape(heading_prefix)} (.+)$")

    sections = {}
    current_key = None
    current_body = []

    for idx, line in enumerate(lines):
        stripped = line.rstrip("\n").rstrip("\r")
        match = heading_re.match(stripped)
        if match and idx not in in_fence:
            if current_key is not None:
                sections[current_key] = "".join(current_body)
            current_key = match.group(1).rstrip()
            current_body = []
        elif current_key is not None:
            current_body.append(line)

    if current_key is not None:
        sections[current_key] = "".join(current_body)

    return sections


def extract_verdict(outcome_section):
    lines = outcome_section.splitlines(keepends=False)
    in_fence = compute_in_fence_lines(lines)
    for idx, line in enumerate(lines):
        if idx in in_fence:
            continue
        match = re.match(r"^\*\*Verdict:\*\* (.+)$", line.strip())
        if match:
            verdict = match.group(1).strip()
            if verdict in VALID_VERDICTS:
                return verdict
            break
    fail("missing or unrecognized Verdict label")


def extract_finding_blocks(section_text):
    if section_text.strip() in {"", "_None._"}:
        return []

    lines = section_text.splitlines(keepends=True)
    in_fence = compute_in_fence_lines(lines)
    blocks = []
    current = []

    for idx, line in enumerate(lines):
        if idx not in in_fence and line.startswith("- "):
            if current:
                blocks.append("".join(current).rstrip())
            current = [line]
            continue
        if current:
            current.append(line)

    if current:
        blocks.append("".join(current).rstrip())

    return [block for block in blocks if block.strip()]


def build_blocking_findings(issues_sections):
    parts = []
    for heading in ("Critical (Must Fix)", "Important (Should Fix)"):
        blocks = extract_finding_blocks(issues_sections.get(heading, ""))
        if not blocks:
            continue
        parts.append(f"#### {heading}\n\n" + "\n\n".join(blocks))
    return "\n\n".join(parts)


def main():
    parser = argparse.ArgumentParser(
        description="Validate REVIEW_ARTIFACT handoff and parse a plan-review artifact.",
    )
    parser.add_argument(
        "--final-message",
        required=True,
        help="Path to final message text, or '-' for stdin",
    )
    parser.add_argument("--expected-path", required=True, help="Expected review artifact path")
    parser.add_argument(
        "--reviewer-provenance",
        required=True,
        help="Exact REVIEWER_PROVENANCE line expected at the start of the review file",
    )
    parser.add_argument(
        "--allowed-tiers",
        required=True,
        help="Comma-separated tier list for validate-review-provenance.py",
    )
    parser.add_argument(
        "--model-tiers",
        default="~/.pi/agent/model-tiers.json",
        help="Path to model-tiers JSON for validate-review-provenance.py",
    )
    args = parser.parse_args()

    handoff_stdout = run_helper([
        sys.executable,
        str(PARSE_HANDOFF),
        "--marker", "REVIEW_ARTIFACT",
        "--final-message", args.final_message,
        "--expected-path", args.expected_path,
        "--check-existence",
        "--check-non-empty",
    ])
    review_path = json.loads(handoff_stdout)["path"]

    try:
        review_text = Path(review_path).read_text()
    except OSError:
        fail(f"missing or empty at {review_path}")

    first_line = first_non_empty_line(review_text)
    if first_line != args.reviewer_provenance:
        fail("does not match supplied REVIEWER_PROVENANCE", review_path=review_path)

    run_helper([
        sys.executable,
        str(VALIDATE_PROVENANCE),
        "--review-file", review_path,
        "--allowed-tiers", args.allowed_tiers,
        "--model-tiers", args.model_tiers,
    ])

    sections = split_markdown_sections(review_text, "###")
    outcome = sections.get("Outcome", "")
    verdict = extract_verdict(outcome)

    issues_sections = split_markdown_sections(sections.get("Issues", ""), "####")
    for heading in SEVERITY_HEADINGS:
        issues_sections.setdefault(heading, "")

    critical_blocks = extract_finding_blocks(issues_sections["Critical (Must Fix)"])
    important_blocks = extract_finding_blocks(issues_sections["Important (Should Fix)"])
    minor_blocks = extract_finding_blocks(issues_sections["Minor (Nice to Have)"])

    print(json.dumps({
        "review_path": review_path,
        "verdict": verdict,
        "critical_count": len(critical_blocks),
        "important_count": len(important_blocks),
        "minor_count": len(minor_blocks),
        "blocking_findings_markdown": build_blocking_findings(issues_sections),
    }))


if __name__ == "__main__":
    main()
