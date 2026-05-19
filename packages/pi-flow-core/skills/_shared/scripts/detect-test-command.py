#!/usr/bin/env python3
"""detect-test-command - Detect test commands in a project directory.

Detects and emits the most appropriate test command for a given working directory
by applying the following rules in order:

Rule 1: package.json
  If <working_dir>/package.json exists, attempt to parse it as JSON.
  If parsing succeeds AND data.get("scripts", {}).get("test") is a non-empty string,
  emit {"detected": true, "command": "npm test", "source": "package.json"} and exit 0.
  If parsing fails, emit a warning to stderr and continue to Rule 2.

Rule 2: Cargo.toml
  If <working_dir>/Cargo.toml exists, emit {"detected": true, "command": "cargo test",
  "source": "Cargo.toml"} and exit 0.

Rule 3: Makefile
  If <working_dir>/Makefile exists and contains a line matching regex ^test: (with
  re.MULTILINE), emit {"detected": true, "command": "make test", "source": "Makefile"}
  and exit 0.

Rule 4: Python project (pyproject.toml or setup.py)
  If <working_dir>/pyproject.toml exists, emit {"detected": true, "command": "pytest",
  "source": "pyproject.toml"} and exit 0.
  Otherwise if <working_dir>/setup.py exists, emit {"detected": true, "command": "pytest",
  "source": "setup.py"} and exit 0.

Rule 5: go.mod
  If <working_dir>/go.mod exists, emit {"detected": true, "command": "go test ./...",
  "source": "go.mod"} and exit 0.

Fallthrough (no markers found):
  Emit {"detected": false, "command": null, "source": null} and exit 0.

Protocol-error label:
  working_dir_not_found: The specified --working-dir does not exist.
"""
import argparse
import json
import os
import re
import sys


def fail(label, **extra):
    """Emit a failure JSON to stderr and exit with code 1."""
    payload = {"failure": label}
    payload.update(extra)
    sys.stderr.write(json.dumps(payload) + "\n")
    sys.exit(1)


def success(detected, command=None, source=None):
    """Emit a success JSON to stdout and exit with code 0."""
    payload = {"detected": detected, "command": command, "source": source}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.exit(0)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Protocol-error labels: working_dir_not_found"
    )
    parser.add_argument(
        "--working-dir",
        default=".",
        help="Working directory to scan for test markers (default: current directory)"
    )
    args = parser.parse_args()

    # Resolve working_dir to an absolute path
    working_dir = os.path.abspath(args.working_dir)

    # Check if working_dir exists
    if not os.path.isdir(working_dir):
        fail("working_dir_not_found", working_dir=args.working_dir)

    # Rule 1: package.json
    package_json_path = os.path.join(working_dir, "package.json")
    if os.path.isfile(package_json_path):
        try:
            with open(package_json_path, 'r') as f:
                data = json.load(f)
            scripts = data.get("scripts") if isinstance(data, dict) else None
            test_script = scripts.get("test") if isinstance(scripts, dict) else None
            if isinstance(test_script, str) and test_script.strip():
                success(True, "npm test", "package.json")
        except (json.JSONDecodeError, IOError) as e:
            sys.stderr.write(f"warning: malformed package.json at {package_json_path}: {e}\n")

    # Rule 2: Cargo.toml
    cargo_toml_path = os.path.join(working_dir, "Cargo.toml")
    if os.path.isfile(cargo_toml_path):
        success(True, "cargo test", "Cargo.toml")

    # Rule 3: Makefile
    makefile_path = os.path.join(working_dir, "Makefile")
    if os.path.isfile(makefile_path):
        try:
            with open(makefile_path, 'r') as f:
                content = f.read()
            if re.search(r"^test:", content, re.MULTILINE):
                success(True, "make test", "Makefile")
        except IOError:
            pass

    # Rule 4: Python project (pyproject.toml or setup.py)
    pyproject_toml_path = os.path.join(working_dir, "pyproject.toml")
    if os.path.isfile(pyproject_toml_path):
        success(True, "pytest", "pyproject.toml")

    setup_py_path = os.path.join(working_dir, "setup.py")
    if os.path.isfile(setup_py_path):
        success(True, "pytest", "setup.py")

    # Rule 5: go.mod
    go_mod_path = os.path.join(working_dir, "go.mod")
    if os.path.isfile(go_mod_path):
        success(True, "go test ./...", "go.mod")

    # Fallthrough: no markers found
    success(False, None, None)


if __name__ == "__main__":
    main()
