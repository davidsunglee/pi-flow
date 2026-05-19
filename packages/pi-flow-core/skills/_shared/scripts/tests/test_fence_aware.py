import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import fence_aware


class TestComputeInFenceLines(unittest.TestCase):

    # (a) no fences → empty set
    def test_no_fences_returns_empty_set(self):
        lines = ["hello\n", "world\n", "plain text\n"]
        result = fence_aware.compute_in_fence_lines(lines)
        self.assertEqual(result, set())

    # (b) one backtick fence → only interior lines fenced
    def test_backtick_fence_interior_fenced(self):
        lines = [
            "```\n",       # index 0, opener
            "code here\n", # index 1, fenced
            "more code\n", # index 2, fenced
            "```\n",       # index 3, closer
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        self.assertEqual(result, {1, 2})

    # (c) one tilde fence → only interior lines fenced
    def test_tilde_fence_interior_fenced(self):
        lines = [
            "~~~\n",       # index 0, opener
            "code here\n", # index 1, fenced
            "~~~\n",       # index 2, closer
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        self.assertEqual(result, {1})

    # (d) backtick fence with leading indentation → still fences interior
    def test_indented_fence_still_fences_interior(self):
        lines = [
            "  ```\n",     # index 0, indented opener
            "code\n",      # index 1, fenced
            "  ```\n",     # index 2, indented closer
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        self.assertEqual(result, {1})

    # (e) opener length 4, closer length 4 → closes
    def test_opener_4_closer_4_closes(self):
        lines = [
            "````\n",      # index 0, opener (length 4)
            "content\n",   # index 1, fenced
            "````\n",      # index 2, closer (length 4)
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        self.assertEqual(result, {1})

    # (f) opener length 3, closer length 5 → closes (closer >= opener)
    def test_opener_3_closer_5_closes(self):
        lines = [
            "```\n",       # index 0, opener (length 3)
            "content\n",   # index 1, fenced
            "`````\n",     # index 2, closer (length 5)
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        self.assertEqual(result, {1})

    # (g) opener length 5, closer length 3 → does NOT close
    def test_opener_5_closer_3_does_not_close(self):
        lines = [
            "`````\n",     # index 0, opener (length 5)
            "content\n",   # index 1
            "```\n",       # index 2, shorter - not a valid closer
            "after\n",     # index 3
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        # opener unclosed → lines 1, 2, 3 all fenced
        self.assertEqual(result, {1, 2, 3})

    # (h) opener ```, closer ~~~ → does NOT close (mismatched marker type)
    def test_mismatched_marker_type_does_not_close(self):
        lines = [
            "```\n",       # index 0, backtick opener
            "content\n",   # index 1
            "~~~\n",       # index 2, tilde - wrong type, not a closer
            "after\n",     # index 3
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        # opener unclosed → lines 1, 2, 3 all fenced
        self.assertEqual(result, {1, 2, 3})

    # (i) unclosed opener → fences through EOF
    def test_unclosed_opener_fences_through_eof(self):
        lines = [
            "preamble\n",  # index 0, not fenced
            "```\n",       # index 1, opener
            "line a\n",    # index 2, fenced
            "line b\n",    # index 3, fenced
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        self.assertEqual(result, {2, 3})

    # (j) two consecutive fences → both interiors fenced, gap line between not fenced
    def test_two_consecutive_fences_gap_not_fenced(self):
        lines = [
            "```\n",       # index 0, opener 1
            "block1\n",    # index 1, fenced
            "```\n",       # index 2, closer 1
            "gap\n",       # index 3, NOT fenced
            "```\n",       # index 4, opener 2
            "block2\n",    # index 5, fenced
            "```\n",       # index 6, closer 2
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        self.assertEqual(result, {1, 5})

    # (k) closer line with trailing whitespace → still closes
    def test_closer_with_trailing_whitespace_closes(self):
        lines = [
            "```\n",       # index 0, opener
            "content\n",   # index 1, fenced
            "```   \n",    # index 2, closer with trailing whitespace
            "after\n",     # index 3, not fenced
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        self.assertEqual(result, {1})

    # (l) closer line with an info string after markers → does NOT close
    def test_closer_with_info_string_does_not_close(self):
        lines = [
            "```\n",         # index 0, opener
            "content\n",     # index 1
            "```python\n",   # index 2, has info string - not a closer
            "after\n",       # index 3
        ]
        result = fence_aware.compute_in_fence_lines(lines)
        # opener unclosed → lines 1, 2, 3 all fenced
        self.assertEqual(result, {1, 2, 3})


class TestSplitH2Sections(unittest.TestCase):

    # (a) two real H2s → two keys with verbatim bodies
    def test_two_h2s_returns_two_keys(self):
        text = "## Section One\nline a\nline b\n## Section Two\nline c\n"
        result = fence_aware.split_h2_sections(text)
        self.assertEqual(set(result.keys()), {"Section One", "Section Two"})
        self.assertEqual(result["Section One"], "line a\nline b\n")
        self.assertEqual(result["Section Two"], "line c\n")

    # (b) a fenced ## Fake line inside a real section → not a new section, body verbatim
    def test_fenced_h2_not_treated_as_section(self):
        text = "## Real Section\nsome text\n```\n## Fake Section\n```\nmore text\n"
        result = fence_aware.split_h2_sections(text)
        self.assertIn("Real Section", result)
        self.assertNotIn("Fake Section", result)
        body = result["Real Section"]
        self.assertIn("## Fake Section", body)

    # (c) preamble before first H2 is discarded
    def test_preamble_is_discarded(self):
        text = "This is a preamble line.\nAnother preamble line.\n## First Section\ncontent\n"
        result = fence_aware.split_h2_sections(text)
        self.assertEqual(set(result.keys()), {"First Section"})
        self.assertNotIn("preamble", result.get("First Section", ""))

    # (d) duplicate H2 names → last value wins
    def test_duplicate_h2_last_wins(self):
        text = "## Duplicate\nfirst body\n## Duplicate\nsecond body\n"
        result = fence_aware.split_h2_sections(text)
        self.assertEqual(result["Duplicate"], "second body\n")

    # (e) section names trimmed of trailing whitespace
    def test_section_names_trimmed(self):
        text = "## Section With Trailing   \ncontent\n"
        result = fence_aware.split_h2_sections(text)
        self.assertIn("Section With Trailing", result)
        self.assertNotIn("Section With Trailing   ", result)


if __name__ == "__main__":
    unittest.main()
