import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", "extract-provenance-preamble.py"
)
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
SPEC_CLEAN = os.path.join(FIXTURES, "preamble-spec-clean.md")
BRIEF_CLEAN = os.path.join(FIXTURES, "preamble-brief-clean.md")
MALFORMED_SHA = os.path.join(FIXTURES, "preamble-malformed-sha.md")
NO_PROVENANCE = os.path.join(FIXTURES, "preamble-no-provenance.md")
SPEC_FENCED_HEADING = os.path.join(FIXTURES, "preamble-spec-fenced-heading.md")


def run(args):
    return subprocess.run(
        [sys.executable, SCRIPT] + args,
        capture_output=True,
        text=True,
    )


def write_tmp(content):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False)
    f.write(content)
    f.close()
    return f.name


class TestExtractProvenancePreamble(unittest.TestCase):

    def test_spec_mode_extracts_source_idea(self):
        result = run(["--file", SPEC_CLEAN, "--mode", "spec"])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["source_idea"], "IDEA-12345678")

    def test_spec_mode_extracts_scout_brief(self):
        result = run(["--file", SPEC_CLEAN, "--mode", "spec"])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["scout_brief"], "docs/briefs/sample.md")

    def test_spec_mode_ignores_lines_after_first_heading(self):
        result = run(["--file", SPEC_CLEAN, "--mode", "spec"])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertIsNone(data["git_sha"])

    def test_spec_mode_ignores_lines_after_40_lines(self):
        lines = ["Arbitrary line {}\n".format(i) for i in range(44)]
        lines.append("Source: IDEA-abcdef01\n")
        lines.append("Trailing line\n")
        path = write_tmp("".join(lines))
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["source_idea"])
        finally:
            os.unlink(path)

    def test_brief_mode_extracts_git_sha(self):
        result = run(["--file", BRIEF_CLEAN, "--mode", "brief"])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["git_sha"], "1234567890abcdef1234567890abcdef12345678")

    def test_brief_mode_ignores_lines_after_8_lines(self):
        result = run(["--file", BRIEF_CLEAN, "--mode", "brief"])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["git_sha"], "1234567890abcdef1234567890abcdef12345678")

    def test_git_sha_malformed_fails_closed(self):
        result = run(["--file", MALFORMED_SHA, "--mode", "brief"])
        self.assertEqual(result.returncode, 1)
        err = json.loads(result.stderr)
        self.assertEqual(err["failure"], "git_sha_malformed")
        self.assertEqual(err["value"], "not-a-valid-sha")

    def test_git_sha_short_hex_fails_closed(self):
        path = write_tmp("# Title\n\nGit SHA: deadbeef\n")
        try:
            result = run(["--file", path, "--mode", "brief"])
            self.assertEqual(result.returncode, 1)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "git_sha_malformed")
        finally:
            os.unlink(path)

    def test_source_idea_non_hex_silently_ignored(self):
        path = write_tmp("# Title\n\nSource: IDEA-zzzzzzzz\n")
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["source_idea"])
        finally:
            os.unlink(path)

    def test_source_idea_wrong_length_silently_ignored(self):
        path = write_tmp("# Title\n\nSource: IDEA-1234\n")
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["source_idea"])
        finally:
            os.unlink(path)

    def test_scout_brief_outside_docs_briefs_ignored(self):
        path = write_tmp("# Title\n\nScout brief: docs/specs/foo.md\n")
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["scout_brief"])
        finally:
            os.unlink(path)

    def test_no_provenance_returns_all_null(self):
        result = run(["--file", NO_PROVENANCE, "--mode", "brief"])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertIsNone(data["source_idea"])
        self.assertIsNone(data["scout_brief"])
        self.assertIsNone(data["git_sha"])

    def test_missing_file_emits_structured_json(self):
        result = run(["--file", "/path/that/does/not/exist.md", "--mode", "brief"])
        self.assertEqual(result.returncode, 2)
        err = json.loads(result.stderr)
        self.assertEqual(err["failure"], "input missing or unreadable")
        self.assertEqual(err["input"], "file")

    def test_brief_mode_does_not_decode_after_bound(self):
        fd, path = tempfile.mkstemp(suffix=".md")
        os.close(fd)
        try:
            with open(path, "wb") as f:
                f.write(b"# Brief\n")
                f.write(b"Git SHA: 1234567890abcdef1234567890abcdef12345678\n")
                for i in range(6):
                    f.write(f"line {i}\n".encode())
                f.write(b"\xff\xfe invalid utf-8 after bounded preamble\n")
            result = run(["--file", path, "--mode", "brief"])
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertEqual(data["git_sha"], "1234567890abcdef1234567890abcdef12345678")
        finally:
            os.unlink(path)

    def test_spec_mode_extracts_bold_source_idea(self):
        content = "# Title\n\n**Source:** IDEA-abcdef01\n\n## Real heading\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["source_idea"], "IDEA-abcdef01")
        finally:
            os.unlink(path)

    def test_spec_mode_extracts_bold_scout_brief(self):
        content = "# Title\n\n**Scout brief:** docs/briefs/sample.md\n\n## Real heading\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["scout_brief"], "docs/briefs/sample.md")
        finally:
            os.unlink(path)

    def test_brief_mode_extracts_bold_git_sha(self):
        content = "# Brief\n**Git SHA:** 1234567890abcdef1234567890abcdef12345678\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "brief"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["git_sha"], "1234567890abcdef1234567890abcdef12345678")
        finally:
            os.unlink(path)

    def test_brief_mode_bold_git_sha_malformed_fails_closed(self):
        content = "# Brief\n**Git SHA:** not-a-sha\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "brief"])
            self.assertEqual(result.returncode, 1)
            err = json.loads(result.stderr)
            self.assertEqual(err["failure"], "git_sha_malformed")
        finally:
            os.unlink(path)

    def test_spec_mode_bold_provenance_inside_fence_ignored(self):
        content = (
            "# Title\n"
            "\n"
            "```markdown\n"
            "**Source:** IDEA-abcdef01\n"
            "**Scout brief:** docs/briefs/sample.md\n"
            "```\n"
            "\n"
            "## Real heading\n"
        )
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["source_idea"])
            self.assertIsNone(data["scout_brief"])
        finally:
            os.unlink(path)

    def test_spec_mode_malformed_asterisks_rejected(self):
        # Test single asterisks
        content = "*Source:* IDEA-abcdef01\n\n## Real heading\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["source_idea"])
        finally:
            os.unlink(path)

        # Test open without close
        content = "**Source: IDEA-abcdef01\n\n## Real heading\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["source_idea"])
        finally:
            os.unlink(path)

        # Test close without open
        content = "Source:** IDEA-abcdef01\n\n## Real heading\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["source_idea"])
        finally:
            os.unlink(path)

        # Test mismatched count
        content = "*Source:** IDEA-abcdef01\n\n## Real heading\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["source_idea"])
        finally:
            os.unlink(path)

    def test_brief_mode_malformed_asterisks_git_sha_rejected(self):
        content = "# Brief\n*Git SHA:* 1234567890abcdef1234567890abcdef12345678\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "brief"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["git_sha"])
        finally:
            os.unlink(path)

    def test_spec_mode_rejects_legacy_prefix(self):
        content = "# Title\n\nSource: TO" + "DO-12345678\n\n## Real heading\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["source_idea"])
        finally:
            os.unlink(path)

    def test_spec_mode_rejects_legacy_todo_scout_brief(self):
        legacy = "TO" + "DO-12345678-brief.md"
        content = f"# Title\n\nScout brief: docs/briefs/{legacy}\n\n## Real heading\n"
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["scout_brief"])
        finally:
            os.unlink(path)


class TestSpecModeFencedHeading(unittest.TestCase):

    def test_fenced_heading_does_not_terminate_scan_real_before_fence(self):
        result = run(["--file", SPEC_FENCED_HEADING, "--mode", "spec"])
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["source_idea"], "IDEA-12345678")
        self.assertEqual(data["scout_brief"], "docs/briefs/sample.md")

    def test_fenced_heading_does_not_terminate_scan_real_after_fence(self):
        content = (
            "# Title\n"
            "\n"
            "Some intro text.\n"
            "\n"
            "```markdown\n"
            "## Fake Heading Inside Fence\n"
            "```\n"
            "\n"
            "Source: IDEA-12345678\n"
            "\n"
            "Scout brief: docs/briefs/sample.md\n"
            "\n"
            "## Real Heading\n"
            "\n"
            "Content.\n"
        )
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["source_idea"], "IDEA-12345678")
            self.assertEqual(data["scout_brief"], "docs/briefs/sample.md")
        finally:
            os.unlink(path)

    def test_fenced_fake_provenance_inside_fence_is_ignored(self):
        content = (
            "# Title\n"
            "\n"
            "Some intro text.\n"
            "\n"
            "```markdown\n"
            "Source: IDEA-aaaaaaaa\n"
            "Scout brief: docs/briefs/fake.md\n"
            "```\n"
            "\n"
            "More text.\n"
            "\n"
            "## Real Heading\n"
        )
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "spec"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertIsNone(data["source_idea"])
            self.assertIsNone(data["scout_brief"])
        finally:
            os.unlink(path)

    def test_fenced_git_sha_inside_brief_mode_is_ignored(self):
        real_sha = "aabbccdd1122334455667788990011aabbccddee"
        fake_sha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
        content = (
            "# Brief\n"
            f"Git SHA: {real_sha}\n"
            "Line 3\n"
            "```\n"
            f"Git SHA: {fake_sha}\n"
            "```\n"
            "Line 6\n"
            "Line 7\n"
        )
        path = write_tmp(content)
        try:
            result = run(["--file", path, "--mode", "brief"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["git_sha"], real_sha)
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
