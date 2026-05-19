import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "resolve-model-dispatch.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
COMPLETE = os.path.join(FIXTURES, "model-tiers-complete.json")
NO_DISPATCH = os.path.join(FIXTURES, "model-tiers-no-dispatch.json")
MISSING_PROVIDER = os.path.join(FIXTURES, "model-tiers-missing-provider.json")


def run(args):
    return subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True,
        text=True,
    )


class TestResolveModelDispatch(unittest.TestCase):

    def test_capable_tier_resolves_anthropic(self):
        result = run(["--tier", "capable", "--agent", "coder", "--model-tiers", COMPLETE])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["model"], "anthropic/claude-opus-4-7")
        self.assertEqual(data["cli"], "claude")
        self.assertEqual(data["provider"], "anthropic")
        self.assertEqual(data["tier"], "capable")

    def test_cross_provider_capable_resolves_openai_codex(self):
        result = run(["--tier", "crossProvider.capable", "--agent", "verifier", "--model-tiers", COMPLETE])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["model"], "openai-codex/gpt-5.5")
        self.assertEqual(data["cli"], "pi")

    def test_template_1_missing_file(self):
        result = run(["--tier", "capable", "--agent", "coder", "--model-tiers", "/nonexistent"])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "~/.pi/agent/model-tiers.json missing or unreadable — cannot dispatch coder.\n",
        )

    def test_template_2_missing_tier(self):
        result = run(["--tier", "nosuchtier", "--agent", "coder", "--model-tiers", COMPLETE])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            'model-tiers.json has no usable "nosuchtier" model — cannot dispatch coder.\n',
        )

    def test_template_2_empty_tier_value(self):
        data = {
            "capable": "anthropic/claude-opus-4-7",
            "crossProvider": {"cheap": ""},
            "dispatch": {"anthropic": "claude"},
        }
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(data, f)
            tmp_path = f.name
        try:
            result = run(["--tier", "crossProvider.cheap", "--agent", "coder", "--model-tiers", tmp_path])
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(
                result.stderr,
                'model-tiers.json has no usable "crossProvider.cheap" model — cannot dispatch coder.\n',
            )
        finally:
            os.unlink(tmp_path)

    def test_template_3_missing_dispatch(self):
        result = run(["--tier", "capable", "--agent", "coder", "--model-tiers", NO_DISPATCH])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "model-tiers.json has no dispatch map — cannot dispatch coder.\n",
        )

    def test_template_4_missing_provider(self):
        result = run(["--tier", "crossProvider.capable", "--agent", "coder", "--model-tiers", MISSING_PROVIDER])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "model-tiers.json has no dispatch.openai-codex mapping for crossProvider.capable model openai-codex/gpt-5.5 — cannot dispatch coder.\n",
        )


if __name__ == "__main__":
    unittest.main()
