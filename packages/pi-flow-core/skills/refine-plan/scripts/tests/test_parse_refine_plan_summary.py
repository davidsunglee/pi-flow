import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "parse-refine-plan-summary.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def run_script(path_or_content, *, via_stdin=False):
    if via_stdin:
        proc = subprocess.run(
            [sys.executable, SCRIPT, "--summary", "-"],
            input=path_or_content,
            capture_output=True,
            text=True,
        )
    else:
        proc = subprocess.run(
            [sys.executable, SCRIPT, "--summary", path_or_content],
            capture_output=True,
            text=True,
        )
    return proc


def run_tempfile(content):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write(content)
        name = f.name
    try:
        return run_script(name)
    finally:
        os.unlink(name)


class TestParseRefinePlanSummary(unittest.TestCase):
    def test_status_approved(self):
        proc = run_script(os.path.join(FIXTURES, "summary-plan-approved.txt"))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["status"], "approved")
        self.assertEqual(data["commit"], "committed abc1234")
        self.assertEqual(data["plan_path"], "docs/plans/foo.md")
        self.assertEqual(
            data["review_paths"], ["docs/plans/reviews/foo-plan-review-v1.md"]
        )
        self.assertFalse(data["structural_only"])
        self.assertIsNone(data["failure_reason"])

    def test_status_not_approved_within_budget(self):
        proc = run_script(os.path.join(FIXTURES, "summary-plan-not-approved.txt"))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["status"], "not_approved_within_budget")
        self.assertEqual(len(data["review_paths"]), 2)

    def test_status_failed_with_failure_reason(self):
        proc = run_script(os.path.join(FIXTURES, "summary-plan-failed.txt"))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["status"], "failed")
        self.assertEqual(data["failure_reason"], "worker dispatch failed: plan-reviewer")
        self.assertEqual(data["review_paths"], [])

    def test_status_structural_only_yes(self):
        proc = run_script(os.path.join(FIXTURES, "summary-plan-structural-only.txt"))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertTrue(data["structural_only"])

    def test_status_missing_fails_closed(self):
        content = (
            "COMMIT: committed abc1234\n"
            "PLAN_PATH: docs/plans/foo.md\n"
            "REVIEW_PATHS:\n"
            "STRUCTURAL_ONLY: no\n"
        )
        proc = run_tempfile(content)
        self.assertEqual(proc.returncode, 1)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "status_missing")

    def test_status_unrecognized_fails_closed(self):
        content = (
            "STATUS: weird\n"
            "COMMIT: committed abc1234\n"
            "PLAN_PATH: docs/plans/foo.md\n"
            "REVIEW_PATHS:\n"
            "STRUCTURAL_ONLY: no\n"
        )
        proc = run_tempfile(content)
        self.assertEqual(proc.returncode, 1)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "status_unrecognized")

    def test_status_failed_without_failure_reason_fails_closed(self):
        content = (
            "STATUS: failed\n"
            "COMMIT: not_attempted\n"
            "PLAN_PATH: docs/plans/baz.md\n"
            "REVIEW_PATHS:\n"
            "STRUCTURAL_ONLY: no\n"
        )
        proc = run_tempfile(content)
        self.assertEqual(proc.returncode, 1)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "missing_failure_reason")

    def test_status_approved_with_failure_reason_fails_closed(self):
        content = (
            "STATUS: approved\n"
            "COMMIT: committed abc1234\n"
            "PLAN_PATH: docs/plans/foo.md\n"
            "REVIEW_PATHS:\n"
            "STRUCTURAL_ONLY: no\n"
            "FAILURE_REASON: something went wrong\n"
        )
        proc = run_tempfile(content)
        self.assertEqual(proc.returncode, 1)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "unexpected_failure_reason")

    def test_structural_only_malformed(self):
        content = (
            "STATUS: approved\n"
            "COMMIT: committed abc1234\n"
            "PLAN_PATH: docs/plans/foo.md\n"
            "REVIEW_PATHS:\n"
            "STRUCTURAL_ONLY: maybe\n"
        )
        proc = run_tempfile(content)
        self.assertEqual(proc.returncode, 1)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "structural_only_malformed")

    def test_review_paths_block_empty_allowed(self):
        content = (
            "STATUS: approved\n"
            "COMMIT: committed abc1234\n"
            "PLAN_PATH: docs/plans/foo.md\n"
            "REVIEW_PATHS:\n"
            "STRUCTURAL_ONLY: no\n"
        )
        proc = run_tempfile(content)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["review_paths"], [])

    def test_commit_missing_fails_closed(self):
        content = (
            "STATUS: approved\n"
            "PLAN_PATH: docs/plans/foo.md\n"
            "REVIEW_PATHS:\n"
            "STRUCTURAL_ONLY: no\n"
        )
        proc = run_tempfile(content)
        self.assertEqual(proc.returncode, 1)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "commit_missing")

    def test_missing_summary_file_emits_structured_json(self):
        proc = run_script("/path/that/does/not/exist.txt")
        self.assertEqual(proc.returncode, 2)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "input missing or unreadable")
        self.assertEqual(err["input"], "summary")


if __name__ == "__main__":
    unittest.main()
