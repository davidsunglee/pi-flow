#!/usr/bin/env python3
"""Classify scout-brief / HEAD workflow drift.

Reads the scout brief preamble, compares its recorded Git SHA against the
current repo HEAD, and classifies the result into one of six outcome tags.

Outcomes:
  silent_continue   — brief SHA equals HEAD; no drift, no action needed.
  workflow_only     — all changed paths are under the workflow-artifact allowlist.
  mixed_changes     — at least one changed path is outside the allowlist.
  uninspectable_a   — brief has no readable Git SHA: line or it is malformed.
  uninspectable_b   — brief SHA is not reachable from HEAD.
  uninspectable_c   — git command failure prevented classification.

Always emits a JSON object to stdout and exits 0 (exits 2 on argument errors).
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


_ALLOWLIST_RE = re.compile(r"^- `(docs/[a-z-]+/)`$")

_MENU_SUFFIX = (
    "\n\n**(c) Continue with plan generation** — proceed despite the scout brief / HEAD difference.\n"
    "**(x) Stop plan generation** — resolve manually before planning."
)


def _workflow_only_body(brief_path, brief_sha, head_sha):
    return (
        f"Scout brief at `{brief_path}` was generated at SHA `{brief_sha}`; HEAD is now `{head_sha}`. "
        "Intervening commits modified only workflow artifacts (`docs/briefs/`, `docs/specs/`, "
        "`docs/todos/`, `docs/plans/`). Treating as expected workflow drift and continuing."
    )


def _mixed_changes_body(brief_path, brief_sha, head_sha, non_workflow_paths):
    path_lines = "\n".join(f"  - `{p}`" for p in non_workflow_paths)
    return (
        f"Scout brief at `{brief_path}` was generated at SHA `{brief_sha}`; HEAD is now `{head_sha}`. "
        f"Non-workflow files changed since the brief SHA:\n\n{path_lines}\n\n"
        "The brief may be stale relative to source/config/agent changes."
        + _MENU_SUFFIX
    )


def _uninspectable_a_body(brief_path, head_sha):
    return (
        f"Scout brief at `{brief_path}` has no readable `Git SHA:` preamble line; "
        f"cannot classify intervening changes against current HEAD `{head_sha}`. The brief may be stale."
        + _MENU_SUFFIX
    )


def _uninspectable_b_body(brief_path, brief_sha, head_sha):
    return (
        f"Scout brief at `{brief_path}` was generated at SHA `{brief_sha}`; HEAD is now `{head_sha}`. "
        "Brief SHA is not reachable from HEAD; cannot classify intervening changes. The brief may be stale."
        + _MENU_SUFFIX
    )


def _uninspectable_c_body(brief_path, brief_sha, head_sha, error):
    return (
        f"Scout brief at `{brief_path}` was generated at SHA `{brief_sha}`; HEAD is now `{head_sha}`. "
        f"Could not enumerate intervening changes: `{error}`. The brief may be stale."
        + _MENU_SUFFIX
    )


def _emit(outcome, brief_path, brief_sha, head_sha, non_workflow_paths, error, message_body):
    print(json.dumps({
        "outcome": outcome,
        "brief_path": brief_path,
        "brief_sha": brief_sha,
        "head_sha": head_sha,
        "non_workflow_paths": non_workflow_paths,
        "error": error,
        "message_body": message_body,
    }))


def _load_allowlist():
    allowlist_path = Path(__file__).resolve().parent.parent / "workflow-artifact-paths.md"
    prefixes = []
    in_allowlist = False
    with open(allowlist_path) as fh:
        for line in fh:
            stripped = line.rstrip("\n")
            if stripped == "## Allowlist":
                in_allowlist = True
                continue
            if in_allowlist and stripped.startswith("## "):
                break
            if in_allowlist:
                m = _ALLOWLIST_RE.match(stripped)
                if m:
                    prefixes.append(m.group(1))
    return prefixes


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Outcome tags:\n"
            "  silent_continue    brief SHA equals HEAD; no drift.\n"
            "  workflow_only      all changed paths are under the workflow-artifact allowlist.\n"
            "  mixed_changes      at least one changed path is outside the allowlist.\n"
            "  uninspectable_a    brief has no readable Git SHA: line or it is malformed.\n"
            "  uninspectable_b    brief SHA is not reachable from HEAD.\n"
            "  uninspectable_c    git command failure prevented classification.\n"
        ),
    )
    parser.add_argument("--brief-path", required=True, help="Path to the scout brief file")
    parser.add_argument("--working-dir", default=None, help="Git working directory (default: cwd)")
    args = parser.parse_args()

    brief_path = args.brief_path
    cwd = args.working_dir or "."

    # Step 1: extract provenance preamble
    if not Path(brief_path).is_file():
        sys.stderr.write(json.dumps({
            "failure": "brief_path_not_found",
            "brief_path": brief_path,
        }) + "\n")
        sys.exit(2)

    preamble_script = Path(__file__).resolve().with_name("extract-provenance-preamble.py")
    preamble_result = subprocess.run(
        [sys.executable, str(preamble_script), "--file", brief_path, "--mode", "brief"],
        capture_output=True,
        text=True,
    )

    preamble_ok = False
    brief_sha = None
    if preamble_result.returncode == 0:
        try:
            preamble = json.loads(preamble_result.stdout)
        except json.JSONDecodeError:
            sys.stderr.write(json.dumps({
                "failure": "preamble_helper_invalid_json",
                "brief_path": brief_path,
                "stdout": preamble_result.stdout,
            }) + "\n")
            sys.exit(2)
        brief_sha = preamble.get("git_sha")
        preamble_ok = brief_sha is not None
    else:
        # Only git_sha_malformed is a normal uninspectable_a outcome.
        # Any other helper failure is a structured failure.
        try:
            err_payload = json.loads(preamble_result.stderr)
        except json.JSONDecodeError:
            err_payload = None
        if isinstance(err_payload, dict) and err_payload.get("failure") == "git_sha_malformed":
            preamble_ok = False
        else:
            sys.stderr.write(json.dumps({
                "failure": "preamble_helper_failure",
                "brief_path": brief_path,
                "exit_code": preamble_result.returncode,
                "stderr": preamble_result.stderr,
            }) + "\n")
            sys.exit(2)

    # Step 2: get HEAD SHA
    try:
        head_result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, cwd=cwd,
        )
        head_failed = head_result.returncode != 0
        head_error = head_result.stderr.strip() if head_failed else None
    except OSError as exc:
        head_failed = True
        head_error = str(exc)

    if head_failed:
        head_sha = "<unknown>"
        rendered_brief_sha = str(brief_sha) if preamble_ok else "<unknown>"
        _emit("uninspectable_c", brief_path, brief_sha if preamble_ok else None,
              head_sha, [], head_error,
              _uninspectable_c_body(brief_path, rendered_brief_sha, head_sha, head_error))
        return

    head_sha = head_result.stdout.strip()

    # Step 3: if no valid brief SHA -> uninspectable_a
    if not preamble_ok:
        _emit("uninspectable_a", brief_path, None, head_sha, [], None,
              _uninspectable_a_body(brief_path, head_sha))
        return

    # Step 3b: SHAs equal -> silent_continue
    if brief_sha == head_sha:
        _emit("silent_continue", brief_path, brief_sha, head_sha, [], None, None)
        return

    # Step 4: check ancestry (brief_sha reachable from HEAD)
    ancestor_result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", brief_sha, "HEAD"],
        capture_output=True, text=True, cwd=cwd,
    )
    if ancestor_result.returncode != 0:
        _emit("uninspectable_b", brief_path, brief_sha, head_sha, [], None,
              _uninspectable_b_body(brief_path, brief_sha, head_sha))
        return

    # Step 5: enumerate changed paths (NUL-separated)
    diff_result = subprocess.run(
        ["git", "diff", "--name-only", "-z", f"{brief_sha}..HEAD"],
        capture_output=True, cwd=cwd,
    )
    if diff_result.returncode != 0:
        error = diff_result.stderr.decode("utf-8", errors="replace").strip()
        _emit("uninspectable_c", brief_path, brief_sha, head_sha, [], error,
              _uninspectable_c_body(brief_path, brief_sha, head_sha, error))
        return

    raw = diff_result.stdout
    if raw:
        parts = raw.split(b"\0")
        if parts and parts[-1] == b"":
            parts = parts[:-1]
        changed_paths = [p.decode("utf-8", errors="replace") for p in parts]
    else:
        changed_paths = []

    # Step 6: load allowlist prefixes
    allowlist = _load_allowlist()

    # Step 7: classify
    non_workflow = [
        p for p in changed_paths
        if not any(p.startswith(prefix) for prefix in allowlist)
    ]

    if not non_workflow:
        _emit("workflow_only", brief_path, brief_sha, head_sha, [], None,
              _workflow_only_body(brief_path, brief_sha, head_sha))
    else:
        _emit("mixed_changes", brief_path, brief_sha, head_sha, non_workflow, None,
              _mixed_changes_body(brief_path, brief_sha, head_sha, non_workflow))


if __name__ == "__main__":
    main()
