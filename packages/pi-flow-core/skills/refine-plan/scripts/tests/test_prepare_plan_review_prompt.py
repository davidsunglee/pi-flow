import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "prepare-plan-review-prompt.py"
)


def write_temp_file(content):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as handle:
        handle.write(content)
        return handle.name


def run_script(*args):
    return subprocess.run(
        [sys.executable, SCRIPT] + list(args),
        capture_output=True,
        text=True,
    )


class TestPreparePlanReviewPrompt(unittest.TestCase):
    def test_builds_prompt_and_metadata_for_primary_reviewer(self):
        original_spec = write_temp_file("Inline spec for review prompt helper.\n")
        structural_note = write_temp_file("")
        working_dir = tempfile.mkdtemp()

        try:
            proc = run_script(
                "--plan-path", "docs/plans/example-plan.md",
                "--task-artifact", "Task artifact: docs/tasks/example.md",
                "--source-todo", "Source todo: TODO-1234",
                "--source-spec", "Source spec: docs/specs/example.md",
                "--scout-brief", "Scout brief: docs/briefs/example.md",
                "--original-spec-inline", original_spec,
                "--structural-only-note", structural_note,
                "--review-output-path", "docs/plans/reviews/example-plan-review",
                "--working-dir", working_dir,
                "--current-era", "2",
                "--reviewer-model", "openai-codex/gpt-5.4",
                "--reviewer-cli", "pi",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)

            data = json.loads(proc.stdout)
            expected_review_path = os.path.realpath(os.path.join(
                working_dir,
                "docs/plans/reviews/example-plan-review-v2.md",
            ))
            self.assertEqual(data["review_path"], expected_review_path)
            self.assertEqual(
                data["reviewer_provenance"],
                "**Reviewer:** openai-codex/gpt-5.4 via pi",
            )
            self.assertTrue(os.path.isabs(data["review_path"]))
            self.assertTrue(os.path.exists(data["prompt_path"]))

            with open(data["prompt_path"], "r") as handle:
                prompt = handle.read()

            self.assertIn("Plan artifact: docs/plans/example-plan.md", prompt)
            self.assertIn(expected_review_path, prompt)
            self.assertIn("**Reviewer:** openai-codex/gpt-5.4 via pi", prompt)
            self.assertIn("Inline spec for review prompt helper.", prompt)
        finally:
            os.unlink(original_spec)
            os.unlink(structural_note)
            if os.path.isdir(working_dir):
                os.rmdir(working_dir)

    def test_supports_fallback_reviewer_inputs_and_preserves_literal_tokens(self):
        original_spec = write_temp_file(
            "Inline spec mentions {REVIEW_OUTPUT_PATH} literally.\n"
        )
        structural_note = write_temp_file(
            "Structural note mentions {REVIEWER_PROVENANCE}.\n"
        )
        working_dir = tempfile.mkdtemp()

        try:
            proc = run_script(
                "--plan-path", "docs/plans/example-plan.md",
                "--task-artifact", "Task artifact: docs/tasks/example.md",
                "--source-todo", "Source todo: TODO-1234",
                "--source-spec", "Source spec: {PLAN_ARTIFACT}",
                "--scout-brief", "Scout brief: docs/briefs/example.md",
                "--original-spec-inline", original_spec,
                "--structural-only-note", structural_note,
                "--review-output-path", "docs/plans/reviews/example-plan-review",
                "--working-dir", working_dir,
                "--current-era", "4",
                "--reviewer-model", "anthropic/claude-sonnet-4-6",
                "--reviewer-cli", "claude",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)

            data = json.loads(proc.stdout)
            self.assertEqual(
                data["reviewer_provenance"],
                "**Reviewer:** anthropic/claude-sonnet-4-6 via claude",
            )

            with open(data["prompt_path"], "r") as handle:
                prompt = handle.read()

            self.assertIn("Source spec: {PLAN_ARTIFACT}", prompt)
            self.assertIn("Inline spec mentions {REVIEW_OUTPUT_PATH} literally.", prompt)
            self.assertIn("Structural note mentions {REVIEWER_PROVENANCE}.", prompt)
        finally:
            os.unlink(original_spec)
            os.unlink(structural_note)
            if os.path.isdir(working_dir):
                os.rmdir(working_dir)

    def test_creates_distinct_readable_temp_prompts_on_each_run(self):
        original_spec = write_temp_file("Inline spec\n")
        structural_note = write_temp_file("")
        working_dir = tempfile.mkdtemp()

        try:
            first = run_script(
                "--plan-path", "docs/plans/example-plan.md",
                "--task-artifact", "",
                "--source-todo", "",
                "--source-spec", "",
                "--scout-brief", "",
                "--original-spec-inline", original_spec,
                "--structural-only-note", structural_note,
                "--review-output-path", "docs/plans/reviews/example-plan-review",
                "--working-dir", working_dir,
                "--current-era", "1",
                "--reviewer-model", "openai-codex/gpt-5.4",
                "--reviewer-cli", "pi",
            )
            second = run_script(
                "--plan-path", "docs/plans/example-plan.md",
                "--task-artifact", "",
                "--source-todo", "",
                "--source-spec", "",
                "--scout-brief", "",
                "--original-spec-inline", original_spec,
                "--structural-only-note", structural_note,
                "--review-output-path", "docs/plans/reviews/example-plan-review",
                "--working-dir", working_dir,
                "--current-era", "1",
                "--reviewer-model", "openai-codex/gpt-5.4",
                "--reviewer-cli", "pi",
            )

            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)

            first_data = json.loads(first.stdout)
            second_data = json.loads(second.stdout)
            self.assertNotEqual(first_data["prompt_path"], second_data["prompt_path"])

            for prompt_path in (first_data["prompt_path"], second_data["prompt_path"]):
                self.assertTrue(os.path.exists(prompt_path))
                with open(prompt_path, "r") as handle:
                    self.assertIn("### Outcome", handle.read())
        finally:
            os.unlink(original_spec)
            os.unlink(structural_note)
            if os.path.isdir(working_dir):
                os.rmdir(working_dir)


if __name__ == "__main__":
    unittest.main()
