#!/usr/bin/env python3
"""compute-verifier-file-set.py — Compute the set of files visible to the verifier.

Supports two wave shapes:
  single-task         — union of task_files, worker_files, and observed_paths
  parallel-multi-task — task_files and worker_files, plus observed_paths that are descendants
                        of any task-files directory or are in worker_files

Output shape (stdout, exit 0):
  {
    "verifier_visible_files": [...],
    "task_files_resolved": [...],
    "worker_files_resolved": [...],
    "observed_paths": [...],
    "scoping_rule": "<wave_shape>"
  }

Protocol-error kinds (stderr JSON, exit non-zero):
  input_json_invalid        — a JSON input is not a valid JSON array of strings
  observed_status_unreadable — the --observed-status file could not be read
  wave_shape_invalid        — the --wave-shape value is not recognized
"""

import argparse
import json
import os
import sys


VALID_WAVE_SHAPES = {"single-task", "parallel-multi-task"}


def _load_json_array(path, field_name):
    """Load a JSON array of strings from a file.

    On failure, emit JSON error to stderr and exit 1.
    Returns the list if successful.
    """
    try:
        if path == '-':
            text = sys.stdin.read()
        else:
            with open(path, 'r') as f:
                text = f.read()

        value = json.loads(text)

        if not isinstance(value, list):
            raise ValueError("not a list")

        if not all(isinstance(item, str) for item in value):
            raise ValueError("contains non-string items")

        return value
    except Exception:
        error = {"failure": "input_json_invalid", "field": field_name}
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)


def _parse_porcelain(text):
    """Parse git porcelain status output into list of paths.

    Each line has format: "XY path" where XY is 2-character status code.
    Returns list of paths with first-occurrence dedup, preserving order.
    """
    paths = []
    seen = set()

    for line in text.splitlines():
        if not line:
            continue
        # Strip leading 2-character status code and space
        path = line[3:] if len(line) > 2 else line
        if path and path not in seen:
            paths.append(path)
            seen.add(path)

    return paths


def _first_occurrence_dedup(items):
    """Deduplicate a list preserving first occurrence order."""
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            result.append(item)
            seen.add(item)
    return result


def _is_descendant(path, directory):
    """Check if path is a descendant of directory using normpath-based prefix matching."""
    norm_path = os.path.normpath(path)
    norm_dir = os.path.normpath(directory)

    # Ensure directory ends with / for proper prefix matching
    if not norm_dir.endswith('/'):
        norm_dir = norm_dir + '/'

    # path must start with directory/ OR be exactly equal to the directory
    return norm_path.startswith(norm_dir) or norm_path == norm_dir.rstrip('/')


def _compute_verifier_files_single_task(task_files, worker_files, observed_paths):
    """Compute union for single-task wave shape."""
    combined = task_files + worker_files + observed_paths
    return _first_occurrence_dedup(combined)


def _compute_verifier_files_parallel_multi_task(task_files, worker_files, observed_paths):
    """Compute files for parallel-multi-task wave shape.

    Includes:
    - Every path in task_files
    - Every path in worker_files
    - Every observed path that is also in task_files or worker_files, OR is a descendant
      of any directory in task_files
    """
    task_set = set(task_files)
    worker_set = set(worker_files)
    result = []
    seen = set()

    # Add all task_files and worker_files first
    for path in task_files:
        if path not in seen:
            result.append(path)
            seen.add(path)

    for path in worker_files:
        if path not in seen:
            result.append(path)
            seen.add(path)

    # Add observed paths that match criteria
    for obs_path in observed_paths:
        if obs_path in seen:
            continue

        # Include if in task_files or worker_files
        if obs_path in task_set or obs_path in worker_set:
            result.append(obs_path)
            seen.add(obs_path)
            continue

        # Include if descendant of any task_files directory
        is_descendant_of_task = any(_is_descendant(obs_path, task_dir) for task_dir in task_files)
        if is_descendant_of_task:
            result.append(obs_path)
            seen.add(obs_path)

    return result


def main():
    parser = argparse.ArgumentParser(
        prog="compute-verifier-file-set.py",
        description="Compute the set of files visible to the verifier.",
        epilog=(
            "Protocol-error labels: input_json_invalid, observed_status_unreadable, wave_shape_invalid"
        ),
    )

    parser.add_argument(
        "--task-files",
        required=True,
        help="Path to JSON file containing array of task file paths",
    )
    parser.add_argument(
        "--worker-files",
        required=True,
        help="Path to JSON file containing array of worker file paths",
    )
    parser.add_argument(
        "--observed-status",
        required=True,
        help="Path to git porcelain status file, or - for stdin",
    )
    parser.add_argument(
        "--observed-diff-paths",
        required=True,
        help="Path to JSON file containing array of observed diff paths",
    )
    parser.add_argument(
        "--wave-shape",
        required=True,
        help="Wave shape: single-task or parallel-multi-task",
    )

    args = parser.parse_args()

    # Load JSON arrays
    task_files = _load_json_array(args.task_files, "task_files")
    worker_files = _load_json_array(args.worker_files, "worker_files")
    observed_diff_paths = _load_json_array(args.observed_diff_paths, "observed_diff_paths")

    # Parse observed-status
    if args.observed_status == '-':
        porcelain_text = sys.stdin.read()
    else:
        try:
            with open(args.observed_status, 'r') as f:
                porcelain_text = f.read()
        except OSError:
            error = {"failure": "observed_status_unreadable", "field": "observed_status"}
            print(json.dumps(error), file=sys.stderr)
            sys.exit(1)

    porcelain_paths = _parse_porcelain(porcelain_text)

    # Validate wave-shape
    if args.wave_shape not in VALID_WAVE_SHAPES:
        error = {"failure": "wave_shape_invalid", "value": args.wave_shape}
        print(json.dumps(error), file=sys.stderr)
        sys.exit(1)

    # Compute observed_paths: porcelain paths + diff paths, deduplicated
    observed_paths = _first_occurrence_dedup(porcelain_paths + observed_diff_paths)

    # Compute verifier_visible_files based on wave shape
    if args.wave_shape == "single-task":
        verifier_visible_files = _compute_verifier_files_single_task(
            task_files, worker_files, observed_paths
        )
    else:  # parallel-multi-task
        verifier_visible_files = _compute_verifier_files_parallel_multi_task(
            task_files, worker_files, observed_paths
        )

    # Emit JSON to stdout
    output = {
        "verifier_visible_files": verifier_visible_files,
        "task_files_resolved": task_files,
        "worker_files_resolved": worker_files,
        "observed_paths": observed_paths,
        "scoping_rule": args.wave_shape,
    }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
