"""
fence_aware — utilities for fence-aware parsing of markdown-like text.

Fence contract:
  - Openers and closers use backticks (`) or tildes (~), minimum length 3.
  - Leading indentation (whitespace) is allowed before the marker characters.
  - A closer must use the same marker character as its opener.
  - A closer must have a marker length >= the opener's marker length.
  - A closer must have only whitespace (or nothing) after the marker characters.
  - An info string (any non-whitespace after the markers) disqualifies a closer.
  - An opener with no matching closer before EOF is considered unclosed; all
    lines strictly after the opener through the last line index are fenced.
  - Opener and closer lines themselves are NOT considered fenced.
"""

import re

FENCE_RE = re.compile(r"^(\s*)(`{3,}|~{3,})(.*?)$")


def compute_in_fence_lines(lines):
    """
    Return the set of line indices (0-based) that are inside a fenced block.

    Input:  lines — a sequence of strings, each with or without a trailing newline.
    Output: set[int] of indices strictly between opener and closer lines.

    Fence contract (see module docstring for full details):
      - Same marker character, closer length >= opener length, no info string on closer.
      - Opener and closer lines themselves are NOT marked fenced.
      - An unclosed opener fences all lines strictly after it through the last index.
    """
    fenced = set()
    i = 0
    n = len(lines)
    while i < n:
        m = FENCE_RE.match(lines[i].rstrip("\n"))
        if m:
            marker_str = m.group(2)
            marker_char = marker_str[0]
            opener_len = len(marker_str)
            # Scan forward for a matching closer
            j = i + 1
            found_closer = False
            while j < n:
                cm = FENCE_RE.match(lines[j].rstrip("\n"))
                if cm:
                    c_marker_str = cm.group(2)
                    c_char = c_marker_str[0]
                    c_len = len(c_marker_str)
                    c_after = cm.group(3)
                    # Valid closer: same char, length >= opener, only whitespace after
                    if c_char == marker_char and c_len >= opener_len and not c_after.strip():
                        for k in range(i + 1, j):
                            fenced.add(k)
                        found_closer = True
                        i = j + 1
                        break
                j += 1
            if not found_closer:
                # Unclosed: fence everything strictly after opener through EOF
                for k in range(i + 1, n):
                    fenced.add(k)
                break
        else:
            i += 1
    return fenced


def split_h2_sections(text):
    """
    Split text into named sections delimited by level-2 markdown headings (## ...).

    Input:  text — a single string, possibly multi-line.
    Output: dict[str, str] mapping trimmed section name to verbatim body lines
            (preserving original line endings). Lines before the first H2 are
            discarded. Duplicate section names → last value wins.

    Fence contract (same as compute_in_fence_lines): ## lines inside a fenced block
    are NOT treated as section delimiters — they are included verbatim in the body.
    Opener and closer lines themselves are NOT considered fenced.
    """
    lines = text.splitlines(keepends=True)
    in_fence = compute_in_fence_lines(lines)

    h2_re = re.compile(r"^## (.+)$")

    sections = {}
    current_key = None
    current_body = []

    for idx, line in enumerate(lines):
        stripped = line.rstrip("\n").rstrip("\r")
        m = h2_re.match(stripped)
        if m and idx not in in_fence:
            if current_key is not None:
                sections[current_key] = "".join(current_body)
            current_key = m.group(1).rstrip()
            current_body = []
        elif current_key is not None:
            current_body.append(line)

    if current_key is not None:
        sections[current_key] = "".join(current_body)

    return sections
