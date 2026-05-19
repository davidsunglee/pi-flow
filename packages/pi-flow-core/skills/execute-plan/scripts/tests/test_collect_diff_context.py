"""Tests for collect-diff-context.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "collect-diff-context.py"
)


def make_temp_repo():
    tmp = tempfile.mkdtemp()
    subprocess.run(["git", "init", tmp], check=True, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        check=True, capture_output=True, cwd=tmp,
    )
    subprocess.run(
        ["git", "config", "user.name", "test"],
        check=True, capture_output=True, cwd=tmp,
    )
    return tmp


def run_script(args, cwd=None):
    result = subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True, text=True, cwd=cwd,
    )
    return result


def commit_file(repo, filename, content):
    path = os.path.join(repo, filename)
    with open(path, "w") as f:
        f.write(content)
    subprocess.run(["git", "add", filename], check=True, capture_output=True, cwd=repo)
    subprocess.run(
        ["git", "commit", "-m", "add file"],
        check=True, capture_output=True, cwd=repo,
    )
    return path


class TestTrackedFileModified(unittest.TestCase):
    def test_tracked_file_modified(self):
        repo = make_temp_repo()
        path = commit_file(repo, "foo.txt", "original content\n")
        with open(path, "w") as f:
            f.write("modified content\n")
        result = run_script(
            ["--working-dir", repo, "--files", "foo.txt"]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("modified content", result.stdout)
        self.assertIn("diff --git", result.stdout)


class TestUntrackedFileAdded(unittest.TestCase):
    def test_untracked_file_added(self):
        repo = make_temp_repo()
        # Make an initial commit so HEAD exists
        commit_file(repo, "baseline.txt", "baseline\n")
        new_file = os.path.join(repo, "new_untracked.txt")
        with open(new_file, "w") as f:
            f.write("brand new content\n")
        result = run_script(
            ["--working-dir", repo, "--files", "new_untracked.txt"]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("brand new content", result.stdout)
        # Unified diff should show lines added
        self.assertTrue(
            any(line.startswith("+") for line in result.stdout.splitlines()),
            "Expected '+' content lines in diff output",
        )


class TestMixedTrackedAndUntracked(unittest.TestCase):
    def test_mixed_tracked_and_untracked(self):
        repo = make_temp_repo()
        commit_file(repo, "tracked.txt", "tracked original\n")
        tracked_path = os.path.join(repo, "tracked.txt")
        with open(tracked_path, "w") as f:
            f.write("tracked modified\n")
        untracked_path = os.path.join(repo, "untracked.txt")
        with open(untracked_path, "w") as f:
            f.write("untracked content\n")
        result = run_script(
            ["--working-dir", repo, "--files", "tracked.txt,untracked.txt"]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("tracked modified", result.stdout)
        self.assertIn("untracked content", result.stdout)


class TestTruncationByLines(unittest.TestCase):
    def test_truncation_by_lines(self):
        repo = make_temp_repo()
        # Create a file with many lines that will produce >500 diff lines when modified
        original = "\n".join(f"line {i}" for i in range(1, 51)) + "\n"
        commit_file(repo, "big.txt", original)
        big_path = os.path.join(repo, "big.txt")
        # Write a file with 600 unique lines (modification will produce ~600 diff lines)
        modified = "\n".join(f"modified line {i}" for i in range(1, 601)) + "\n"
        with open(big_path, "w") as f:
            f.write(modified)
        result = run_script(
            ["--working-dir", repo, "--files", "big.txt", "--limit-lines", "500"]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        marker = "[diff truncated — "
        self.assertEqual(
            result.stdout.count(marker), 1,
            f"Expected exactly one truncation marker, got: {result.stdout.count(marker)}",
        )
        stderr_json = json.loads(result.stderr.strip())
        self.assertTrue(stderr_json["truncated"])
        lines = result.stdout.splitlines()
        marker_idx = next(i for i, l in enumerate(lines) if marker in l)
        self.assertEqual(marker_idx, 300, f"Marker should be at line 300, got {marker_idx}")
        self.assertEqual(len(lines) - marker_idx - 1, 100, "Should have 100 lines after marker")


class TestTruncationByBytes(unittest.TestCase):
    def test_truncation_by_bytes(self):
        repo = make_temp_repo()
        # Create content that will produce >40KB when diffed
        original = "x\n"
        commit_file(repo, "bigbytes.txt", original)
        big_path = os.path.join(repo, "bigbytes.txt")
        # 50KB worth of content
        big_content = "A" * 100 + "\n"
        modified = big_content * 450
        with open(big_path, "w") as f:
            f.write(modified)
        result = run_script(
            ["--working-dir", repo, "--files", "bigbytes.txt",
             "--limit-bytes", "40960", "--limit-lines", "100000"]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        marker = "[diff truncated — "
        self.assertEqual(
            result.stdout.count(marker), 1,
            f"Expected exactly one truncation marker in output",
        )
        stderr_json = json.loads(result.stderr.strip())
        self.assertTrue(stderr_json["truncated"])


class TestFilesObservedSummary(unittest.TestCase):
    def test_files_observed_summary(self):
        repo = make_temp_repo()
        commit_file(repo, "a.txt", "content a\n")
        commit_file(repo, "b.txt", "content b\n")
        untracked_path = os.path.join(repo, "c.txt")
        with open(untracked_path, "w") as f:
            f.write("content c\n")
        result = run_script(
            ["--working-dir", repo, "--files", "a.txt,b.txt,c.txt"]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        stderr_json = json.loads(result.stderr.strip())
        self.assertIn("files_observed", stderr_json)
        self.assertEqual(
            set(stderr_json["files_observed"]),
            {"a.txt", "b.txt", "c.txt"},
        )


class TestOutsideGitRepo(unittest.TestCase):
    def test_outside_git_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            some_file = os.path.join(tmp, "file.txt")
            with open(some_file, "w") as f:
                f.write("content\n")
            result = run_script(
                ["--working-dir", tmp, "--files", "file.txt"]
            )
            self.assertNotEqual(result.returncode, 0)
            # Should have structured error on stderr
            self.assertTrue(
                len(result.stderr.strip()) > 0,
                "Expected error output on stderr",
            )


class TestFilesJsonPath(unittest.TestCase):
    def test_files_json_path_reads_file(self):
        repo = make_temp_repo()
        commit_file(repo, "a.txt", "a\n")
        with open(os.path.join(repo, "a.txt"), "w") as f:
            f.write("a modified\n")
        files_path = os.path.join(repo, "files.json")
        with open(files_path, "w") as f:
            json.dump(["a.txt"], f)
        result = run_script(
            ["--working-dir", repo, "--files-json", files_path]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("a modified", result.stdout)
        stderr_json = json.loads(result.stderr.strip())
        self.assertEqual(stderr_json["files_observed"], ["a.txt"])

    def test_files_json_missing_file_structured_error(self):
        repo = make_temp_repo()
        result = run_script(
            ["--working-dir", repo, "--files-json", os.path.join(repo, "nope.json")]
        )
        self.assertNotEqual(result.returncode, 0)
        err = json.loads(result.stderr.strip())
        self.assertEqual(err.get("error"), "files_json_invalid")

    def test_files_json_malformed_json_structured_error(self):
        repo = make_temp_repo()
        files_path = os.path.join(repo, "bad.json")
        with open(files_path, "w") as f:
            f.write("{not json")
        result = run_script(
            ["--working-dir", repo, "--files-json", files_path]
        )
        self.assertNotEqual(result.returncode, 0)
        err = json.loads(result.stderr.strip())
        self.assertEqual(err.get("error"), "files_json_invalid")

    def test_files_json_not_array_structured_error(self):
        repo = make_temp_repo()
        files_path = os.path.join(repo, "obj.json")
        with open(files_path, "w") as f:
            json.dump({"a": "b"}, f)
        result = run_script(
            ["--working-dir", repo, "--files-json", files_path]
        )
        self.assertNotEqual(result.returncode, 0)
        err = json.loads(result.stderr.strip())
        self.assertEqual(err.get("error"), "files_json_invalid")


class TestCleanTrackedFileTakesTrackedBranch(unittest.TestCase):
    def test_clean_tracked_file_takes_tracked_branch(self):
        """Clean committed file (no working-tree changes) must not produce added-content diff."""
        repo = make_temp_repo()
        commit_file(repo, "clean.txt", "clean content\n")
        result = run_script(
            ["--working-dir", repo, "--files", "clean.txt"]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = result.stdout.splitlines()
        # Must not contain '+++ b/clean.txt' (that's the untracked/no-index branch marker)
        self.assertFalse(
            any("+++ b/clean.txt" in line for line in lines),
            "Clean tracked file must not route through --no-index branch",
        )
        # Must not contain any '+' content lines (the diff should be empty)
        content_plus_lines = [
            line for line in lines
            if line.startswith("+") and not line.startswith("+++")
        ]
        self.assertEqual(
            content_plus_lines, [],
            f"Expected no '+' content lines for clean tracked file, got: {content_plus_lines}",
        )


if __name__ == "__main__":
    unittest.main()
