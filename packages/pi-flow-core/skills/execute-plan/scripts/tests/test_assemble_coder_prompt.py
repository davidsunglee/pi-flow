"""Tests for assemble-coder-prompt.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__),
    "..",
    "assemble-coder-prompt.py",
)
REAL_TEMPLATE = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "execute-task-prompt.md",
)
REAL_TDD_BLOCK = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "..",
    "_shared",
    "coder-tdd-block.md",
)


def run_script(args, input_text=None):
    result = subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True,
        text=True,
        input=input_text,
    )
    return result


class TestAssembleCoderPrompt(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def _write_file(self, name, content):
        path = os.path.join(self.tmpdir, name)
        with open(path, "w") as f:
            f.write(content)
        return path

    def _output_path(self, name="output.md"):
        return os.path.join(self.tmpdir, name)

    # ── Test (a): full success with TDD enabled ──────────────────────────────

    def test_full_success_with_tdd_enabled(self):
        task_spec = "### Task 1: foo"
        context = "Plan goal: bar"

        task_spec_file = self._write_file("task_spec.txt", task_spec)
        context_file = self._write_file("context.txt", context)
        output_file = self._output_path()

        result = run_script([
            "--task-spec", task_spec_file,
            "--context", context_file,
            "--working-dir", "/tmp/work",
            "--tdd-block", "enabled",
            "--output", output_file,
        ])

        self.assertEqual(result.returncode, 0, msg=f"stderr: {result.stderr}")

        with open(output_file) as f:
            output = f.read()

        # Check that supplied task spec text is present
        self.assertIn(task_spec, output)

        # Check that supplied context text is present
        self.assertIn(context, output)

        # Check that the literal operating-from line is present
        self.assertIn("Operate from: `/tmp/work`", output)

        # Check that the TDD block content is present
        self.assertIn("## Test-Driven Development", output)

    # ── Test (b): full success with TDD disabled ─────────────────────────────

    def test_full_success_with_tdd_disabled(self):
        task_spec = "### Task 1: foo"
        context = "Plan goal: bar"

        task_spec_file = self._write_file("task_spec.txt", task_spec)
        context_file = self._write_file("context.txt", context)
        output_file = self._output_path()

        result = run_script([
            "--task-spec", task_spec_file,
            "--context", context_file,
            "--working-dir", "/tmp/work",
            "--tdd-block", "disabled",
            "--output", output_file,
        ])

        self.assertEqual(result.returncode, 0, msg=f"stderr: {result.stderr}")

        with open(output_file) as f:
            output = f.read()

        # Check that supplied task spec text is present
        self.assertIn(task_spec, output)

        # Check that supplied context text is present
        self.assertIn(context, output)

        # Check that the literal operating-from line is present
        self.assertIn("Operate from: `/tmp/work`", output)

        # Check that the TDD block substring is NOT present
        self.assertNotIn("## Test-Driven Development", output)

        # Verify the four section headers are still present (from the template)
        self.assertIn("## Task Description", output)
        self.assertIn("## Context", output)
        self.assertIn("## Working Directory", output)
        self.assertIn("## Code Organization", output)

    # ── Test (c): input missing or unreadable task-spec ───────────────────────

    def test_input_missing_or_unreadable_task_spec(self):
        context_file = self._write_file("context.txt", "Plan goal: bar")
        output_file = self._output_path()

        result = run_script([
            "--task-spec", "/nonexistent",
            "--context", context_file,
            "--working-dir", "/tmp/work",
            "--tdd-block", "enabled",
            "--output", output_file,
        ])

        self.assertEqual(result.returncode, 2)

        # Parse stderr as JSON
        error_json = json.loads(result.stderr)
        self.assertEqual(error_json["failure"], "input missing or unreadable")
        self.assertEqual(error_json["input"], "task-spec")

    # ── Test (d): unreplaced placeholder fails closed ────────────────────────

    def test_unreplaced_placeholder_fails_closed(self):
        custom_template = self._write_file(
            "custom_template.md",
            "Hello {UNKNOWN}!",
        )
        task_spec_file = self._write_file("task_spec.txt", "Task.")
        context_file = self._write_file("context.txt", "Plan goal")
        output_file = self._output_path()

        result = run_script([
            "--template", custom_template,
            "--task-spec", task_spec_file,
            "--context", context_file,
            "--working-dir", "/tmp/work",
            "--tdd-block", "enabled",
            "--output", output_file,
        ])

        self.assertEqual(result.returncode, 1)

        # Parse stderr as JSON
        error_json = json.loads(result.stderr)
        self.assertEqual(error_json["failure"], "unreplaced placeholders remain")
        self.assertIn("UNKNOWN", error_json["unreplaced"])

    # ── Test (e): no recursive expansion ──────────────────────────────────────

    def test_no_recursive_expansion(self):
        """
        Placeholder values must be inserted literally; if a task spec contains
        {OTHER} as a literal string, it must NOT be substituted.
        """
        task_spec = "see {OTHER}"
        context = "Plan goal: bar"

        task_spec_file = self._write_file("task_spec.txt", task_spec)
        context_file = self._write_file("context.txt", context)
        output_file = self._output_path()

        result = run_script([
            "--task-spec", task_spec_file,
            "--context", context_file,
            "--working-dir", "/tmp/work",
            "--tdd-block", "enabled",
            "--output", output_file,
        ])

        self.assertEqual(result.returncode, 0, msg=f"stderr: {result.stderr}")

        with open(output_file) as f:
            output = f.read()

        # The literal {OTHER} inside TASK_SPEC value must remain literal.
        self.assertIn("see {OTHER}", output)


if __name__ == "__main__":
    unittest.main()
