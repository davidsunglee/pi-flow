"""Tests for parse-coder-report.py"""
import json
import os
import subprocess
import sys
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "parse-coder-report.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def run_script(*args):
    """Run the script with given args; return (returncode, stdout_json, stdout_raw, stderr_raw)."""
    result = subprocess.run(
        [sys.executable, SCRIPT] + list(args),
        capture_output=True,
        text=True,
    )
    try:
        stdout_data = json.loads(result.stdout)
    except json.JSONDecodeError:
        stdout_data = None
    try:
        stderr_data = json.loads(result.stderr)
    except json.JSONDecodeError:
        stderr_data = None
    return result.returncode, stdout_data, stderr_data, result.stdout, result.stderr


def fixture(name):
    return os.path.join(FIXTURES, name)


class TestDoneReport(unittest.TestCase):
    def setUp(self):
        self.rc, self.data, self.stderr_data, self.stdout, self.stderr = run_script(
            "--report", fixture("coder-report-done.md")
        )

    def test_exit_0(self):
        self.assertEqual(self.rc, 0)

    def test_status_done(self):
        self.assertEqual(self.data["status"], "DONE")

    def test_files_changed_length_2(self):
        self.assertEqual(len(self.data["files_changed"]), 2)

    def test_files_changed_paths_in_order(self):
        self.assertEqual(
            self.data["files_changed"][0],
            "agent/skills/execute-plan/scripts/parse-coder-report.py",
        )
        self.assertEqual(
            self.data["files_changed"][1],
            "agent/skills/execute-plan/scripts/tests/test_parse_coder_report.py",
        )

    def test_completed_block_nonempty(self):
        self.assertTrue(self.data["completed_block"].strip())

    def test_protocol_warnings_empty(self):
        self.assertEqual(self.data["protocol_warnings"], [])

    def test_blocker_text_null(self):
        self.assertIsNone(self.data["blocker_text"])

    def test_needs_text_null(self):
        self.assertIsNone(self.data["needs_text"])


class TestDoneWithConcerns(unittest.TestCase):
    def setUp(self):
        self.rc, self.data, self.stderr_data, self.stdout, self.stderr = run_script(
            "--report", fixture("coder-report-done-with-concerns.md")
        )

    def test_exit_0(self):
        self.assertEqual(self.rc, 0)

    def test_status(self):
        self.assertEqual(self.data["status"], "DONE_WITH_CONCERNS")

    def test_concerns_block_nonempty(self):
        self.assertTrue(self.data["concerns_block"].strip())

    def test_no_concerns_block_missing_warning(self):
        self.assertNotIn("concerns_block_missing", self.data["protocol_warnings"])


class TestBlocked(unittest.TestCase):
    def setUp(self):
        self.rc, self.data, self.stderr_data, self.stdout, self.stderr = run_script(
            "--report", fixture("coder-report-blocked.md")
        )

    def test_exit_0(self):
        self.assertEqual(self.rc, 0)

    def test_status(self):
        self.assertEqual(self.data["status"], "BLOCKED")

    def test_blocker_text_nonempty(self):
        self.assertTrue(self.data["blocker_text"].strip())

    def test_needs_text_null(self):
        self.assertIsNone(self.data["needs_text"])


class TestNeedsContext(unittest.TestCase):
    def setUp(self):
        self.rc, self.data, self.stderr_data, self.stdout, self.stderr = run_script(
            "--report", fixture("coder-report-needs-context.md")
        )

    def test_exit_0(self):
        self.assertEqual(self.rc, 0)

    def test_status(self):
        self.assertEqual(self.data["status"], "NEEDS_CONTEXT")

    def test_needs_text_nonempty(self):
        self.assertTrue(self.data["needs_text"].strip())

    def test_blocker_text_null(self):
        self.assertIsNone(self.data["blocker_text"])


class TestMissingStatus(unittest.TestCase):
    def setUp(self):
        self.rc, self.data, self.stderr_data, self.stdout, self.stderr = run_script(
            "--report", fixture("coder-report-no-status.md")
        )

    def test_exit_nonzero(self):
        self.assertNotEqual(self.rc, 0)

    def test_stderr_failure_status_line_missing(self):
        self.assertIsNotNone(self.stderr_data)
        self.assertEqual(self.stderr_data["failure"], "status_line_missing")


class TestInvalidStatusToken(unittest.TestCase):
    def setUp(self):
        self.rc, self.data, self.stderr_data, self.stdout, self.stderr = run_script(
            "--report", fixture("coder-report-bad-status.md")
        )

    def test_exit_nonzero(self):
        self.assertNotEqual(self.rc, 0)

    def test_stderr_failure_status_token_invalid(self):
        self.assertIsNotNone(self.stderr_data)
        self.assertEqual(self.stderr_data["failure"], "status_token_invalid")

    def test_stderr_token_value(self):
        self.assertEqual(self.stderr_data["token"], "COMPLETED")


class TestConcernsMissing(unittest.TestCase):
    def setUp(self):
        self.rc, self.data, self.stderr_data, self.stdout, self.stderr = run_script(
            "--report", fixture("coder-report-concerns-missing.md")
        )

    def test_exit_0(self):
        self.assertEqual(self.rc, 0)

    def test_protocol_warnings_contains_concerns_block_missing(self):
        self.assertIn("concerns_block_missing", self.data["protocol_warnings"])


class TestBulletWithoutBackticks(unittest.TestCase):
    """Bullets without backticks should be silently skipped in files_changed."""

    def test_bullet_without_backticks_skipped(self):
        import tempfile

        content = """STATUS: DONE

## Completed
Done.

## Tests
Pass.

## Files Changed
- file.ts — note without backticks
- `path/to/real.py` — with backticks

## Self-Review Findings
None.
"""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".md", delete=False
        ) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, _, _, _ = run_script("--report", tmp)
            self.assertEqual(rc, 0)
            self.assertEqual(data["files_changed"], ["path/to/real.py"])
            self.assertEqual(data["protocol_warnings"], [])
        finally:
            os.unlink(tmp)


class TestFencedH2InCompleted(unittest.TestCase):
    """Fenced ## lines inside ## Completed must not truncate that section."""

    def test_fenced_heading_stays_in_completed_and_real_tests_found(self):
        import tempfile

        content = (
            "STATUS: DONE\n"
            "\n"
            "## Completed\n"
            "Implemented foo.\n"
            "\n"
            "```markdown\n"
            "## Tests\n"
            "Fake nested heading inside a fence.\n"
            "```\n"
            "\n"
            "More text after the fence.\n"
            "\n"
            "## Tests\n"
            "Real tests block.\n"
            "\n"
            "## Files Changed\n"
            "- `path/to/real.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, _, _, _ = run_script("--report", tmp)
            self.assertEqual(rc, 0)
            self.assertIn("Implemented foo.", data["completed_block"])
            self.assertIn("More text after the fence.", data["completed_block"])
            self.assertIn("## Tests", data["completed_block"])
            self.assertEqual(data["tests_block"].strip(), "Real tests block.")
        finally:
            os.unlink(tmp)


class TestFencedH2InSelfReview(unittest.TestCase):
    """Fenced ## lines inside ## Self-Review Findings must not truncate that section."""

    def test_fenced_concerns_heading_stays_in_self_review(self):
        import tempfile

        content = (
            "STATUS: DONE\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "Looks good.\n"
            "\n"
            "```\n"
            "## Concerns / Needs / Blocker\n"
            "Fake concern inside a fence.\n"
            "```\n"
            "\n"
            "More self-review text.\n"
            "\n"
            "## Concerns / Needs / Blocker\n"
            "Real concern here.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, _, _, _ = run_script("--report", tmp)
            self.assertEqual(rc, 0)
            self.assertIn("## Concerns / Needs / Blocker", data["self_review_block"])
            self.assertEqual(data["concerns_block"].strip(), "Real concern here.")
        finally:
            os.unlink(tmp)


class TestFencedH2InConcerns(unittest.TestCase):
    """Fenced ## lines inside ## Concerns / Needs / Blocker must not truncate that section."""

    def test_fenced_files_changed_stays_in_concerns(self):
        import tempfile

        content = (
            "STATUS: DONE_WITH_CONCERNS\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
            "\n"
            "## Concerns / Needs / Blocker\n"
            "Some concern.\n"
            "\n"
            "```\n"
            "## Files Changed\n"
            "- `fake/path.py`\n"
            "```\n"
            "\n"
            "More concern text.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, _, _, _ = run_script("--report", tmp)
            self.assertEqual(rc, 0)
            self.assertIn("## Files Changed", data["concerns_block"])
            self.assertEqual(data["files_changed"], ["real/file.py"])
        finally:
            os.unlink(tmp)


class TestFencedH2InTests(unittest.TestCase):
    """Fenced ## lines inside ## Tests must not truncate that section."""

    def test_fenced_self_review_heading_stays_in_tests(self):
        import tempfile

        content = (
            "STATUS: DONE\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "All passed.\n"
            "\n"
            "```\n"
            "## Self-Review Findings\n"
            "Fake heading in pytest output.\n"
            "```\n"
            "\n"
            "More test output.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "Real self-review text.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, _, _, _ = run_script("--report", tmp)
            self.assertEqual(rc, 0)
            self.assertIn("## Self-Review Findings", data["tests_block"])
            self.assertEqual(data["self_review_block"].strip(), "Real self-review text.")
        finally:
            os.unlink(tmp)


class TestFencedStatusBeforeRealStatus(unittest.TestCase):
    """A fenced fake STATUS: line before the real STATUS: line must not be accepted."""

    def test_fenced_blocked_before_real_done_uses_real_status(self):
        import tempfile

        content = (
            "```\n"
            "STATUS: BLOCKED\n"
            "Fake fenced status above the real one.\n"
            "```\n"
            "\n"
            "STATUS: DONE\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, stderr_data, _, _ = run_script("--report", tmp)
            self.assertEqual(rc, 0)
            self.assertEqual(data["status"], "DONE")
        finally:
            os.unlink(tmp)


class TestOnlyFencedStatus(unittest.TestCase):
    """A fenced STATUS: line with no real STATUS: line must fail closed."""

    def test_only_fenced_status_fails_closed_with_status_line_missing(self):
        import tempfile

        content = (
            "Some preamble.\n"
            "\n"
            "```\n"
            "STATUS: DONE\n"
            "Fake fenced status, no real status anywhere else.\n"
            "```\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, stderr_data, _, stderr = run_script("--report", tmp)
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(stderr_data, f"stderr was not JSON: {stderr!r}")
            self.assertEqual(stderr_data["failure"], "status_line_missing")
        finally:
            os.unlink(tmp)


class TestFencedFilesChangedBullet(unittest.TestCase):
    """Fenced `- `path`` bullets inside ## Files Changed must not be picked up as real changed files."""

    def test_fenced_fake_bullet_excluded_from_files_changed(self):
        import tempfile

        content = (
            "STATUS: DONE\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "```\n"
            "- `fake/path.py`\n"
            "```\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, _, _, _ = run_script("--report", tmp)
            self.assertEqual(rc, 0)
            self.assertEqual(data["files_changed"], ["real/file.py"])
        finally:
            os.unlink(tmp)


class TestStatusHeadingPrefixTolerance(unittest.TestCase):
    """Tests for accepting optional Markdown heading markers before STATUS line."""

    def test_h2_status_done_parses(self):
        import tempfile

        content = (
            "## STATUS: DONE\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, _, _, _ = run_script("--report", tmp)
            self.assertEqual(rc, 0)
            self.assertEqual(data["status"], "DONE")
        finally:
            os.unlink(tmp)

    def test_h3_status_blocked_parses(self):
        import tempfile

        content = (
            "### STATUS: BLOCKED\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, _, _, _ = run_script("--report", tmp)
            self.assertEqual(rc, 0)
            self.assertEqual(data["status"], "BLOCKED")
        finally:
            os.unlink(tmp)

    def test_h6_status_done_with_concerns_parses(self):
        import tempfile

        content = (
            "###### STATUS: DONE_WITH_CONCERNS\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
            "\n"
            "## Concerns / Needs / Blocker\n"
            "Some concern.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, _, _, _ = run_script("--report", tmp)
            self.assertEqual(rc, 0)
            self.assertEqual(data["status"], "DONE_WITH_CONCERNS")
        finally:
            os.unlink(tmp)

    def test_fenced_h2_status_still_fails(self):
        import tempfile

        content = (
            "Some preamble.\n"
            "\n"
            "```\n"
            "## STATUS: DONE\n"
            "Fake fenced status inside fence.\n"
            "```\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, stderr_data, _, stderr = run_script("--report", tmp)
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(stderr_data, f"stderr was not JSON: {stderr!r}")
            self.assertEqual(stderr_data["failure"], "status_line_missing")
        finally:
            os.unlink(tmp)

    def test_h7_status_not_accepted(self):
        import tempfile

        content = (
            "####### STATUS: DONE\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, stderr_data, _, stderr = run_script("--report", tmp)
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(stderr_data, f"stderr was not JSON: {stderr!r}")
            self.assertEqual(stderr_data["failure"], "status_line_missing")
        finally:
            os.unlink(tmp)

    def test_h2_status_unknown_token_still_fails(self):
        import tempfile

        content = (
            "## STATUS: BOGUS\n"
            "\n"
            "## Completed\n"
            "Done.\n"
            "\n"
            "## Tests\n"
            "Pass.\n"
            "\n"
            "## Files Changed\n"
            "- `real/file.py`\n"
            "\n"
            "## Self-Review Findings\n"
            "None.\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(content)
            tmp = f.name

        try:
            rc, data, stderr_data, _, _ = run_script("--report", tmp)
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(stderr_data)
            self.assertEqual(stderr_data["failure"], "status_token_invalid")
        finally:
            os.unlink(tmp)


if __name__ == "__main__":
    unittest.main()
