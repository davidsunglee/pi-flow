import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "prepare-plan-edit-prompt.py"
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


class TestPreparePlanEditPrompt(unittest.TestCase):
    def test_builds_prompt_for_task_artifact_provenance(self):
        findings = write_temp_file(
            "#### Important (Should Fix)\n\n"
            "- **Task 2: Preserve exact provenance checks**\n"
            "  - **What:** Keep the exact first-line equality guard.\n"
            "  - **Why it matters:** The coordinator depends on byte-equal provenance.\n"
            "  - **Recommendation:** Carry the exact reviewer-provenance string into the helper.\n"
        )
        original_spec = write_temp_file("")

        try:
            proc = run_script(
                "--review-findings", findings,
                "--plan-path", "docs/plans/example-plan.md",
                "--task-artifact", "Task artifact: docs/tasks/example.md",
                "--source-todo", "Source todo: TODO-1234",
                "--source-spec", "Source spec: docs/specs/example.md",
                "--scout-brief", "Scout brief: docs/briefs/example.md",
                "--original-spec-inline", original_spec,
                "--output-path", "docs/plans/example-plan.md",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)

            data = json.loads(proc.stdout)
            self.assertTrue(os.path.exists(data["prompt_path"]))
            self.assertEqual(data["output_path"], "docs/plans/example-plan.md")

            with open(data["prompt_path"], "r") as handle:
                prompt = handle.read()

            self.assertIn("Plan artifact: docs/plans/example-plan.md", prompt)
            self.assertIn("Task artifact: docs/tasks/example.md", prompt)
            self.assertIn("Preserve exact provenance checks", prompt)
            self.assertIn("docs/plans/example-plan.md", prompt)
        finally:
            os.unlink(findings)
            os.unlink(original_spec)

    def test_builds_prompt_for_inline_spec_provenance(self):
        findings = write_temp_file(
            "#### Critical (Must Fix)\n\n"
            "- **Task 1: Add missing helper output field**\n"
            "  - **What:** The helper omits the computed review path.\n"
            "  - **Why it matters:** The coordinator cannot validate the artifact destination.\n"
            "  - **Recommendation:** Return the absolute review path in structured JSON.\n"
        )
        original_spec = write_temp_file("Inline todo text for refine-plan helper work.\n")

        try:
            proc = run_script(
                "--review-findings", findings,
                "--plan-path", "docs/plans/example-plan.md",
                "--task-artifact", "",
                "--source-todo", "",
                "--source-spec", "",
                "--scout-brief", "",
                "--original-spec-inline", original_spec,
                "--output-path", "docs/plans/example-plan.md",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)

            data = json.loads(proc.stdout)
            with open(data["prompt_path"], "r") as handle:
                prompt = handle.read()

            self.assertIn("Inline todo text for refine-plan helper work.", prompt)
            self.assertIn("Add missing helper output field", prompt)
            self.assertIn("Write the edited plan to `docs/plans/example-plan.md`", prompt)
        finally:
            os.unlink(findings)
            os.unlink(original_spec)

    def test_preserves_placeholder_like_text_in_inputs(self):
        findings = write_temp_file(
            "#### Important (Should Fix)\n\n"
            "- **Task 3: Preserve literal tokens**\n"
            "  - **What:** Keep {OUTPUT_PATH} literal in findings.\n"
            "  - **Why it matters:** Recursive placeholder expansion would corrupt the prompt.\n"
            "  - **Recommendation:** Preserve {REVIEW_FINDINGS} text byte-for-byte.\n"
        )
        original_spec = write_temp_file("Inline spec keeps {PLAN_ARTIFACT} literal.\n")

        try:
            proc = run_script(
                "--review-findings", findings,
                "--plan-path", "docs/plans/example-plan.md",
                "--task-artifact", "",
                "--source-todo", "",
                "--source-spec", "",
                "--scout-brief", "",
                "--original-spec-inline", original_spec,
                "--output-path", "docs/plans/example-plan.md",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)

            data = json.loads(proc.stdout)
            with open(data["prompt_path"], "r") as handle:
                prompt = handle.read()

            self.assertIn("Keep {OUTPUT_PATH} literal in findings.", prompt)
            self.assertIn("Preserve {REVIEW_FINDINGS} text byte-for-byte.", prompt)
            self.assertIn("Inline spec keeps {PLAN_ARTIFACT} literal.", prompt)
        finally:
            os.unlink(findings)
            os.unlink(original_spec)


if __name__ == "__main__":
    unittest.main()
