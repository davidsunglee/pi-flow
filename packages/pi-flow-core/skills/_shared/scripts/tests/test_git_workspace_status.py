import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "git-workspace-status.py"
)


def run_helper(*args):
    return subprocess.run(
        [sys.executable, SCRIPT] + list(args),
        capture_output=True,
        text=True,
    )


class GitWorkspaceStatusBase(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        subprocess.run(["git", "init", self.tmpdir], check=True, capture_output=True)
        subprocess.run(["git", "-C", self.tmpdir, "config", "user.email", "test@example.com"], check=True, capture_output=True)
        subprocess.run(["git", "-C", self.tmpdir, "config", "user.name", "Test User"], check=True, capture_output=True)
        subprocess.run(["git", "-C", self.tmpdir, "checkout", "-b", "main"], check=True, capture_output=True)
        open(os.path.join(self.tmpdir, ".gitkeep"), "w").close()
        subprocess.run(["git", "-C", self.tmpdir, "add", "."], check=True, capture_output=True)
        subprocess.run(["git", "-C", self.tmpdir, "commit", "-m", "initial"], check=True, capture_output=True)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)


class TestNonGitDirectory(unittest.TestCase):
    def test_non_git_dir_returns_is_git_repo_false(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            result = run_helper("--working-dir", tmpdir)
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertFalse(data["is_git_repo"])
            self.assertIsNone(data["workspace_path"])
            self.assertIsNone(data["is_worktree"])
            self.assertIsNone(data["current_branch"])
            self.assertIsNone(data["branch_label"])
            self.assertIsNone(data["is_feature_branch"])
            self.assertIsNone(data["dirty_status"])


class TestPlainRepoOnMain(GitWorkspaceStatusBase):
    def test_plain_repo_on_main(self):
        result = run_helper("--working-dir", self.tmpdir)
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertTrue(data["is_git_repo"])
        self.assertFalse(data["is_worktree"])
        self.assertFalse(data["is_feature_branch"])
        self.assertEqual(data["current_branch"], "main")
        self.assertEqual(data["branch_label"], "main")


class TestFeatureBranch(GitWorkspaceStatusBase):
    def test_feature_branch(self):
        subprocess.run(["git", "-C", self.tmpdir, "checkout", "-b", "feature/foo"], check=True, capture_output=True)
        result = run_helper("--working-dir", self.tmpdir)
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertTrue(data["is_feature_branch"])
        self.assertEqual(data["current_branch"], "feature/foo")


class TestDetachedHead(GitWorkspaceStatusBase):
    def test_detached_head(self):
        sha = subprocess.run(
            ["git", "-C", self.tmpdir, "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        subprocess.run(["git", "-C", self.tmpdir, "checkout", sha], check=True, capture_output=True)
        result = run_helper("--working-dir", self.tmpdir)
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["current_branch"], "")
        self.assertRegex(data["branch_label"], r"^detached HEAD at [0-9a-f]{7,}$")


class TestLinkedWorktree(GitWorkspaceStatusBase):
    def test_linked_worktree(self):
        worktree_dir = tempfile.mkdtemp()
        try:
            subprocess.run(
                ["git", "-C", self.tmpdir, "worktree", "add", worktree_dir, "-b", "wt-branch"],
                check=True, capture_output=True,
            )
            result = run_helper("--working-dir", worktree_dir)
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertTrue(data["is_git_repo"])
            self.assertTrue(data["is_worktree"])
        finally:
            import shutil
            shutil.rmtree(worktree_dir, ignore_errors=True)


class TestDirtyStatus(GitWorkspaceStatusBase):
    def test_dirty_status(self):
        untracked = os.path.join(self.tmpdir, "untracked.txt")
        with open(untracked, "w") as f:
            f.write("untracked content\n")
        result = run_helper("--working-dir", self.tmpdir)
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertIn("??", data["dirty_status"])
        self.assertIn("untracked.txt", data["dirty_status"])


class TestCustomMainBranches(GitWorkspaceStatusBase):
    def test_custom_main_branches(self):
        subprocess.run(["git", "-C", self.tmpdir, "checkout", "-b", "trunk"], check=True, capture_output=True)
        subprocess.run(["git", "-C", self.tmpdir, "commit", "--allow-empty", "-m", "trunk commit"], check=True, capture_output=True)
        result = run_helper("--working-dir", self.tmpdir, "--main-branches", "trunk")
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertFalse(data["is_feature_branch"])


class TestNonexistentWorkingDir(unittest.TestCase):
    def test_nonexistent_working_dir(self):
        result = run_helper("--working-dir", "/this/path/does/not/exist")
        self.assertEqual(result.returncode, 1)
        err = json.loads(result.stderr)
        self.assertEqual(err["failure"], "working_dir_not_found")


class TestHelpDocumentsErrorLabels(unittest.TestCase):
    def test_help_contains_error_labels(self):
        result = run_helper("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("working_dir_not_found", result.stdout)
        self.assertIn("git_command_failed", result.stdout)


if __name__ == "__main__":
    unittest.main()
