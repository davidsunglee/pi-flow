"""Regression test: generate-plan/SKILL.md Step 3's `{OUTPUT_PATH}` definition
must specify an absolute path so that Step 3.4's parse-artifact-handoff
validation (`--expected-path <{OUTPUT_PATH} ... (absolute path)>`) and the
planner prompt's byte-equal `PLAN_ARTIFACT: {OUTPUT_PATH}` requirement
agree. If `{OUTPUT_PATH}` is a relative `docs/plans/...` string, the
planner emits the relative path and the orchestrator's absolute-path
validation fails at the handoff gate.
"""
import os
import re
import unittest


REPO_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", "..")
)
SKILL_PATH = os.path.join(REPO_ROOT, "packages/pi-flow-core/skills/generate-plan/SKILL.md")


class TestOutputPathAbsoluteContract(unittest.TestCase):
    def test_output_path_definition_is_absolute(self):
        with open(SKILL_PATH, "r", encoding="utf-8") as fh:
            body = fh.read()

        # Find the `{OUTPUT_PATH}` placeholder definition line.
        match = re.search(r"`\{OUTPUT_PATH\}`\s*[—-]\s*(.+)", body)
        self.assertIsNotNone(
            match,
            "SKILL.md must define `{OUTPUT_PATH}` placeholder",
        )
        definition_line = match.group(1)

        # The definition must indicate an absolute path. We accept either an
        # explicit "<working-dir>/..." prefix template or the literal word
        # "absolute" qualifying the path.
        is_absolute = (
            "<working-dir>/" in definition_line
            or "absolute" in definition_line.lower()
        )
        self.assertTrue(
            is_absolute,
            "`{OUTPUT_PATH}` definition must specify an absolute path "
            "(prefix the path with `<working-dir>/` or include the word "
            "'absolute'). Step 3.4's `--expected-path ... (absolute path)` "
            "validation and the planner prompt's byte-equal "
            "`PLAN_ARTIFACT: {OUTPUT_PATH}` emission both depend on this. "
            f"Got: {definition_line!r}"
        )

    def test_output_path_definition_not_bare_relative_docs_plans(self):
        with open(SKILL_PATH, "r", encoding="utf-8") as fh:
            body = fh.read()

        # Reject the legacy bare relative form
        # ``docs/plans/yyyy-MM-dd-<short-description>.md`` on the placeholder
        # definition line.
        match = re.search(r"`\{OUTPUT_PATH\}`\s*[—-]\s*(.+)", body)
        self.assertIsNotNone(match)
        definition_line = match.group(1)
        # The bare relative form starts with a backtick-quoted
        # ``docs/plans/...`` token immediately after the dash.
        self.assertNotRegex(
            definition_line,
            r"^\s*`docs/plans/",
            "SKILL.md `{OUTPUT_PATH}` definition still uses the bare "
            "relative `docs/plans/...` form. Step 3.4 validates against an "
            "absolute path; the planner will emit the relative path and "
            "validation will fail.",
        )


if __name__ == "__main__":
    unittest.main()
