#!/usr/bin/env python3
"""git-workspace-status — Git workspace pre-flight inspector.

Inspects a working directory and emits a JSON object describing its Git state.

Output fields:
  is_git_repo       — bool: whether the working directory is inside a git repo
  workspace_path    — str|null: absolute path to the repo root
  is_worktree       — bool|null: True if the working directory is a linked worktree
  current_branch    — str|null: current branch name, empty string when detached HEAD
  branch_label      — str|null: human-readable label; "detached HEAD at <sha>" when detached
  is_feature_branch — bool|null: True when current_branch is non-empty and not in --main-branches
  dirty_status      — str|null: output of "git status --porcelain"; empty string when clean

Protocol error labels (emitted to stderr as JSON with a "failure" key, exit 1):
  working_dir_not_found — the path given via --working-dir does not exist
  git_command_failed    — an unexpected git command failure occurred
"""
import argparse
import json
import os
import subprocess
import sys


def _git(args, working_dir):
    result = subprocess.run(
        ["git", "-C", working_dir] + args,
        capture_output=True,
        text=True,
    )
    return result


def _fail(failure, **extra):
    payload = {"failure": failure, **extra}
    sys.stderr.write(json.dumps(payload) + "\n")
    sys.exit(1)


def _null_result():
    return {
        "is_git_repo": False,
        "workspace_path": None,
        "is_worktree": None,
        "current_branch": None,
        "branch_label": None,
        "is_feature_branch": None,
        "dirty_status": None,
    }


def main():
    epilog = (
        "Protocol error labels (emitted to stderr as JSON, exit 1):\n"
        "  working_dir_not_found  -- the path given via --working-dir does not exist\n"
        "  git_command_failed     -- an unexpected git command failure occurred\n"
    )
    parser = argparse.ArgumentParser(
        description="Inspect a git workspace and emit a JSON status object.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=epilog,
    )
    parser.add_argument("--working-dir", default=".", metavar="PATH", help="Directory to inspect (default: .)")
    parser.add_argument(
        "--main-branches",
        default="main,master,develop",
        metavar="MAIN1,MAIN2,...",
        help="Comma-separated list of branch names considered 'main' (default: main,master,develop)",
    )
    args = parser.parse_args()

    working_dir = os.path.abspath(args.working_dir)
    if not os.path.isdir(working_dir):
        _fail("working_dir_not_found", working_dir=args.working_dir)

    main_branches = [b.strip() for b in args.main_branches.split(",") if b.strip()]

    # Step 4: Check if this is a git repo
    rev_parse = _git(["rev-parse", "--git-dir"], working_dir)
    if rev_parse.returncode != 0:
        print(json.dumps(_null_result()))
        sys.exit(0)

    # Step 5: Detect worktree
    git_dir_result = _git(["rev-parse", "--git-dir"], working_dir)
    if git_dir_result.returncode != 0:
        _fail("git_command_failed", stderr=git_dir_result.stderr.strip())
    git_common_dir_result = _git(["rev-parse", "--git-common-dir"], working_dir)
    if git_common_dir_result.returncode != 0:
        _fail("git_command_failed", stderr=git_common_dir_result.stderr.strip())

    git_dir_raw = git_dir_result.stdout.strip()
    git_common_dir_raw = git_common_dir_result.stdout.strip()

    # Resolve to absolute paths
    if not os.path.isabs(git_dir_raw):
        git_dir_abs = os.path.normpath(os.path.join(working_dir, git_dir_raw))
    else:
        git_dir_abs = git_dir_raw

    if not os.path.isabs(git_common_dir_raw):
        git_common_dir_abs = os.path.normpath(os.path.join(working_dir, git_common_dir_raw))
    else:
        git_common_dir_abs = git_common_dir_raw

    is_worktree = git_dir_abs != git_common_dir_abs

    # Step 6: current_branch and workspace_path
    branch_result = _git(["branch", "--show-current"], working_dir)
    if branch_result.returncode != 0:
        _fail("git_command_failed", stderr=branch_result.stderr.strip())
    current_branch = branch_result.stdout.strip()

    toplevel_result = _git(["rev-parse", "--show-toplevel"], working_dir)
    if toplevel_result.returncode != 0:
        _fail("git_command_failed", stderr=toplevel_result.stderr.strip())
    workspace_path = toplevel_result.stdout.strip()

    # Step 7: branch_label
    if current_branch:
        branch_label = current_branch
    else:
        short_sha_result = _git(["rev-parse", "--short", "HEAD"], working_dir)
        if short_sha_result.returncode != 0:
            _fail("git_command_failed", stderr=short_sha_result.stderr.strip())
        branch_label = f"detached HEAD at {short_sha_result.stdout.strip()}"

    # Step 8: is_feature_branch
    is_feature_branch = bool(current_branch) and current_branch not in main_branches

    # Step 9: dirty_status
    dirty_result = _git(["status", "--porcelain"], working_dir)
    if dirty_result.returncode != 0:
        _fail("git_command_failed", stderr=dirty_result.stderr.strip())
    dirty_status = dirty_result.stdout

    result = {
        "is_git_repo": True,
        "workspace_path": workspace_path,
        "is_worktree": is_worktree,
        "current_branch": current_branch,
        "branch_label": branch_label,
        "is_feature_branch": is_feature_branch,
        "dirty_status": dirty_status,
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
