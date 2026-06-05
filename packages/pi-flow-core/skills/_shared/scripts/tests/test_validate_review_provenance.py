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
        self.assertEqual(data["cli"], "pi")

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


if __name__ == "__main__":
    unittest.main()
