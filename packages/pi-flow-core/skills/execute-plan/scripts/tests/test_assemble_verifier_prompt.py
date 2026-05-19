"""Tests for assemble-verifier-prompt.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__),
    "..",
    "assemble-verifier-prompt.py",
)
REAL_TEMPLATE = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "verify-task-prompt.md",
)


def run_script(args, input_text=None):
    result = subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True,
        text=True,
        input=input_text,
    )
    return result


class TestAssembleVerifierPrompt(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def _write_file(self, name, content):
        path = os.path.join(self.tmpdir, name)
        with open(path, "w") as f:
            f.write(content)
        return path

    def _output_path(self, name="output.md"):
        return os.path.join(self.tmpdir, name)

    # ── Test (a): full success against real template ──────────────────────────

    def test_full_success_against_real_template(self):
        task_spec = "Do the thing correctly."
        criteria = [
            {"text": "Crit 1", "verify": "ls -la"},
            {"text": "Crit 2", "verify": "grep foo bar.txt"},
        ]
        phase1_recipes = [{"criterion_n": 1, "recipe": "ls -la"}]
        modified_files_content = "file_a.py\nfile_b.py\nfile_a.py\n"  # duplicate
        diff_text = "--- a/file_a.py\n+++ b/file_a.py\n@@ -1 +1 @@\n-old\n+new"

        task_spec_file = self._write_file("task_spec.txt", task_spec)
        criteria_file = self._write_file("criteria.json", json.dumps(criteria))
        recipes_file = self._write_file("recipes.json", json.dumps(phase1_recipes))
        modified_file = self._write_file("modified.txt", modified_files_content)
        diff_file = self._write_file("diff.txt", diff_text)
        output_file = self._output_path()

        result = run_script([
            "--template", REAL_TEMPLATE,
            "--task-spec", task_spec_file,
            "--criteria-json", criteria_file,
            "--phase1-recipes-json", recipes_file,
            "--modified-files", modified_file,
            "--diff-context", diff_file,
            "--working-dir", "/tmp/work",
            "--output", output_file,
        ])

        self.assertEqual(result.returncode, 0, msg=f"stderr: {result.stderr}")

        with open(output_file) as f:
            output = f.read()

        # No remaining placeholders
        import re
        remaining = re.findall(r'\{[A-Z_][A-Z0-9_]*\}', output)
        self.assertEqual(remaining, [], msg=f"Unreplaced placeholders: {remaining}")

        # Task spec section
        self.assertIn("## Task Spec", output)
        self.assertIn(task_spec, output)

        # Acceptance criteria section
        self.assertIn("## Acceptance Criteria", output)
        self.assertIn("1. Crit 1", output)
        self.assertIn("Verify: ls -la", output)
        self.assertIn("2. Crit 2", output)
        self.assertIn("Verify: grep foo bar.txt", output)

        # Phase 1 recipes section
        self.assertIn("## Phase 1 Verification Recipes", output)
        self.assertIn("[Recipe for Criterion 1] ls -la", output)

        # Verifier-Visible Files section
        self.assertIn("## Verifier-Visible Files", output)
        self.assertIn("file_a.py", output)
        self.assertIn("file_b.py", output)

        # Diff context section
        self.assertIn("## Diff Context", output)
        self.assertIn(diff_text, output)

        # Working directory
        self.assertIn("Operate from: `/tmp/work`", output)

    # ── Test (b): empty phase1 recipes ───────────────────────────────────────

    def test_empty_phase1_recipes(self):
        task_spec = "Simple task."
        criteria = [{"text": "Crit 1", "verify": "ls -la"}]
        phase1_recipes = []

        task_spec_file = self._write_file("task_spec.txt", task_spec)
        criteria_file = self._write_file("criteria.json", json.dumps(criteria))
        recipes_file = self._write_file("recipes.json", json.dumps(phase1_recipes))
        modified_file = self._write_file("modified.txt", "file_a.py\n")
        diff_file = self._write_file("diff.txt", "no diff")
        output_file = self._output_path()

        result = run_script([
            "--template", REAL_TEMPLATE,
            "--task-spec", task_spec_file,
            "--criteria-json", criteria_file,
            "--phase1-recipes-json", recipes_file,
            "--modified-files", modified_file,
            "--diff-context", diff_file,
            "--working-dir", "/tmp/work",
            "--output", output_file,
        ])

        self.assertEqual(result.returncode, 0, msg=f"stderr: {result.stderr}")

        with open(output_file) as f:
            output = f.read()

        import re
        remaining = re.findall(r'\{[A-Z_][A-Z0-9_]*\}', output)
        self.assertEqual(remaining, [], msg=f"Unreplaced placeholders: {remaining}")

        # Placeholder should be replaced with empty string (no recipe lines)
        self.assertNotIn("[Recipe for Criterion", output)

    # ── Test (c): duplicate modified files are deduplicated ──────────────────

    def test_modified_files_deduplicated(self):
        task_spec = "Simple."
        criteria = [{"text": "C1", "verify": "ls"}]
        phase1_recipes = [{"criterion_n": 1, "recipe": "ls"}]

        task_spec_file = self._write_file("task_spec.txt", task_spec)
        criteria_file = self._write_file("criteria.json", json.dumps(criteria))
        recipes_file = self._write_file("recipes.json", json.dumps(phase1_recipes))
        # Three entries, two are duplicates of the first
        modified_file = self._write_file(
            "modified.txt", "alpha.py\nbeta.py\nalpha.py\nbeta.py\n"
        )
        diff_file = self._write_file("diff.txt", "diff")
        output_file = self._output_path()

        result = run_script([
            "--template", REAL_TEMPLATE,
            "--task-spec", task_spec_file,
            "--criteria-json", criteria_file,
            "--phase1-recipes-json", recipes_file,
            "--modified-files", modified_file,
            "--diff-context", diff_file,
            "--working-dir", "/tmp/work",
            "--output", output_file,
        ])

        self.assertEqual(result.returncode, 0, msg=f"stderr: {result.stderr}")

        with open(output_file) as f:
            output = f.read()

        # Count occurrences of each path — should appear exactly once each
        self.assertEqual(output.count("alpha.py"), 1)
        self.assertEqual(output.count("beta.py"), 1)

    # ── Test (d): malformed criteria JSON fails closed ────────────────────────

    def test_malformed_criteria_json_fails_closed(self):
        task_spec_file = self._write_file("task_spec.txt", "Task.")
        criteria_file = self._write_file("criteria.json", "not valid json {{")
        recipes_file = self._write_file("recipes.json", "[]")
        modified_file = self._write_file("modified.txt", "file.py\n")
        diff_file = self._write_file("diff.txt", "diff")
        output_file = self._output_path()

        result = run_script([
            "--template", REAL_TEMPLATE,
            "--task-spec", task_spec_file,
            "--criteria-json", criteria_file,
            "--phase1-recipes-json", recipes_file,
            "--modified-files", modified_file,
            "--diff-context", diff_file,
            "--working-dir", "/tmp/work",
            "--output", output_file,
        ])

        self.assertNotEqual(result.returncode, 0)
        # Should produce some error output
        self.assertTrue(
            result.stderr.strip() or result.stdout.strip(),
            msg="Expected error output on malformed criteria",
        )

    # ── Regression: no recursive substitution across replacements ────────────

    def test_no_recursive_substitution_between_placeholders(self):
        """
        Placeholder values must be inserted literally; if a task spec contains
        {WORKING_DIR} as a literal string, it must NOT be substituted with the
        --working-dir value during the same fill.
        """
        custom_template = self._write_file(
            "custom_template.md",
            "TASK: {TASK_SPEC}\nDIR: {WORKING_DIR}\n",
        )
        # task_spec contains a literal {WORKING_DIR} which must not be expanded
        task_spec_file = self._write_file("task_spec.txt", "see {WORKING_DIR} ref")
        criteria_file = self._write_file("criteria.json", "[]")
        recipes_file = self._write_file("recipes.json", "[]")
        modified_file = self._write_file("modified.txt", "")
        diff_file = self._write_file("diff.txt", "")
        output_file = self._output_path()

        result = run_script([
            "--template", custom_template,
            "--task-spec", task_spec_file,
            "--criteria-json", criteria_file,
            "--phase1-recipes-json", recipes_file,
            "--modified-files", modified_file,
            "--diff-context", diff_file,
            "--working-dir", "/tmp/REAL_WORKING_DIR",
            "--output", output_file,
        ])

        self.assertEqual(result.returncode, 0, msg=f"stderr: {result.stderr}")
        with open(output_file) as f:
            output = f.read()
        # The literal {WORKING_DIR} inside TASK_SPEC value must remain literal.
        self.assertIn("TASK: see {WORKING_DIR} ref", output)
        # The actual template placeholder still resolves.
        self.assertIn("DIR: /tmp/REAL_WORKING_DIR", output)

    # ── Test (e): unreplaced placeholders fail closed ─────────────────────────

    def test_unreplaced_placeholders_fail_closed(self):
        custom_template = self._write_file(
            "custom_template.md",
            "## Task Spec\n\n{TASK_SPEC}\n\n{UNKNOWN_PLACEHOLDER}\n",
        )
        task_spec_file = self._write_file("task_spec.txt", "Task.")
        criteria_file = self._write_file("criteria.json", "[]")
        recipes_file = self._write_file("recipes.json", "[]")
        modified_file = self._write_file("modified.txt", "file.py\n")
        diff_file = self._write_file("diff.txt", "diff")
        output_file = self._output_path()

        result = run_script([
            "--template", custom_template,
            "--task-spec", task_spec_file,
            "--criteria-json", criteria_file,
            "--phase1-recipes-json", recipes_file,
            "--modified-files", modified_file,
            "--diff-context", diff_file,
            "--working-dir", "/tmp/work",
            "--output", output_file,
        ])

        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
