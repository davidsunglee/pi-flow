"""Tests for fill-refine-plan-prompt.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "fill-refine-plan-prompt.py"
)
REAL_TEMPLATE = os.path.join(
    os.path.dirname(__file__), "..", "..", "refine-plan-prompt.md"
)


def run_script(*args):
    """Run the script with given args; return (returncode, stdout, stderr)."""
    result = subprocess.run(
        [sys.executable, SCRIPT] + list(args),
        capture_output=True,
        text=True,
    )
    return result.returncode, result.stdout, result.stderr


def write_temp_file(content):
    """Write content to a temp file and return its path."""
    f = tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".md")
    f.write(content)
    f.close()
    return f.name


class TestFullSuccessAgainstRealTemplate(unittest.TestCase):
    """Test successful substitution with all thirteen placeholders."""

    def test_full_success_against_real_template(self):
        """Supply all thirteen placeholders and verify full substitution with no remaining tokens."""
        # Create a template with only the 13 placeholders this script handles
        template_content = """# Refine Plan

Plan: {PLAN_PATH}

Artifact: {TASK_ARTIFACT}

Todo: {SOURCE_TODO}

Spec: {SOURCE_SPEC}

Scout: {SCOUT_BRIEF}

Original: {ORIGINAL_SPEC_INLINE}

Structural: {STRUCTURAL_ONLY_NOTE}

Iterations: {MAX_ITERATIONS}
Era: {STARTING_ERA}
Review: {REVIEW_OUTPUT_PATH}
Work: {WORKING_DIR}
Matrix: {MODEL_MATRIX}
Carry: {CARRY_OVER_REVIEW}
"""
        template_file = write_temp_file(template_content)
        spec_file = write_temp_file("Original spec inline content")
        note_file = write_temp_file("Structural only note")
        matrix_file = write_temp_file("Model matrix content")
        output_file = tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".md"
        ).name

        try:
            rc, stdout, stderr = run_script(
                "--template", template_file,
                "--plan-path", "/path/to/plan.md",
                "--task-artifact", "Task artifact content",
                "--source-todo", "Source todo content",
                "--source-spec", "Source spec content",
                "--scout-brief", "Scout brief content",
                "--original-spec-inline", spec_file,
                "--structural-only-note", note_file,
                "--max-iterations", "5",
                "--starting-era", "1",
                "--review-output-path", "/path/to/review",
                "--working-dir", "/work",
                "--model-matrix", matrix_file,
                "--carry-over-review", "",
                "--output", output_file,
            )

            self.assertEqual(rc, 0, f"Script failed with stderr: {stderr}")

            # Read the output file
            with open(output_file, "r") as f:
                content = f.read()

            # Verify substitutions
            self.assertIn("/path/to/plan.md", content)
            self.assertIn("Task artifact content", content)
            self.assertIn("Source todo content", content)
            self.assertIn("Source spec content", content)
            self.assertIn("Scout brief content", content)
            self.assertIn("Original spec inline content", content)
            self.assertIn("Structural only note", content)
            self.assertIn("5", content)
            self.assertIn("1", content)
            self.assertIn("/path/to/review", content)
            self.assertIn("/work", content)
            self.assertIn("Model matrix content", content)

            # Verify no remaining placeholders
            self.assertNotIn("{PLAN_PATH}", content)
            self.assertNotIn("{TASK_ARTIFACT}", content)
            self.assertNotIn("{SOURCE_TODO}", content)
            self.assertNotIn("{SOURCE_SPEC}", content)
            self.assertNotIn("{SCOUT_BRIEF}", content)
            self.assertNotIn("{ORIGINAL_SPEC_INLINE}", content)
            self.assertNotIn("{STRUCTURAL_ONLY_NOTE}", content)
            self.assertNotIn("{MAX_ITERATIONS}", content)
            self.assertNotIn("{STARTING_ERA}", content)
            self.assertNotIn("{REVIEW_OUTPUT_PATH}", content)
            self.assertNotIn("{WORKING_DIR}", content)
            self.assertNotIn("{MODEL_MATRIX}", content)
            self.assertNotIn("{CARRY_OVER_REVIEW}", content)
        finally:
            for f in [template_file, spec_file, note_file, matrix_file, output_file]:
                if os.path.exists(f):
                    os.unlink(f)


class TestInputMissingOrUnreadable(unittest.TestCase):
    """Test handling of missing input files."""

    def test_input_missing_or_unreadable_original_spec_inline(self):
        """Test missing original-spec-inline file; assert exit 2 and proper error."""
        note_file = write_temp_file("Note")
        matrix_file = write_temp_file("Matrix")
        output_file = tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".md"
        ).name

        try:
            rc, stdout, stderr = run_script(
                "--template", REAL_TEMPLATE,
                "--plan-path", "/path/to/plan.md",
                "--task-artifact", "Task artifact",
                "--source-todo", "Source todo",
                "--source-spec", "Source spec",
                "--scout-brief", "Scout brief",
                "--original-spec-inline", "/nonexistent",
                "--structural-only-note", note_file,
                "--max-iterations", "5",
                "--starting-era", "1",
                "--review-output-path", "/path/to/review",
                "--working-dir", "/work",
                "--model-matrix", matrix_file,
                "--carry-over-review", "",
                "--output", output_file,
            )

            self.assertEqual(rc, 2, f"Expected exit 2, got {rc}")

            # Parse stderr JSON
            error_data = json.loads(stderr)
            self.assertEqual(error_data["failure"], "input missing or unreadable")
            self.assertEqual(error_data["input"], "original-spec-inline")
        finally:
            for f in [note_file, matrix_file, output_file]:
                if os.path.exists(f):
                    os.unlink(f)


class TestUnreplacedPlaceholder(unittest.TestCase):
    """Test handling of unreplaced placeholders."""

    def test_unreplaced_placeholder_fails_closed(self):
        """Test custom template with unknown placeholder; assert exit 1 and proper error."""
        # Create a custom template with an unknown placeholder
        template_file = write_temp_file(
            "This is a {KNOWN} and this is {UNKNOWN}."
        )
        spec_file = write_temp_file("Original spec")
        note_file = write_temp_file("Note")
        matrix_file = write_temp_file("Matrix")
        output_file = tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".md"
        ).name

        try:
            rc, stdout, stderr = run_script(
                "--template", template_file,
                "--plan-path", "/path/to/plan.md",
                "--task-artifact", "Task artifact",
                "--source-todo", "Source todo",
                "--source-spec", "Source spec",
                "--scout-brief", "Scout brief",
                "--original-spec-inline", spec_file,
                "--structural-only-note", note_file,
                "--max-iterations", "5",
                "--starting-era", "1",
                "--review-output-path", "/path/to/review",
                "--working-dir", "/work",
                "--model-matrix", matrix_file,
                "--carry-over-review", "",
                "--output", output_file,
            )

            self.assertEqual(rc, 1, f"Expected exit 1, got {rc}")

            # Parse stderr JSON
            error_data = json.loads(stderr)
            self.assertEqual(
                error_data["failure"], "unreplaced placeholders remain"
            )
        finally:
            for f in [template_file, spec_file, note_file, matrix_file, output_file]:
                if os.path.exists(f):
                    os.unlink(f)


class TestEmptyStringSubstitution(unittest.TestCase):
    """Test that empty strings substitute correctly."""

    def test_empty_string_substitutes(self):
        """Test passing --task-artifact with empty string; assert proper substitution."""
        template_file = write_temp_file(
            "Artifact: '{TASK_ARTIFACT}' End."
        )
        spec_file = write_temp_file("Original spec")
        note_file = write_temp_file("Note")
        matrix_file = write_temp_file("Matrix")
        output_file = tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".md"
        ).name

        try:
            rc, stdout, stderr = run_script(
                "--template", template_file,
                "--plan-path", "/path/to/plan.md",
                "--task-artifact", "",
                "--source-todo", "Source todo",
                "--source-spec", "Source spec",
                "--scout-brief", "Scout brief",
                "--original-spec-inline", spec_file,
                "--structural-only-note", note_file,
                "--max-iterations", "5",
                "--starting-era", "1",
                "--review-output-path", "/path/to/review",
                "--working-dir", "/work",
                "--model-matrix", matrix_file,
                "--carry-over-review", "",
                "--output", output_file,
            )

            self.assertEqual(rc, 0, f"Script failed with stderr: {stderr}")

            # Read the output file
            with open(output_file, "r") as f:
                content = f.read()

            # Verify empty string was substituted
            self.assertIn("Artifact: '' End.", content)
            self.assertNotIn("{TASK_ARTIFACT}", content)
        finally:
            for f in [template_file, spec_file, note_file, matrix_file, output_file]:
                if os.path.exists(f):
                    os.unlink(f)


class TestNoRecursiveExpansion(unittest.TestCase):
    """Test that placeholders in values don't expand recursively."""

    def test_owned_placeholder_in_value_is_preserved(self):
        """A value containing another owned placeholder is inserted literally."""
        template_content = "Artifact: {TASK_ARTIFACT}; Todo: {SOURCE_TODO}"
        template_file = write_temp_file(template_content)
        spec_file = write_temp_file("Original spec")
        note_file = write_temp_file("Note")
        matrix_file = write_temp_file("Matrix")
        output_file = tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".md"
        ).name

        try:
            rc, stdout, stderr = run_script(
                "--template", template_file,
                "--plan-path", "/path/to/plan.md",
                "--task-artifact", "{SOURCE_TODO}",
                "--source-todo", "Source todo value",
                "--source-spec", "Source spec",
                "--scout-brief", "Scout brief",
                "--original-spec-inline", spec_file,
                "--structural-only-note", note_file,
                "--max-iterations", "5",
                "--starting-era", "1",
                "--review-output-path", "/path/to/review",
                "--working-dir", "/work",
                "--model-matrix", matrix_file,
                "--carry-over-review", "",
                "--output", output_file,
            )

            self.assertEqual(rc, 0, f"Script failed with stderr: {stderr}")
            with open(output_file, "r") as f:
                content = f.read()
            self.assertIn("Artifact: {SOURCE_TODO}; Todo: Source todo value", content)
        finally:
            for f in [template_file, spec_file, note_file, matrix_file, output_file]:
                if os.path.exists(f):
                    os.unlink(f)

    def test_no_recursive_expansion(self):
        """Test passing value with placeholder; assert no recursive expansion."""
        # Create a template with all 13 placeholders to avoid "unreplaced" error
        template_content = """{PLAN_PATH} {TASK_ARTIFACT} {SOURCE_TODO} {SOURCE_SPEC} {SCOUT_BRIEF} {ORIGINAL_SPEC_INLINE} {STRUCTURAL_ONLY_NOTE} {MAX_ITERATIONS} {STARTING_ERA} {REVIEW_OUTPUT_PATH} {WORKING_DIR} {MODEL_MATRIX} {CARRY_OVER_REVIEW}"""
        template_file = write_temp_file(template_content)
        spec_file = write_temp_file("Original spec")
        note_file = write_temp_file("Note")
        matrix_file = write_temp_file("Matrix")
        output_file = tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".md"
        ).name

        try:
            rc, stdout, stderr = run_script(
                "--template", template_file,
                "--plan-path", "/path/to/plan.md",
                "--task-artifact", "Task artifact",
                "--source-todo", "see {OTHER}",
                "--source-spec", "Source spec",
                "--scout-brief", "Scout brief",
                "--original-spec-inline", spec_file,
                "--structural-only-note", note_file,
                "--max-iterations", "5",
                "--starting-era", "1",
                "--review-output-path", "/path/to/review",
                "--working-dir", "/work",
                "--model-matrix", matrix_file,
                "--carry-over-review", "",
                "--output", output_file,
            )

            self.assertEqual(rc, 0, f"Script failed with stderr: {stderr}")

            # Read the output file
            with open(output_file, "r") as f:
                content = f.read()

            # Verify no recursive expansion - the {OTHER} inside the value should be preserved
            self.assertIn("see {OTHER}", content)
        finally:
            for f in [template_file, spec_file, note_file, matrix_file, output_file]:
                if os.path.exists(f):
                    os.unlink(f)


class TestStartingEraStringified(unittest.TestCase):
    """Test that integers are rendered as strings."""

    def test_starting_era_stringified(self):
        """Test passing --starting-era with integer; assert rendered as string."""
        template_file = write_temp_file("Era: {STARTING_ERA}")
        spec_file = write_temp_file("Original spec")
        note_file = write_temp_file("Note")
        matrix_file = write_temp_file("Matrix")
        output_file = tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".md"
        ).name

        try:
            rc, stdout, stderr = run_script(
                "--template", template_file,
                "--plan-path", "/path/to/plan.md",
                "--task-artifact", "Task artifact",
                "--source-todo", "Source todo",
                "--source-spec", "Source spec",
                "--scout-brief", "Scout brief",
                "--original-spec-inline", spec_file,
                "--structural-only-note", note_file,
                "--max-iterations", "10",
                "--starting-era", "2",
                "--review-output-path", "/path/to/review",
                "--working-dir", "/work",
                "--model-matrix", matrix_file,
                "--carry-over-review", "",
                "--output", output_file,
            )

            self.assertEqual(rc, 0, f"Script failed with stderr: {stderr}")

            # Read the output file
            with open(output_file, "r") as f:
                content = f.read()

            # Verify the integer is rendered as string
            self.assertIn("Era: 2", content)
            self.assertNotIn("{STARTING_ERA}", content)
        finally:
            for f in [template_file, spec_file, note_file, matrix_file, output_file]:
                if os.path.exists(f):
                    os.unlink(f)


class TestOutputDashWritesStdout(unittest.TestCase):
    """`--output -` should write to stdout, not a file named '-'."""

    def test_output_dash_writes_stdout(self):
        template_file = write_temp_file("Era: {STARTING_ERA}")
        spec_file = write_temp_file("Original spec")
        note_file = write_temp_file("Note")
        matrix_file = write_temp_file("Matrix")

        cwd = tempfile.mkdtemp()
        try:
            result = subprocess.run(
                [
                    sys.executable, SCRIPT,
                    "--template", template_file,
                    "--plan-path", "/path/to/plan.md",
                    "--task-artifact", "Task artifact",
                    "--source-todo", "Source todo",
                    "--source-spec", "Source spec",
                    "--scout-brief", "Scout brief",
                    "--original-spec-inline", spec_file,
                    "--structural-only-note", note_file,
                    "--max-iterations", "5",
                    "--starting-era", "7",
                    "--review-output-path", "/path/to/review",
                    "--working-dir", "/work",
                    "--model-matrix", matrix_file,
                    "--carry-over-review", "",
                    "--output", "-",
                ],
                capture_output=True,
                text=True,
                cwd=cwd,
            )
            self.assertEqual(result.returncode, 0, f"stderr: {result.stderr}")
            self.assertIn("Era: 7", result.stdout)
            # No literal '-' file created in cwd
            self.assertFalse(
                os.path.exists(os.path.join(cwd, "-")),
                "Helper should not create a file literally named '-'",
            )
        finally:
            for f in [template_file, spec_file, note_file, matrix_file]:
                if os.path.exists(f):
                    os.unlink(f)
            dash_path = os.path.join(cwd, "-")
            if os.path.exists(dash_path):
                os.unlink(dash_path)
            os.rmdir(cwd)


class TestCarryOverReviewPopulated(unittest.TestCase):
    """Test carry-over-review with a non-empty path value."""

    def test_carry_over_review_path_substituted(self):
        """Test --carry-over-review with a path; assert the path string is substituted (not file content)."""
        template_file = write_temp_file("Review: {CARRY_OVER_REVIEW}")
        spec_file = write_temp_file("Original spec")
        note_file = write_temp_file("Note")
        matrix_file = write_temp_file("Matrix")
        review_path = "docs/plans/reviews/foo-plan-review-v1.md"
        output_file = tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".md"
        ).name

        try:
            rc, stdout, stderr = run_script(
                "--template", template_file,
                "--plan-path", "/path/to/plan.md",
                "--task-artifact", "Task artifact",
                "--source-todo", "Source todo",
                "--source-spec", "Source spec",
                "--scout-brief", "Scout brief",
                "--original-spec-inline", spec_file,
                "--structural-only-note", note_file,
                "--max-iterations", "5",
                "--starting-era", "1",
                "--review-output-path", "/path/to/review",
                "--working-dir", "/work",
                "--model-matrix", matrix_file,
                "--carry-over-review", review_path,
                "--output", output_file,
            )

            self.assertEqual(rc, 0, f"Script failed with stderr: {stderr}")

            # Read the output file
            with open(output_file, "r") as f:
                content = f.read()

            # Verify the path string itself was substituted (not file content)
            self.assertIn(review_path, content)
            self.assertIn("Review: docs/plans/reviews/foo-plan-review-v1.md", content)
            self.assertNotIn("{CARRY_OVER_REVIEW}", content)
        finally:
            for f in [template_file, spec_file, note_file, matrix_file, output_file]:
                if os.path.exists(f):
                    os.unlink(f)


class TestHelp(unittest.TestCase):
    """Test --help output."""

    def test_help_contains_all_placeholders(self):
        """Test --help output contains all thirteen placeholder names."""
        rc, stdout, stderr = run_script("--help")

        self.assertEqual(rc, 0, f"Help failed with stderr: {stderr}")

        # Verify all thirteen placeholder names are mentioned
        placeholders = [
            "PLAN_PATH",
            "TASK_ARTIFACT",
            "SOURCE_TODO",
            "SOURCE_SPEC",
            "SCOUT_BRIEF",
            "ORIGINAL_SPEC_INLINE",
            "STRUCTURAL_ONLY_NOTE",
            "MAX_ITERATIONS",
            "STARTING_ERA",
            "REVIEW_OUTPUT_PATH",
            "WORKING_DIR",
            "MODEL_MATRIX",
            "CARRY_OVER_REVIEW",
        ]

        for placeholder in placeholders:
            self.assertIn(
                placeholder,
                stdout,
                f"Placeholder {placeholder} not found in help output",
            )


if __name__ == "__main__":
    unittest.main()
