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
COMPLETE = os.path.join(FIXTURES, "flow-complete.json")
NO_DISPATCH = os.path.join(FIXTURES, "flow-no-dispatch.json")
MISSING_PROVIDER = os.path.join(FIXTURES, "flow-missing-provider.json")


def run(args):
    return subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True,
        text=True,
    )


class TestResolveModelDispatch(unittest.TestCase):

    def test_capable_tier_resolves_anthropic(self):
        result = run(["--tier", "modelTiers.capable", "--agent", "coder", "--flow-config", COMPLETE])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["model"], "anthropic/claude-opus-4-7")
        self.assertEqual(data["cli"], "claude")
        self.assertEqual(data["provider"], "anthropic")
        self.assertEqual(data["tier"], "modelTiers.capable")
        self.assertEqual(data["executionPolicy"], "guarded")

    def test_cross_provider_capable_resolves_openai_codex(self):
        result = run(["--tier", "crossProviderModelTiers.capable", "--agent", "verifier", "--flow-config", COMPLETE])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["model"], "openai-codex/gpt-5.5")
        self.assertEqual(data["cli"], "pi")
        self.assertEqual(data["tier"], "crossProviderModelTiers.capable")
        self.assertEqual(data["executionPolicy"], "guarded")

    def test_template_1_missing_file(self):
        result = run(["--tier", "modelTiers.capable", "--agent", "coder", "--flow-config", "/nonexistent"])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "~/.pi/agent/flow.json missing or unreadable — cannot dispatch coder.\n",
        )

    def test_template_2_missing_tier(self):
        result = run(["--tier", "nosuchtier", "--agent", "coder", "--flow-config", COMPLETE])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            'flow.json has no usable "nosuchtier" model — cannot dispatch coder.\n',
        )

    def test_template_2_empty_tier_value(self):
        data = {
            "modelTiers": {"capable": "anthropic/claude-opus-4-7"},
            "crossProviderModelTiers": {"cheap": ""},
            "subagentDispatch": {"anthropic": "claude"},
            "executionPolicy": "guarded",
        }
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(data, f)
            tmp_path = f.name
        try:
            result = run(["--tier", "crossProviderModelTiers.cheap", "--agent", "coder", "--flow-config", tmp_path])
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(
                result.stderr,
                'flow.json has no usable "crossProviderModelTiers.cheap" model — cannot dispatch coder.\n',
            )
        finally:
            os.unlink(tmp_path)

    def test_template_3_missing_dispatch(self):
        result = run(["--tier", "modelTiers.capable", "--agent", "coder", "--flow-config", NO_DISPATCH])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "flow.json has no subagentDispatch map — cannot dispatch coder.\n",
        )

    def test_template_4_missing_provider(self):
        result = run(["--tier", "crossProviderModelTiers.capable", "--agent", "coder", "--flow-config", MISSING_PROVIDER])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "flow.json has no subagentDispatch.openai-codex mapping for crossProviderModelTiers.capable model openai-codex/gpt-5.5 — cannot dispatch coder.\n",
        )

    def run_with_config(self, data, tier="modelTiers.capable", agent="coder"):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(data, f)
            tmp_path = f.name
        try:
            return run(["--tier", tier, "--agent", agent, "--flow-config", tmp_path])
        finally:
            os.unlink(tmp_path)

    def complete_config(self):
        with open(COMPLETE) as f:
            return json.load(f)

    def test_template_5_missing_execution_policy(self):
        data = self.complete_config()
        del data["executionPolicy"]
        result = self.run_with_config(data, tier="modelTiers.capable", agent="coder")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            'flow.json has no usable executionPolicy ("guarded" or "unrestricted") — cannot dispatch coder.\n',
        )

    def test_template_5_invalid_execution_policy(self):
        data = self.complete_config()
        data["executionPolicy"] = "permissive"
        result = self.run_with_config(data, tier="modelTiers.capable", agent="coder")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            'flow.json has no usable executionPolicy ("guarded" or "unrestricted") — cannot dispatch coder.\n',
        )

    def test_execution_policy_unrestricted_passes_through(self):
        data = self.complete_config()
        data["executionPolicy"] = "unrestricted"
        result = self.run_with_config(data, tier="modelTiers.capable", agent="coder")
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["executionPolicy"], "unrestricted")


if __name__ == "__main__":
    unittest.main()
