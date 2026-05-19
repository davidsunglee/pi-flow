"""Tests for parse-refine-code-summary.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "parse-refine-code-summary.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def run_script(*args, input_text=None):
    """Run the script with given args; return (returncode, stdout, stderr)."""
    result = subprocess.run(
        [sys.executable, SCRIPT] + list(args),
        capture_output=True,
        text=True,
        input=input_text,
    )
    return result.returncode, result.stdout, result.stderr


def parse_stdout(stdout):
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return None


def parse_stderr(stderr):
    try:
        return json.loads(stderr)
    except json.JSONDecodeError:
        return None


def fixture(name):
    return os.path.join(FIXTURES, name)


def write_temp_summary(content):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
    f.write(content)
    f.close()
    return f.name


class TestApproved(unittest.TestCase):
    def setUp(self):
        self.rc, self.stdout, self.stderr = run_script(
            "--summary", fixture("summary-code-approved.txt")
        )
        self.data = parse_stdout(self.stdout)

    def test_exit_0(self):
        self.assertEqual(self.rc, 0)

    def test_status(self):
        self.assertEqual(self.data["status"], "approved")

    def test_iterations(self):
        self.assertEqual(self.data["iterations"], 2)

    def test_issues_found_total(self):
        self.assertEqual(self.data["issues_found_total"], 5)

    def test_issues_found_critical(self):
        self.assertEqual(self.data["issues_found_critical"], 1)

    def test_issues_found_important(self):
        self.assertEqual(self.data["issues_found_important"], 2)

    def test_issues_found_minor(self):
        self.assertEqual(self.data["issues_found_minor"], 2)

    def test_issues_fixed(self):
        self.assertEqual(self.data["issues_fixed"], 3)

    def test_issues_remaining(self):
        self.assertEqual(self.data["issues_remaining"], 2)

    def test_review_file(self):
        self.assertEqual(self.data["review_file"], "docs/reviews/sample-code-review-v1.md")

    def test_remaining_issues_null(self):
        self.assertIsNone(self.data["remaining_issues"])

    def test_failure_reason_null(self):
        self.assertIsNone(self.data["failure_reason"])


class TestApprovedWithConcerns(unittest.TestCase):
    def setUp(self):
        self.rc, self.stdout, self.stderr = run_script(
            "--summary", fixture("summary-code-approved-with-concerns.txt")
        )
        self.data = parse_stdout(self.stdout)

    def test_exit_0(self):
        self.assertEqual(self.rc, 0)

    def test_status(self):
        self.assertEqual(self.data["status"], "approved_with_concerns")

    def test_iterations(self):
        self.assertEqual(self.data["iterations"], 2)

    def test_issues_found_critical(self):
        self.assertEqual(self.data["issues_found_critical"], 1)

    def test_review_file(self):
        self.assertEqual(self.data["review_file"], "docs/reviews/sample-code-review-v1.md")

    def test_remaining_issues_null(self):
        self.assertIsNone(self.data["remaining_issues"])

    def test_failure_reason_null(self):
        self.assertIsNone(self.data["failure_reason"])


class TestNotApproved(unittest.TestCase):
    def setUp(self):
        self.rc, self.stdout, self.stderr = run_script(
            "--summary", fixture("summary-code-not-approved.txt")
        )
        self.data = parse_stdout(self.stdout)

    def test_exit_0(self):
        self.assertEqual(self.rc, 0)

    def test_status(self):
        self.assertEqual(self.data["status"], "not_approved_within_budget")

    def test_remaining_issues_contains_critical(self):
        self.assertIn("[Critical] tests/foo.py:42", self.data["remaining_issues"])

    def test_remaining_issues_contains_important(self):
        self.assertIn("[Important] tests/bar.py:13", self.data["remaining_issues"])

    def test_review_file(self):
        self.assertEqual(self.data["review_file"], "docs/reviews/sample-code-review-v3.md")

    def test_failure_reason_null(self):
        self.assertIsNone(self.data["failure_reason"])


class TestFailed(unittest.TestCase):
    def setUp(self):
        self.rc, self.stdout, self.stderr = run_script(
            "--summary", fixture("summary-code-failed.txt")
        )
        self.data = parse_stdout(self.stdout)

    def test_exit_0(self):
        self.assertEqual(self.rc, 0)

    def test_status(self):
        self.assertEqual(self.data["status"], "failed")

    def test_failure_reason(self):
        self.assertEqual(self.data["failure_reason"], "worker dispatch failed: code-reviewer")

    def test_remaining_issues_null(self):
        self.assertIsNone(self.data["remaining_issues"])


class TestFailClosed(unittest.TestCase):
    def _run_temp(self, content):
        path = write_temp_summary(content)
        try:
            rc, stdout, stderr = run_script("--summary", path)
        finally:
            os.unlink(path)
        return rc, stdout, stderr

    def test_status_missing_fails_closed(self):
        content = "\n## Summary\nIterations: 1\nIssues found: 0 (0 Critical, 0 Important, 0 Minor)\nIssues fixed: 0\nIssues remaining: 0\n\n## Review File\nsome/path.md\n"
        rc, stdout, stderr = self._run_temp(content)
        self.assertNotEqual(rc, 0)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "status_missing")

    def test_status_unrecognized_fails_closed(self):
        content = "STATUS: unknown_value\n\n## Summary\nIterations: 1\nIssues found: 0 (0 Critical, 0 Important, 0 Minor)\nIssues fixed: 0\nIssues remaining: 0\n\n## Review File\nsome/path.md\n"
        rc, stdout, stderr = self._run_temp(content)
        self.assertNotEqual(rc, 0)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "status_unrecognized")

    def test_summary_block_missing_fails_closed(self):
        content = "STATUS: approved\n\n## Review File\nsome/path.md\n"
        rc, stdout, stderr = self._run_temp(content)
        self.assertNotEqual(rc, 0)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "summary_block_missing")

    def test_summary_field_missing_fails_closed(self):
        content = "STATUS: approved\n\n## Summary\nIssues found: 0 (0 Critical, 0 Important, 0 Minor)\nIssues fixed: 0\nIssues remaining: 0\n\n## Review File\nsome/path.md\n"
        rc, stdout, stderr = self._run_temp(content)
        self.assertNotEqual(rc, 0)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "summary_field_missing")
        self.assertIn("iterations", err.get("detail", "").lower())

    def test_summary_field_malformed_fails_closed(self):
        content = "STATUS: approved\n\n## Summary\nIterations: not-an-int\nIssues found: 0 (0 Critical, 0 Important, 0 Minor)\nIssues fixed: 0\nIssues remaining: 0\n\n## Review File\nsome/path.md\n"
        rc, stdout, stderr = self._run_temp(content)
        self.assertNotEqual(rc, 0)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "summary_field_malformed")

    def test_review_file_missing_fails_closed(self):
        content = "STATUS: approved\n\n## Summary\nIterations: 1\nIssues found: 0 (0 Critical, 0 Important, 0 Minor)\nIssues fixed: 0\nIssues remaining: 0\n"
        rc, stdout, stderr = self._run_temp(content)
        self.assertNotEqual(rc, 0)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "review_file_missing")

    def test_unexpected_remaining_issues_fails_closed(self):
        content = "STATUS: approved\n\n## Summary\nIterations: 1\nIssues found: 0 (0 Critical, 0 Important, 0 Minor)\nIssues fixed: 0\nIssues remaining: 0\n\n## Remaining Issues\n[Critical] foo.py:1 — bad\n\n## Review File\nsome/path.md\n"
        rc, stdout, stderr = self._run_temp(content)
        self.assertNotEqual(rc, 0)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "unexpected_remaining_issues")

    def test_unexpected_failure_reason_fails_closed(self):
        content = "STATUS: approved\n\n## Summary\nIterations: 1\nIssues found: 0 (0 Critical, 0 Important, 0 Minor)\nIssues fixed: 0\nIssues remaining: 0\n\n## Review File\nsome/path.md\n\n## Failure Reason\nsome reason\n"
        rc, stdout, stderr = self._run_temp(content)
        self.assertNotEqual(rc, 0)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "unexpected_failure_reason")

    def test_missing_failure_reason_fails_closed(self):
        content = "STATUS: failed\n\n## Summary\nIterations: 0\nIssues found: 0 (0 Critical, 0 Important, 0 Minor)\nIssues fixed: 0\nIssues remaining: 0\n\n## Review File\n(none)\n"
        rc, stdout, stderr = self._run_temp(content)
        self.assertNotEqual(rc, 0)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "missing_failure_reason")

    def test_missing_summary_file_emits_structured_json(self):
        rc, stdout, stderr = run_script("--summary", "/path/that/does/not/exist.txt")
        self.assertEqual(rc, 2)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "input missing or unreadable")
        self.assertEqual(err["input"], "summary")


class TestRemainingIssuesDocumentedHeading(unittest.TestCase):
    """The coordinator prompt's documented heading is
    '## Remaining Issues (only if not_approved_within_budget)'. The parser
    must accept it as the remaining-issues block."""

    def _run_temp(self, content):
        path = write_temp_summary(content)
        try:
            rc, stdout, stderr = run_script("--summary", path)
        finally:
            os.unlink(path)
        return rc, stdout, stderr

    def test_documented_heading_parses_remaining_issues(self):
        content = (
            "STATUS: not_approved_within_budget\n\n"
            "## Summary\nIterations: 3\nIssues found: 2 (1 Critical, 1 Important, 0 Minor)\n"
            "Issues fixed: 0\nIssues remaining: 2\n\n"
            "## Remaining Issues (only if not_approved_within_budget)\n"
            "[Critical] tests/foo.py:42 — flaky test\n"
            "[Important] tests/bar.py:13 — missing assertion\n\n"
            "## Review File\ndocs/reviews/sample-code-review-v3.md\n"
        )
        rc, stdout, stderr = self._run_temp(content)
        self.assertEqual(rc, 0, stderr)
        data = parse_stdout(stdout)
        self.assertIsNotNone(data["remaining_issues"])
        self.assertIn("[Critical] tests/foo.py:42", data["remaining_issues"])
        self.assertIn("[Important] tests/bar.py:13", data["remaining_issues"])

    def test_documented_heading_unexpected_for_non_budget_status(self):
        content = (
            "STATUS: approved\n\n"
            "## Summary\nIterations: 1\nIssues found: 0 (0 Critical, 0 Important, 0 Minor)\n"
            "Issues fixed: 0\nIssues remaining: 0\n\n"
            "## Remaining Issues (only if not_approved_within_budget)\n"
            "[Critical] foo.py:1 — bad\n\n"
            "## Review File\nsome/path.md\n"
        )
        rc, stdout, stderr = self._run_temp(content)
        self.assertNotEqual(rc, 0)
        err = parse_stderr(stderr)
        self.assertEqual(err["failure"], "unexpected_remaining_issues")


class TestFencedH2InRemainingIssues(unittest.TestCase):
    """Fenced ## lines inside ## Remaining Issues must not split the section."""

    def _run_temp(self, content):
        path = write_temp_summary(content)
        try:
            rc, stdout, stderr = run_script("--summary", path)
        finally:
            os.unlink(path)
        return rc, stdout, stderr

    def test_fenced_h2_preserved_and_real_review_file_parsed(self):
        content = (
            "STATUS: not_approved_within_budget\n\n"
            "## Summary\n"
            "Iterations: 1\n"
            "Issues found: 2 (1 Critical, 1 Important, 0 Minor)\n"
            "Issues fixed: 0\n"
            "Issues remaining: 2\n\n"
            "## Remaining Issues\n"
            "[Critical] tests/foo.py:42 — flaky test\n\n"
            "```markdown\n"
            "## Review File\n"
            "docs/reviews/fake.md\n"
            "```\n\n"
            "[Important] tests/bar.py:13 — missing assertion\n\n"
            "## Review File\n"
            "docs/reviews/sample-code-review-v3.md\n"
        )
        rc, stdout, stderr = self._run_temp(content)
        self.assertEqual(rc, 0, stderr)
        data = parse_stdout(stdout)
        self.assertIn("[Critical] tests/foo.py:42", data["remaining_issues"])
        self.assertIn("[Important] tests/bar.py:13", data["remaining_issues"])
        self.assertIn("## Review File", data["remaining_issues"])
        self.assertEqual(data["review_file"], "docs/reviews/sample-code-review-v3.md")


class TestFencedH2InSummary(unittest.TestCase):
    """Fenced ## lines inside ## Summary must not break field parsing."""

    def _run_temp(self, content):
        path = write_temp_summary(content)
        try:
            rc, stdout, stderr = run_script("--summary", path)
        finally:
            os.unlink(path)
        return rc, stdout, stderr

    def test_fenced_h2_in_summary_does_not_break_parser(self):
        content = (
            "STATUS: approved\n\n"
            "## Summary\n"
            "Iterations: 2\n"
            "Issues found: 3 (1 Critical, 1 Important, 1 Minor)\n"
            "Issues fixed: 2\n"
            "Issues remaining: 1\n\n"
            "```markdown\n"
            "## Review File\n"
            "docs/reviews/fake-embedded.md\n"
            "```\n\n"
            "## Review File\n"
            "docs/reviews/real-review.md\n"
        )
        rc, stdout, stderr = self._run_temp(content)
        self.assertEqual(rc, 0, stderr)
        data = parse_stdout(stdout)
        self.assertIsNotNone(data)
        self.assertEqual(data["iterations"], 2)
        self.assertEqual(data["issues_found_critical"], 1)
        self.assertEqual(data["issues_found_important"], 1)
        self.assertEqual(data["issues_found_minor"], 1)
        self.assertEqual(data["issues_fixed"], 2)
        self.assertEqual(data["issues_remaining"], 1)
        self.assertEqual(data["review_file"], "docs/reviews/real-review.md")


class TestFencedFakeFieldsInSummary(unittest.TestCase):
    """Fake summary field labels inside a fenced block must not override real values."""

    def _run_temp(self, content):
        path = write_temp_summary(content)
        try:
            rc, stdout, stderr = run_script("--summary", path)
        finally:
            os.unlink(path)
        return rc, stdout, stderr

    def test_fenced_fake_fields_after_real_do_not_override(self):
        content = (
            "STATUS: approved\n\n"
            "## Summary\n"
            "Iterations: 2\n"
            "Issues found: 5 (1 Critical, 2 Important, 2 Minor)\n"
            "Issues fixed: 3\n"
            "Issues remaining: 2\n\n"
            "```\n"
            "Iterations: 99\n"
            "Issues found: 99 (99 Critical, 99 Important, 99 Minor)\n"
            "Issues fixed: 99\n"
            "Issues remaining: 99\n"
            "```\n\n"
            "## Review File\n"
            "docs/reviews/real-review.md\n"
        )
        rc, stdout, stderr = self._run_temp(content)
        self.assertEqual(rc, 0, stderr)
        data = parse_stdout(stdout)
        self.assertIsNotNone(data)
        self.assertEqual(data["iterations"], 2)
        self.assertEqual(data["issues_found_total"], 5)
        self.assertEqual(data["issues_found_critical"], 1)
        self.assertEqual(data["issues_found_important"], 2)
        self.assertEqual(data["issues_found_minor"], 2)
        self.assertEqual(data["issues_fixed"], 3)
        self.assertEqual(data["issues_remaining"], 2)


if __name__ == "__main__":
    unittest.main()
