"""Helper for constructing isolated PATH stubs for detect-mux-backend tests."""

import os
import stat
import tempfile


def make_stub_dir(*executable_names: str) -> str:
    """Create a temp dir with stub executables; return the dir path."""
    stub_dir = tempfile.mkdtemp()
    for name in executable_names:
        path = os.path.join(stub_dir, name)
        with open(path, "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(path, 0o755)
    return stub_dir
