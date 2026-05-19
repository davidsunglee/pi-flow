import json
import os
import subprocess
import sys
import unittest

from conftest_path_stubs import make_stub_dir

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "detect-mux-backend.py"
)

SYSTEM_PATH = "/usr/bin:/bin"

MSG_MUX = "Running spec design in subagent pane (mux detected, no override)."
MSG_INLINE_NO_MUX = "Running spec design in this session (no multiplexer detected)."
MSG_INLINE_OVERRIDE = "Running spec design in this session (per user override: --no-subagent or equivalent)."


def run_script(*args, env=None):
    return subprocess.run(
        [sys.executable, SCRIPT, *args],
        env=env,
        capture_output=True,
        text=True,
    )


def clean_env(**extra):
    return {"PATH": SYSTEM_PATH, **extra}


class TestRule1PiSubagentModeHeadless(unittest.TestCase):
    def test_rule_1_pi_subagent_mode_headless(self):
        result = run_script(env=clean_env(PI_SUBAGENT_MODE="headless"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "inline")
        self.assertIsNone(data["backend"])
        self.assertEqual(data["reason"], "pi_subagent_mode_headless")
        self.assertEqual(data["status_message"], MSG_INLINE_NO_MUX)


class TestRule2PiSubagentModePane(unittest.TestCase):
    def test_rule_2_pi_subagent_mode_pane(self):
        result = run_script(env=clean_env(PI_SUBAGENT_MODE="pane"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "mux")
        self.assertIsNone(data["backend"])
        self.assertEqual(data["reason"], "pi_subagent_mode_pane")
        self.assertEqual(data["status_message"], MSG_MUX)


class TestRule3PiSubagentMuxPinned(unittest.TestCase):
    def test_rule_3_pi_subagent_mux_pinned_match(self):
        stub_dir = make_stub_dir("cmux")
        env = {
            "PATH": stub_dir + os.pathsep + SYSTEM_PATH,
            "PI_SUBAGENT_MUX": "cmux",
            "CMUX_SOCKET_PATH": "/tmp/test-cmux.sock",
        }
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "mux")
        self.assertEqual(data["backend"], "cmux")
        self.assertEqual(data["reason"], "pi_subagent_mux_pinned")
        self.assertEqual(data["status_message"], MSG_MUX)

    def test_rule_3_pinned_backend_unavailable_no_fallback(self):
        # PI_SUBAGENT_MUX=tmux but no tmux binary and no TMUX env var
        stub_dir = make_stub_dir("cmux")  # cmux available but not pinned
        env = {
            "PATH": stub_dir + os.pathsep + SYSTEM_PATH,
            "PI_SUBAGENT_MUX": "tmux",
            "CMUX_SOCKET_PATH": "/tmp/test-cmux.sock",
        }
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "inline")
        self.assertIsNone(data["backend"])
        self.assertEqual(data["reason"], "pi_subagent_mux_pinned_unavailable")
        self.assertEqual(data["status_message"], MSG_INLINE_NO_MUX)


class TestRule4CmuxDetected(unittest.TestCase):
    def test_rule_4_cmux_detected(self):
        stub_dir = make_stub_dir("cmux")
        env = {
            "PATH": stub_dir + os.pathsep + SYSTEM_PATH,
            "CMUX_SOCKET_PATH": "/tmp/test-cmux.sock",
        }
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "mux")
        self.assertEqual(data["backend"], "cmux")
        self.assertEqual(data["reason"], "cmux_detected")
        self.assertEqual(data["status_message"], MSG_MUX)


class TestRule5TmuxDetected(unittest.TestCase):
    def test_rule_5_tmux_detected(self):
        stub_dir = make_stub_dir("tmux")
        env = {
            "PATH": stub_dir + os.pathsep + SYSTEM_PATH,
            "TMUX": "/tmp/tmux-12345/default,1234,0",
        }
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "mux")
        self.assertEqual(data["backend"], "tmux")
        self.assertEqual(data["reason"], "tmux_detected")
        self.assertEqual(data["status_message"], MSG_MUX)


class TestRule6ZellijDetected(unittest.TestCase):
    def test_rule_6_zellij_via_zellij_env(self):
        stub_dir = make_stub_dir("zellij")
        env = {
            "PATH": stub_dir + os.pathsep + SYSTEM_PATH,
            "ZELLIJ": "0",
        }
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "mux")
        self.assertEqual(data["backend"], "zellij")
        self.assertEqual(data["reason"], "zellij_detected")
        self.assertEqual(data["status_message"], MSG_MUX)

    def test_rule_6_zellij_via_zellij_session_name_env(self):
        stub_dir = make_stub_dir("zellij")
        env = {
            "PATH": stub_dir + os.pathsep + SYSTEM_PATH,
            "ZELLIJ_SESSION_NAME": "my-session",
        }
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "mux")
        self.assertEqual(data["backend"], "zellij")
        self.assertEqual(data["reason"], "zellij_detected")
        self.assertEqual(data["status_message"], MSG_MUX)


class TestRule7WeztermDetected(unittest.TestCase):
    def test_rule_7_wezterm_detected(self):
        stub_dir = make_stub_dir("wezterm")
        env = {
            "PATH": stub_dir + os.pathsep + SYSTEM_PATH,
            "WEZTERM_UNIX_SOCKET": "/tmp/wezterm.sock",
        }
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "mux")
        self.assertEqual(data["backend"], "wezterm")
        self.assertEqual(data["reason"], "wezterm_detected")
        self.assertEqual(data["status_message"], MSG_MUX)


class TestRule8NoMuxDetected(unittest.TestCase):
    def test_rule_8_no_mux_detected(self):
        result = run_script(env=clean_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "inline")
        self.assertIsNone(data["backend"])
        self.assertEqual(data["reason"], "no_mux_detected")
        self.assertEqual(data["status_message"], MSG_INLINE_NO_MUX)


class TestUserInputOverrides(unittest.TestCase):
    def _assert_override(self, user_input, expected_reason):
        result = run_script(f"--user-input={user_input}", env=clean_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "inline")
        self.assertIsNone(data["backend"])
        self.assertEqual(data["reason"], expected_reason)
        self.assertEqual(data["status_message"], MSG_INLINE_OVERRIDE)

    def test_user_input_override_no_subagent_dash_dash(self):
        self._assert_override("--no-subagent", "user_input_override_--no-subagent")

    def test_user_input_override_without_a_subagent(self):
        self._assert_override("run this without a subagent", "user_input_override_without a subagent")

    def test_user_input_override_without_subagent(self):
        self._assert_override("without subagent please", "user_input_override_without subagent")

    def test_user_input_override_no_subagent(self):
        self._assert_override("no subagent please", "user_input_override_no subagent")

    def test_user_input_override_skip_subagent(self):
        self._assert_override("skip subagent for now", "user_input_override_skip subagent")

    def test_user_input_override_case_insensitive(self):
        self._assert_override("NO SUBAGENT", "user_input_override_no subagent")

    def test_inline_word_does_not_false_positive(self):
        # Bare 'inline' in user-facing prompt text must NOT trigger the inline-override branch
        # when no actual override substring (--no-subagent / 'no subagent' / etc.) is present.
        result = run_script("--user-input=build a spec for inline editing of cells", env=clean_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        # With clean_env() (no mux env vars), Rule 8 fires → branch=inline, reason=no_mux_detected.
        # The key assertion is the REASON: no_mux_detected (NOT user_input_override_inline).
        self.assertEqual(data["branch"], "inline")
        self.assertIsNone(data["backend"])
        self.assertEqual(data["reason"], "no_mux_detected")
        self.assertEqual(data["status_message"], MSG_INLINE_NO_MUX)


class TestPrecedence(unittest.TestCase):
    def test_precedence_pi_subagent_mode_wins_over_tmux(self):
        stub_dir = make_stub_dir("tmux")
        env = {
            "PATH": stub_dir + os.pathsep + SYSTEM_PATH,
            "PI_SUBAGENT_MODE": "headless",
            "TMUX": "/tmp/tmux-12345/default,1234,0",
        }
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "inline")
        self.assertEqual(data["reason"], "pi_subagent_mode_headless")


class TestStdoutContract(unittest.TestCase):
    def test_stdout_only_contains_json_no_extra_text(self):
        result = run_script(env=clean_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        # stdout must be exactly one JSON object (parseable) with no extra text
        stripped = result.stdout.strip()
        data = json.loads(stripped)
        self.assertIn("branch", data)
        self.assertIn("backend", data)
        self.assertIn("reason", data)
        self.assertIn("status_message", data)
        # Verify stdout ends with exactly one newline after JSON
        self.assertEqual(result.stdout, stripped + "\n")


if __name__ == "__main__":
    unittest.main()
