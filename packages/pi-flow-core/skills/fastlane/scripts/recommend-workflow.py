#!/usr/bin/env python3
"""
Recommends fastlane or deep-workflow based on specification characteristics.

Analyzes a specification markdown file to determine complexity and approach.
Outputs a JSON recommendation with reasoning.
"""

import argparse
import json
import sys
import re
from pathlib import Path


def parse_markdown_sections(text):
    """Parse markdown sections, returning a dict of section names to content."""
    sections = {}
    current_section = None
    current_content = []

    for line in text.split('\n'):
        # Check for H2 header
        if line.startswith('## '):
            # Save previous section
            if current_section:
                sections[current_section] = '\n'.join(current_content).strip()
            current_section = line[3:].strip()
            current_content = []
        else:
            if current_section:
                current_content.append(line)

    # Save last section
    if current_section:
        sections[current_section] = '\n'.join(current_content).strip()

    return sections


def has_approach_section(text):
    """Check if text contains a '## Approach' header."""
    return bool(re.search(r'^## Approach\s*$', text, re.MULTILINE))


def count_requirements(text):
    """Count bullet points in the Requirements section."""
    sections = parse_markdown_sections(text)
    requirements_content = sections.get('Requirements', '')

    if not requirements_content:
        return 0

    # Count lines starting with '- ' (allowing leading whitespace)
    bullet_count = 0
    for line in requirements_content.split('\n'):
        if re.match(r'^\s*- ', line):
            bullet_count += 1

    return bullet_count


def find_flagged_non_goals(text):
    """Find flagged keywords in the Non-Goals section."""
    sections = parse_markdown_sections(text)
    non_goals_content = sections.get('Non-Goals', '')

    if not non_goals_content:
        return []

    # Keywords to search for (case-insensitive)
    keywords = ['multi-subsystem', 'migration', 'security', 'compatibility']
    flagged = []

    for keyword in keywords:
        if keyword.lower() in non_goals_content.lower():
            flagged.append(keyword)

    return flagged


def generate_rationale(has_approach, requirements_count, requirements_threshold, flagged_non_goals):
    """Generate human-readable rationale for the recommendation."""
    if not has_approach and requirements_count <= requirements_threshold and not flagged_non_goals:
        # Fastlane case
        return f"no Approach section, {requirements_count} requirements (threshold {requirements_threshold}), Non-Goals clean"
    else:
        # Deep-workflow case - collect trigger fragments
        triggers = []

        if has_approach:
            triggers.append("has Approach section")

        if requirements_count > requirements_threshold:
            triggers.append(f"{requirements_count} requirements (threshold {requirements_threshold})")

        if flagged_non_goals:
            keywords_str = ", ".join(flagged_non_goals)
            triggers.append(f"Non-Goals flags {keywords_str}")

        return ", ".join(triggers)


def main():
    parser = argparse.ArgumentParser(
        description='Recommend fastlane or deep-workflow based on specification characteristics.'
    )
    parser.add_argument(
        '--spec-path',
        required=True,
        help='Path to the specification markdown file'
    )
    parser.add_argument(
        '--requirements-threshold',
        type=int,
        default=6,
        help='Threshold for requirements count (default: 6)'
    )

    args = parser.parse_args()

    # Try to read the spec file
    spec_path = Path(args.spec_path)
    try:
        spec_content = spec_path.read_text()
    except FileNotFoundError:
        # Spec file missing
        error_output = {
            'failure': 'spec_missing',
            'path': args.spec_path
        }
        print(json.dumps(error_output, indent=2), file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Other read errors
        error_output = {
            'failure': 'spec_unreadable',
            'path': args.spec_path
        }
        print(json.dumps(error_output, indent=2), file=sys.stderr)
        sys.exit(1)

    # Analyze the specification
    has_approach = has_approach_section(spec_content)
    requirements_count = count_requirements(spec_content)
    flagged_non_goals = find_flagged_non_goals(spec_content)

    # Determine recommendation
    if not has_approach and requirements_count <= args.requirements_threshold and not flagged_non_goals:
        recommendation = 'fastlane'
    else:
        recommendation = 'deep-workflow'

    # Generate rationale
    rationale = generate_rationale(has_approach, requirements_count, args.requirements_threshold, flagged_non_goals)

    # Build output JSON
    output = {
        'recommendation': recommendation,
        'rationale': rationale,
        'reasons': {
            'has_approach': has_approach,
            'requirements_count': requirements_count,
            'requirements_threshold': args.requirements_threshold,
            'flagged_non_goals': flagged_non_goals
        }
    }

    # Output to stdout
    print(json.dumps(output, indent=2))
    sys.exit(0)


if __name__ == '__main__':
    main()
