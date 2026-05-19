import unittest
import json
import subprocess
import tempfile
import os
from pathlib import Path


class TestDetectTestCommand(unittest.TestCase):
    """Tests for detect-test-command.py script."""

    def setUp(self):
        """Set up test paths and create temp directory for each test."""
        self.script_path = Path(__file__).parent.parent / "detect-test-command.py"
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up temp directory after each test."""
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    def run_script(self, args):
        """Run the detect-test-command script with given args, return stdout, stderr, and exit code."""
        cmd = ["python3", str(self.script_path)] + args
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.stdout, result.stderr, result.returncode

    def test_package_json_with_scripts_test(self):
        """Test: package.json with {"scripts": {"test": "vitest"}} → detected: true, command: "npm test", source: "package.json"."""
        package_json_path = os.path.join(self.temp_dir, "package.json")
        with open(package_json_path, 'w') as f:
            json.dump({"scripts": {"test": "vitest"}}, f)

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertTrue(result["detected"])
        self.assertEqual(result["command"], "npm test")
        self.assertEqual(result["source"], "package.json")

    def test_package_json_without_scripts_test(self):
        """Test: package.json with no scripts.test (e.g., {"name": "foo"}) → fallthrough."""
        package_json_path = os.path.join(self.temp_dir, "package.json")
        with open(package_json_path, 'w') as f:
            json.dump({"name": "foo"}, f)

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertFalse(result["detected"])

    def test_malformed_package_json_with_cargo_toml(self):
        """Test: malformed package.json plus Cargo.toml → command: "cargo test", stderr contains warning."""
        package_json_path = os.path.join(self.temp_dir, "package.json")
        with open(package_json_path, 'w') as f:
            f.write("{not valid json")

        cargo_toml_path = os.path.join(self.temp_dir, "Cargo.toml")
        with open(cargo_toml_path, 'w') as f:
            f.write("")

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertEqual(result["command"], "cargo test")
        self.assertIn("warning: malformed package.json", stderr)

    def test_package_json_with_invalid_scripts_shape_falls_through(self):
        """Test: valid JSON with non-dict scripts falls through to later rules."""
        package_json_path = os.path.join(self.temp_dir, "package.json")
        with open(package_json_path, 'w') as f:
            json.dump({"scripts": []}, f)

        cargo_toml_path = os.path.join(self.temp_dir, "Cargo.toml")
        with open(cargo_toml_path, 'w') as f:
            f.write("")

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertEqual(result["command"], "cargo test")
        self.assertEqual(result["source"], "Cargo.toml")
        self.assertEqual(stderr, "")

    def test_cargo_toml_only(self):
        """Test: Cargo.toml only → cargo test."""
        cargo_toml_path = os.path.join(self.temp_dir, "Cargo.toml")
        with open(cargo_toml_path, 'w') as f:
            f.write("")

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertTrue(result["detected"])
        self.assertEqual(result["command"], "cargo test")
        self.assertEqual(result["source"], "Cargo.toml")

    def test_makefile_with_test_target(self):
        """Test: Makefile containing test:\n\techo hi → make test."""
        makefile_path = os.path.join(self.temp_dir, "Makefile")
        with open(makefile_path, 'w') as f:
            f.write("test:\n\techo hi")

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertTrue(result["detected"])
        self.assertEqual(result["command"], "make test")
        self.assertEqual(result["source"], "Makefile")

    def test_makefile_without_test_target(self):
        """Test: Makefile without a test: target → fallthrough."""
        makefile_path = os.path.join(self.temp_dir, "Makefile")
        with open(makefile_path, 'w') as f:
            f.write("build:\n\techo hi")

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertFalse(result["detected"])

    def test_pyproject_toml_only(self):
        """Test: pyproject.toml only → pytest, source pyproject.toml."""
        pyproject_path = os.path.join(self.temp_dir, "pyproject.toml")
        with open(pyproject_path, 'w') as f:
            f.write("")

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertTrue(result["detected"])
        self.assertEqual(result["command"], "pytest")
        self.assertEqual(result["source"], "pyproject.toml")

    def test_setup_py_only(self):
        """Test: setup.py only → pytest, source setup.py."""
        setup_py_path = os.path.join(self.temp_dir, "setup.py")
        with open(setup_py_path, 'w') as f:
            f.write("")

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertTrue(result["detected"])
        self.assertEqual(result["command"], "pytest")
        self.assertEqual(result["source"], "setup.py")

    def test_go_mod_only(self):
        """Test: go.mod only → go test ./..."""
        go_mod_path = os.path.join(self.temp_dir, "go.mod")
        with open(go_mod_path, 'w') as f:
            f.write("")

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertTrue(result["detected"])
        self.assertEqual(result["command"], "go test ./...")
        self.assertEqual(result["source"], "go.mod")

    def test_package_json_and_cargo_toml_rule_1_wins(self):
        """Test: both package.json (with scripts.test) and Cargo.toml → rule 1 wins (npm test)."""
        package_json_path = os.path.join(self.temp_dir, "package.json")
        with open(package_json_path, 'w') as f:
            json.dump({"scripts": {"test": "vitest"}}, f)

        cargo_toml_path = os.path.join(self.temp_dir, "Cargo.toml")
        with open(cargo_toml_path, 'w') as f:
            f.write("")

        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertEqual(result["command"], "npm test")
        self.assertEqual(result["source"], "package.json")

    def test_empty_directory(self):
        """Test: empty directory → detected: false."""
        stdout, stderr, code = self.run_script(["--working-dir", self.temp_dir])
        self.assertEqual(code, 0, f"Script failed: {stderr}")
        result = json.loads(stdout)
        self.assertFalse(result["detected"])
        self.assertIsNone(result["command"])
        self.assertIsNone(result["source"])

    def test_nonexistent_working_dir(self):
        """Test: nonexistent --working-dir → exit 1, stderr JSON failure == "working_dir_not_found"."""
        nonexistent = "/this/path/does/not/exist"
        stdout, stderr, code = self.run_script(["--working-dir", nonexistent])
        self.assertNotEqual(code, 0, "Script should exit non-zero for nonexistent directory")
        result = json.loads(stderr)
        self.assertEqual(result["failure"], "working_dir_not_found")
        self.assertEqual(result["working_dir"], nonexistent)

    def test_help_flag(self):
        """Test that --help exits 0 and includes protocol-error label."""
        stdout, stderr, code = self.run_script(["--help"])
        self.assertEqual(code, 0, f"Help failed: {stderr}")
        # Should mention working_dir_not_found in the help
        self.assertIn("working_dir_not_found", stdout)


if __name__ == '__main__':
    unittest.main()
