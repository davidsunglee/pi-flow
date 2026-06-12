import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "validate-and-parse-plan-review.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
EXPECTED_PROVENANCE = "**Reviewer:** openai/reviewer-v1 via pi"


def write_temp_file(content):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as handle:
        handle.write(content)
        return handle.name


def write_temp_json(data):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as handle:
        json.dump(data, handle)
        return handle.name


def write_final_message(artifact_path):
    return write_temp_file(
        f"Review complete.\nREVIEW_ARTIFACT: {artifact_path}\n"
    )


def run_script(*args):
    return subprocess.run(
        [sys.executable, SCRIPT] + list(args),
        capture_output=True,
        text=True,
    )


class ValidateAndParsePlanReviewTest(unittest.TestCase):
    def setUp(self):
        self.flow_config = write_temp_json({
            "crossProviderModelTiers": {"capable": "openai/reviewer-v1"},
            "modelTiers": {"capable": "anthropic/reviewer-fallback"},
            "subagentDispatch": {
                "openai": "pi",
                "anthropic": "claude",
                "inline": "pi",
            },
            "executionPolicy": "guarded",
        })

    def tearDown(self):
        os.unlink(self.flow_config)

    def run_success_case(self, fixture_name):
        review_path = os.path.join(FIXTURES, fixture_name)
        final_message = write_final_message(review_path)
        try:
            proc = run_script(
                "--final-message", final_message,
                "--expected-path", review_path,
                "--reviewer-provenance", EXPECTED_PROVENANCE,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", self.flow_config,
            )
        finally:
            os.unlink(final_message)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    def test_parses_approved_fixture(self):
        data = self.run_success_case("review-approved.md")
        self.assertEqual(data["review_path"], os.path.join(FIXTURES, "review-approved.md"))
        self.assertEqual(data["verdict"], "Approved")
        self.assertEqual(data["critical_count"], 0)
        self.assertEqual(data["important_count"], 0)
        self.assertEqual(data["minor_count"], 1)
        self.assertEqual(data["blocking_findings_markdown"], "")

    def test_parses_approved_with_concerns_fixture(self):
        data = self.run_success_case("review-approved-with-concerns.md")
        self.assertEqual(data["verdict"], "Approved with concerns")
        self.assertEqual(data["critical_count"], 0)
        self.assertEqual(data["important_count"], 1)
        self.assertEqual(data["minor_count"], 0)
        self.assertIn("#### Important (Should Fix)", data["blocking_findings_markdown"])
        self.assertIn("README omits the targeted validation command", data["blocking_findings_markdown"])

    def test_parses_not_approved_fixture_and_extracts_only_blocking_findings(self):
        data = self.run_success_case("review-not-approved.md")
        self.assertEqual(data["verdict"], "Not approved")
        self.assertEqual(data["critical_count"], 1)
        self.assertEqual(data["important_count"], 1)
        self.assertEqual(data["minor_count"], 1)
        self.assertIn("#### Critical (Must Fix)", data["blocking_findings_markdown"])
        self.assertIn("#### Important (Should Fix)", data["blocking_findings_markdown"])
        self.assertIn("Parser output omits blocking findings markdown", data["blocking_findings_markdown"])
        self.assertIn("Edit helper contract does not name the output path field", data["blocking_findings_markdown"])
        self.assertNotIn("README example could mention fixture coverage", data["blocking_findings_markdown"])

    def test_parses_none_sections_fixture(self):
        data = self.run_success_case("review-none-sections.md")
        self.assertEqual(data["verdict"], "Approved")
        self.assertEqual(data["critical_count"], 0)
        self.assertEqual(data["important_count"], 0)
        self.assertEqual(data["minor_count"], 0)
        self.assertEqual(data["blocking_findings_markdown"], "")

    def test_missing_review_artifact_marker_fails_closed(self):
        final_message = write_temp_file("Review complete without a marker.\n")
        review_path = os.path.join(FIXTURES, "review-approved.md")
        try:
            proc = run_script(
                "--final-message", final_message,
                "--expected-path", review_path,
                "--reviewer-provenance", EXPECTED_PROVENANCE,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", self.flow_config,
            )
        finally:
            os.unlink(final_message)

        self.assertNotEqual(proc.returncode, 0)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "missing REVIEW_ARTIFACT marker")

    def test_path_mismatch_fails_closed(self):
        review_path = os.path.join(FIXTURES, "review-approved.md")
        final_message = write_final_message(review_path)
        wrong_path = os.path.join(FIXTURES, "review-not-approved.md")
        try:
            proc = run_script(
                "--final-message", final_message,
                "--expected-path", wrong_path,
                "--reviewer-provenance", EXPECTED_PROVENANCE,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", self.flow_config,
            )
        finally:
            os.unlink(final_message)

        self.assertNotEqual(proc.returncode, 0)
        err = json.loads(proc.stderr)
        self.assertTrue(err["failure"].startswith("path mismatch: expected "))

    def test_missing_or_empty_artifact_fails_closed(self):
        empty_review = write_temp_file("")
        final_message = write_final_message(empty_review)
        try:
            proc = run_script(
                "--final-message", final_message,
                "--expected-path", empty_review,
                "--reviewer-provenance", EXPECTED_PROVENANCE,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", self.flow_config,
            )
        finally:
            os.unlink(final_message)
            os.unlink(empty_review)

        self.assertNotEqual(proc.returncode, 0)
        err = json.loads(proc.stderr)
        self.assertTrue(err["failure"].startswith("missing or empty at "))

    def test_exact_provenance_mismatch_fails_closed(self):
        review_path = os.path.join(FIXTURES, "review-approved.md")
        final_message = write_final_message(review_path)
        try:
            proc = run_script(
                "--final-message", final_message,
                "--expected-path", review_path,
                "--reviewer-provenance", "**Reviewer:** anthropic/reviewer-fallback via claude",
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", self.flow_config,
            )
        finally:
            os.unlink(final_message)

        self.assertNotEqual(proc.returncode, 0)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "does not match supplied REVIEWER_PROVENANCE")

    def test_defense_in_depth_provenance_validation_failure(self):
        temp_dir = tempfile.mkdtemp()
        review_path = os.path.join(temp_dir, "review-inline.md")
        final_message = write_final_message(review_path)
        try:
            with open(review_path, "w") as handle:
                handle.write(
                    "**Reviewer:** inline/reviewer-v1 via pi\n\n"
                    "### Outcome\n\n"
                    "**Verdict:** Approved\n\n"
                    "**Reasoning:** Inline provenance should be rejected.\n\n"
                    "### Strengths\n\n_None._\n\n"
                    "### Issues\n\n"
                    "#### Critical (Must Fix)\n\n_None._\n\n"
                    "#### Important (Should Fix)\n\n_None._\n\n"
                    "#### Minor (Nice to Have)\n\n_None._\n\n"
                    "### Recommendations\n\n_None._\n"
                )
            override_tiers = write_temp_json({
                "crossProviderModelTiers": {"capable": "inline/reviewer-v1"},
                "modelTiers": {"capable": "anthropic/reviewer-fallback"},
                "subagentDispatch": {
                    "inline": "pi",
                    "anthropic": "claude",
                },
                "executionPolicy": "guarded",
            })
            try:
                proc = run_script(
                    "--final-message", final_message,
                    "--expected-path", review_path,
                    "--reviewer-provenance", "**Reviewer:** inline/reviewer-v1 via pi",
                    "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                    "--flow-config", override_tiers,
                )
            finally:
                os.unlink(override_tiers)
        finally:
            os.unlink(final_message)
            shutil.rmtree(temp_dir)

        self.assertNotEqual(proc.returncode, 0)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "inline-substring forbidden")

    def test_working_dir_forwarded_without_explicit_flow_config(self):
        """Script accepts --working-dir and resolves project-local config when --flow-config is omitted."""
        temp_dir = tempfile.mkdtemp()
        pi_dir = os.path.join(temp_dir, ".pi")
        os.makedirs(pi_dir)
        project_config = os.path.join(pi_dir, "flow.json")
        with open(project_config, "w") as handle:
            json.dump({
                "crossProviderModelTiers": {"capable": "openai/reviewer-v1"},
                "modelTiers": {"capable": "anthropic/reviewer-fallback"},
                "subagentDispatch": {
                    "openai": "pi",
                    "anthropic": "claude",
                    "inline": "pi",
                },
                "executionPolicy": "guarded",
            }, handle)

        review_path = os.path.join(FIXTURES, "review-approved.md")
        final_message = write_final_message(review_path)
        try:
            proc = run_script(
                "--final-message", final_message,
                "--expected-path", review_path,
                "--reviewer-provenance", EXPECTED_PROVENANCE,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--working-dir", temp_dir,
            )
        finally:
            os.unlink(final_message)
            shutil.rmtree(temp_dir)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["verdict"], "Approved")

    def test_missing_verdict_label_fails_closed(self):
        temp_dir = tempfile.mkdtemp()
        review_path = os.path.join(temp_dir, "review-no-verdict.md")
        final_message = write_final_message(review_path)
        try:
            with open(review_path, "w") as handle:
                handle.write(
                    EXPECTED_PROVENANCE + "\n\n"
                    "### Outcome\n\n"
                    "**Reasoning:** No verdict line is present.\n\n"
                    "### Strengths\n\n_None._\n\n"
                    "### Issues\n\n"
                    "#### Critical (Must Fix)\n\n_None._\n\n"
                    "#### Important (Should Fix)\n\n_None._\n\n"
                    "#### Minor (Nice to Have)\n\n_None._\n\n"
                    "### Recommendations\n\n_None._\n"
                )
            proc = run_script(
                "--final-message", final_message,
                "--expected-path", review_path,
                "--reviewer-provenance", EXPECTED_PROVENANCE,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", self.flow_config,
            )
        finally:
            os.unlink(final_message)
            shutil.rmtree(temp_dir)

        self.assertNotEqual(proc.returncode, 0)
        err = json.loads(proc.stderr)
        self.assertEqual(err["failure"], "missing or unrecognized Verdict label")


if __name__ == "__main__":
    unittest.main()
