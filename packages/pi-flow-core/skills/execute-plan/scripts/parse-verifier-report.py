#!/usr/bin/env python3
"""
Parse a verifier report and emit structured JSON.

Protocol-error labels emitted by this script:
  verifier phase-1 evidence block malformed at criterion N: <specific check>
  verifier missing evidence block for command-style criterion N
  verifier ran command not matching any phase-1 recipe: <command>

Captured stdout/stderr payloads wrapped in code fences are preserved verbatim.
Heading-like lines, evidence-block delimiters, criterion headers, field labels,
and `VERDICT:` lines that appear inside such fences are treated as opaque
payload, not as report structure.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared", "scripts"),
)
from fence_aware import compute_in_fence_lines, split_h2_sections, FENCE_RE


EVIDENCE_FIELDS = ("command:", "exit_code:", "stdout:", "stderr:")


def parse_evidence_blocks(section_text):
    """
    Parse [Evidence for Criterion N] blocks from Phase 1 Evidence section.
    Returns dict: {N (int): {"command": ..., "exit_code": ..., "stdout": ..., "stderr": ...}}
    and a list of protocol error strings.
    """
    blocks = {}
    errors = []
    lines = section_text.splitlines()
    in_fence = compute_in_fence_lines(lines)
    i = 0
    while i < len(lines):
        if i in in_fence:
            i += 1
            continue
        m = re.match(r"^\[Evidence for Criterion (\d+)\]$", lines[i].strip())
        if m:
            n = int(m.group(1))
            i += 1
            block_lines = []
            while i < len(lines):
                if i not in in_fence:
                    if re.match(r"^\[Evidence for Criterion \d+\]$", lines[i].strip()):
                        break
                    if re.match(r"^## ", lines[i]):
                        break
                block_lines.append(lines[i])
                i += 1
            parsed, errs = parse_evidence_fields(n, block_lines)
            errors.extend(errs)
            blocks[n] = parsed
        else:
            i += 1
    return blocks, errors


def parse_evidence_fields(n, lines):
    """
    Parse the four labelled fields from a single evidence block's lines.
    Returns (dict, list_of_errors).
    """
    errors = []
    field_order = ["command:", "exit_code:", "stdout:", "stderr:"]
    found = {}
    in_fence = compute_in_fence_lines(lines)

    i = 0
    field_idx = 0
    while i < len(lines):
        if i in in_fence:
            i += 1
            continue
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        matched_field = None
        for fi, label in enumerate(field_order):
            if stripped.startswith(label):
                matched_field = (fi, label)
                break
        if matched_field is not None:
            fi, label = matched_field
            if fi < field_idx:
                errors.append(
                    f"verifier phase-1 evidence block malformed at criterion {n}: "
                    f"{label[:-1]} field out of order"
                )
            field_idx = fi + 1
            value = stripped[len(label):].strip()
            key = label[:-1]
            buf = [value]
            i += 1
            while i < len(lines):
                # Fenced payload: consume opener+interior+closer verbatim, then
                # continue scanning for further value content past the closer.
                if i not in in_fence and FENCE_RE.match(lines[i].rstrip("\n")):
                    opener_match = FENCE_RE.match(lines[i].rstrip("\n"))
                    marker_str = opener_match.group(2)
                    marker_char = marker_str[0]
                    opener_len = len(marker_str)
                    i += 1  # skip opener (interior only, per spec)
                    while i < len(lines):
                        cm = FENCE_RE.match(lines[i].rstrip("\n"))
                        if cm:
                            c_marker = cm.group(2)
                            c_after = cm.group(3)
                            if (
                                c_marker[0] == marker_char
                                and len(c_marker) >= opener_len
                                and not c_after.strip()
                            ):
                                i += 1  # skip past closer
                                break
                        buf.append(lines[i])
                        i += 1
                    continue
                next_stripped = lines[i].strip()
                is_next_field = any(
                    next_stripped.startswith(lbl) for lbl in field_order
                )
                if is_next_field or not next_stripped:
                    if not next_stripped:
                        i += 1
                    break
                buf.append(next_stripped)
                i += 1
            found[key] = "\n".join(buf).strip()
        else:
            i += 1

    for label in field_order:
        key = label[:-1]
        if key not in found:
            errors.append(
                f"verifier phase-1 evidence block malformed at criterion {n}: "
                f"{key} field missing"
            )

    return found, errors


def _extract_reason(block_lines, start_idx, in_fence):
    """Extract the `reason:` field text (possibly multi-line) from a criterion block.

    Lines whose absolute index (start_idx + relative offset) is in `in_fence`
    are treated as opaque payload and skipped — they cannot start or terminate
    the reason and cannot pose as a `[Criterion N]` header.
    """
    reason_parts = []
    in_reason = False
    for offset, line in enumerate(block_lines):
        abs_idx = start_idx + offset
        if abs_idx in in_fence:
            continue
        stripped = line.strip()
        if not in_reason:
            m = re.match(r"^reason:\s*(.*)$", stripped, re.IGNORECASE)
            if m:
                in_reason = True
                first = m.group(1)
                if first:
                    reason_parts.append(first)
                continue
        else:
            if not stripped:
                break
            if re.match(r"^\[Criterion \d+\]", stripped):
                break
            reason_parts.append(stripped)
    return " ".join(reason_parts).strip()


def parse_per_criterion_verdicts(section_text, k):
    """
    Parse [Criterion N] PASS|FAIL headers and trailing `reason:` text.
    Returns (list of per-criterion dicts sorted by N, list of protocol errors).
    """
    errors = []
    seen = {}
    lines = section_text.splitlines()
    in_fence = compute_in_fence_lines(lines)

    # First pass: collect header positions so we can scope each block.
    header_positions = []  # list of (line_idx, n, token, trailing)
    for idx, line in enumerate(lines):
        if idx in in_fence:
            continue
        stripped = line.strip()
        m_bad = re.match(r"^\[Criterion (\d+)\]\s+verdict:\s*(.+)$", stripped)
        if m_bad:
            n = int(m_bad.group(1))
            errors.append(
                f"verifier malformed criterion header: [Criterion {n}] uses forbidden 'verdict:' prefix"
            )
            continue
        m = re.match(r"^\[Criterion (\d+)\]\s+(\S+)(.*)$", stripped)
        if m:
            header_positions.append(
                (idx, int(m.group(1)), m.group(2), m.group(3))
            )

    for hi, (idx, n, token, trailing) in enumerate(header_positions):
        end = header_positions[hi + 1][0] if hi + 1 < len(header_positions) else len(lines)
        block_lines = lines[idx + 1:end]
        reason = _extract_reason(block_lines, idx + 1, in_fence)

        if token not in ("PASS", "FAIL"):
            errors.append(
                f"verifier malformed criterion header: [Criterion {n}] has invalid verdict token '{token}' (must be PASS or FAIL)"
            )
            continue
        if trailing.strip():
            errors.append(
                f"verifier malformed criterion header: [Criterion {n}] has extra tokens after verdict (must be exactly '[Criterion {n}] PASS' or '[Criterion {n}] FAIL')"
            )
            continue
        if n in seen:
            errors.append(
                f"verifier duplicate criterion header: [Criterion {n}] appears more than once"
            )
            continue
        if n < 1 or n > k:
            errors.append(
                f"verifier out-of-range criterion header: [Criterion {n}] is outside 1..{k}"
            )
            continue
        seen[n] = {"criterion": n, "verdict": token, "reason": reason}

    # Check for missing criteria
    for i in range(1, k + 1):
        if i not in seen:
            errors.append(
                f"verifier missing criterion header: [Criterion {i}] not found (expected 1..{k})"
            )

    per_criterion = [seen[i] for i in sorted(seen.keys())]
    return per_criterion, errors


def parse_overall_verdict(section_text):
    """Parse VERDICT: PASS|FAIL line. Returns (verdict_str or None, errors)."""
    errors = []
    lines = section_text.splitlines()
    in_fence = compute_in_fence_lines(lines)
    for idx, line in enumerate(lines):
        if idx in in_fence:
            continue
        stripped = line.strip()
        m = re.match(r"^VERDICT:\s+(\S+)$", stripped)
        if m:
            token = m.group(1)
            if token in ("PASS", "FAIL"):
                return token, []
            else:
                errors.append(
                    f"verifier malformed overall verdict: unexpected token '{token}'"
                )
                return None, errors
    errors.append("verifier missing overall verdict: no VERDICT: line found")
    return None, errors


def validate_phase1_recipes(evidence_blocks, recipes, k):
    """
    For each criterion N in recipes, check:
    - evidence_blocks contains an entry for N
    - evidence_blocks[N]["command"] == recipes[N] (byte-equal)
    Returns list of protocol errors.
    """
    errors = []
    for n, recipe in recipes.items():
        if n not in evidence_blocks:
            errors.append(
                f"verifier missing evidence block for command-style criterion {n}"
            )
        else:
            actual_command = evidence_blocks[n].get("command", "")
            if actual_command != recipe:
                errors.append(
                    f"verifier ran command not matching any phase-1 recipe: {actual_command}"
                )

    allowed_commands = set(recipes.values())
    recipe_criteria = set(recipes.keys())
    for n, block in evidence_blocks.items():
        if n in recipe_criteria:
            continue
        actual_command = block.get("command", "")
        if actual_command not in allowed_commands:
            errors.append(
                f"verifier ran command not matching any phase-1 recipe: {actual_command}"
            )
    return errors


def _load_phase1_recipes(path):
    """
    Load phase-1 recipes from a JSON file.

    Required shape: a JSON array of objects, each with integer "criterion_n"
    and string "recipe". Returns ({n: recipe} dict, list_of_protocol_errors).
    """
    try:
        with open(path, "r") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        return {}, [f"phase1-recipes-json invalid: {e}"]

    if not isinstance(data, list):
        return {}, [
            "phase1-recipes-json invalid: expected a JSON array of "
            '{"criterion_n", "recipe"} entries'
        ]

    recipes = {}
    for i, entry in enumerate(data):
        if (
            not isinstance(entry, dict)
            or "criterion_n" not in entry
            or "recipe" not in entry
            or not isinstance(entry["criterion_n"], int)
            or not isinstance(entry["recipe"], str)
        ):
            return {}, [
                f"phase1-recipes-json invalid: entry {i} must be an object "
                'with integer "criterion_n" and string "recipe"'
            ]
        recipes[entry["criterion_n"]] = entry["recipe"]
    return recipes, []


def classify_report_tolerant(
    criteria_section, overall_section, evidence_blocks, evidence_errors,
    k, recipes, recipes_provided,
):
    """Deterministic second pass: decide whether a strict-flagged report still
    presents complete, unambiguous PASS evidence with only protocol-only defects.

    Returns (semantic_pass, per_criterion, phase1_evidence, protocol_warnings).
    `substantive = True` is set on any deviation that cannot be accounted for as
    an enumerated protocol-only defect, forcing `semantic_pass = False`.
    """
    substantive = False
    protocol_warnings = []

    # 1. Criteria recovery (fence-aware).
    crit_lines = criteria_section.splitlines()
    crit_in_fence = compute_in_fence_lines(crit_lines)
    recovered_pass = set()
    seen = {}
    reasons = {}

    # Collect header positions to scope each criterion's reason block.
    header_positions = []  # (line_idx, n)
    for idx, line in enumerate(crit_lines):
        if idx in crit_in_fence:
            continue
        m = re.match(r"^\[Criterion (\d+)\]\s*(.*)$", line.strip())
        if m:
            header_positions.append((idx, int(m.group(1)), m.group(2)))

    for hi, (idx, n, rest) in enumerate(header_positions):
        end = header_positions[hi + 1][0] if hi + 1 < len(header_positions) else len(crit_lines)
        block_lines = crit_lines[idx + 1:end]
        reasons[n] = _extract_reason(block_lines, idx + 1, crit_in_fence)

        rest = rest.strip()
        verdict_prefix = False
        if rest.startswith("verdict:"):
            verdict_prefix = True
            rest = rest[len("verdict:"):].strip()
        tokens = rest.split()
        first = tokens[0] if tokens else ""
        trailing = tokens[1:]

        if n in seen:
            substantive = True
            continue
        seen[n] = True
        if n < 1 or n > k:
            substantive = True
            continue

        if first.upper() == "PASS":
            recovered_pass.add(n)
            if first != "PASS":
                protocol_warnings.append(
                    f"criterion {n}: verdict token '{first}' differs only in case from PASS"
                )
            if trailing:
                protocol_warnings.append(
                    f"criterion {n}: trailing annotation after PASS verdict: {' '.join(trailing)}"
                )
            if verdict_prefix:
                protocol_warnings.append(
                    f"criterion {n}: forbidden 'verdict:' prefix before PASS verdict"
                )
        elif first.upper() == "FAIL":
            substantive = True
        else:
            substantive = True

    for n in range(1, k + 1):
        if n not in recovered_pass:
            substantive = True

    # 2. Overall recovery (fence-aware). Collect every non-fenced overall
    # VERDICT: line; a recoverable PASS requires exactly one such line whose
    # token is PASS-like. A duplicate overall verdict, any FAIL-like token, or
    # any unrecognized token is substantive contrary evidence — accepting the
    # first PASS-like token and ignoring a later conflicting FAIL would break
    # the fail-closed posture.
    overall_lines = overall_section.splitlines()
    overall_in_fence = compute_in_fence_lines(overall_lines)
    overall_verdicts = []  # list of token-lists, one per non-fenced VERDICT: line
    for idx, line in enumerate(overall_lines):
        if idx in overall_in_fence:
            continue
        m = re.match(r"^VERDICT:\s*(.*)$", line.strip())
        if m:
            overall_verdicts.append(m.group(1).strip().split())

    overall_pass = False
    if len(overall_verdicts) != 1:
        # Zero overall verdicts (none recoverable) or duplicates (ambiguous)
        # are both substantive.
        substantive = True
    else:
        tokens = overall_verdicts[0]
        first = tokens[0] if tokens else ""
        if first.upper() == "PASS":
            overall_pass = True
            if first != "PASS":
                protocol_warnings.append(
                    f"overall verdict token '{first}' differs only in case from PASS"
                )
            if tokens[1:]:
                protocol_warnings.append(
                    f"overall verdict has trailing annotation: {' '.join(tokens[1:])}"
                )
        else:
            # FAIL-like or otherwise unrecognized overall token.
            substantive = True
    if not overall_pass:
        substantive = True

    # 3. Evidence classification.
    label_missing_re = re.compile(
        r"evidence block malformed at criterion \d+: (stdout|stderr) field missing"
    )
    for err in evidence_errors:
        if label_missing_re.search(err):
            protocol_warnings.append(err)
        else:
            substantive = True

    if recipes_provided:
        for n, recipe in recipes.items():
            if n not in evidence_blocks:
                substantive = True
                continue
            cmd = evidence_blocks[n].get("command", "")
            if cmd.strip() == recipe.strip():
                if cmd != recipe:
                    protocol_warnings.append(
                        f"criterion {n}: command has surrounding whitespace differing from recipe"
                    )
            else:
                substantive = True
            exit_raw = evidence_blocks[n].get("exit_code", "")
            try:
                if int(exit_raw) != 0:
                    substantive = True
            except (ValueError, TypeError):
                substantive = True
        allowed = {r.strip() for r in recipes.values()}
        for n, block in evidence_blocks.items():
            if n in recipes:
                continue
            if block.get("command", "").strip() not in allowed:
                substantive = True

    # 4. Decision.
    semantic_pass = (not substantive) and (len(protocol_warnings) > 0)
    per_criterion = []
    phase1_evidence = {}
    if semantic_pass:
        per_criterion = [
            {"criterion": n, "verdict": "PASS", "reason": reasons.get(n, "")}
            for n in range(1, k + 1)
        ]
        phase1_evidence = evidence_blocks
    return semantic_pass, per_criterion, phase1_evidence, protocol_warnings


def main():
    parser = argparse.ArgumentParser(
        description="Parse a verifier report and emit structured JSON.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Protocol-error labels:
  verifier phase-1 evidence block malformed at criterion N: <specific check>
  verifier missing evidence block for command-style criterion N
  verifier ran command not matching any phase-1 recipe: <command>
""",
    )
    parser.add_argument("--report", required=True, help="Path to verifier report .md file")
    parser.add_argument(
        "--criteria-count",
        required=True,
        type=int,
        help="Total number of acceptance criteria (K)",
    )
    parser.add_argument(
        "--phase1-recipes-json",
        default=None,
        help=(
            "Path to a JSON file containing an array of "
            '{"criterion_n": <int>, "recipe": <str>} entries.'
        ),
    )
    args = parser.parse_args()

    with open(args.report, "r") as f:
        text = f.read()

    k = args.criteria_count
    recipes = {}
    recipes_load_errors = []
    if args.phase1_recipes_json:
        recipes, recipes_load_errors = _load_phase1_recipes(args.phase1_recipes_json)
        if recipes_load_errors:
            result = {
                "verdict": "FAIL",
                "per_criterion": [],
                "phase1_evidence": {},
                "protocol_errors": recipes_load_errors,
            }
            print(json.dumps(result, indent=2))
            sys.exit(1)

    sections = split_h2_sections(text)

    evidence_section = sections.get("Phase 1 Evidence", "")
    criteria_section = sections.get("Per-Criterion Verdicts", "")
    overall_section = sections.get("Overall Verdict", "")

    protocol_errors = []

    # Parse evidence blocks
    evidence_blocks, evidence_errors = parse_evidence_blocks(evidence_section)
    protocol_errors.extend(evidence_errors)

    # Parse per-criterion verdicts
    per_criterion, crit_errors = parse_per_criterion_verdicts(criteria_section, k)
    protocol_errors.extend(crit_errors)

    # Parse overall verdict
    overall_verdict, verdict_errors = parse_overall_verdict(overall_section)
    protocol_errors.extend(verdict_errors)

    # Validate phase-1 recipes if the flag was provided (even with [] recipes,
    # so extra evidence commands are still rejected).
    if args.phase1_recipes_json:
        recipe_errors = validate_phase1_recipes(evidence_blocks, recipes, k)
        protocol_errors.extend(recipe_errors)

    # Determine final verdict.
    # Any per-criterion FAIL forces FAIL regardless of the overall line, so a
    # malformed/inconsistent report cannot let a failed criterion through.
    any_criterion_fail = any(c["verdict"] == "FAIL" for c in per_criterion)

    strict_clean = (not protocol_errors) and (not any_criterion_fail)

    if strict_clean:
        final_verdict = overall_verdict if overall_verdict else "FAIL"
        result = {
            "verdict": final_verdict,
            "per_criterion": per_criterion,
            "phase1_evidence": {str(n): block for n, block in evidence_blocks.items()},
            "protocol_errors": protocol_errors,
        }
        print(json.dumps(result, indent=2))
        sys.exit(0 if final_verdict == "PASS" else 1)

    semantic_pass, tol_per_criterion, tol_evidence, protocol_warnings = classify_report_tolerant(
        criteria_section, overall_section, evidence_blocks, evidence_errors,
        k, recipes, bool(args.phase1_recipes_json),
    )
    if semantic_pass:
        result = {
            "verdict": "PASS_WITH_PROTOCOL_WARNINGS",
            "per_criterion": tol_per_criterion,
            "phase1_evidence": {str(n): block for n, block in tol_evidence.items()},
            "protocol_errors": [],
            "protocol_warnings": protocol_warnings,
        }
        print(json.dumps(result, indent=2))
        sys.exit(0)

    result = {
        "verdict": "FAIL",
        "per_criterion": per_criterion,
        "phase1_evidence": {str(n): block for n, block in evidence_blocks.items()},
        "protocol_errors": protocol_errors,
    }
    print(json.dumps(result, indent=2))
    sys.exit(1)


if __name__ == "__main__":
    main()
