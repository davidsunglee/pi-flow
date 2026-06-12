"""Tests for parse-test-runner-artifact.py"""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "parse-test-runner-artifact.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def run_script(*args):
    result = subprocess.run(
        [sys.executable, SCRIPT] + list(args),
        capture_output=True,
        text=True,
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = None
    return result.returncode, data, result.stdout, result.stderr


def fixture(name):
    return os.path.join(FIXTURES, name)


def write_temp_artifact(content):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
    f.write(content)
    f.close()
    return f.name


def write_temp_message(content):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
    f.write(content)
    f.close()
    return f.name


CLEAN_ARTIFACT = """\
PHASE: baseline
COMMAND: npm test
WORKING_DIRECTORY: /tmp/project
EXIT_CODE: 0
TIMESTAMP: 2026-05-01T10:00:00Z
FAILING_IDENTIFIERS_COUNT: 0
FAILING_IDENTIFIERS:
END_FAILING_IDENTIFIERS
NON_RECONCILABLE_COUNT: 0
NON_RECONCILABLE_FAILURES:
END_NON_RECONCILABLE_FAILURES

--- RAW RUN OUTPUT BELOW ---
All tests passed.
"""


class TestCleanArtifact(unittest.TestCase):
    def test_clean_artifact_parses(self):
        rc, data, _, _ = run_script("--artifact", fixture("test-runner-artifact-clean.txt"))
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["exit_code"], 0)
        self.assertEqual(data["failing_identifiers"], [])
        self.assertEqual(data["non_reconcilable_failures"], [])


class TestStableFailures(unittest.TestCase):
    def test_stable_failures_only(self):
        rc, data, _, _ = run_script("--artifact", fixture("test-runner-artifact-stable-failures.txt"))
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["failing_identifiers"], ["tests/test_a.py::test_one", "tests/test_b.py::test_two"])
        self.assertEqual(data["non_reconcilable_failures"], [])


class TestNonReconcilable(unittest.TestCase):
    def test_non_reconcilable_only(self):
        rc, data, _, _ = run_script("--artifact", fixture("test-runner-artifact-non-reconcilable.txt"))
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["failing_identifiers"], ["tests/test_c.py::test_three"])
        self.assertEqual(len(data["non_reconcilable_failures"]), 2)
        self.assertIn("ImportError", data["non_reconcilable_failures"][0])
        self.assertIn("SyntaxError", data["non_reconcilable_failures"][1])
        # Entries are multi-line and preserved verbatim
        self.assertIn("\n", data["non_reconcilable_failures"][0])
        self.assertIn("\n", data["non_reconcilable_failures"][1])

    def test_single_composite_non_reconcilable_preserves_internal_blank_lines(self):
        content = (
            "PHASE: baseline\n"
            "COMMAND: pnpm test\n"
            "WORKING_DIRECTORY: /tmp/project\n"
            "EXIT_CODE: 1\n"
            "TIMESTAMP: 2026-05-01T10:00:00Z\n"
            "FAILING_IDENTIFIERS_COUNT: 0\n"
            "FAILING_IDENTIFIERS:\n"
            "END_FAILING_IDENTIFIERS\n"
            "NON_RECONCILABLE_COUNT: 1\n"
            "NON_RECONCILABLE_FAILURES:\n"
            "[ERR_PNPM_NO_PKG_MANIFEST] No package.json found\n"
            "[ERROR] Command failed with exit code 1: pnpm install\n"
            "\n"
            "pnpm: Command failed with exit code 1: pnpm install\n"
            "    at getFinalError (pnpm.mjs:1:1)\n"
            "\n"
            "Command exited with code 1\n"
            "END_NON_RECONCILABLE_FAILURES\n"
            "\n"
            "--- RAW RUN OUTPUT BELOW ---\n"
            "raw output\n"
        )
        path = write_temp_artifact(content)
        try:
            rc, data, _, _ = run_script("--artifact", path)
            self.assertEqual(rc, 0)
            self.assertIsNotNone(data)
            self.assertEqual(data["non_reconcilable_count"], 1)
            self.assertEqual(len(data["non_reconcilable_failures"]), 1)
            self.assertIn("\n\npnpm: Command failed", data["non_reconcilable_failures"][0])
            self.assertIn("\n\nCommand exited with code 1", data["non_reconcilable_failures"][0])
        finally:
            os.unlink(path)


class TestBothBucketsPopulated(unittest.TestCase):
    def test_both_buckets_populated(self):
        rc, data, _, _ = run_script("--artifact", fixture("test-runner-artifact-non-reconcilable.txt"))
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertGreater(len(data["failing_identifiers"]), 0)
        self.assertGreater(len(data["non_reconcilable_failures"]), 0)


class TestSuccessJsonShape(unittest.TestCase):
    def test_success_json_includes_count_fields(self):
        content = (
            "PHASE: baseline\n"
            "COMMAND: pytest\n"
            "WORKING_DIRECTORY: /tmp\n"
            "EXIT_CODE: 1\n"
            "TIMESTAMP: 2026-05-01T10:00:00Z\n"
            "FAILING_IDENTIFIERS_COUNT: 3\n"
            "FAILING_IDENTIFIERS:\n"
            "tests/test_a.py::test_one\n"
            "tests/test_b.py::test_two\n"
            "tests/test_a.py::test_one\n"
            "END_FAILING_IDENTIFIERS\n"
            "NON_RECONCILABLE_COUNT: 1\n"
            "NON_RECONCILABLE_FAILURES:\n"
            "Some error\n"
            "END_NON_RECONCILABLE_FAILURES\n"
            "\n"
            "--- RAW RUN OUTPUT BELOW ---\n"
            "output\n"
        )
        path = write_temp_artifact(content)
        try:
            rc, data, _, _ = run_script("--artifact", path)
            self.assertEqual(rc, 0)
            self.assertIsNotNone(data)
            # Declared counts must be preserved separately from list lengths.
            self.assertEqual(data["failing_identifiers_count"], 3)
            self.assertEqual(data["non_reconcilable_count"], 1)
            # Deduplicated list length differs from declared count.
            self.assertEqual(len(data["failing_identifiers"]), 2)
            # Full documented shape
            self.assertEqual(
                set(data.keys()),
                {
                    "phase",
                    "command",
                    "working_directory",
                    "exit_code",
                    "timestamp",
                    "failing_identifiers_count",
                    "failing_identifiers",
                    "non_reconcilable_count",
                    "non_reconcilable_failures",
                    "used_fallback",
                },
            )
        finally:
            os.unlink(path)


class TestDuplicateIdentifierDedupes(unittest.TestCase):
    def test_duplicate_identifier_dedupes(self):
        content = (
            "PHASE: baseline\n"
            "COMMAND: pytest\n"
            "WORKING_DIRECTORY: /tmp\n"
            "EXIT_CODE: 1\n"
            "TIMESTAMP: 2026-05-01T10:00:00Z\n"
            "FAILING_IDENTIFIERS_COUNT: 3\n"
            "FAILING_IDENTIFIERS:\n"
            "tests/test_a.py::test_one\n"
            "tests/test_b.py::test_two\n"
            "tests/test_a.py::test_one\n"
            "END_FAILING_IDENTIFIERS\n"
            "NON_RECONCILABLE_COUNT: 0\n"
            "NON_RECONCILABLE_FAILURES:\n"
            "END_NON_RECONCILABLE_FAILURES\n"
            "\n"
            "--- RAW RUN OUTPUT BELOW ---\n"
            "output\n"
        )
        path = write_temp_artifact(content)
        try:
            rc, data, _, _ = run_script("--artifact", path)
            self.assertEqual(rc, 0)
            self.assertIsNotNone(data)
            # COUNT=3 matches raw line count → passes validation
            # Deduplicated output preserves first-occurrence order
            self.assertEqual(data["failing_identifiers"], ["tests/test_a.py::test_one", "tests/test_b.py::test_two"])
        finally:
            os.unlink(path)


class TestHeaderOutOfOrder(unittest.TestCase):
    def test_header_out_of_order(self):
        rc, _, _, stderr = run_script("--artifact", fixture("test-runner-artifact-out-of-order.txt"))
        self.assertNotEqual(rc, 0)
        err = json.loads(stderr)
        self.assertEqual(err["failure"], "header_out_of_order")


class TestHeaderMissing(unittest.TestCase):
    def test_header_missing(self):
        # Omit TIMESTAMP
        content = (
            "PHASE: baseline\n"
            "COMMAND: npm test\n"
            "WORKING_DIRECTORY: /tmp/project\n"
            "EXIT_CODE: 0\n"
            "FAILING_IDENTIFIERS_COUNT: 0\n"
            "FAILING_IDENTIFIERS:\n"
            "END_FAILING_IDENTIFIERS\n"
            "NON_RECONCILABLE_COUNT: 0\n"
            "NON_RECONCILABLE_FAILURES:\n"
            "END_NON_RECONCILABLE_FAILURES\n"
            "\n"
            "--- RAW RUN OUTPUT BELOW ---\n"
        )
        path = write_temp_artifact(content)
        try:
            rc, _, _, stderr = run_script("--artifact", path)
            self.assertNotEqual(rc, 0)
            err = json.loads(stderr)
            self.assertEqual(err["failure"], "header_missing")
        finally:
            os.unlink(path)


class TestExitCodeMalformed(unittest.TestCase):
    def test_exit_code_malformed(self):
        content = (
            "PHASE: baseline\n"
            "COMMAND: npm test\n"
            "WORKING_DIRECTORY: /tmp/project\n"
            "EXIT_CODE: not-an-int\n"
            "TIMESTAMP: 2026-05-01T10:00:00Z\n"
            "FAILING_IDENTIFIERS_COUNT: 0\n"
            "FAILING_IDENTIFIERS:\n"
            "END_FAILING_IDENTIFIERS\n"
            "NON_RECONCILABLE_COUNT: 0\n"
            "NON_RECONCILABLE_FAILURES:\n"
            "END_NON_RECONCILABLE_FAILURES\n"
            "\n"
            "--- RAW RUN OUTPUT BELOW ---\n"
        )
        path = write_temp_artifact(content)
        try:
            rc, _, _, stderr = run_script("--artifact", path)
            self.assertNotEqual(rc, 0)
            err = json.loads(stderr)
            self.assertEqual(err["failure"], "exit_code_malformed")
        finally:
            os.unlink(path)


class TestCountFieldMalformed(unittest.TestCase):
    def test_count_field_malformed(self):
        content = (
            "PHASE: baseline\n"
            "COMMAND: npm test\n"
            "WORKING_DIRECTORY: /tmp/project\n"
            "EXIT_CODE: 0\n"
            "TIMESTAMP: 2026-05-01T10:00:00Z\n"
            "FAILING_IDENTIFIERS_COUNT: not-an-int\n"
            "FAILING_IDENTIFIERS:\n"
            "END_FAILING_IDENTIFIERS\n"
            "NON_RECONCILABLE_COUNT: 0\n"
            "NON_RECONCILABLE_FAILURES:\n"
            "END_NON_RECONCILABLE_FAILURES\n"
            "\n"
            "--- RAW RUN OUTPUT BELOW ---\n"
        )
        path = write_temp_artifact(content)
        try:
            rc, _, _, stderr = run_script("--artifact", path)
            self.assertNotEqual(rc, 0)
            err = json.loads(stderr)
            self.assertEqual(err["failure"], "count_field_malformed")
        finally:
            os.unlink(path)


class TestArtifactMissingOrEmpty(unittest.TestCase):
    def test_artifact_missing_or_empty(self):
        rc, _, _, stderr = run_script("--artifact", "/nonexistent/path/artifact.txt")
        self.assertNotEqual(rc, 0)
        err = json.loads(stderr)
        self.assertEqual(err["failure"], "artifact_missing_or_empty")

    def test_artifact_empty_file(self):
        path = write_temp_artifact("")
        try:
            rc, _, _, stderr = run_script("--artifact", path)
            self.assertNotEqual(rc, 0)
            err = json.loads(stderr)
            self.assertEqual(err["failure"], "artifact_missing_or_empty")
        finally:
            os.unlink(path)


class TestFailingIdentifiersCountMismatch(unittest.TestCase):
    def test_failing_identifiers_count_mismatch(self):
        rc, _, _, stderr = run_script("--artifact", fixture("test-runner-artifact-count-mismatch.txt"))
        self.assertNotEqual(rc, 0)
        err = json.loads(stderr)
        self.assertEqual(err["failure"], "failing_identifiers_count_mismatch")


class TestNonReconcilableCountMismatch(unittest.TestCase):
    def test_non_reconcilable_count_mismatch(self):
        # NON_RECONCILABLE_COUNT=3 but only 1 entry provided
        content = (
            "PHASE: baseline\n"
            "COMMAND: pytest\n"
            "WORKING_DIRECTORY: /tmp\n"
            "EXIT_CODE: 1\n"
            "TIMESTAMP: 2026-05-01T10:00:00Z\n"
            "FAILING_IDENTIFIERS_COUNT: 0\n"
            "FAILING_IDENTIFIERS:\n"
            "END_FAILING_IDENTIFIERS\n"
            "NON_RECONCILABLE_COUNT: 3\n"
            "NON_RECONCILABLE_FAILURES:\n"
            "Some error occurred\n"
            "END_NON_RECONCILABLE_FAILURES\n"
            "\n"
            "--- RAW RUN OUTPUT BELOW ---\n"
            "output\n"
        )
        path = write_temp_artifact(content)
        try:
            rc, _, _, stderr = run_script("--artifact", path)
            self.assertNotEqual(rc, 0)
            err = json.loads(stderr)
            self.assertEqual(err["failure"], "non_reconcilable_count_mismatch")
        finally:
            os.unlink(path)


class TestRawOutputMarkerMissing(unittest.TestCase):
    def test_raw_output_marker_missing(self):
        rc, _, _, stderr = run_script("--artifact", fixture("test-runner-artifact-missing-marker.txt"))
        self.assertNotEqual(rc, 0)
        err = json.loads(stderr)
        self.assertEqual(err["failure"], "raw_output_marker_missing")


class TestRawOutputExcludedFromJson(unittest.TestCase):
    def test_raw_output_excluded_from_json(self):
        content = (
            "PHASE: baseline\n"
            "COMMAND: npm test\n"
            "WORKING_DIRECTORY: /tmp/project\n"
            "EXIT_CODE: 0\n"
            "TIMESTAMP: 2026-05-01T10:00:00Z\n"
            "FAILING_IDENTIFIERS_COUNT: 0\n"
            "FAILING_IDENTIFIERS:\n"
            "END_FAILING_IDENTIFIERS\n"
            "NON_RECONCILABLE_COUNT: 0\n"
            "NON_RECONCILABLE_FAILURES:\n"
            "END_NON_RECONCILABLE_FAILURES\n"
            "\n"
            "--- RAW RUN OUTPUT BELOW ---\n"
            "__SHOULD_NOT_APPEAR_IN_JSON__\n"
            "more raw output here\n"
        )
        path = write_temp_artifact(content)
        try:
            rc, _, stdout, _ = run_script("--artifact", path)
            self.assertEqual(rc, 0)
            self.assertNotIn("__SHOULD_NOT_APPEAR_IN_JSON__", stdout)
        finally:
            os.unlink(path)


class TestFinalMessageHandoffCheck(unittest.TestCase):
    def test_with_final_message_handoff_check(self):
        artifact_path = write_temp_artifact(CLEAN_ARTIFACT)
        message_content = f"Some preamble.\nTEST_RESULT_ARTIFACT: {artifact_path}\n"
        message_path = write_temp_message(message_content)
        try:
            rc, data, _, _ = run_script(
                "--artifact", artifact_path,
                "--final-message", message_path,
                "--expected-path", artifact_path,
            )
            self.assertEqual(rc, 0)
            self.assertIsNotNone(data)
            self.assertEqual(data["exit_code"], 0)
        finally:
            os.unlink(artifact_path)
            os.unlink(message_path)

    def test_with_final_message_handoff_check_marker_missing(self):
        artifact_path = write_temp_artifact(CLEAN_ARTIFACT)
        message_content = "Some preamble without the marker.\n"
        message_path = write_temp_message(message_content)
        try:
            rc, _, _, stderr = run_script(
                "--artifact", artifact_path,
                "--final-message", message_path,
                "--expected-path", artifact_path,
            )
            self.assertNotEqual(rc, 0)
            self.assertIn("missing TEST_RESULT_ARTIFACT marker", stderr)
        finally:
            os.unlink(artifact_path)
            os.unlink(message_path)


class TestNoPhaseFixture(unittest.TestCase):
    def test_no_phase_fixture_parses_with_phase_none(self):
        rc, data, _, _ = run_script("--artifact", fixture("test-runner-artifact-no-phase.txt"))
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertIsNone(data["phase"])
        self.assertEqual(data["exit_code"], 0)


class TestMalformedPhaseFixture(unittest.TestCase):
    def test_malformed_phase_fixture_rejected(self):
        rc, _, _, stderr = run_script("--artifact", fixture("test-runner-artifact-malformed-phase.txt"))
        self.assertNotEqual(rc, 0)
        err = json.loads(stderr)
        self.assertEqual(err["failure"], "header_missing")


class TestNoPhaseInlineContent(unittest.TestCase):
    def test_no_phase_inline_produces_phase_null(self):
        content = (
            "COMMAND: npm test\n"
            "WORKING_DIRECTORY: /tmp/project\n"
            "EXIT_CODE: 0\n"
            "TIMESTAMP: 2026-05-01T10:00:00Z\n"
            "FAILING_IDENTIFIERS_COUNT: 0\n"
            "FAILING_IDENTIFIERS:\n"
            "END_FAILING_IDENTIFIERS\n"
            "NON_RECONCILABLE_COUNT: 0\n"
            "NON_RECONCILABLE_FAILURES:\n"
            "END_NON_RECONCILABLE_FAILURES\n"
            "\n"
            "--- RAW RUN OUTPUT BELOW ---\n"
            "output\n"
        )
        path = write_temp_artifact(content)
        try:
            rc, data, stdout, _ = run_script("--artifact", path)
            self.assertEqual(rc, 0)
            self.assertIsNotNone(data)
            self.assertIsNone(data["phase"])
            self.assertIn('"phase": null', stdout)
        finally:
            os.unlink(path)


class TestFinalMessageHandoffFallback(unittest.TestCase):
    def test_missing_marker_fresh_artifact_succeeds(self):
        artifact_path = write_temp_artifact(CLEAN_ARTIFACT)
        artifact_mtime = os.path.getmtime(artifact_path)
        message_content = "Some preamble.\n"
        message_path = write_temp_message(message_content)
        baseline = artifact_mtime - 60
        try:
            rc, data, _, _ = run_script(
                "--artifact", artifact_path,
                "--final-message", message_path,
                "--expected-path", artifact_path,
                "--freshness-baseline", str(baseline),
            )
            self.assertEqual(rc, 0)
            self.assertIsNotNone(data)
            self.assertEqual(data["exit_code"], 0)
            self.assertEqual(data["failing_identifiers"], [])
            self.assertTrue(data.get("used_fallback"))
        finally:
            os.unlink(artifact_path)
            os.unlink(message_path)

    def test_missing_marker_stale_artifact_fails(self):
        artifact_path = write_temp_artifact(CLEAN_ARTIFACT)
        artifact_mtime = os.path.getmtime(artifact_path)
        message_content = "Some preamble.\n"
        message_path = write_temp_message(message_content)
        baseline = artifact_mtime + 60
        try:
            rc, _, _, stderr = run_script(
                "--artifact", artifact_path,
                "--final-message", message_path,
                "--expected-path", artifact_path,
                "--freshness-baseline", str(baseline),
            )
            self.assertNotEqual(rc, 0)
            self.assertIn("missing TEST_RESULT_ARTIFACT marker", stderr)
        finally:
            os.unlink(artifact_path)
            os.unlink(message_path)

    def test_missing_marker_no_baseline_still_strict(self):
        artifact_path = write_temp_artifact(CLEAN_ARTIFACT)
        message_content = "Some preamble.\n"
        message_path = write_temp_message(message_content)
        try:
            rc, _, _, stderr = run_script(
                "--artifact", artifact_path,
                "--final-message", message_path,
                "--expected-path", artifact_path,
            )
            self.assertNotEqual(rc, 0)
            self.assertIn("missing TEST_RESULT_ARTIFACT marker", stderr)
        finally:
            os.unlink(artifact_path)
            os.unlink(message_path)

    def test_marker_present_baseline_supplied_succeeds(self):
        artifact_path = write_temp_artifact(CLEAN_ARTIFACT)
        artifact_mtime = os.path.getmtime(artifact_path)
        message_content = f"Some preamble.\nTEST_RESULT_ARTIFACT: {artifact_path}\n"
        message_path = write_temp_message(message_content)
        baseline = artifact_mtime - 60
        try:
            rc, data, _, _ = run_script(
                "--artifact", artifact_path,
                "--final-message", message_path,
                "--expected-path", artifact_path,
                "--freshness-baseline", str(baseline),
            )
            self.assertEqual(rc, 0)
            self.assertIsNotNone(data)
            self.assertFalse(data.get("used_fallback"))
        finally:
            os.unlink(artifact_path)
            os.unlink(message_path)

    def test_marker_present_no_baseline_succeeds(self):
        artifact_path = write_temp_artifact(CLEAN_ARTIFACT)
        message_content = f"Some preamble.\nTEST_RESULT_ARTIFACT: {artifact_path}\n"
        message_path = write_temp_message(message_content)
        try:
            rc, data, _, _ = run_script(
                "--artifact", artifact_path,
                "--final-message", message_path,
                "--expected-path", artifact_path,
            )
            self.assertEqual(rc, 0)
            self.assertIsNotNone(data)
            self.assertFalse(data.get("used_fallback"))
        finally:
            os.unlink(artifact_path)
            os.unlink(message_path)


class TestExit0Override(unittest.TestCase):
    def test_exit0_bogus_non_reconcilable_discarded(self):
        # 2026-06-09 case: EXIT_CODE 0 but NON_RECONCILABLE_COUNT 1 (passing stdout).
        rc, data, _, _ = run_script(
            "--artifact",
            fixture("test-runner-artifact-exit0-bogus-non-reconcilable.txt"),
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["exit_code"], 0)
        self.assertEqual(data["failing_identifiers"], [])
        self.assertEqual(data["non_reconcilable_failures"], [])
        self.assertEqual(data["non_reconcilable_count"], 0)
        self.assertEqual(data["failing_identifiers_count"], 0)
        self.assertTrue(data["exit0_override"])
        self.assertEqual(data["discarded_non_reconcilable_count"], 1)
        self.assertEqual(len(data["discarded_non_reconcilable_failures"]), 1)

    def test_exit0_bogus_failing_identifiers_discarded(self):
        content = (
            "COMMAND: npm test\n"
            "WORKING_DIRECTORY: /tmp/project\n"
            "EXIT_CODE: 0\n"
            "TIMESTAMP: 2026-06-09T12:00:00Z\n"
            "FAILING_IDENTIFIERS_COUNT: 2\n"
            "FAILING_IDENTIFIERS:\n"
            "tests/test_a.py::test_one\n"
            "tests/test_b.py::test_two\n"
            "END_FAILING_IDENTIFIERS\n"
            "NON_RECONCILABLE_COUNT: 0\n"
            "NON_RECONCILABLE_FAILURES:\n"
            "END_NON_RECONCILABLE_FAILURES\n"
            "\n"
            "--- RAW RUN OUTPUT BELOW ---\n"
            "All tests passed.\n"
        )
        path = write_temp_artifact(content)
        try:
            rc, data, _, _ = run_script("--artifact", path)
            self.assertEqual(rc, 0)
            self.assertIsNotNone(data)
            self.assertEqual(data["failing_identifiers"], [])
            self.assertEqual(data["failing_identifiers_count"], 0)
            self.assertTrue(data["exit0_override"])
            self.assertEqual(data["discarded_failing_identifiers_count"], 2)
            self.assertEqual(
                data["discarded_failing_identifiers"],
                ["tests/test_a.py::test_one", "tests/test_b.py::test_two"],
            )
        finally:
            os.unlink(path)

    def test_exit0_empty_buckets_no_signal(self):
        rc, data, _, _ = run_script(
            "--artifact", fixture("test-runner-artifact-clean.txt")
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertNotIn("exit0_override", data)

    def test_nonzero_exit_buckets_honored_no_signal(self):
        rc, data, _, _ = run_script(
            "--artifact", fixture("test-runner-artifact-non-reconcilable.txt")
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertNotIn("exit0_override", data)
        self.assertGreater(len(data["non_reconcilable_failures"]), 0)


if __name__ == "__main__":
    unittest.main()
