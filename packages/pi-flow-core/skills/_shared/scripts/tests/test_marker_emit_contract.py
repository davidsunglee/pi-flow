"""Tests that every marker-emit prompt and agent definition references the new
_ARTIFACT marker family and instructs the dual-channel completion contract
(final assistant message line + subagent_done(message=...) terminal call).

These tests guard against regression of the rename + belt-and-suspenders
contract. Each prompt under test is read fresh from disk and asserted against
three rules:
  - contains the expected marker name (e.g., BRIEF_ARTIFACT)
  - contains a subagent_done(message="<MARKER>: ...") instruction
  - does NOT contain the old marker names (BRIEF_WRITTEN, SPEC_WRITTEN)

Tests assert string presence rather than dispatching real subagents."""
import os
import re
import unittest


REPO_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", "..")
)


def read(rel_path):
    abs_path = os.path.join(REPO_ROOT, rel_path)
    with open(abs_path, "r", encoding="utf-8") as fh:
        return fh.read()


# Marker name → list of (relative_path, kind) tuples to assert against.
# kind is informational; it surfaces in failure messages when an assertion fails.
PROMPTS_BY_MARKER = {
    "BRIEF_ARTIFACT": [
        ("packages/pi-flow-core/skills/scout/scout-prompt.md", "prompt"),
        ("packages/pi-flow-core/agents/scout.md", "agent"),
    ],
    "SPEC_ARTIFACT": [
        ("packages/pi-flow-core/skills/define-spec/spec-design-procedure.md", "prompt"),
        ("packages/pi-flow-core/agents/spec-designer.md", "agent"),
    ],
    "PLAN_ARTIFACT": [
        ("packages/pi-flow-core/skills/generate-plan/generate-plan-prompt.md", "prompt"),
        ("packages/pi-flow-core/agents/planner.md", "agent"),
    ],
    "REVIEW_ARTIFACT": [
        ("packages/pi-flow-core/skills/requesting-code-review/review-code-prompt.md", "prompt"),
        ("packages/pi-flow-core/skills/generate-plan/review-plan-prompt.md", "prompt"),
        ("packages/pi-flow-core/agents/code-reviewer.md", "agent"),
        ("packages/pi-flow-core/agents/plan-reviewer.md", "agent"),
    ],
    "TEST_RESULT_ARTIFACT": [
        ("packages/pi-flow-core/skills/_shared/test-runner-prompt.md", "prompt"),
        ("packages/pi-flow-core/agents/test-runner.md", "agent"),
    ],
}

OLD_NAMES = ["BRIEF_WRITTEN", "SPEC_WRITTEN"]


class TestMarkerNameInPrompt(unittest.TestCase):
    def test_each_prompt_contains_its_marker_name(self):
        for marker, files in PROMPTS_BY_MARKER.items():
            for rel_path, kind in files:
                with self.subTest(marker=marker, file=rel_path, kind=kind):
                    body = read(rel_path)
                    self.assertIn(
                        marker, body,
                        msg=f"{rel_path} ({kind}) does not contain marker {marker}",
                    )


class TestSubagentDoneInstructionInPrompt(unittest.TestCase):
    def test_each_prompt_instructs_subagent_done_with_marker_message(self):
        # Match `subagent_done(message="<MARKER>: ...")` with optional surrounding
        # quotes/backticks/whitespace. Tolerate the marker being a literal value or
        # a placeholder (e.g., in the planner edit-mode note that mentions the
        # initial-generation marker name).
        for marker, files in PROMPTS_BY_MARKER.items():
            for rel_path, kind in files:
                with self.subTest(marker=marker, file=rel_path, kind=kind):
                    body = read(rel_path)
                    pattern = re.compile(
                        r"subagent_done\s*\(\s*message\s*=\s*[\"`]" + re.escape(marker) + r":",
                        re.MULTILINE,
                    )
                    self.assertRegex(
                        body, pattern,
                        msg=(
                            f"{rel_path} ({kind}) does not instruct "
                            f"subagent_done(message=\"{marker}: ...\")"
                        ),
                    )


class TestOldMarkerNamesAbsent(unittest.TestCase):
    def test_no_prompt_contains_old_marker_names(self):
        # Every file in the PROMPTS_BY_MARKER table must NOT mention the old names.
        all_files = []
        for files in PROMPTS_BY_MARKER.values():
            all_files.extend(files)
        for rel_path, kind in all_files:
            with self.subTest(file=rel_path, kind=kind):
                body = read(rel_path)
                for old in OLD_NAMES:
                    self.assertNotIn(
                        old, body,
                        msg=f"{rel_path} ({kind}) still contains old marker name {old}",
                    )


if __name__ == "__main__":
    unittest.main()
