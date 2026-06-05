import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "resolve-coordinator-dispatch.py"
)
LEAF_SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "resolve-model-dispatch.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
COORDINATOR = os.path.join(FIXTURES, "model-tiers-coordinator.json")


def run(args, script=SCRIPT):
    return subprocess.run(
        [sys.executable, script] + args,
        capture_output=True,
        text=True,
    )


class TestResolveCoordinatorDispatch(unittest.TestCase):

    def run_with_config(self, data, agent):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(data, f)
            tmp_path = f.name
        try:
            return run(["--agent", agent, "--model-tiers", tmp_path])
        finally:
            os.unlink(tmp_path)

    def test_valid_chain_resolves(self):
        result = run(["--agent", "plan-refiner", "--model-tiers", COORDINATOR])
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(
            data["modelChain"],
            ["openai-codex/gpt-5.4", "anthropic/claude-sonnet-4-6"],
        )
        self.assertEqual(data["cli"], "pi")

    def test_single_entry_chain_is_valid(self):
        result = self.run_with_config(
            {"coordinatorDispatch": {"modelChain": ["openai-codex/gpt-5.4"]}},
            "code-refiner",
        )
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["modelChain"], ["openai-codex/gpt-5.4"])
        self.assertEqual(data["cli"], "pi")

    def test_unknown_extra_keys_ignored_and_cli_always_pi(self):
        result = self.run_with_config(
            {
                "coordinatorDispatch": {
                    "modelChain": ["openai-codex/gpt-5.4"],
                    "cli": "codex",
                    "note": "ignored",
                }
            },
            "plan-refiner",
        )
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["cli"], "pi")
        self.assertEqual(data["modelChain"], ["openai-codex/gpt-5.4"])

    def test_entries_are_opaque_no_provider_prefix_required(self):
        result = self.run_with_config(
            {"coordinatorDispatch": {"modelChain": ["local-model"]}},
            "plan-refiner",
        )
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["modelChain"], ["local-model"])

    def test_template_1_missing_file(self):
        result = run(["--agent", "plan-refiner", "--model-tiers", "/nonexistent"])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "~/.pi/agent/model-tiers.json missing or unreadable — cannot dispatch plan-refiner.\n",
        )

    def test_missing_section(self):
        result = self.run_with_config(
            {
                "capable": "anthropic/claude-opus-4-7",
                "dispatch": {"anthropic": "claude", "openai-codex": "codex"},
            },
            "plan-refiner",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "model-tiers.json has no coordinatorDispatch section — cannot dispatch plan-refiner.\n",
        )

    def test_non_object_section_is_missing_section(self):
        result = self.run_with_config({"coordinatorDispatch": "pi"}, "code-refiner")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "model-tiers.json has no coordinatorDispatch section — cannot dispatch code-refiner.\n",
        )

    def test_modelchain_missing(self):
        result = self.run_with_config({"coordinatorDispatch": {}}, "code-refiner")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "model-tiers.json coordinatorDispatch has no usable modelChain — cannot dispatch code-refiner.\n",
        )

    def test_modelchain_not_an_array(self):
        result = self.run_with_config(
            {"coordinatorDispatch": {"modelChain": "openai-codex/gpt-5.4"}},
            "plan-refiner",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "model-tiers.json coordinatorDispatch has no usable modelChain — cannot dispatch plan-refiner.\n",
        )

    def test_modelchain_empty(self):
        result = self.run_with_config(
            {"coordinatorDispatch": {"modelChain": []}}, "plan-refiner"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "model-tiers.json coordinatorDispatch has no usable modelChain — cannot dispatch plan-refiner.\n",
        )

    def test_non_string_entry_rejected_wholesale(self):
        result = self.run_with_config(
            {"coordinatorDispatch": {"modelChain": ["openai-codex/gpt-5.4", 42]}},
            "code-refiner",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "model-tiers.json coordinatorDispatch has no usable modelChain — cannot dispatch code-refiner.\n",
        )

    def test_empty_string_entry_rejected_wholesale(self):
        result = self.run_with_config(
            {"coordinatorDispatch": {"modelChain": ["openai-codex/gpt-5.4", ""]}},
            "code-refiner",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            "model-tiers.json coordinatorDispatch has no usable modelChain — cannot dispatch code-refiner.\n",
        )

    def test_leaf_resolution_unaffected_by_coordinator_section(self):
        result = run(
            ["--tier", "capable", "--agent", "coder", "--model-tiers", COORDINATOR],
            script=LEAF_SCRIPT,
        )
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["model"], "anthropic/claude-opus-4-7")
        self.assertEqual(data["cli"], "claude")

        result = run(
            [
                "--tier",
                "crossProvider.capable",
                "--agent",
                "verifier",
                "--model-tiers",
                COORDINATOR,
            ],
            script=LEAF_SCRIPT,
        )
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["model"], "openai-codex/gpt-5.5")
        self.assertEqual(data["cli"], "codex")


if __name__ == "__main__":
    unittest.main()
