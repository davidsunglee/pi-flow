import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "validate-review-provenance.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
COMPLETE = os.path.join(FIXTURES, "flow-complete.json")
REVIEW_GOOD = os.path.join(FIXTURES, "review-good.md")
REVIEW_MALFORMED = os.path.join(FIXTURES, "review-malformed-line.md")
REVIEW_INLINE = os.path.join(FIXTURES, "review-inline-forbidden.md")


def run(args):
    return subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True,
        text=True,
    )


def write_review(content):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False)
    f.write(content)
    f.close()
    return f.name


class TestValidateReviewProvenance(unittest.TestCase):

    def test_good_review_cross_provider(self):
        result = run([
            "--review-file", REVIEW_GOOD,
            "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
            "--flow-config", COMPLETE,
        ])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["matched_tier"], "crossProviderModelTiers.capable")
        self.assertEqual(data["provider_model"], "openai-codex/gpt-5.5")
        self.assertEqual(data["cli"], "codex")

    def test_good_review_fallback_capable(self):
        path = write_review("**Reviewer:** anthropic/claude-opus-4-7 via claude\n\n## Outcome\n\nGood.\n")
        try:
            result = run([
                "--review-file", path,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", COMPLETE,
            ])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["matched_tier"], "modelTiers.capable")
            self.assertEqual(data["provider_model"], "anthropic/claude-opus-4-7")
            self.assertEqual(data["cli"], "claude")
        finally:
            os.unlink(path)

    def test_malformed_format(self):
        result = run([
            "--review-file", REVIEW_MALFORMED,
            "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
            "--flow-config", COMPLETE,
        ])
        self.assertNotEqual(result.returncode, 0)
        data = json.loads(result.stderr)
        self.assertEqual(data["failure"], "format mismatch")

    def test_inline_forbidden(self):
        result = run([
            "--review-file", REVIEW_INLINE,
            "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
            "--flow-config", COMPLETE,
        ])
        self.assertNotEqual(result.returncode, 0)
        data = json.loads(result.stderr)
        self.assertEqual(data["failure"], "inline-substring forbidden")

    def test_model_cli_mismatch(self):
        path = write_review("**Reviewer:** anthropic/claude-sonnet-4-6 via claude\n\n## Outcome\n\nWrong model.\n")
        try:
            result = run([
                "--review-file", path,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", COMPLETE,
            ])
            self.assertNotEqual(result.returncode, 0)
            data = json.loads(result.stderr)
            self.assertTrue(data["failure"].startswith("model/cli mismatch"))
            self.assertIn("openai-codex/gpt-5.5", data["failure"])
            self.assertIn("anthropic/claude-opus-4-7", data["failure"])
            self.assertIn("anthropic/claude-sonnet-4-6", data["failure"])
        finally:
            os.unlink(path)

    def test_first_line_missing(self):
        path = write_review("   \n\n   \n")
        try:
            result = run([
                "--review-file", path,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", COMPLETE,
            ])
            self.assertNotEqual(result.returncode, 0)
            data = json.loads(result.stderr)
            self.assertEqual(data["failure"], "first non-empty line missing")
        finally:
            os.unlink(path)

    def test_missing_flow_config_file(self):
        result = run([
            "--review-file", REVIEW_GOOD,
            "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
            "--flow-config", "/nonexistent/path/flow.json",
        ])
        self.assertNotEqual(result.returncode, 0)
        data = json.loads(result.stderr)
        self.assertEqual(data["failure"], "flow.json missing or unreadable")

    def test_non_object_subagent_dispatch(self):
        data = {
            "modelTiers": {"capable": "anthropic/claude-opus-4-7"},
            "crossProviderModelTiers": {"capable": "openai-codex/gpt-5.5"},
            "subagentDispatch": "claude",
            "executionPolicy": "guarded",
        }
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(data, f)
            tmp_path = f.name
        try:
            result = run([
                "--review-file", REVIEW_GOOD,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", tmp_path,
            ])
            self.assertNotEqual(result.returncode, 0)
            payload = json.loads(result.stderr)
            self.assertEqual(payload["failure"], "flow.json missing or unreadable")
            self.assertNotIn("Traceback", result.stderr)
        finally:
            os.unlink(tmp_path)

    def test_non_object_flow_config_file(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump([], f)
            tmp_path = f.name
        try:
            result = run([
                "--review-file", REVIEW_GOOD,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", tmp_path,
            ])
            self.assertNotEqual(result.returncode, 0)
            data = json.loads(result.stderr)
            self.assertEqual(data["failure"], "flow.json missing or unreadable")
            self.assertNotIn("Traceback", result.stderr)
        finally:
            os.unlink(tmp_path)


    def test_non_string_tier_value_skipped(self):
        # Cross-provider tier has bogus non-string value; modelTiers.capable should still match.
        data = {
            "modelTiers": {"capable": "anthropic/claude-opus-4-7"},
            "crossProviderModelTiers": {"capable": 42},
            "subagentDispatch": {"anthropic": "claude"},
            "executionPolicy": "guarded",
        }
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as cf:
            json.dump(data, cf)
            cf_path = cf.name
        review_path = write_review("**Reviewer:** anthropic/claude-opus-4-7 via claude\n\n## Outcome\n\nGood.\n")
        try:
            result = run([
                "--review-file", review_path,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", cf_path,
            ])
            self.assertNotIn("Traceback", result.stderr)
            self.assertEqual(result.returncode, 0)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["matched_tier"], "modelTiers.capable")
        finally:
            os.unlink(cf_path)
            os.unlink(review_path)

    def test_slashless_tier_value_skipped(self):
        data = {
            "modelTiers": {"capable": "anthropic/claude-opus-4-7"},
            "crossProviderModelTiers": {"capable": "bogus-no-slash"},
            "subagentDispatch": {"anthropic": "claude", "bogus-no-slash": "pi"},
            "executionPolicy": "guarded",
        }
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as cf:
            json.dump(data, cf)
            cf_path = cf.name
        # Observed line uses the bogus slashless model — should NOT match.
        review_path = write_review("**Reviewer:** bogus-no-slash via pi\n\n## Outcome\n\nBad.\n")
        try:
            result = run([
                "--review-file", review_path,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", cf_path,
            ])
            # First line won't match REVIEWER_RE (no slash in model) → format mismatch.
            self.assertNotIn("Traceback", result.stderr)
            self.assertNotEqual(result.returncode, 0)
            payload = json.loads(result.stderr)
            # Either format mismatch (caught at regex) is fine; the key is no traceback.
            self.assertIn(payload["failure"], ("format mismatch",))
        finally:
            os.unlink(cf_path)
            os.unlink(review_path)

    def test_slashless_allowed_tier_does_not_crash(self):
        # Slashless value in an allowed tier should be skipped, falling back to other tiers.
        data = {
            "modelTiers": {"capable": "anthropic/claude-opus-4-7"},
            "crossProviderModelTiers": {"capable": "bogus-no-slash"},
            "subagentDispatch": {"anthropic": "claude"},
            "executionPolicy": "guarded",
        }
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as cf:
            json.dump(data, cf)
            cf_path = cf.name
        review_path = write_review("**Reviewer:** anthropic/claude-opus-4-7 via claude\n\n## Outcome\n\nGood.\n")
        try:
            result = run([
                "--review-file", review_path,
                "--allowed-tiers", "crossProviderModelTiers.capable,modelTiers.capable",
                "--flow-config", cf_path,
            ])
            self.assertNotIn("Traceback", result.stderr)
            self.assertEqual(result.returncode, 0)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["matched_tier"], "modelTiers.capable")
        finally:
            os.unlink(cf_path)
            os.unlink(review_path)


if __name__ == "__main__":
    unittest.main()
