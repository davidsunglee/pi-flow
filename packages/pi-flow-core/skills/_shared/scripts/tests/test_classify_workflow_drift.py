import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "classify-workflow-drift.py"
)


def make_temp_repo():
    """Create a temp git repo with an initial commit; return TemporaryDirectory (use .name for path)."""
    tmp = tempfile.TemporaryDirectory()
    path = tmp.name
    subprocess.run(["git", "init", path], check=True, capture_output=True)
    subprocess.run(["git", "-C", path, "config", "user.email", "test@example.com"], check=True, capture_output=True)
    subprocess.run(["git", "-C", path, "config", "user.name", "test"], check=True, capture_output=True)
    open(os.path.join(path, ".gitkeep"), "w").close()
    subprocess.run(["git", "-C", path, "add", "."], check=True, capture_output=True)
    subprocess.run(["git", "-C", path, "commit", "-m", "initial"], check=True, capture_output=True)
    return tmp


def git_head(repo):
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        capture_output=True, text=True, cwd=repo, check=True,
    ).stdout.strip()


def write_brief(path, sha=None):
    """Write a brief file optionally containing a Git SHA line."""
    with open(path, "w") as f:
        if sha:
            f.write(f"Git SHA: {sha}\n")
        f.write("# Scout Brief\n\nSome content.\n")


def commit_files(repo, files):
    """Create files in repo and commit them. files is a list of relative paths."""
    for rel in files:
        full = os.path.join(repo, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write("content\n")
    subprocess.run(["git", "-C", repo, "add"] + list(files), check=True, capture_output=True)
    subprocess.run(["git", "-C", repo, "commit", "-m", "test commit"], check=True, capture_output=True)


def run_helper(brief_path, working_dir=None):
    args = [sys.executable, SCRIPT, "--brief-path", brief_path]
    if working_dir:
        args += ["--working-dir", working_dir]
    return subprocess.run(args, capture_output=True, text=True)


_MENU_SUFFIX = (
    "\n\n**(c) Continue with plan generation** — proceed despite the scout brief / HEAD difference.\n"
    "**(x) Stop plan generation** — resolve manually before planning."
)


class TestClassifyWorkflowDrift(unittest.TestCase):

    def test_silent_continue_when_brief_sha_equals_head(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            sha = git_head(repo)
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, sha)
            result = run_helper(brief, repo)
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["outcome"], "silent_continue")
            self.assertIsNone(data["message_body"])
        finally:
            tmp.cleanup()

    def test_workflow_only_outcome(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            sha1 = git_head(repo)
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, sha1)
            commit_files(repo, ["docs/specs/foo.md"])
            result = run_helper(brief, repo)
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["outcome"], "workflow_only")
            self.assertEqual(data["non_workflow_paths"], [])
            sha2 = git_head(repo)
            expected_body = (
                f"Scout brief at `{brief}` was generated at SHA `{sha1}`; HEAD is now `{sha2}`. "
                "Intervening commits modified only workflow artifacts (`docs/briefs/`, `docs/specs/`, "
                "`docs/todos/`, `docs/plans/`). Treating as expected workflow drift and continuing."
            )
            self.assertEqual(data["message_body"], expected_body)
        finally:
            tmp.cleanup()

    def test_mixed_changes_outcome(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            sha1 = git_head(repo)
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, sha1)
            commit_files(repo, ["docs/specs/foo.md", "agent/skills/some.md"])
            result = run_helper(brief, repo)
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["outcome"], "mixed_changes")
            self.assertEqual(data["non_workflow_paths"], ["agent/skills/some.md"])
            sha2 = git_head(repo)
            # message_body should include the non-workflow paths
            self.assertIn("agent/skills/some.md", data["message_body"])
            self.assertIn(sha1, data["message_body"])
            self.assertIn(sha2, data["message_body"])
        finally:
            tmp.cleanup()

    def test_uninspectable_a_missing_git_sha(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, sha=None)  # no Git SHA line
            result = run_helper(brief, repo)
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["outcome"], "uninspectable_a")
            self.assertIsNone(data["brief_sha"])
            self.assertIsNotNone(data["message_body"])
            head_sha = git_head(repo)
            self.assertIn(head_sha, data["message_body"])
        finally:
            tmp.cleanup()

    def test_uninspectable_a_malformed_git_sha(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            brief = os.path.join(tmp.name, "brief.md")
            with open(brief, "w") as f:
                f.write("Git SHA: not-a-real-sha\n# Scout Brief\n")
            result = run_helper(brief, repo)
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["outcome"], "uninspectable_a")
        finally:
            tmp.cleanup()

    def test_uninspectable_b_brief_sha_not_ancestor(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            fake_sha = "a" * 40
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, fake_sha)
            result = run_helper(brief, repo)
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["outcome"], "uninspectable_b")
            self.assertEqual(data["brief_sha"], fake_sha)
        finally:
            tmp.cleanup()

    def test_uninspectable_c_git_failure(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            sha = git_head(repo)
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, sha)
            result = run_helper(brief, working_dir="/tmp/not-a-repo")
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["outcome"], "uninspectable_c")
            self.assertEqual(data["head_sha"], "<unknown>")
            self.assertIsNotNone(data["error"])
        finally:
            tmp.cleanup()

    def test_uninspectable_c_git_failure_takes_precedence_over_missing_sha(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, sha=None)
            result = run_helper(brief, working_dir=tmp.name)
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["outcome"], "uninspectable_c")
            self.assertIsNone(data["brief_sha"])
            self.assertEqual(data["head_sha"], "<unknown>")
            self.assertIsNotNone(data["error"])
        finally:
            tmp.cleanup()

    def test_message_body_workflow_only_byte_equal(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            sha1 = git_head(repo)
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, sha1)
            commit_files(repo, ["docs/specs/foo.md"])
            sha2 = git_head(repo)
            result = run_helper(brief, repo)
            data = json.loads(result.stdout)
            expected = (
                f"Scout brief at `{brief}` was generated at SHA `{sha1}`; HEAD is now `{sha2}`. "
                "Intervening commits modified only workflow artifacts (`docs/briefs/`, `docs/specs/`, "
                "`docs/todos/`, `docs/plans/`). Treating as expected workflow drift and continuing."
            )
            self.assertEqual(data["message_body"], expected)
        finally:
            tmp.cleanup()

    def test_message_body_mixed_changes_byte_equal(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            sha1 = git_head(repo)
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, sha1)
            commit_files(repo, ["docs/specs/foo.md", "agent/skills/some.md"])
            sha2 = git_head(repo)
            result = run_helper(brief, repo)
            data = json.loads(result.stdout)
            expected = (
                f"Scout brief at `{brief}` was generated at SHA `{sha1}`; HEAD is now `{sha2}`. "
                "Non-workflow files changed since the brief SHA:\n\n"
                "  - `agent/skills/some.md`\n\n"
                "The brief may be stale relative to source/config/agent changes."
                + _MENU_SUFFIX
            )
            self.assertEqual(data["message_body"], expected)
        finally:
            tmp.cleanup()

    def test_message_body_uninspectable_a_byte_equal(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            head_sha = git_head(repo)
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, sha=None)
            result = run_helper(brief, repo)
            data = json.loads(result.stdout)
            expected = (
                f"Scout brief at `{brief}` has no readable `Git SHA:` preamble line; "
                f"cannot classify intervening changes against current HEAD `{head_sha}`. The brief may be stale."
                + _MENU_SUFFIX
            )
            self.assertEqual(data["message_body"], expected)
        finally:
            tmp.cleanup()

    def test_message_body_uninspectable_b_byte_equal(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            head_sha = git_head(repo)
            fake_sha = "b" * 40
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, fake_sha)
            result = run_helper(brief, repo)
            data = json.loads(result.stdout)
            expected = (
                f"Scout brief at `{brief}` was generated at SHA `{fake_sha}`; HEAD is now `{head_sha}`. "
                "Brief SHA is not reachable from HEAD; cannot classify intervening changes. The brief may be stale."
                + _MENU_SUFFIX
            )
            self.assertEqual(data["message_body"], expected)
        finally:
            tmp.cleanup()

    def test_missing_brief_file_exits_2_with_failure(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            missing = os.path.join(tmp.name, "does-not-exist.md")
            result = run_helper(missing, repo)
            self.assertEqual(result.returncode, 2)
            err = json.loads(result.stderr.strip())
            self.assertIn("failure", err)
            self.assertEqual(err["brief_path"], missing)
        finally:
            tmp.cleanup()

    def test_preamble_helper_unexpected_failure_exits_2(self):
        # Pass --brief-path that points to a directory (open() raises IsADirectoryError),
        # which is an unexpected helper failure rather than git_sha_malformed.
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            dir_as_brief = os.path.join(tmp.name, "subdir")
            os.makedirs(dir_as_brief)
            result = run_helper(dir_as_brief, repo)
            self.assertEqual(result.returncode, 2)
            err = json.loads(result.stderr.strip())
            self.assertIn("failure", err)
        finally:
            tmp.cleanup()

    def test_message_body_uninspectable_c_byte_equal(self):
        tmp = make_temp_repo()
        try:
            repo = tmp.name
            sha = git_head(repo)
            brief = os.path.join(tmp.name, "brief.md")
            write_brief(brief, sha)
            result = run_helper(brief, working_dir="/tmp/not-a-repo")
            data = json.loads(result.stdout)
            error = data["error"]
            expected = (
                f"Scout brief at `{brief}` was generated at SHA `{sha}`; HEAD is now `<unknown>`. "
                f"Could not enumerate intervening changes: `{error}`. The brief may be stale."
                + _MENU_SUFFIX
            )
            self.assertEqual(data["message_body"], expected)
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
