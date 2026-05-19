"""
plan_fence_hardening — detect and rewrite ambiguous nested fences in plan markdown.

An outer fence is ambiguous when its inner body contains a fence opener (with an info
string) whose natural closer is the same bare marker that the outer fence parser
mistakenly uses as the outer closer — causing the outer fence to terminate prematurely.
"""

import argparse
import re
import sys

FENCE_RE = re.compile(r"^(\s*)(`{3,}|~{3,})(.*?)$")


def _fence_match(line):
    """Return (marker_char, marker_len, info) or None for a fence line."""
    m = FENCE_RE.match(line.rstrip("\n"))
    if m:
        marker = m.group(2)
        return marker[0], len(marker), m.group(3).strip()
    return None


def _find_first_closer(lines, start, outer_char, outer_len):
    """Return index of first valid closer for outer_char/outer_len starting at start."""
    for i in range(start, len(lines)):
        f = _fence_match(lines[i])
        if f:
            c_char, c_len, c_info = f
            if c_char == outer_char and c_len >= outer_len and not c_info:
                return i
    return None


def _find_intended_outer_closer(lines, opener_idx, outer_char, outer_len):
    """
    Find the intended outer closer for an outer fence by walking past inner fenced blocks.

    Skips past every inner opener/closer pair, so a bare same-marker fence that is
    actually an inner snippet's closer is not mistaken for the outer closer. A bare
    same-marker fence whose run is strictly longer than the outer opener is also
    treated as a candidate inner opener when a matching same-length closer exists
    later, since such a pattern represents an unlabeled longer same-marker example.
    """
    i = opener_idx + 1
    while i < len(lines):
        f = _fence_match(lines[i])
        if f:
            c_char, c_len, c_info = f
            if c_info:
                # Info-bearing inner opener: skip over its body to its matching closer.
                inner_closer = _find_first_closer(lines, i + 1, c_char, c_len)
                if inner_closer is None:
                    return None
                i = inner_closer + 1
                continue
            if c_char == outer_char and c_len > outer_len:
                # Unlabeled same-marker fence that's strictly longer than the outer
                # opener — treat as a candidate inner opener if it has a matching
                # closer; otherwise fall through and treat as outer closer.
                inner_closer = _find_first_closer(lines, i + 1, c_char, c_len)
                if inner_closer is not None:
                    i = inner_closer + 1
                    continue
            if c_char == outer_char and c_len >= outer_len:
                return i
        i += 1
    return None


def _has_unclosed_inner_fence(lines, start, end):
    """Return (True, opener_idx) if there is a fence opener in [start, end) with no closer within range."""
    i = start
    while i < end:
        f = _fence_match(lines[i])
        if f:
            i_char, i_len, i_info = f
            if i_info:
                # Look for its closer within [i+1, end)
                closer = _find_first_closer(lines, i + 1, i_char, i_len)
                if closer is None or closer >= end:
                    return True, i
                i = closer + 1
            else:
                i += 1
        else:
            i += 1
    return False, None


def detect_ambiguous_nested_fences(text):
    """
    Scan plan markdown for outer fences whose inner body causes premature termination.

    Returns a list of issue dicts, each with:
      - line: 1-based line number of the premature closer
      - marker: fence marker character ("`" or "~")
      - outer_fence_length: length of the outer opener marker
      - inner_run_length: length of the premature closer's marker run
      - hint: remediation hint string
    """
    if not text:
        return []
    lines = text.splitlines(keepends=True)
    issues = []
    i = 0
    while i < len(lines):
        f = _fence_match(lines[i])
        if not f:
            i += 1
            continue
        outer_char, outer_len, _ = f
        p_idx = _find_first_closer(lines, i + 1, outer_char, outer_len)
        if p_idx is None:
            break  # unclosed, nothing more to parse
        i_idx = _find_intended_outer_closer(lines, i, outer_char, outer_len)
        # Ambiguous when either an info-bearing inner opener has no closer in the
        # premature outer body, OR the intended outer closer (computed by walking
        # past inner blocks, including unlabeled longer same-marker pairs) lands
        # past the apparent premature closer.
        unclosed, _ = _has_unclosed_inner_fence(lines, i + 1, p_idx)
        ambiguous = unclosed or (i_idx is not None and i_idx != p_idx)
        if ambiguous:
            pf = _fence_match(lines[p_idx])
            inner_run_len = pf[1] if pf else outer_len
            hint = (
                f"Switch outer fence to ~~~ or use a longer `{'`' * outer_len}` fence "
                f"(e.g., `{'`' * (outer_len + 1)}`)"
            )
            issues.append({
                "line": p_idx + 1,
                "marker": outer_char,
                "outer_fence_length": outer_len,
                "inner_run_length": inner_run_len,
                "hint": hint,
            })
            # Skip past I (the intended outer closer) so it isn't re-parsed as an opener.
            i = (i_idx + 1) if i_idx is not None else (p_idx + 1)
        else:
            i = p_idx + 1
    return issues


def _max_backtick_run(lines):
    """Return max backtick fence marker length found among the given lines."""
    max_len = 0
    for line in lines:
        f = _fence_match(line)
        if f and f[0] == "`":
            max_len = max(max_len, f[1])
    return max_len


def _max_tilde_run(lines):
    """Return max tilde fence marker length found among the given lines."""
    max_len = 0
    for line in lines:
        f = _fence_match(line)
        if f and f[0] == "~":
            max_len = max(max_len, f[1])
    return max_len


def _choose_replacement(outer_char, outer_len, payload_lines):
    """
    Choose an unambiguous replacement fence marker string for the outer fence.

    Per spec: prefer ~~~ when payload has ``` and ~~~ is NOT already present.
    Otherwise use a fence marker strictly longer than the longest same-marker run
    in the payload.
    """
    has_backtick = _max_backtick_run(payload_lines) >= 3
    has_tilde = _max_tilde_run(payload_lines) >= 3

    if has_backtick and not has_tilde:
        return "~~~"
    # Fall through: use longer same-marker fence
    if outer_char == "`":
        max_run = _max_backtick_run(payload_lines)
    else:
        max_run = _max_tilde_run(payload_lines)
    new_len = max(outer_len, max_run) + 1
    return outer_char * new_len


def _build_replacement_line(original_line, new_marker):
    """Replace the fence marker in original_line with new_marker, preserving leading whitespace."""
    m = FENCE_RE.match(original_line.rstrip("\n"))
    if not m:
        return original_line
    indent = m.group(1)
    ending = "\n" if original_line.endswith("\n") else ""
    return indent + new_marker + ending


def rewrite_ambiguous_nested_fences(text):
    """
    Rewrite ambiguous outer example fences to unambiguous form.

    For each ambiguous outer fence (opener O, premature closer P, intended closer I):
    - Prefer ~~~ when payload has ``` and no ~~~
    - Otherwise use a backtick/tilde fence strictly longer than any same-marker run in payload
    Only lines O and I are modified; inner literal content is preserved verbatim.
    Returns the rewritten text (unchanged if no ambiguities found).
    """
    if not text:
        return text
    lines = text.splitlines(keepends=True)

    # Collect rewrites as (line_index, new_marker) pairs
    rewrites = {}

    i = 0
    while i < len(lines):
        f = _fence_match(lines[i])
        if not f:
            i += 1
            continue
        outer_char, outer_len, _ = f

        # Find premature closer P
        p_idx = _find_first_closer(lines, i + 1, outer_char, outer_len)
        if p_idx is None:
            break

        # Find intended outer closer I by walking past inner fenced blocks from O.
        # The next bare same-marker fence after P may be an inner snippet's closer
        # (when the outer body contains multiple nested snippets, including
        # unlabeled longer same-marker pairs), so we cannot use _find_first_closer
        # here.
        i_idx = _find_intended_outer_closer(lines, i, outer_char, outer_len)

        # Ambiguous when either an info-bearing inner opener has no closer in the
        # premature outer body, OR the intended outer closer differs from the
        # apparent premature closer.
        unclosed, _ = _has_unclosed_inner_fence(lines, i + 1, p_idx)
        if not unclosed and (i_idx is None or i_idx == p_idx):
            i = p_idx + 1
            continue
        if i_idx is None:
            # Can't determine intended structure; skip
            i = p_idx + 1
            continue

        # Payload: everything between O and I (exclusive), includes P
        payload_lines = lines[i + 1 : i_idx]
        new_marker = _choose_replacement(outer_char, outer_len, payload_lines)

        rewrites[i] = new_marker
        rewrites[i_idx] = new_marker

        # Continue scanning after I
        i = i_idx + 1

    if not rewrites:
        return text

    result = []
    for idx, line in enumerate(lines):
        if idx in rewrites:
            result.append(_build_replacement_line(line, rewrites[idx]))
        else:
            result.append(line)
    return "".join(result)


def main():
    parser = argparse.ArgumentParser(
        description="Detect and rewrite ambiguous nested fences in plan markdown."
    )
    parser.add_argument("--plan", required=True, help="Path to the plan markdown file")
    parser.add_argument(
        "--rewrite-in-place",
        action="store_true",
        help="Rewrite ambiguous fences in the file in place",
    )
    args = parser.parse_args()

    try:
        with open(args.plan, "r") as f:
            content = f.read()
    except OSError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)

    if args.rewrite_in_place:
        rewritten = rewrite_ambiguous_nested_fences(content)
        if rewritten != content:
            with open(args.plan, "w") as f:
                f.write(rewritten)
    else:
        issues = detect_ambiguous_nested_fences(content)
        for issue in issues:
            print(
                f"line {issue['line']}: ambiguous {issue['marker'] * issue['outer_fence_length']} "
                f"outer fence (inner run length {issue['inner_run_length']}): {issue['hint']}"
            )
        if issues:
            sys.exit(1)


if __name__ == "__main__":
    main()
