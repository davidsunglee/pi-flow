#!/usr/bin/env python3
"""extract-plan-tasks.py — Parse a plan markdown file and emit a JSON task manifest.

Output shape (stdout, exit 0):
  {
    "goal": "<first paragraph of ## Goal section>",
    "test_command": "<contents of the first fenced block under ## Test Command, regardless of info string>",
    "tasks": [
      {
        "number": 1,                # int for plain IDs, string (e.g. "2a") for suffixed IDs
        "title": "<heading text after '### Task N:'>",
        "task_spec": "<raw markdown block for this task>",
        "files": {
          "create": ["path/..."],
          "modify": ["path/..."],
          "test": ["path/..."]
        },
        "steps": ["Step 1 text", ...],
        "criteria": [
          {"text": "criterion text", "verify": "verify instruction"}
        ],
        "model_recommendation": "cheap|standard|capable",
        "dependencies": [1, 2, ...]  # ints and/or suffixed strings
      }
    ],
    "waves": [
      {"wave": 1, "subwave": 1, "tasks": [1, 2]},
      {"wave": 2, "subwave": 1, "tasks": [3]}
    ]
  }

  Task IDs accept an optional single-lowercase-letter suffix to support intentionally
  inserted tasks (e.g. "### Task 15a — CLI entry"). Suffixed IDs are preserved as
  strings in JSON output; plain numeric IDs remain integers for backwards compatibility.

Protocol-error kinds (stderr JSON, exit non-zero):
  ambiguous_nested_fence    — an outer fence contains an inner fenced block whose closer
                              prematurely terminates the outer fence; fields: line, marker,
                              outer_fence_length, inner_fence_length, hint
  missing_required_section  — a required top-level section is absent or has empty body;
                              section names: goal, architecture_summary, tech_stack,
                              file_structure, numbered_tasks, dependencies, risk_assessment
  dependency_unknown_target — a dependency references a task number not in the plan
  dependency_cycle          — dependency graph contains a cycle; cycle lists participating
                              task numbers in discovery order
  missing_verify_recipe     — a criterion bullet has no trailing Verify: line
  duplicate_task_number     — two ### Task N: headings share the same N
  missing_files_block       — a task has no **Files:** block before **Steps:**/**Acceptance criteria:**
  missing_model_recommendation — **Model recommendation:** is absent or its value is not cheap|standard|capable
  out_of_order_task_number  — base task numbers are not strictly ascending from 1 with no gaps,
                              or a suffixed task ID was declared without its base integer task
  malformed_task_heading    — a "### Task N" heading does not use one of the accepted separators (:, —, –, -);
                              fields: kind, line (1-based), observed (full heading text)

Options:
  --plan                    Path to the plan markdown file
  --task-number             If given, return only this task (single-element tasks array)
  --max-parallel-hard-cap   Maximum tasks per subwave (default: 8); matches MAX_PARALLEL_HARD_CAP
                            constant used by pi-interactive-subagent
"""

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared", "scripts"))
from fence_aware import compute_in_fence_lines, FENCE_RE  # noqa: E402
from plan_fence_hardening import detect_ambiguous_nested_fences  # noqa: E402


VALID_MODELS = {"cheap", "standard", "capable"}

TASK_ID_PATTERN = r"\d+[a-z]?"
TASK_ID_FULL_RE = re.compile(rf"^({TASK_ID_PATTERN})$")
TASK_HEADING_RE = re.compile(rf"^### Task ({TASK_ID_PATTERN})\s*[:—–-]\s*(.*)$")
MALFORMED_TASK_HEADING_RE = re.compile(r"^### Task \d")
SECTION_HEADING_RE = re.compile(r"^## ")
DEP_LINE_RE = re.compile(rf"^-\s+Task\s+({TASK_ID_PATTERN})\s+depends\s+on:\s*(.+)")
DEP_INNER_RE = re.compile(rf"Task\s+({TASK_ID_PATTERN})")


def normalize_task_id(raw):
    """Return int when raw has no suffix, otherwise the raw string. None if invalid."""
    m = TASK_ID_FULL_RE.match(raw)
    if not m:
        return None
    text = m.group(1)
    if text[-1].isalpha():
        return text
    return int(text)


def task_id_parts(task_id):
    """Return (base_int, suffix_str) for an int or suffixed-string task id."""
    if isinstance(task_id, int):
        return task_id, ""
    text = str(task_id)
    if text and text[-1].isalpha():
        return int(text[:-1]), text[-1]
    return int(text), ""


def task_id_sort_key(task_id):
    return task_id_parts(task_id)

MAX_PARALLEL_HARD_CAP = 8

SECTION_RULES = [
    {"key": "goal", "patterns": [r"^## Goal\s*$", r"^\*\*Goal\*\*:", r"^\*\*Goal:\*\*"], "requires_body": True},
    {"key": "architecture_summary", "patterns": [r"^## Architecture summary\s*$", r"^\*\*Architecture summary\*\*:", r"^\*\*Architecture summary:\*\*"], "requires_body": True},
    {"key": "tech_stack", "patterns": [r"^## Tech stack\s*$", r"^\*\*Tech stack\*\*:", r"^\*\*Tech stack:\*\*"], "requires_body": True},
    {"key": "file_structure", "patterns": [r"^## File Structure"], "requires_body": False},
    {"key": "numbered_tasks", "patterns": [rf"^### Task {TASK_ID_PATTERN}\s*[:—–-]"], "requires_body": False},
    {"key": "dependencies", "patterns": [r"^## Dependencies\s*$"], "requires_body": False},
    {"key": "risk_assessment", "patterns": [r"^## Risk [Aa]ssessment\s*$"], "requires_body": False},
]

IGNORECASE_SECTIONS = {"architecture_summary", "tech_stack", "risk_assessment"}


def validate_required_sections(text):
    """Return list of missing_required_section errors for absent/empty sections."""
    lines = text.splitlines()
    errors = []

    in_fence = compute_in_fence_lines(lines)

    all_section_patterns = []
    for rule in SECTION_RULES:
        flags = re.IGNORECASE if rule["key"] in IGNORECASE_SECTIONS else 0
        for p in rule["patterns"]:
            all_section_patterns.append(re.compile(p, flags))

    def is_boundary_line(idx):
        if idx in in_fence:
            return False
        raw = lines[idx]
        if re.match(r"^#{1,3}\s", raw):
            return True
        stripped = raw.strip()
        for pat in all_section_patterns:
            if pat.match(stripped):
                return True
        return False

    def check_section_compiled(compiled, requires_body):
        matches = []
        for idx, raw_line in enumerate(lines):
            if idx in in_fence:
                continue
            stripped = raw_line.strip()
            for pat in compiled:
                m = pat.match(stripped)
                if m:
                    matches.append((idx, m, stripped))
                    break
        if not matches:
            return False
        if not requires_body:
            return True
        for idx, m, stripped in matches:
            inline = stripped[m.end():].strip()
            if inline:
                return True
            j = idx + 1
            while j < len(lines):
                if j in in_fence:
                    j += 1
                    continue
                if is_boundary_line(j):
                    break
                if lines[j].strip():
                    return True
                j += 1
        return False

    for rule in SECTION_RULES:
        name = rule["key"]
        flags = re.IGNORECASE if name in IGNORECASE_SECTIONS else 0
        compiled_patterns = [re.compile(p, flags) for p in rule["patterns"]]
        if not check_section_compiled(compiled_patterns, rule["requires_body"]):
            errors.append({"kind": "missing_required_section", "section": name})

    return errors


def validate_dependency_targets(tasks, dep_raw):
    """Return errors for dep references to unknown task numbers."""
    errors = []
    known = {t["number"] for t in tasks}
    for task_num, dep_nums in dep_raw.items():
        for dep in dep_nums:
            if dep not in known:
                errors.append({
                    "kind": "dependency_unknown_target",
                    "task_number": task_num,
                    "unknown_dep": dep,
                })
    return errors


def detect_dependency_cycle(dep_raw):
    """Detect a cycle in the dependency graph via DFS. Returns at most one error."""
    all_nodes = set(dep_raw.keys())
    for deps in dep_raw.values():
        all_nodes.update(deps)

    visited = set()
    rec_stack = []
    rec_set = set()

    def dfs(node):
        visited.add(node)
        rec_stack.append(node)
        rec_set.add(node)
        for neighbor in dep_raw.get(node, []):
            if neighbor not in visited:
                result = dfs(neighbor)
                if result is not None:
                    return result
            elif neighbor in rec_set:
                cycle_start = rec_stack.index(neighbor)
                return list(rec_stack[cycle_start:])
        rec_stack.pop()
        rec_set.remove(node)
        return None

    for node in sorted(all_nodes, key=task_id_sort_key):
        if node not in visited:
            cycle = dfs(node)
            if cycle is not None:
                return [{"kind": "dependency_cycle", "cycle": cycle}]

    return []


def compute_waves(tasks, dep_raw, max_parallel_hard_cap):
    """Assign tasks to waves based on dependencies; split oversized waves into subwaves."""
    task_numbers = [t["number"] for t in tasks]
    wave_assignment = {}
    remaining = set(task_numbers)
    current_wave = 1

    while remaining:
        wave_tasks = [
            t for t in sorted(remaining, key=task_id_sort_key)
            if all(d in wave_assignment for d in dep_raw.get(t, []))
        ]
        if not wave_tasks:
            break
        for t in wave_tasks:
            wave_assignment[t] = current_wave
            remaining.remove(t)
        current_wave += 1

    waves_dict = {}
    for t, w in wave_assignment.items():
        waves_dict.setdefault(w, []).append(t)
    for w in waves_dict:
        waves_dict[w].sort(key=task_id_sort_key)

    result = []
    for w in sorted(waves_dict.keys()):
        wave_tasks = waves_dict[w]
        subwave = 1
        for i in range(0, len(wave_tasks), max_parallel_hard_cap):
            chunk = wave_tasks[i:i + max_parallel_hard_cap]
            result.append({"wave": w, "subwave": subwave, "tasks": chunk})
            subwave += 1

    return result


def parse_plan(text, max_parallel_hard_cap=MAX_PARALLEL_HARD_CAP):
    lines = text.splitlines(keepends=True)
    errors = []

    # Ambiguous-fence check first: premature fence termination is the root cause,
    # not the downstream missing-section symptom it produces.
    fence_issues = detect_ambiguous_nested_fences(text)
    if fence_issues:
        fence_errors = [
            {
                "kind": "ambiguous_nested_fence",
                "line": issue["line"],
                "marker": issue["marker"],
                "outer_fence_length": issue["outer_fence_length"],
                "inner_fence_length": issue["inner_run_length"],
                "hint": issue["hint"],
            }
            for issue in fence_issues
        ]
        return {"goal": None, "test_command": None, "tasks": []}, fence_errors

    # Section validation; skip task parsing if any section is missing
    section_errors = validate_required_sections(text)
    if section_errors:
        # Still scan for malformed task headings so callers get targeted errors alongside
        # missing-section errors when every task heading is malformed.
        early_in_fence = compute_in_fence_lines(lines)
        early_mh_errors = []
        for ei, raw in enumerate(lines):
            stripped_raw = raw.rstrip("\n")
            if ei not in early_in_fence and not TASK_HEADING_RE.match(stripped_raw) and MALFORMED_TASK_HEADING_RE.match(stripped_raw):
                early_mh_errors.append({"kind": "malformed_task_heading", "line": ei + 1, "observed": stripped_raw})
        return {"goal": None, "test_command": None, "tasks": []}, section_errors + early_mh_errors

    goal = None
    test_command = None
    dep_raw = {}  # task_number -> list of dep numbers
    section = None

    in_fence = compute_in_fence_lines(lines)

    # First pass: identify task boundaries and sections
    i = 0
    n = len(lines)
    task_starts = []  # (line_index, number, title)

    while i < n:
        line = lines[i].rstrip("\n")

        if i not in in_fence:
            m = TASK_HEADING_RE.match(line)
            if m:
                task_starts.append((i, normalize_task_id(m.group(1)), m.group(2).strip()))
                i += 1
                continue

            if MALFORMED_TASK_HEADING_RE.match(line):
                errors.append({"kind": "malformed_task_heading", "line": i + 1, "observed": line})
                i += 1
                continue

            if SECTION_HEADING_RE.match(line):
                section = line.strip()

        i += 1

    # Compute task raw blocks
    section_starts = []
    for idx, line_str in enumerate(lines):
        if idx not in in_fence:
            s = line_str.rstrip("\n")
            if SECTION_HEADING_RE.match(s):
                section_starts.append(idx)

    def find_block_end(start_idx):
        for j in range(start_idx + 1, n):
            if j not in in_fence:
                s = lines[j].rstrip("\n")
                if TASK_HEADING_RE.match(s) or SECTION_HEADING_RE.match(s):
                    return j
        return n

    task_blocks = []
    for ts_idx, (line_idx, num, title) in enumerate(task_starts):
        end_idx = find_block_end(line_idx)
        raw_block = "".join(lines[line_idx:end_idx]).rstrip("\n")
        task_blocks.append({
            "number": num,
            "title": title,
            "task_spec": raw_block,
            "line_idx": line_idx,
        })

    # Duplicate detection
    seen_numbers = {}
    for tb in task_blocks:
        num = tb["number"]
        if num in seen_numbers:
            errors.append({
                "kind": "duplicate_task_number",
                "task_number": num,
                "detail": f"Task {num} appears more than once",
            })
        else:
            seen_numbers[num] = True

    # Out-of-order detection: declaration order must match the canonical sort key
    # (numeric base ascending, then suffix). Base tasks must be contiguous 1..N;
    # suffixed tasks (e.g., 2a) must follow their base integer task immediately
    # (modulo other suffixes on the same base).
    unique_task_numbers = list(dict.fromkeys(tb["number"] for tb in task_blocks))
    declared_bases = {
        task_id_parts(tid)[0] for tid in unique_task_numbers if task_id_parts(tid)[1] == ""
    }
    expected_sorted = sorted(unique_task_numbers, key=task_id_sort_key)
    expected_base = 1
    for idx, tid in enumerate(unique_task_numbers):
        base, suffix = task_id_parts(tid)
        if suffix == "":
            if base != expected_base:
                errors.append({
                    "kind": "out_of_order_task_number",
                    "task_number": tid,
                    "detail": f"Expected Task {expected_base} but found Task {tid}",
                })
                break
            expected_base += 1
        else:
            if base not in declared_bases:
                errors.append({
                    "kind": "out_of_order_task_number",
                    "task_number": tid,
                    "detail": f"Suffixed Task {tid} has no base Task {base}",
                })
                break
        if tid != expected_sorted[idx]:
            errors.append({
                "kind": "out_of_order_task_number",
                "task_number": tid,
                "detail": f"Task {tid} is out of order; expected Task {expected_sorted[idx]} at this position",
            })
            break

    # Parse goal: first paragraph of ## Goal or inline **Goal**:
    i = 0
    while i < n:
        if i in in_fence:
            i += 1
            continue
        stripped = lines[i].rstrip("\n").strip()
        if stripped == "## Goal":
            i += 1
            while i < n and lines[i].strip() == "":
                i += 1
            goal_lines = []
            while i < n and lines[i].strip() != "" and not SECTION_HEADING_RE.match(lines[i]) and not TASK_HEADING_RE.match(lines[i]) and i not in in_fence:
                goal_lines.append(lines[i].rstrip("\n"))
                i += 1
            goal = " ".join(goal_lines).strip()
            break
        inline_goal = re.match(r"^\*\*Goal(?:\*\*:|:\*\*)\s*(.*)$", stripped)
        if inline_goal:
            inline_text = inline_goal.group(1).strip()
            if inline_text:
                goal = inline_text
            else:
                i += 1
                goal_lines = []
                while i < n and lines[i].strip() != "" and not SECTION_HEADING_RE.match(lines[i]) and not TASK_HEADING_RE.match(lines[i].rstrip("\n")) and i not in in_fence:
                    goal_lines.append(lines[i].rstrip("\n"))
                    i += 1
                goal = " ".join(goal_lines).strip()
            break
        i += 1

    # Parse test_command: ## Test Command -> next fenced block (any info string)
    i = 0
    while i < n:
        if i not in in_fence and lines[i].rstrip("\n") == "## Test Command":
            i += 1
            while i < n:
                if i in in_fence:
                    i += 1
                    continue
                line_no_nl = lines[i].rstrip("\n")
                m = FENCE_RE.match(line_no_nl)
                if m:
                    marker_char = m.group(2)[0]
                    opener_len = len(m.group(2))
                    i += 1
                    cmd_lines = []
                    found_closer = False
                    while i < n:
                        close_line = lines[i].rstrip("\n")
                        cm = FENCE_RE.match(close_line)
                        if cm:
                            c_char = cm.group(2)[0]
                            c_len = len(cm.group(2))
                            c_after = cm.group(3)
                            if c_char == marker_char and c_len >= opener_len and not c_after.strip():
                                found_closer = True
                                i += 1
                                break
                        cmd_lines.append(lines[i].rstrip("\n"))
                        i += 1
                    test_command = "\n".join(cmd_lines).strip()
                    break
                if SECTION_HEADING_RE.match(lines[i]) or TASK_HEADING_RE.match(lines[i].rstrip("\n")):
                    break
                i += 1
            break
        i += 1

    # Parse dependencies: ## Dependencies section
    i = 0
    while i < n:
        if i not in in_fence and lines[i].rstrip("\n") == "## Dependencies":
            i += 1
            while i < n:
                if i in in_fence:
                    i += 1
                    continue
                line = lines[i].rstrip("\n")
                if SECTION_HEADING_RE.match(line) or TASK_HEADING_RE.match(line):
                    break
                m = DEP_LINE_RE.match(line.strip())
                if m:
                    task_num = normalize_task_id(m.group(1))
                    deps_str = m.group(2)
                    dep_nums = []
                    for part in deps_str.split(","):
                        part = part.strip()
                        dm = DEP_INNER_RE.match(part)
                        if dm:
                            dep_nums.append(normalize_task_id(dm.group(1)))
                    dep_raw[task_num] = dep_nums
                i += 1
            break
        i += 1

    # Parse each task block in detail
    def parse_task_block(tb):
        block_text = tb["task_spec"]
        block_lines = block_text.splitlines(keepends=True)
        task_errors = []

        files = {"create": [], "modify": [], "test": []}
        steps = []
        criteria = []
        model_recommendation = None

        # Get fence awareness for this task block
        block_in_fence = compute_in_fence_lines(block_lines)

        state = "header"
        j = 0
        nb = len(block_lines)
        has_files_block = False

        while j < nb:
            if j in block_in_fence:
                j += 1
                continue
            line = block_lines[j].rstrip("\n")
            stripped = line.strip()

            if stripped.lower() == "**files:**":
                has_files_block = True
                state = "files"
                j += 1
                continue

            if stripped.lower() == "**steps:**":
                state = "steps"
                j += 1
                continue

            if stripped.lower() == "**acceptance criteria:**":
                state = "criteria"
                j += 1
                continue

            if stripped.lower().startswith("**model recommendation:**"):
                val = stripped[len("**model recommendation:**"):].strip()
                model_recommendation = val
                state = "header"
                j += 1
                continue

            if state == "files" and stripped.startswith("- "):
                item = stripped[2:].strip()
                if item.lower().startswith("create:"):
                    path = item[len("create:"):].strip()
                    files["create"].append(path)
                elif item.lower().startswith("modify:"):
                    path = item[len("modify:"):].strip()
                    files["modify"].append(path)
                elif item.lower().startswith("test:"):
                    path = item[len("test:"):].strip()
                    files["test"].append(path)
                j += 1
                continue

            if state == "steps" and stripped.startswith("- [ ]"):
                step_text = stripped[5:].strip()
                steps.append(step_text)
                j += 1
                continue

            if state == "criteria" and stripped.startswith("- "):
                criterion_text = stripped[2:].strip()
                verify_text = None
                if j + 1 < nb:
                    next_j = j + 1
                    while next_j < nb and next_j in block_in_fence:
                        next_j += 1
                    if next_j < nb:
                        next_line = block_lines[next_j].rstrip("\n")
                        next_stripped = next_line.strip()
                        if next_stripped.lower().startswith("verify:"):
                            verify_text = next_stripped[len("Verify:"):].strip()
                            j = next_j

                criteria.append({"text": criterion_text, "verify": verify_text or ""})
                if verify_text is None:
                    task_errors.append({
                        "kind": "missing_verify_recipe",
                        "task_number": tb["number"],
                        "criterion": criterion_text,
                        "detail": f"Task {tb['number']}: criterion '{criterion_text}' has no Verify: line",
                    })
                j += 1
                continue

            j += 1

        if not has_files_block:
            task_errors.append({
                "kind": "missing_files_block",
                "task_number": tb["number"],
                "detail": f"Task {tb['number']} has no **Files:** block",
            })

        if model_recommendation is None:
            task_errors.append({
                "kind": "missing_model_recommendation",
                "task_number": tb["number"],
                "detail": "line absent",
            })
        elif model_recommendation not in VALID_MODELS:
            task_errors.append({
                "kind": "missing_model_recommendation",
                "task_number": tb["number"],
                "detail": f"invalid value: {model_recommendation!r}",
            })

        return files, steps, criteria, model_recommendation, task_errors

    # Build final task list (skip duplicates beyond first occurrence)
    final_tasks = []
    seen_for_output = set()
    all_task_errors = []

    for tb in task_blocks:
        num = tb["number"]
        files, steps, criteria, model_rec, task_errs = parse_task_block(tb)
        all_task_errors.extend(task_errs)

        if num not in seen_for_output:
            seen_for_output.add(num)
            final_tasks.append({
                "number": num,
                "title": tb["title"],
                "task_spec": tb["task_spec"],
                "files": files,
                "steps": steps,
                "criteria": criteria,
                "model_recommendation": model_rec,
                "dependencies": dep_raw.get(num, []),
            })

    errors.extend(all_task_errors)

    if errors:
        return {
            "goal": goal,
            "test_command": test_command,
            "tasks": final_tasks,
        }, errors

    # Dependency reference + cycle validation
    dep_errors = validate_dependency_targets(final_tasks, dep_raw)
    dep_errors.extend(detect_dependency_cycle(dep_raw))

    if dep_errors:
        return {
            "goal": goal,
            "test_command": test_command,
            "tasks": final_tasks,
        }, dep_errors

    # All clean: compute waves
    waves = compute_waves(final_tasks, dep_raw, max_parallel_hard_cap)

    return {
        "goal": goal,
        "test_command": test_command,
        "tasks": final_tasks,
        "waves": waves,
    }, []


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--plan", required=True, help="Path to the plan markdown file")
    parser.add_argument(
        "--task-number",
        type=str,
        default=None,
        help="If given, return only this task (still as a single-element tasks array). "
             "Accepts integer IDs (e.g. '1') or suffixed IDs (e.g. '2a').",
    )
    parser.add_argument(
        "--max-parallel-hard-cap",
        type=int,
        default=MAX_PARALLEL_HARD_CAP,
        help=f"Maximum tasks per subwave when splitting oversized waves (default: {MAX_PARALLEL_HARD_CAP})",
    )
    args = parser.parse_args()

    with open(args.plan, "r", encoding="utf-8") as f:
        text = f.read()

    result, errors = parse_plan(text, args.max_parallel_hard_cap)

    if errors:
        print(json.dumps({"errors": errors}, indent=2), file=sys.stderr)
        sys.exit(1)

    if args.task_number is not None:
        wanted = normalize_task_id(args.task_number)
        matching = [t for t in result["tasks"] if t["number"] == wanted]
        result["tasks"] = matching

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
