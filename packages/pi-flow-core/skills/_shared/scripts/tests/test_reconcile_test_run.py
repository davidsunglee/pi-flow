"""Tests for reconcile-test-run.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "reconcile-test-run.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def run_script(*args):
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
    return result.returncode, stdout_data, result.stdout, result.stderr, stderr_data


def fixture(name):
    return os.path.join(FIXTURES, name)


class TestCaptureClean(unittest.TestCase):
    def test_capture_clean_artifact(self):
        rc, data, _, _, _ = run_script(
            "--artifact", fixture("test-runner-artifact-clean.txt"),
            "--mode", "capture",
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["classification"], "clean")
        self.assertEqual(data["baseline_failures"], [])
        self.assertEqual(data["mode"], "capture")


class TestCaptureStableFailures(unittest.TestCase):
    def test_capture_stable_failures(self):
        rc, data, _, _, _ = run_script(
            "--artifact", fixture("test-runner-artifact-stable-failures.txt"),
            "--mode", "capture",
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["classification"], "stable-failures-only")
        self.assertEqual(
            data["baseline_failures"],
            ["tests/test_a.py::test_one", "tests/test_b.py::test_two"],
        )


class TestCaptureNonReconcilable(unittest.TestCase):
    def test_capture_non_reconcilable_artifact(self):
        rc, data, _, _, _ = run_script(
            "--artifact", fixture("test-runner-artifact-non-reconcilable.txt"),
            "--mode", "capture",
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["classification"], "contains-non-reconcilable-evidence")


class TestReconcileCleanAgainstEmptyBaseline(unittest.TestCase):
    def test_reconcile_clean_artifact_empty_baseline(self):
        rc, data, _, _, _ = run_script(
            "--artifact", fixture("test-runner-artifact-clean.txt"),
            "--mode", "reconcile",
            "--baseline-failures", fixture("baseline-failures-empty.json"),
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["classification"], "pass")
        self.assertEqual(data["current_non_baseline_stable"], [])


class TestReconcileStableFailuresAgainstEmptyBaseline(unittest.TestCase):
    def test_reconcile_stable_failures_empty_baseline(self):
        rc, data, _, _, _ = run_script(
            "--artifact", fixture("test-runner-artifact-stable-failures.txt"),
            "--mode", "reconcile",
            "--baseline-failures", fixture("baseline-failures-empty.json"),
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["classification"], "fail")
        self.assertEqual(
            data["current_non_baseline_stable"],
            ["tests/test_a.py::test_one", "tests/test_b.py::test_two"],
        )


class TestReconcileNonReconcilableAgainstEmptyBaseline(unittest.TestCase):
    def test_reconcile_non_reconcilable_empty_baseline_fails(self):
        rc, data, _, _, _ = run_script(
            "--artifact", fixture("test-runner-artifact-non-reconcilable.txt"),
            "--mode", "reconcile",
            "--baseline-failures", fixture("baseline-failures-empty.json"),
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["classification"], "fail")


class TestReconcileStableFailuresWithPartialBaseline(unittest.TestCase):
    def test_reconcile_partial_baseline_overlap(self):
        # baseline-failures-stable.json has tests/test_a.py::test_one
        # stable-failures artifact has test_one and test_two
        # So only test_two should be in current_non_baseline_stable
        rc, data, _, _, _ = run_script(
            "--artifact", fixture("test-runner-artifact-stable-failures.txt"),
            "--mode", "reconcile",
            "--baseline-failures", fixture("baseline-failures-stable.json"),
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertNotIn("tests/test_a.py::test_one", data["current_non_baseline_stable"])
        self.assertIn("tests/test_b.py::test_two", data["current_non_baseline_stable"])
        self.assertEqual(data["classification"], "fail")


class TestReconcileMalformedBaseline(unittest.TestCase):
    def test_reconcile_malformed_baseline_exits_nonzero(self):
        rc, _, _, stderr, stderr_data = run_script(
            "--artifact", fixture("test-runner-artifact-clean.txt"),
            "--mode", "reconcile",
            "--baseline-failures", fixture("baseline-failures-malformed.json"),
        )
        self.assertNotEqual(rc, 0)
        self.assertIsNotNone(stderr_data)
        self.assertEqual(stderr_data["failure"], "baseline_failures_invalid")


class TestCaptureOutputIsAcceptedAsBaseline(unittest.TestCase):
    def test_capture_output_can_feed_reconcile(self):
        rc, data, _, _, _ = run_script(
            "--artifact", fixture("test-runner-artifact-stable-failures.txt"),
            "--mode", "capture",
        )
        self.assertEqual(rc, 0)
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(data, f)
            baseline_path = f.name
        try:
            rc, reconcile_data, _, _, _ = run_script(
                "--artifact", fixture("test-runner-artifact-stable-failures.txt"),
                "--mode", "reconcile",
                "--baseline-failures", baseline_path,
            )
            self.assertEqual(rc, 0)
            self.assertEqual(reconcile_data["classification"], "pass")
            self.assertEqual(reconcile_data["current_non_baseline_stable"], [])
        finally:
            os.unlink(baseline_path)


class TestPropagatesArtifactMissingOrEmpty(unittest.TestCase):
    def test_missing_artifact_propagates_upstream_error(self):
        rc, _, _, stderr, stderr_data = run_script(
            "--artifact", "/nonexistent/path/artifact.txt",
            "--mode", "capture",
        )
        self.assertNotEqual(rc, 0)
        self.assertIsNotNone(stderr_data)
        self.assertEqual(stderr_data["failure"], "artifact_missing_or_empty")


class TestReconcileExit0OverridePasses(unittest.TestCase):
    def test_reconcile_exit0_bogus_non_reconcilable_passes(self):
        rc, data, _, _, _ = run_script(
            "--artifact",
            fixture("test-runner-artifact-exit0-bogus-non-reconcilable.txt"),
            "--mode", "reconcile",
            "--baseline-failures", fixture("baseline-failures-empty.json"),
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["classification"], "pass")
        self.assertEqual(data["current_non_reconcilable"], [])
        self.assertEqual(data["current_non_baseline_stable"], [])
        self.assertTrue(data["exit0_override"])
        self.assertEqual(data["discarded_non_reconcilable_count"], 1)


class TestCaptureExit0OverrideClean(unittest.TestCase):
    def test_capture_exit0_bogus_non_reconcilable_clean(self):
        rc, data, _, _, _ = run_script(
            "--artifact",
            fixture("test-runner-artifact-exit0-bogus-non-reconcilable.txt"),
            "--mode", "capture",
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["classification"], "clean")
        self.assertEqual(data["baseline_failures"], [])
        self.assertTrue(data["exit0_override"])
        self.assertEqual(data["discarded_non_reconcilable_count"], 1)


class TestReconcileNonzeroExitNoOverrideSignal(unittest.TestCase):
    def test_reconcile_nonzero_exit_still_fails_no_signal(self):
        rc, data, _, _, _ = run_script(
            "--artifact",
            fixture("test-runner-artifact-non-reconcilable.txt"),
            "--mode", "reconcile",
            "--baseline-failures", fixture("baseline-failures-empty.json"),
        )
        self.assertEqual(rc, 0)
        self.assertIsNotNone(data)
        self.assertEqual(data["classification"], "fail")
        self.assertNotIn("exit0_override", data)


if __name__ == "__main__":
    unittest.main()
