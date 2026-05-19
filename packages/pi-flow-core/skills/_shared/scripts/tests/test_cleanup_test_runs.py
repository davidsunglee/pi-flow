import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "cleanup-test-runs.py"
)


def run(args, cwd):
    return subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True,
        text=True,
        cwd=cwd,
    )


class TestCleanupTestRuns(unittest.TestCase):

    def _make_cwd_with_test_runs(self):
        cwd = tempfile.mkdtemp()
        target = os.path.join(cwd, "docs", "test-runs", "my-plan")
        os.makedirs(target)
        with open(os.path.join(target, "baseline.log"), "w") as f:
            f.write("baseline output\n")
        return cwd, target

    def test_successful_cleanup_of_present_target(self):
        cwd, target = self._make_cwd_with_test_runs()
        try:
            self.assertTrue(os.path.isdir(target))
            result = run(["docs/test-runs/my-plan"], cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(os.path.exists(target))
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_idempotent_when_target_absent(self):
        cwd = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(cwd, "docs", "test-runs"))
            result = run(["docs/test-runs/my-plan"], cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stderr)
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_rejects_dotdot_traversal(self):
        cwd, _ = self._make_cwd_with_test_runs()
        try:
            result = run(["docs/test-runs/../my-plan"], cwd=cwd)
            self.assertNotEqual(result.returncode, 0)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "dotdot_traversal")
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_rejects_path_outside_cwd(self):
        cwd, _ = self._make_cwd_with_test_runs()
        try:
            result = run(["/tmp/somewhere-else"], cwd=cwd)
            self.assertNotEqual(result.returncode, 0)
            err = json.loads(result.stderr)
            self.assertIn(err["failure"], ("outside_cwd", "outside_test_runs_prefix"))
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_rejects_protected_segment_git(self):
        cwd = tempfile.mkdtemp()
        try:
            target = os.path.join(cwd, "docs", "test-runs", ".git")
            os.makedirs(target)
            result = run(["docs/test-runs/.git"], cwd=cwd)
            self.assertNotEqual(result.returncode, 0)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "protected_segment")
            self.assertEqual(err["segment"], ".git")
            self.assertTrue(os.path.isdir(target))
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_rejects_protected_segment_node_modules(self):
        cwd = tempfile.mkdtemp()
        try:
            target = os.path.join(cwd, "docs", "test-runs", "node_modules")
            os.makedirs(target)
            result = run(["docs/test-runs/node_modules"], cwd=cwd)
            self.assertNotEqual(result.returncode, 0)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "protected_segment")
            self.assertTrue(os.path.isdir(target))
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_rejects_path_outside_test_runs_prefix(self):
        cwd = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(cwd, "docs", "specs"))
            target = os.path.join(cwd, "docs", "specs", "foo")
            os.makedirs(target)
            result = run(["docs/specs/foo"], cwd=cwd)
            self.assertNotEqual(result.returncode, 0)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "outside_test_runs_prefix")
            self.assertTrue(os.path.isdir(target))
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_rejects_test_runs_root(self):
        cwd = tempfile.mkdtemp()
        try:
            root = os.path.join(cwd, "docs", "test-runs")
            os.makedirs(os.path.join(root, "p"))
            result = run(["docs/test-runs"], cwd=cwd)
            self.assertNotEqual(result.returncode, 0)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "outside_test_runs_prefix")
            self.assertTrue(os.path.isdir(root))
            self.assertTrue(os.path.isdir(os.path.join(root, "p")))
        finally:
            shutil.rmtree(cwd, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
