import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "cleanup-pycache.py"
)


def run(args, cwd):
    return subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True,
        text=True,
        cwd=cwd,
    )


def make_pycache(parent):
    pc = os.path.join(parent, "__pycache__")
    os.makedirs(pc)
    with open(os.path.join(pc, "module.cpython-313.pyc"), "wb") as f:
        f.write(b"\x00\x01\x02")
    return pc


class TestCleanupPycache(unittest.TestCase):

    def test_successful_cleanup_of_nested_pycache(self):
        cwd = tempfile.mkdtemp()
        try:
            top = os.path.join(cwd, "agent")
            nested = os.path.join(cwd, "agent", "skills", "foo", "scripts")
            os.makedirs(nested)
            pc1 = make_pycache(top)
            pc2 = make_pycache(nested)
            result = run(["agent"], cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(os.path.exists(pc1))
            self.assertFalse(os.path.exists(pc2))
            self.assertTrue(os.path.isdir(nested))
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_idempotent_no_pycache_present(self):
        cwd = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(cwd, "agent", "skills"))
            result = run(["agent"], cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stderr)
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_idempotent_target_absent(self):
        cwd = tempfile.mkdtemp()
        try:
            result = run(["agent"], cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stderr)
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_removes_target_when_target_is_pycache(self):
        cwd = tempfile.mkdtemp()
        try:
            pc = make_pycache(cwd)
            result = run(["__pycache__"], cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(os.path.exists(pc))
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_rejects_dotdot_traversal(self):
        cwd = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(cwd, "agent"))
            result = run(["agent/../something"], cwd=cwd)
            self.assertNotEqual(result.returncode, 0)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "dotdot_traversal")
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_rejects_path_outside_cwd(self):
        cwd = tempfile.mkdtemp()
        try:
            result = run(["/tmp/elsewhere"], cwd=cwd)
            self.assertNotEqual(result.returncode, 0)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "outside_cwd")
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_rejects_protected_segment_git(self):
        cwd = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(cwd, ".git", "hooks"))
            make_pycache(os.path.join(cwd, ".git"))
            result = run([".git"], cwd=cwd)
            self.assertNotEqual(result.returncode, 0)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "protected_segment")
            self.assertEqual(err["segment"], ".git")
            self.assertTrue(os.path.isdir(os.path.join(cwd, ".git", "__pycache__")))
        finally:
            shutil.rmtree(cwd, ignore_errors=True)

    def test_rejects_protected_segment_venv(self):
        cwd = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(cwd, ".venv", "lib"))
            result = run([".venv"], cwd=cwd)
            self.assertNotEqual(result.returncode, 0)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "protected_segment")
        finally:
            shutil.rmtree(cwd, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
