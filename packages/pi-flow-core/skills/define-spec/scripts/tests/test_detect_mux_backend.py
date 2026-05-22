"""Wrapper-contract tests for detect-mux-backend.py.

These tests exercise the helper as a black box. The helper now delegates
runtime multiplexer detection to `pi-mux-detect` (from
`@aphotic/pi-mux-subagents`) and only adapts its JSON output plus applies
define-spec's inline-override substrings. Tests stub `pi-mux-detect` on
PATH and assert the wrapper's branch / backend / status-message contract.

The audit test at the bottom asserts that no other workflow skill carries
its own mux-detection logic, so this is the single source of truth.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "detect-mux-backend.py"
)

MSG_MUX = "Running spec design in subagent pane (mux detected, no override)."
MSG_INLINE_NO_MUX = "Running spec design in this session (no multiplexer detected)."
MSG_INLINE_OVERRIDE = "Running spec design in this session (per user override: --no-subagent or equivalent)."


def make_pi_mux_detect_stub(*, stdout: str = "", stderr: str = "", exit_code: int = 0) -> str:
    """Create a temp dir containing a `pi-mux-detect` stub. Returns the dir.

    The stub is a Python script (no PATH dependencies — uses an absolute
    shebang to the current interpreter) that writes `stdout` to stdout,
    `stderr` to stderr, and exits with `exit_code`. PATH-prepend the
    returned dir to make the wrapper's detector resolution pick up the stub.
    """
    stub_dir = tempfile.mkdtemp(prefix="pi-mux-detect-stub-")
    stub_path = os.path.join(stub_dir, "pi-mux-detect")
    script = (
        f"#!{sys.executable}\n"
        "import sys\n"
        f"sys.stdout.write({stdout!r})\n"
        f"if {stdout!r}:\n"
        "    sys.stdout.write('\\n')\n"
        f"sys.stderr.write({stderr!r})\n"
        f"sys.exit({exit_code})\n"
    )
    with open(stub_path, "w") as f:
        f.write(script)
    os.chmod(stub_path, 0o755)
    return stub_dir


def run_script(*args, env=None):
    return subprocess.run(
        [sys.executable, SCRIPT, *args],
        env=env,
        capture_output=True,
        text=True,
    )


def detector_payload(**overrides) -> str:
    """Compose a pi-mux-detect JSON payload string."""
    payload = {
        "backend": "headless",
        "mux": None,
        "modeForced": None,
        "muxPreference": None,
        "muxPreferenceInvalid": None,
        "reason": "auto-selected headless backend; no supported mux detected",
    }
    payload.update(overrides)
    return json.dumps(payload)


class TestDetectorPaneBranch(unittest.TestCase):
    """Detector reports backend=pane: wrapper routes to mux branch."""

    def _assert_mux(self, mux_name):
        stub_dir = make_pi_mux_detect_stub(
            stdout=detector_payload(backend="pane", mux=mux_name)
        )
        env = {"PATH": stub_dir}
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "mux")
        self.assertEqual(data["backend"], mux_name)
        self.assertEqual(data["status_message"], MSG_MUX)

    def test_herdr(self):
        self._assert_mux("herdr")

    def test_cmux(self):
        self._assert_mux("cmux")

    def test_tmux(self):
        self._assert_mux("tmux")

    def test_zellij(self):
        self._assert_mux("zellij")

    def test_wezterm(self):
        self._assert_mux("wezterm")


class TestDetectorHeadlessBranch(unittest.TestCase):
    def test_headless_routes_to_inline_no_mux(self):
        stub_dir = make_pi_mux_detect_stub(
            stdout=detector_payload(backend="headless", mux=None)
        )
        env = {"PATH": stub_dir}
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "inline")
        self.assertIsNone(data["backend"])
        self.assertEqual(data["status_message"], MSG_INLINE_NO_MUX)


class TestUserInputOverrides(unittest.TestCase):
    """Overrides take precedence; detector is NOT invoked when an override matches."""

    def _override_env(self):
        # Stub `pi-mux-detect` that EXITS NONZERO if invoked. The wrapper must
        # succeed because the override path skips the detector entirely. If the
        # wrapper invokes the detector, the wrapper would fail and the assertions
        # below would fire.
        stub_dir = make_pi_mux_detect_stub(
            stdout="", stderr="should not be invoked", exit_code=99
        )
        return {"PATH": stub_dir}

    def _assert_override(self, user_input, expected_substring):
        result = run_script(f"--user-input={user_input}", env=self._override_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "inline")
        self.assertIsNone(data["backend"])
        self.assertEqual(data["reason"], f"user_input_override_{expected_substring}")
        self.assertEqual(data["status_message"], MSG_INLINE_OVERRIDE)

    def test_dash_dash_no_subagent(self):
        self._assert_override("--no-subagent", "--no-subagent")

    def test_without_a_subagent(self):
        self._assert_override("run this without a subagent", "without a subagent")

    def test_without_subagent(self):
        self._assert_override("without subagent please", "without subagent")

    def test_no_subagent(self):
        self._assert_override("no subagent please", "no subagent")

    def test_skip_subagent(self):
        self._assert_override("skip subagent for now", "skip subagent")

    def test_case_insensitive(self):
        self._assert_override("NO SUBAGENT", "no subagent")

    def test_inline_word_does_not_false_positive(self):
        # 'inline' bare in user-facing text must NOT trigger an override; the
        # wrapper should fall through to the detector, which here reports
        # headless → branch=inline (but with no_mux status, not override status).
        stub_dir = make_pi_mux_detect_stub(
            stdout=detector_payload(backend="headless", mux=None)
        )
        env = {"PATH": stub_dir}
        result = run_script(
            "--user-input=build a spec for inline editing of cells", env=env
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        data = json.loads(result.stdout)
        self.assertEqual(data["branch"], "inline")
        self.assertIsNone(data["backend"])
        # Key assertion: this is the no-mux path, NOT the override path.
        self.assertEqual(data["status_message"], MSG_INLINE_NO_MUX)


class TestDetectorFailures(unittest.TestCase):
    """Detector failures must surface as structured JSON on stderr with a nonzero exit."""

    def _assert_failure(self, env):
        result = run_script(env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        # stderr must be a single JSON object with a 'failure' field
        stderr_stripped = result.stderr.strip()
        try:
            payload = json.loads(stderr_stripped)
        except json.JSONDecodeError as exc:
            self.fail(f"stderr was not valid JSON: {stderr_stripped!r} ({exc})")
        self.assertIn("failure", payload)
        return payload

    def test_detector_exits_nonzero(self):
        stub_dir = make_pi_mux_detect_stub(
            stdout="", stderr="kaboom", exit_code=2
        )
        payload = self._assert_failure({"PATH": stub_dir})
        self.assertIn("nonzero", payload["failure"].lower())

    def test_detector_emits_invalid_json(self):
        stub_dir = make_pi_mux_detect_stub(stdout="not-json-just-text")
        payload = self._assert_failure({"PATH": stub_dir})
        self.assertIn("json", payload["failure"].lower())

    def test_detector_emits_payload_missing_backend(self):
        stub_dir = make_pi_mux_detect_stub(stdout=json.dumps({"mux": "tmux"}))
        payload = self._assert_failure({"PATH": stub_dir})
        # The failure message must reference the missing field; we don't pin
        # exact wording but the key 'backend' is expected to appear somewhere.
        self.assertIn("backend", payload["failure"].lower())

    def test_detector_emits_unknown_backend_value(self):
        stub_dir = make_pi_mux_detect_stub(
            stdout=detector_payload(backend="other", mux=None)
        )
        payload = self._assert_failure({"PATH": stub_dir})
        self.assertIn("backend", payload["failure"].lower())


class TestStdoutContract(unittest.TestCase):
    def test_stdout_is_one_json_object_with_trailing_newline(self):
        stub_dir = make_pi_mux_detect_stub(
            stdout=detector_payload(backend="pane", mux="herdr")
        )
        env = {"PATH": stub_dir}
        result = run_script(env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        stripped = result.stdout.strip()
        data = json.loads(stripped)
        for key in ("branch", "backend", "reason", "status_message"):
            self.assertIn(key, data)
        # Exactly one trailing newline after the JSON object
        self.assertEqual(result.stdout, stripped + "\n")


class TestNoOtherWorkflowSkillCarriesMuxDetection(unittest.TestCase):
    """Audit: define-spec's helper must be the only place mux detection lives.

    If a future skill adds env-var based mux probing of its own (instead of
    delegating to `pi-mux-detect`), this test fails and forces a discussion.
    """

    SKILLS_ROOT = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..")
    )

    FORBIDDEN_PATTERNS = [
        r"\bCMUX_SOCKET_PATH\b",
        r"\bWEZTERM_UNIX_SOCKET\b",
        r"\bZELLIJ_SESSION_NAME\b",
        r"\bHERDR_PANE_ID\b",
        r"\bHERDR_ENV\b",
    ]

    def test_no_other_skill_references_mux_env_vars(self):
        offenders = []
        for dirpath, dirnames, filenames in os.walk(self.SKILLS_ROOT):
            # Skip third-party directories that may slip into the tree.
            dirnames[:] = [d for d in dirnames if d != "__pycache__" and d != "node_modules"]
            for filename in filenames:
                if not filename.endswith((".py", ".md")):
                    continue
                path = os.path.join(dirpath, filename)
                # This audit test itself names the forbidden vars in regex form;
                # exclude it to avoid a self-reference false positive.
                if os.path.samefile(path, os.path.abspath(__file__)):
                    continue
                with open(path, encoding="utf-8", errors="replace") as f:
                    content = f.read()
                for pattern in self.FORBIDDEN_PATTERNS:
                    if re.search(pattern, content):
                        offenders.append((path, pattern))
        self.assertEqual(
            offenders,
            [],
            "Other workflow skill files reference mux env-vars directly; "
            "they should delegate to `pi-mux-detect` like define-spec does.",
        )


if __name__ == "__main__":
    unittest.main()
