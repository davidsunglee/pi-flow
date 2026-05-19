import unittest
import json
import subprocess
from pathlib import Path


class TestRecommendWorkflow(unittest.TestCase):
    """Tests for the legacy/non-authoritative recommend-workflow.py helper.

    The helper is retained for backwards compatibility and as an optional
    supporting signal. `define-spec` Step 8 no longer treats its output as
    the authoritative fastlane vs. deep-workflow recommendation — the
    orchestrating LLM reads the committed spec and makes the judgment
    itself. These tests verify the helper's existing JSON contract still
    holds for any caller that chooses to consume it.
    """

    def setUp(self):
        """Set up test paths."""
        self.script_path = Path(__file__).parent.parent / "recommend-workflow.py"
        self.fixtures_dir = Path(__file__).parent / "fixtures"

    def run_script(self, args):
        """Run the recommend-workflow script with given args, return stdout, stderr, and exit code."""
        cmd = ["python3", str(self.script_path)] + args
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.stdout, result.stderr, result.returncode

    def test_fast_lane_fit_recommends_fast_lane(self):
        """Test: spec-fast-lane-fit.md recommends fastlane."""
        spec_path = self.fixtures_dir / "spec-fast-lane-fit.md"
        stdout, stderr, code = self.run_script(["--spec-path", str(spec_path)])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertEqual(result["recommendation"], "fastlane")

    def test_has_approach_recommends_deep_workflow(self):
        """Test: spec-deep-fit-approach.md recommends deep-workflow with has_approach=True."""
        spec_path = self.fixtures_dir / "spec-deep-fit-approach.md"
        stdout, stderr, code = self.run_script(["--spec-path", str(spec_path)])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertEqual(result["recommendation"], "deep-workflow")
        self.assertTrue(result["reasons"]["has_approach"])

    def test_many_requirements_recommends_deep_workflow(self):
        """Test: spec-deep-fit-many-requirements.md recommends deep-workflow with requirements_count=10."""
        spec_path = self.fixtures_dir / "spec-deep-fit-many-requirements.md"
        stdout, stderr, code = self.run_script(["--spec-path", str(spec_path)])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertEqual(result["recommendation"], "deep-workflow")
        self.assertEqual(result["reasons"]["requirements_count"], 10)

    def test_flagged_non_goals_recommends_deep_workflow(self):
        """Test: spec-deep-fit-flagged-non-goals.md recommends deep-workflow with flagged keywords."""
        spec_path = self.fixtures_dir / "spec-deep-fit-flagged-non-goals.md"
        stdout, stderr, code = self.run_script(["--spec-path", str(spec_path)])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertEqual(result["recommendation"], "deep-workflow")
        self.assertIn("migration", result["reasons"]["flagged_non_goals"])

    def test_missing_spec_fails_with_label(self):
        """Test: missing spec file exits 1 with failure label."""
        stdout, stderr, code = self.run_script(["--spec-path", "/tmp/does-not-exist-fast-lane-spec.md"])
        self.assertNotEqual(code, 0, "Script should exit non-zero for missing spec")
        result = json.loads(stderr)
        self.assertEqual(result["failure"], "spec_missing")


if __name__ == '__main__':
    unittest.main()
