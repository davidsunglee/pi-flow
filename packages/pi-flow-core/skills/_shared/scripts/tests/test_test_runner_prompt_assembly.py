"""Tests for `test-runner-prompt.md` conditional `{PHASE_SECTION}` placeholder.

Verifies prompt assembly with and without a phase section using `fill-template.py`.
"""
import os
import json
import subprocess
import sys
import tempfile
import unittest

TEMPLATE = os.path.join(os.path.dirname(__file__), "..", "..", "test-runner-prompt.md")
FILL_SCRIPT = os.path.join(os.path.dirname(__file__), "..", "fill-template.py")


def run_fill(placeholders_dict):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(placeholders_dict, f)
        json_file = f.name
    try:
        result = subprocess.run(
            [sys.executable, FILL_SCRIPT, "--template", TEMPLATE, "--placeholders-json", json_file, "--output", "-"],
            capture_output=True,
            text=True,
        )
        return result.returncode, result.stdout
    finally:
        os.unlink(json_file)


def phase_label_to_section(phase_label):
    if phase_label is None or phase_label == "":
        return ""
    return "## Phase Label\n\n" + phase_label + "\n"


class TestPhaseSectionPresent(unittest.TestCase):
    def test_phase_section_included_when_supplied(self):
        self.assertEqual(phase_label_to_section("baseline"), "## Phase Label\n\nbaseline\n")
        returncode, stdout = run_fill({
            "TEST_COMMAND": "npm test",
            "WORKING_DIR": "/tmp",
            "ARTIFACT_PATH": "/tmp/x.log",
            "PHASE_SECTION": phase_label_to_section("baseline"),
        })
        self.assertEqual(returncode, 0)
        self.assertIn("\n## Phase Label\n", stdout)
        self.assertIn("baseline", stdout)


class TestPhaseSectionAbsent(unittest.TestCase):
    def test_phase_section_omitted_when_phase_label_is_empty_string(self):
        self.assertEqual(phase_label_to_section(""), "")
        returncode, stdout = run_fill({
            "TEST_COMMAND": "npm test",
            "WORKING_DIR": "/tmp",
            "ARTIFACT_PATH": "/tmp/x.log",
            "PHASE_SECTION": phase_label_to_section(""),
        })
        self.assertEqual(returncode, 0)
        self.assertNotIn("\n## Phase Label\n", stdout)

    def test_phase_section_omitted_when_phase_label_is_none(self):
        self.assertEqual(phase_label_to_section(None), "")
        returncode, stdout = run_fill({
            "TEST_COMMAND": "npm test",
            "WORKING_DIR": "/tmp",
            "ARTIFACT_PATH": "/tmp/x.log",
            "PHASE_SECTION": phase_label_to_section(None),
        })
        self.assertEqual(returncode, 0)
        self.assertNotIn("\n## Phase Label\n", stdout)


if __name__ == "__main__":
    unittest.main()
