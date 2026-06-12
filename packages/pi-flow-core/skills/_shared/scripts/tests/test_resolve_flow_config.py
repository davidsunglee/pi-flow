import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "resolve-flow-config.py")
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
PROJECT_LOCAL = os.path.join(FIXTURES, "flow-project-local.json")


def run(args, home):
    env = {**os.environ, "HOME": home}
    return subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True, text=True, env=env,
    )


def seed_project(working_dir):
    pi_dir = os.path.join(working_dir, ".pi")
    os.makedirs(pi_dir, exist_ok=True)
    dst = os.path.join(pi_dir, "flow.json")
    shutil.copyfile(PROJECT_LOCAL, dst)
    return dst


def seed_user(home):
    agent = os.path.join(home, ".pi", "agent")
    os.makedirs(agent, exist_ok=True)
    dst = os.path.join(agent, "flow.json")
    shutil.copyfile(PROJECT_LOCAL, dst)
    return dst


class TestResolveFlowConfig(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.proj = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)
        shutil.rmtree(self.proj, ignore_errors=True)

    def test_explicit_scope(self):
        explicit = seed_project(self.proj)  # any readable file
        result = run(["--flow-config", explicit, "--working-dir", self.proj], self.home)
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["scope"], "explicit")
        self.assertEqual(data["path"], os.path.abspath(explicit))
        self.assertEqual(data["searched"], [os.path.abspath(explicit)])

    def test_project_scope(self):
        project = seed_project(self.proj)
        result = run(["--working-dir", self.proj], self.home)
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["scope"], "project")
        self.assertEqual(data["path"], os.path.abspath(project))
        self.assertEqual(data["searched"], [os.path.abspath(project)])

    def test_user_scope(self):
        user = seed_user(self.home)
        result = run(["--working-dir", self.proj], self.home)
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["scope"], "user")
        self.assertEqual(data["path"], os.path.abspath(user))
        expected_project = os.path.abspath(os.path.join(self.proj, ".pi", "flow.json"))
        self.assertEqual(data["searched"], [expected_project, os.path.abspath(user)])

    def test_missing_config_error(self):
        result = run(["--working-dir", self.proj], self.home)
        self.assertEqual(result.returncode, 1)
        project = os.path.abspath(os.path.join(self.proj, ".pi", "flow.json"))
        self.assertEqual(
            result.stderr,
            f"flow.json missing or unreadable; searched {project}, ~/.pi/agent/flow.json.\n",
        )

    @unittest.skipIf(os.geteuid() == 0, "chmod 0 is bypassed by root")
    def test_unreadable_explicit_fails_hard(self):
        explicit = seed_project(self.proj)
        os.chmod(explicit, 0)
        try:
            result = run(["--flow-config", explicit, "--working-dir", self.proj], self.home)
        finally:
            os.chmod(explicit, 0o644)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(
            result.stderr,
            f"flow.json missing or unreadable; searched {os.path.abspath(explicit)}.\n",
        )

    @unittest.skipIf(os.geteuid() == 0, "chmod 0 is bypassed by root")
    def test_unreadable_project_skips_to_user_but_records(self):
        project = seed_project(self.proj)
        user = seed_user(self.home)
        os.chmod(project, 0)
        try:
            result = run(["--working-dir", self.proj], self.home)
        finally:
            os.chmod(project, 0o644)
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["scope"], "user")
        self.assertEqual(data["path"], os.path.abspath(user))
        self.assertEqual(
            data["searched"], [os.path.abspath(project), os.path.abspath(user)]
        )


if __name__ == "__main__":
    unittest.main()
