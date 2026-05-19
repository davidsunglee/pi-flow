import unittest
import json
import subprocess
import tempfile
import os
from pathlib import Path


class TestFillTemplate(unittest.TestCase):
    """Tests for fill-template.py script."""

    def setUp(self):
        """Set up test paths."""
        self.script_path = Path(__file__).parent.parent / "fill-template.py"
        self.fixtures_dir = Path(__file__).parent / "fixtures"
        self.simple_template = self.fixtures_dir / "template-simple.md"
        self.multi_template = self.fixtures_dir / "template-multi.md"

    def run_script(self, args):
        """Run the fill-template script with given args, return stdout, stderr, and exit code."""
        cmd = ["python3", str(self.script_path)] + args
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.stdout, result.stderr, result.returncode

    def test_single_placeholder_substitution(self):
        """Test replacing a single placeholder via --placeholders-json."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"NAME": "world"}, f)
            json_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.simple_template),
                "--placeholders-json", json_file,
                "--output", output_file
            ])
            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            self.assertEqual(content, "Hello, world!\n")
        finally:
            os.unlink(json_file)
            os.unlink(output_file)

    def test_single_placeholder_with_stdin_json(self):
        """Test replacing a placeholder with JSON from stdin."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            cmd = ["python3", str(self.script_path),
                   "--template", str(self.simple_template),
                   "--placeholders-json", "-",
                   "--output", output_file]
            result = subprocess.run(cmd, input='{"NAME": "world"}', capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, f"Script failed: {result.stderr}")
            with open(output_file) as f:
                content = f.read()
            self.assertEqual(content, "Hello, world!\n")
        finally:
            os.unlink(output_file)

    def test_single_placeholder_to_stdout(self):
        """Test outputting to stdout via --output -"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"NAME": "world"}, f)
            json_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.simple_template),
                "--placeholders-json", json_file,
                "--output", "-"
            ])
            self.assertEqual(code, 0, f"Script failed: {stderr}")
            self.assertEqual(stdout, "Hello, world!\n")
        finally:
            os.unlink(json_file)

    def test_multiple_placeholder_substitution(self):
        """Test replacing multiple placeholders."""
        placeholders = {
            "PLAN_PATH": "/path/to/plan.md",
            "TASK_NUMBER": "42",
            "GOAL": "Implement feature X"
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(placeholders, f)
            json_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.multi_template),
                "--placeholders-json", json_file,
                "--output", output_file
            ])
            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            expected = "Plan: /path/to/plan.md\nTask: 42\nGoal: Implement feature X\n"
            self.assertEqual(content, expected)
        finally:
            os.unlink(json_file)
            os.unlink(output_file)

    def test_no_recursive_expansion(self):
        """Test that values containing {OTHER} are not recursively expanded."""
        placeholders = {
            "NAME": "see {OTHER}"
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(placeholders, f)
            json_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.simple_template),
                "--placeholders-json", json_file,
                "--output", output_file
            ])
            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            # The literal {OTHER} in the value should NOT be expanded
            self.assertEqual(content, "Hello, see {OTHER}!\n")
        finally:
            os.unlink(json_file)
            os.unlink(output_file)

    def test_no_recursive_expansion_with_present_key(self):
        """A value containing {OTHER} must stay literal even when OTHER is also a key in the JSON map."""
        # Use the multi-template which has {PLAN_PATH}, {TASK_NUMBER}, {GOAL}.
        placeholders = {
            "PLAN_PATH": "see {GOAL}",
            "TASK_NUMBER": "1",
            "GOAL": "REAL_GOAL_VALUE",
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(placeholders, f)
            json_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.multi_template),
                "--placeholders-json", json_file,
                "--output", output_file
            ])
            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            # The value of {PLAN_PATH} contains literal "{GOAL}", which must
            # NOT be re-expanded into REAL_GOAL_VALUE.
            self.assertIn("Plan: see {GOAL}", content)
            # The actual {GOAL} placeholder in the template should still resolve.
            self.assertIn("Goal: REAL_GOAL_VALUE", content)
        finally:
            os.unlink(json_file)
            os.unlink(output_file)

    def test_extra_json_keys_ignored(self):
        """Test that extra JSON keys whose {KEY} does not appear in template are silently ignored."""
        placeholders = {
            "NAME": "world",
            "EXTRA": "ignored"
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(placeholders, f)
            json_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.simple_template),
                "--placeholders-json", json_file,
                "--output", output_file
            ])
            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            self.assertEqual(content, "Hello, world!\n")
        finally:
            os.unlink(json_file)
            os.unlink(output_file)

    def test_require_all_replaced_with_unreplaced(self):
        """Test --require-all-replaced with unreplaced placeholders."""
        # Empty JSON map, simple template has {NAME}
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({}, f)
            json_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.simple_template),
                "--placeholders-json", json_file,
                "--output", output_file,
                "--require-all-replaced"
            ])
            # Should exit non-zero
            self.assertNotEqual(code, 0, "Script should exit non-zero with unreplaced placeholders")
            # stderr should contain JSON with failure info
            stderr_json = json.loads(stderr)
            self.assertEqual(stderr_json["failure"], "unreplaced placeholders remain")
            self.assertIn("NAME", stderr_json["unreplaced"])
        finally:
            os.unlink(json_file)
            os.unlink(output_file)

    def test_require_all_replaced_with_all_replaced(self):
        """Test --require-all-replaced with all placeholders replaced."""
        placeholders = {"NAME": "world"}
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(placeholders, f)
            json_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.simple_template),
                "--placeholders-json", json_file,
                "--output", output_file,
                "--require-all-replaced"
            ])
            # Should exit 0
            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            self.assertEqual(content, "Hello, world!\n")
        finally:
            os.unlink(json_file)
            os.unlink(output_file)

    def test_require_all_replaced_extra_keys_ignored(self):
        """Test that --require-all-replaced ignores extra JSON keys."""
        placeholders = {
            "NAME": "world",
            "EXTRA": "ignored"
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(placeholders, f)
            json_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.simple_template),
                "--placeholders-json", json_file,
                "--output", output_file,
                "--require-all-replaced"
            ])
            # Should exit 0 (extra keys never trigger the unreplaced-token check)
            self.assertEqual(code, 0, f"Script failed: {stderr}")
            with open(output_file) as f:
                content = f.read()
            self.assertEqual(content, "Hello, world!\n")
        finally:
            os.unlink(json_file)
            os.unlink(output_file)

    def test_missing_template_file(self):
        """Test that missing --template file exits non-zero with structured JSON error."""
        missing_template = "/nonexistent/path/to/template.md"
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"NAME": "world"}, f)
            json_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", missing_template,
                "--placeholders-json", json_file,
                "--output", output_file
            ])
            self.assertNotEqual(code, 0, "Script should exit non-zero for missing template")
            stderr_json = json.loads(stderr)
            self.assertEqual(stderr_json["failure"], "template missing or unreadable")
        finally:
            os.unlink(json_file)
            os.unlink(output_file)

    def test_malformed_placeholders_json(self):
        """Test that malformed --placeholders-json exits non-zero with structured JSON error."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write("{not valid json")
            json_file = f.name

        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.simple_template),
                "--placeholders-json", json_file,
                "--output", output_file
            ])
            self.assertNotEqual(code, 0, "Script should exit non-zero for malformed JSON")
            stderr_json = json.loads(stderr)
            self.assertEqual(stderr_json["failure"], "placeholders-json malformed")
        finally:
            os.unlink(json_file)
            os.unlink(output_file)

    def test_missing_placeholders_json_file(self):
        """Test that missing --placeholders-json file exits non-zero with structured JSON error."""
        missing_json = "/nonexistent/path/to/placeholders.json"
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            output_file = f.name

        try:
            stdout, stderr, code = self.run_script([
                "--template", str(self.simple_template),
                "--placeholders-json", missing_json,
                "--output", output_file
            ])
            self.assertNotEqual(code, 0, "Script should exit non-zero for missing JSON")
            stderr_json = json.loads(stderr)
            self.assertEqual(stderr_json["failure"], "placeholders-json missing or unreadable")
        finally:
            os.unlink(output_file)

    def test_help_flag(self):
        """Test that --help exits 0 and describes the placeholder grammar."""
        stdout, stderr, code = self.run_script(["--help"])
        self.assertEqual(code, 0, f"Help failed: {stderr}")
        # Should mention placeholders and the placeholder pattern
        self.assertIn("placeholder", stdout.lower())
        # Should mention --require-all-replaced
        self.assertIn("--require-all-replaced", stdout)


if __name__ == '__main__':
    unittest.main()
