import unittest
import json
import subprocess
import tempfile
import os
from pathlib import Path


class TestFillRefineCodePrompt(unittest.TestCase):
    """Tests for fill-refine-code-prompt.py script."""

    def setUp(self):
        """Set up test paths."""
        self.script_path = Path(__file__).parent.parent / "fill-refine-code-prompt.py"
        self.real_template = Path(__file__).parent.parent.parent / "refine-code-prompt.md"

    def run_script(self, args):
        """Run the fill-refine-code-prompt script with given args, return stdout, stderr, and exit code."""
        cmd = ["python3", str(self.script_path)] + args
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.stdout, result.stderr, result.returncode

    def test_full_success_against_real_template(self):
        """Test full substitution against real refine-code-prompt.md template with all placeholders."""
        # Create temp files for required text inputs
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Implement feature X")
            plan_goal_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Requirements for feature X")
            plan_contents_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"crossProviderModelTiers.capable": "model1"}, f)
            flow_config_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        # Create a minimal template with only the 8 required placeholders
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("""# Test Template

## What Was Implemented

{PLAN_GOAL}

## Requirements/Plan

{PLAN_CONTENTS}

## Git Range

**Base (pre-implementation):** {BASE_SHA}
**Head (post-implementation):** {HEAD_SHA}

## Configuration

- **Max iterations:** {MAX_ITERATIONS}
- **Review output base path:** {REVIEW_OUTPUT_PATH}
- **Working directory:** {WORKING_DIR}

### Flow Config

{FLOW_CONFIG}
""")
            template_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", template_file,
                "--plan-goal", plan_goal_file,
                "--plan-contents", plan_contents_file,
                "--base-sha", "abc1234",
                "--head-sha", "def5678",
                "--review-output-path", "review.md",
                "--max-iterations", "5",
                "--flow-config", flow_config_file,
                "--working-dir", "/work/dir",
                "--carry-over-review", "",
                "--output", output_file
            ])

            self.assertEqual(code, 0, f"Script failed: {stderr}")

            with open(output_file) as f:
                content = f.read()

            # Verify plan goal is in the output
            self.assertIn("Implement feature X", content)
            # Verify plan contents is in the output
            self.assertIn("Requirements for feature X", content)
            # Verify base/head SHAs
            self.assertIn("**Base (pre-implementation):** abc1234", content)
            self.assertIn("**Head (post-implementation):** def5678", content)
            # Verify review output path
            self.assertIn("review.md", content)
            # Verify max iterations as literal string
            self.assertIn("**Max iterations:** 5", content)
            # Verify flow config content is included
            self.assertIn("crossProviderModelTiers.capable", content)
            # Verify working directory is in Configuration section
            self.assertIn("**Working directory:** /work/dir", content)
            # Verify no remaining placeholders (the 8 required ones)
            self.assertNotIn("{PLAN_GOAL}", content)
            self.assertNotIn("{PLAN_CONTENTS}", content)
            self.assertNotIn("{BASE_SHA}", content)
            self.assertNotIn("{HEAD_SHA}", content)
            self.assertNotIn("{REVIEW_OUTPUT_PATH}", content)
            self.assertNotIn("{MAX_ITERATIONS}", content)
            self.assertNotIn("{FLOW_CONFIG}", content)
            self.assertNotIn("{WORKING_DIR}", content)
        finally:
            os.unlink(plan_goal_file)
            os.unlink(plan_contents_file)
            os.unlink(flow_config_file)
            os.unlink(output_file)
            os.unlink(template_file)

    def test_input_missing_or_unreadable_plan_goal(self):
        """Test that missing plan-goal file fails with proper error."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Requirements for feature X")
            plan_contents_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"crossProviderModelTiers.capable": "model1"}, f)
            flow_config_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.real_template),
                "--plan-goal", "/nonexistent/plan/goal.md",
                "--plan-contents", plan_contents_file,
                "--base-sha", "abc1234",
                "--head-sha", "def5678",
                "--review-output-path", "/path/to/review.md",
                "--max-iterations", "5",
                "--flow-config", flow_config_file,
                "--working-dir", "/work/dir",
                "--carry-over-review", "",
                "--output", output_file
            ])

            self.assertEqual(code, 2, "Script should exit 2 for missing input")
            stderr_json = json.loads(stderr)
            self.assertEqual(stderr_json["failure"], "input missing or unreadable")
            self.assertEqual(stderr_json["input"], "plan-goal")
        finally:
            os.unlink(plan_contents_file)
            os.unlink(flow_config_file)
            os.unlink(output_file)

    def test_unreplaced_placeholder_fails_closed(self):
        """Test that unreplaced placeholders fail with proper error."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("# Test Template\n\n{PLAN_GOAL}\n\n{UNKNOWN}\n")
            template_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Test goal")
            plan_goal_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Test contents")
            plan_contents_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"crossProviderModelTiers.capable": "model1"}, f)
            flow_config_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", template_file,
                "--plan-goal", plan_goal_file,
                "--plan-contents", plan_contents_file,
                "--base-sha", "abc1234",
                "--head-sha", "def5678",
                "--review-output-path", "/path/to/review.md",
                "--max-iterations", "5",
                "--flow-config", flow_config_file,
                "--working-dir", "/work/dir",
                "--carry-over-review", "",
                "--output", output_file
            ])

            self.assertEqual(code, 1, "Script should exit 1 for unreplaced placeholders")
            stderr_json = json.loads(stderr)
            self.assertEqual(stderr_json["failure"], "unreplaced placeholders remain")
            self.assertIn("UNKNOWN", stderr_json["unreplaced"])
        finally:
            os.unlink(template_file)
            os.unlink(plan_goal_file)
            os.unlink(plan_contents_file)
            os.unlink(flow_config_file)
            os.unlink(output_file)

    def test_no_recursive_expansion(self):
        """Test that values containing {OTHER} are not recursively expanded."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("See {OTHER}")
            plan_goal_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("# Template\n\nPlan: {PLAN_GOAL}")
            template_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Contents")
            plan_contents_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"crossProviderModelTiers.capable": "model1"}, f)
            flow_config_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", template_file,
                "--plan-goal", plan_goal_file,
                "--plan-contents", plan_contents_file,
                "--base-sha", "abc1234",
                "--head-sha", "def5678",
                "--review-output-path", "/path/to/review.md",
                "--max-iterations", "5",
                "--flow-config", flow_config_file,
                "--working-dir", "/work/dir",
                "--carry-over-review", "",
                "--output", output_file
            ])

            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            self.assertIn("See {OTHER}", content)
        finally:
            os.unlink(plan_goal_file)
            os.unlink(template_file)
            os.unlink(plan_contents_file)
            os.unlink(flow_config_file)
            os.unlink(output_file)

    def test_plan_contents_placeholders_preserved(self):
        """Plan contents may document placeholder tokens and must be inserted literally."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Contents: {PLAN_CONTENTS}")
            template_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Test goal")
            plan_goal_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Plan mentions {TASK_SPEC} and {WORKING_DIR}")
            plan_contents_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"crossProviderModelTiers.capable": "model1"}, f)
            flow_config_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", template_file,
                "--plan-goal", plan_goal_file,
                "--plan-contents", plan_contents_file,
                "--base-sha", "abc1234",
                "--head-sha", "def5678",
                "--review-output-path", "/path/to/review.md",
                "--max-iterations", "5",
                "--flow-config", flow_config_file,
                "--working-dir", "/work/dir",
                "--carry-over-review", "",
                "--output", output_file
            ])

            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            self.assertIn("Plan mentions {TASK_SPEC} and {WORKING_DIR}", content)
        finally:
            os.unlink(template_file)
            os.unlink(plan_goal_file)
            os.unlink(plan_contents_file)
            os.unlink(flow_config_file)
            os.unlink(output_file)

    def test_max_iterations_stringified(self):
        """Test that max-iterations int is converted to string in output."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Plan: {MAX_ITERATIONS}")
            template_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Test goal")
            plan_goal_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Test contents")
            plan_contents_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"crossProviderModelTiers.capable": "model1"}, f)
            flow_config_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", template_file,
                "--plan-goal", plan_goal_file,
                "--plan-contents", plan_contents_file,
                "--base-sha", "abc1234",
                "--head-sha", "def5678",
                "--review-output-path", "/path/to/review.md",
                "--max-iterations", "3",
                "--flow-config", flow_config_file,
                "--working-dir", "/work/dir",
                "--carry-over-review", "",
                "--output", output_file
            ])

            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            # Verify the literal "3" appears (not as {MAX_ITERATIONS})
            self.assertIn("Plan: 3", content)
            self.assertNotIn("{MAX_ITERATIONS}", content)
        finally:
            os.unlink(plan_goal_file)
            os.unlink(template_file)
            os.unlink(plan_contents_file)
            os.unlink(flow_config_file)
            os.unlink(output_file)

    def test_help_flag(self):
        """Test that --help exits 0 and lists all nine placeholders."""
        stdout, stderr, code = self.run_script(["--help"])
        self.assertEqual(code, 0, f"Help failed: {stderr}")
        # Should mention all nine placeholders
        for placeholder in ["PLAN_GOAL", "PLAN_CONTENTS", "BASE_SHA", "HEAD_SHA",
                           "REVIEW_OUTPUT_PATH", "MAX_ITERATIONS", "FLOW_CONFIG", "WORKING_DIR", "CARRY_OVER_REVIEW"]:
            self.assertIn(placeholder, stdout, f"--help should mention {placeholder}")

    def test_carry_over_review_with_empty_string(self):
        """Test that --carry-over-review accepts empty string."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Goal: {PLAN_GOAL}")
            template_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Test goal")
            plan_goal_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Test contents")
            plan_contents_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"crossProviderModelTiers.capable": "model1"}, f)
            flow_config_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", template_file,
                "--plan-goal", plan_goal_file,
                "--plan-contents", plan_contents_file,
                "--base-sha", "abc1234",
                "--head-sha", "def5678",
                "--review-output-path", "review.md",
                "--max-iterations", "5",
                "--flow-config", flow_config_file,
                "--working-dir", "/work/dir",
                "--carry-over-review", "",
                "--output", output_file
            ])

            self.assertEqual(code, 0, f"Script failed: {stderr}")
        finally:
            os.unlink(template_file)
            os.unlink(plan_goal_file)
            os.unlink(plan_contents_file)
            os.unlink(flow_config_file)
            os.unlink(output_file)

    def test_carry_over_review_populated(self):
        """Test that --carry-over-review substitutes the populated path literally."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Test goal")
            plan_goal_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Test contents")
            plan_contents_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"crossProviderModelTiers.capable": "model1"}, f)
            flow_config_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("Review findings from prior era")
            carry_over_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write("# Template\n{CARRY_OVER_REVIEW}")
            template_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", template_file,
                "--plan-goal", plan_goal_file,
                "--plan-contents", plan_contents_file,
                "--base-sha", "abc1234",
                "--head-sha", "def5678",
                "--review-output-path", "review.md",
                "--max-iterations", "5",
                "--flow-config", flow_config_file,
                "--working-dir", "/work/dir",
                "--carry-over-review", carry_over_file,
                "--output", output_file
            ])

            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            self.assertIn(carry_over_file, content)
            self.assertNotIn("Review findings from prior era", content)
            self.assertNotIn("{CARRY_OVER_REVIEW}", content)
        finally:
            os.unlink(plan_goal_file)
            os.unlink(plan_contents_file)
            os.unlink(flow_config_file)
            os.unlink(carry_over_file)
            os.unlink(template_file)
            os.unlink(output_file)

    def test_help_flag_includes_carry_over_review(self):
        """Test that --help documents CARRY_OVER_REVIEW placeholder."""
        stdout, stderr, code = self.run_script(["--help"])
        self.assertEqual(code, 0, f"Help failed: {stderr}")
        self.assertIn("CARRY_OVER_REVIEW", stdout, "--help should mention CARRY_OVER_REVIEW")


if __name__ == '__main__':
    unittest.main()
