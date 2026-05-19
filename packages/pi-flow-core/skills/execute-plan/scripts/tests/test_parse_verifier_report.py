"""Tests for parse-verifier-report.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "parse-verifier-report.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def run_script(*args):
    """Run the script with given args; return (returncode, parsed_json)."""
    result = subprocess.run(
        [sys.executable, SCRIPT] + list(args),
        capture_output=True,
        text=True,
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = None
    return result.returncode, data, result.stdout, result.stderr


def fixture(name):
    return os.path.join(FIXTURES, name)


def write_temp_report(content):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False)
    f.write(content)
    f.close()
    return f.name


def write_temp_recipes(recipes_array):
    """Write a phase1-recipes JSON file (array shape)."""
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    json.dump(recipes_array, f)
    f.close()
    return f.name


class TestPassReport(unittest.TestCase):
    def test_pass_report_exit_0(self):
        rc, data, _, _ = run_script(
            "--report", fixture("verifier-report-pass.md"),
            "--criteria-count", "2",
        )
        self.assertEqual(rc, 0)

    def test_pass_report_verdict_pass(self):
        _, data, _, _ = run_script(
            "--report", fixture("verifier-report-pass.md"),
            "--criteria-count", "2",
        )
        self.assertIsNotNone(data)
        self.assertEqual(data["verdict"], "PASS")

    def test_pass_report_two_criteria(self):
        _, data, _, _ = run_script(
            "--report", fixture("verifier-report-pass.md"),
            "--criteria-count", "2",
        )
        self.assertIsNotNone(data)
        self.assertEqual(len(data["per_criterion"]), 2)


class TestFailReport(unittest.TestCase):
    def test_fail_report_exit_nonzero(self):
        rc, _, _, _ = run_script(
            "--report", fixture("verifier-report-fail.md"),
            "--criteria-count", "2",
        )
        self.assertNotEqual(rc, 0)

    def test_fail_report_verdict_fail(self):
        _, data, _, _ = run_script(
            "--report", fixture("verifier-report-fail.md"),
            "--criteria-count", "2",
        )
        self.assertIsNotNone(data)
        self.assertEqual(data["verdict"], "FAIL")

    def test_fail_report_criterion_2_fail(self):
        _, data, _, _ = run_script(
            "--report", fixture("verifier-report-fail.md"),
            "--criteria-count", "2",
        )
        self.assertIsNotNone(data)
        # per_criterion is a list sorted by criterion number (0-indexed)
        self.assertEqual(data["per_criterion"][1]["verdict"], "FAIL")


class TestMalformedHeader(unittest.TestCase):
    def test_malformed_header_exit_nonzero(self):
        rc, _, _, _ = run_script(
            "--report", fixture("verifier-report-malformed.md"),
            "--criteria-count", "1",
        )
        self.assertNotEqual(rc, 0)

    def test_malformed_header_verdict_fail(self):
        _, data, _, _ = run_script(
            "--report", fixture("verifier-report-malformed.md"),
            "--criteria-count", "1",
        )
        self.assertIsNotNone(data)
        self.assertEqual(data["verdict"], "FAIL")

    def test_malformed_header_protocol_errors_nonempty(self):
        _, data, _, _ = run_script(
            "--report", fixture("verifier-report-malformed.md"),
            "--criteria-count", "1",
        )
        self.assertIsNotNone(data)
        self.assertTrue(len(data["protocol_errors"]) > 0)


class TestLowercaseVerdict(unittest.TestCase):
    def test_lowercase_pass_is_protocol_error(self):
        content = """## Phase 1 Evidence

## Per-Criterion Verdicts

[Criterion 1] pass
reason: lowercase verdict

## Overall Verdict

VERDICT: PASS
"""
        path = write_temp_report(content)
        try:
            rc, data, _, _ = run_script(
                "--report", path, "--criteria-count", "1"
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            self.assertTrue(len(data["protocol_errors"]) > 0)
        finally:
            os.unlink(path)


class TestExtraTokensAfterVerdict(unittest.TestCase):
    def test_extra_token_after_pass_is_protocol_error(self):
        content = """## Phase 1 Evidence

## Per-Criterion Verdicts

[Criterion 1] PASS extra
reason: trailing token after verdict

## Overall Verdict

VERDICT: PASS
"""
        path = write_temp_report(content)
        try:
            rc, data, _, _ = run_script(
                "--report", path, "--criteria-count", "1"
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            self.assertEqual(data["verdict"], "FAIL")
            errors = data["protocol_errors"]
            self.assertTrue(
                any("extra tokens" in e.lower() for e in errors),
                f"Expected extra-tokens malformed-header error: {errors}",
            )
            # Criterion must not be recorded as a valid PASS.
            self.assertEqual(data["per_criterion"], [])
        finally:
            os.unlink(path)

    def test_extra_token_after_fail_is_protocol_error(self):
        content = """## Phase 1 Evidence

## Per-Criterion Verdicts

[Criterion 1] FAIL because reasons
reason: trailing token after verdict

## Overall Verdict

VERDICT: FAIL
"""
        path = write_temp_report(content)
        try:
            rc, data, _, _ = run_script(
                "--report", path, "--criteria-count", "1"
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            self.assertEqual(data["verdict"], "FAIL")
            errors = data["protocol_errors"]
            self.assertTrue(
                any("extra tokens" in e.lower() for e in errors),
                f"Expected extra-tokens malformed-header error: {errors}",
            )
        finally:
            os.unlink(path)

    def test_trailing_whitespace_after_verdict_is_accepted(self):
        # Trailing spaces are not extra tokens; the line is stripped before
        # matching, so this must remain valid.
        content = (
            "## Phase 1 Evidence\n\n"
            "## Per-Criterion Verdicts\n\n"
            "[Criterion 1] PASS   \n"
            "reason: ok\n\n"
            "## Overall Verdict\n\n"
            "VERDICT: PASS\n"
        )
        path = write_temp_report(content)
        try:
            rc, data, _, _ = run_script(
                "--report", path, "--criteria-count", "1"
            )
            self.assertEqual(rc, 0)
            self.assertEqual(data["verdict"], "PASS")
            self.assertEqual(len(data["per_criterion"]), 1)
            self.assertEqual(data["per_criterion"][0]["verdict"], "PASS")
        finally:
            os.unlink(path)


class TestDuplicateCriterion(unittest.TestCase):
    def test_duplicate_criterion_protocol_error(self):
        content = """## Phase 1 Evidence

## Per-Criterion Verdicts

[Criterion 1] PASS
reason: first

[Criterion 1] PASS
reason: duplicate

## Overall Verdict

VERDICT: PASS
"""
        path = write_temp_report(content)
        try:
            rc, data, _, _ = run_script(
                "--report", path, "--criteria-count", "1"
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            errors = data["protocol_errors"]
            self.assertTrue(
                any("duplicate" in e.lower() or "criterion 1" in e.lower() for e in errors),
                f"Expected duplicate error in protocol_errors: {errors}",
            )
        finally:
            os.unlink(path)


class TestMissingCriterion(unittest.TestCase):
    def test_missing_criterion_protocol_error(self):
        content = """## Phase 1 Evidence

## Per-Criterion Verdicts

[Criterion 1] PASS
reason: ok

[Criterion 3] PASS
reason: ok

## Overall Verdict

VERDICT: PASS
"""
        path = write_temp_report(content)
        try:
            rc, data, _, _ = run_script(
                "--report", path, "--criteria-count", "3"
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            errors = data["protocol_errors"]
            self.assertTrue(
                any("2" in e for e in errors),
                f"Expected mention of criterion 2 missing in protocol_errors: {errors}",
            )
        finally:
            os.unlink(path)


class TestOutOfRangeCriterion(unittest.TestCase):
    def test_out_of_range_criterion_protocol_error(self):
        content = """## Phase 1 Evidence

## Per-Criterion Verdicts

[Criterion 1] PASS
reason: ok

[Criterion 2] PASS
reason: ok

[Criterion 3] PASS
reason: ok

[Criterion 4] PASS
reason: out of range

## Overall Verdict

VERDICT: PASS
"""
        path = write_temp_report(content)
        try:
            rc, data, _, _ = run_script(
                "--report", path, "--criteria-count", "3"
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            errors = data["protocol_errors"]
            self.assertTrue(
                any("4" in e for e in errors),
                f"Expected mention of out-of-range criterion 4 in protocol_errors: {errors}",
            )
        finally:
            os.unlink(path)


class TestEvidenceBlockMissingField(unittest.TestCase):
    def test_missing_stderr_field_protocol_error(self):
        recipes_path = write_temp_recipes(
            [{"criterion_n": 1, "recipe": "python3 myscript.py --help"}]
        )
        try:
            rc, data, _, _ = run_script(
                "--report", fixture("verifier-report-evidence-malformed.md"),
                "--criteria-count", "1",
                "--phase1-recipes-json", recipes_path,
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            errors = data["protocol_errors"]
            self.assertIn(
                "verifier phase-1 evidence block malformed at criterion 1: stderr field missing",
                errors,
            )
        finally:
            os.unlink(recipes_path)


class TestMissingEvidenceBlock(unittest.TestCase):
    def test_missing_evidence_block_for_command_criterion(self):
        content = """## Phase 1 Evidence

## Per-Criterion Verdicts

[Criterion 1] PASS
reason: ok

## Overall Verdict

VERDICT: PASS
"""
        path = write_temp_report(content)
        recipes_path = write_temp_recipes(
            [{"criterion_n": 1, "recipe": "python3 myscript.py --help"}]
        )
        try:
            rc, data, _, _ = run_script(
                "--report", path,
                "--criteria-count", "1",
                "--phase1-recipes-json", recipes_path,
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            errors = data["protocol_errors"]
            self.assertIn(
                "verifier missing evidence block for command-style criterion 1",
                errors,
            )
        finally:
            os.unlink(path)
            os.unlink(recipes_path)


class TestCommandNotMatchingRecipe(unittest.TestCase):
    def test_command_not_matching_recipe_protocol_error(self):
        content = """## Phase 1 Evidence

[Evidence for Criterion 1]
command: python3 myscript.py --wrong-flag
exit_code: 0
stdout: usage
stderr:

## Per-Criterion Verdicts

[Criterion 1] PASS
reason: ok

## Overall Verdict

VERDICT: PASS
"""
        path = write_temp_report(content)
        recipes_path = write_temp_recipes(
            [{"criterion_n": 1, "recipe": "python3 myscript.py --help"}]
        )
        try:
            rc, data, _, _ = run_script(
                "--report", path,
                "--criteria-count", "1",
                "--phase1-recipes-json", recipes_path,
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            errors = data["protocol_errors"]
            self.assertTrue(
                any("verifier ran command not matching any phase-1 recipe:" in e for e in errors),
                f"Expected recipe-mismatch error in protocol_errors: {errors}",
            )
        finally:
            os.unlink(path)
            os.unlink(recipes_path)


class TestExtraEvidenceCommand(unittest.TestCase):
    def test_extra_evidence_command_with_empty_recipes_protocol_error(self):
        # phase1-recipes-json is [] but report has a Phase 1 evidence command.
        content = """## Phase 1 Evidence

[Evidence for Criterion 1]
command: echo unexpected
exit_code: 0
stdout: unexpected
stderr:

## Per-Criterion Verdicts

[Criterion 1] PASS
reason: ok

## Overall Verdict

VERDICT: PASS
"""
        path = write_temp_report(content)
        recipes_path = write_temp_recipes([])
        try:
            rc, data, _, _ = run_script(
                "--report", path,
                "--criteria-count", "1",
                "--phase1-recipes-json", recipes_path,
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            errors = data["protocol_errors"]
            self.assertTrue(
                any(
                    "verifier ran command not matching any phase-1 recipe: echo unexpected" in e
                    for e in errors
                ),
                f"Expected extra-command protocol error: {errors}",
            )
        finally:
            os.unlink(path)
            os.unlink(recipes_path)

    def test_extra_evidence_command_for_inspection_criterion_protocol_error(self):
        # Recipe only for criterion 1; criterion 2 is inspection-only but report
        # has an evidence block with command for it.
        content = """## Phase 1 Evidence

[Evidence for Criterion 1]
command: python3 myscript.py --help
exit_code: 0
stdout: usage
stderr:

[Evidence for Criterion 2]
command: echo unexpected
exit_code: 0
stdout: unexpected
stderr:

## Per-Criterion Verdicts

[Criterion 1] PASS
reason: ok

[Criterion 2] PASS
reason: ok

## Overall Verdict

VERDICT: PASS
"""
        path = write_temp_report(content)
        recipes_path = write_temp_recipes(
            [{"criterion_n": 1, "recipe": "python3 myscript.py --help"}]
        )
        try:
            rc, data, _, _ = run_script(
                "--report", path,
                "--criteria-count", "2",
                "--phase1-recipes-json", recipes_path,
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            errors = data["protocol_errors"]
            self.assertTrue(
                any(
                    "verifier ran command not matching any phase-1 recipe: echo unexpected" in e
                    for e in errors
                ),
                f"Expected extra-command protocol error: {errors}",
            )
        finally:
            os.unlink(path)
            os.unlink(recipes_path)


class TestPhase1RecipesPathInvalid(unittest.TestCase):
    def test_phase1_recipes_missing_file_protocol_error(self):
        rc, data, _, _ = run_script(
            "--report", fixture("verifier-report-pass.md"),
            "--criteria-count", "2",
            "--phase1-recipes-json", "/nonexistent/path/recipes.json",
        )
        self.assertNotEqual(rc, 0)
        self.assertIsNotNone(data)
        errors = data["protocol_errors"]
        self.assertTrue(
            any("phase1-recipes-json invalid" in e for e in errors),
            f"Expected phase1-recipes-json invalid error: {errors}",
        )

    def test_phase1_recipes_object_shape_protocol_error(self):
        # Old object shape {"1": "cmd"} must be rejected; only array shape is accepted.
        recipes_path = write_temp_recipes_raw(json.dumps({"1": "python3 myscript.py --help"}))
        try:
            rc, data, _, _ = run_script(
                "--report", fixture("verifier-report-pass.md"),
                "--criteria-count", "2",
                "--phase1-recipes-json", recipes_path,
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            errors = data["protocol_errors"]
            self.assertTrue(
                any("phase1-recipes-json invalid" in e for e in errors),
                f"Expected phase1-recipes-json invalid error: {errors}",
            )
        finally:
            os.unlink(recipes_path)

    def test_phase1_recipes_array_shape_accepted(self):
        recipes_path = write_temp_recipes(
            [{"criterion_n": 1, "recipe": "python3 myscript.py --help"}]
        )
        try:
            rc, data, _, _ = run_script(
                "--report", fixture("verifier-report-evidence-malformed.md"),
                "--criteria-count", "1",
                "--phase1-recipes-json", recipes_path,
            )
            # Recipe matches the command in the report; failure here comes only
            # from the missing stderr field, not from a recipes-shape error.
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            errors = data["protocol_errors"]
            self.assertFalse(
                any("phase1-recipes-json invalid" in e for e in errors),
                f"Array-shape recipes file must not be rejected: {errors}",
            )
        finally:
            os.unlink(recipes_path)


def write_temp_recipes_raw(text):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    f.write(text)
    f.close()
    return f.name


class TestPerCriterionFailOverridesOverallPass(unittest.TestCase):
    def test_per_criterion_fail_with_overall_pass_yields_fail(self):
        """A single per-criterion FAIL must force final FAIL even if VERDICT: PASS."""
        content = """## Phase 1 Evidence

## Per-Criterion Verdicts

[Criterion 1] PASS
reason: ok

[Criterion 2] FAIL
reason: actually broken

## Overall Verdict

VERDICT: PASS
"""
        path = write_temp_report(content)
        try:
            rc, data, _, _ = run_script(
                "--report", path, "--criteria-count", "2"
            )
            self.assertNotEqual(rc, 0, "Per-criterion FAIL must produce non-zero exit")
            self.assertIsNotNone(data)
            self.assertEqual(
                data["verdict"], "FAIL",
                "Final verdict must be FAIL when any per-criterion is FAIL",
            )
        finally:
            os.unlink(path)


class TestPerCriterionReason(unittest.TestCase):
    def test_fail_report_includes_reason_text(self):
        _, data, _, _ = run_script(
            "--report", fixture("verifier-report-fail.md"),
            "--criteria-count", "2",
        )
        self.assertIsNotNone(data)
        # Each per_criterion entry must include 'reason'.
        c1 = data["per_criterion"][0]
        c2 = data["per_criterion"][1]
        self.assertIn("reason", c1)
        self.assertIn("reason", c2)
        self.assertEqual(c1["criterion"], 1)
        self.assertEqual(c2["criterion"], 2)
        self.assertIn("--help flag", c1["reason"])
        self.assertIn("non-zero exit", c2["reason"])


class TestFencedPayload(unittest.TestCase):
    def _run_fixture(self):
        return run_script(
            "--report", fixture("verifier-report-fenced-payload.md"),
            "--criteria-count", "1",
        )

    def test_fenced_payload_exit_0(self):
        rc, _, _, _ = self._run_fixture()
        self.assertEqual(rc, 0)

    def test_fenced_payload_verdict_pass(self):
        _, data, _, _ = self._run_fixture()
        self.assertIsNotNone(data)
        self.assertEqual(data["verdict"], "PASS")

    def test_fenced_payload_one_evidence_block(self):
        _, data, _, _ = self._run_fixture()
        self.assertIsNotNone(data)
        self.assertEqual(list(data["phase1_evidence"].keys()), ["1"])

    def test_fenced_payload_stdout_preserved_verbatim(self):
        _, data, _, _ = self._run_fixture()
        self.assertIsNotNone(data)
        stdout = data["phase1_evidence"]["1"]["stdout"]
        self.assertIn("## Per-Criterion Verdicts", stdout)
        self.assertIn("[Evidence for Criterion 99]", stdout)
        self.assertIn("[Criterion 99] PASS", stdout)
        self.assertIn("VERDICT: FAIL", stdout)

    def test_fenced_payload_no_fake_criterion_99(self):
        _, data, _, _ = self._run_fixture()
        self.assertIsNotNone(data)
        # No fake criterion 99 leaked into per_criterion or evidence keys.
        self.assertNotIn("99", data["phase1_evidence"])
        self.assertFalse(
            any(c["criterion"] == 99 for c in data["per_criterion"]),
            "fake [Criterion 99] inside fenced payload must not be parsed",
        )

    def test_fenced_payload_one_criterion_pass(self):
        _, data, _, _ = self._run_fixture()
        self.assertIsNotNone(data)
        self.assertEqual(len(data["per_criterion"]), 1)
        self.assertEqual(data["per_criterion"][0]["verdict"], "PASS")

    def test_fenced_payload_no_protocol_errors(self):
        _, data, _, _ = self._run_fixture()
        self.assertIsNotNone(data)
        self.assertEqual(data["protocol_errors"], [])


class TestFencedSectionDelimiter(unittest.TestCase):
    def test_fenced_h2_does_not_split_section(self):
        """A fenced ``## Fake Section`` line inside Per-Criterion Verdicts must
        not start a new top-level section, and the surrounding criterion under
        the real section is still discovered."""
        content = (
            "## Phase 1 Evidence\n\n"
            "## Per-Criterion Verdicts\n\n"
            "[Criterion 1] PASS\n"
            "reason: ok\n\n"
            "```\n"
            "## Fake Section\n"
            "[Criterion 2] FAIL\n"
            "```\n\n"
            "## Overall Verdict\n\n"
            "VERDICT: PASS\n"
        )
        path = write_temp_report(content)
        try:
            rc, data, _, _ = run_script(
                "--report", path, "--criteria-count", "1"
            )
            self.assertEqual(rc, 0, f"Expected PASS exit; got data={data}")
            self.assertEqual(data["verdict"], "PASS")
            # Real criterion 1 still discovered.
            self.assertEqual(len(data["per_criterion"]), 1)
            self.assertEqual(data["per_criterion"][0]["criterion"], 1)
            self.assertEqual(data["per_criterion"][0]["verdict"], "PASS")
            # Fake [Criterion 2] inside fence must not leak.
            self.assertFalse(
                any(c["criterion"] == 2 for c in data["per_criterion"]),
                "fake [Criterion 2] inside fence must not be parsed",
            )
            self.assertEqual(data["protocol_errors"], [])
        finally:
            os.unlink(path)


class TestFencedReasonExtraction(unittest.TestCase):
    def test_fenced_reason_does_not_yield_fake_criterion(self):
        """A fenced reason: block containing fake [Criterion 2] FAIL lines must
        not be picked up as a second criterion. With --criteria-count 2, the
        only protocol error should be the genuinely-missing criterion 2."""
        content = (
            "## Phase 1 Evidence\n\n"
            "## Per-Criterion Verdicts\n\n"
            "[Criterion 1] PASS\n"
            "reason:\n"
            "```\n"
            "[Criterion 2] FAIL\n"
            "embedded fake content\n"
            "```\n\n"
            "## Overall Verdict\n\n"
            "VERDICT: PASS\n"
        )
        path = write_temp_report(content)
        try:
            rc, data, _, _ = run_script(
                "--report", path, "--criteria-count", "2"
            )
            self.assertNotEqual(rc, 0)
            self.assertIsNotNone(data)
            # Fake criterion 2 must not be reported as parsed.
            self.assertEqual(len(data["per_criterion"]), 1)
            self.assertEqual(data["per_criterion"][0]["criterion"], 1)
            errors = data["protocol_errors"]
            # Missing criterion 2 must be reported.
            self.assertTrue(
                any(
                    "missing criterion header" in e and "[Criterion 2]" in e
                    for e in errors
                ),
                f"Expected missing-criterion-2 protocol error: {errors}",
            )
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
