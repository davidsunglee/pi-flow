"""Tests that pin the idea-input-shape detection rule documented in
spec-design-procedure.md Step 1.

The procedure says: trim leading/trailing whitespace and lowercase the
captured hex segment of the input before matching against
^IDEA-([0-9a-f]{8})$ exactly. This test pins that behavior — if a future
PR changes the procedure's normalization rules, the test must change in
lockstep, catching drift between the prose and any consumer's
interpretation."""
import re
import unittest

IDEA_PATTERN = re.compile(r"^IDEA-([0-9a-f]{8})$", re.IGNORECASE)


def normalize(user_input: str) -> str:
    return user_input.strip().lower()


def detect_idea(user_input: str):
    normalized = normalize(user_input)
    m = IDEA_PATTERN.match(normalized)
    return m.group(1) if m else None


class TestIdeaInputShape(unittest.TestCase):

    def test_lowercase_hex_matches(self):
        self.assertEqual(detect_idea("IDEA-bd750b75"), "bd750b75")

    def test_uppercase_hex_matches_after_lowercasing(self):
        self.assertEqual(detect_idea("IDEA-BD750B75"), "bd750b75")

    def test_trailing_whitespace_matches_after_trim(self):
        self.assertEqual(detect_idea("IDEA-bd750b75 "), "bd750b75")

    def test_leading_whitespace_matches_after_trim(self):
        self.assertEqual(detect_idea(" IDEA-bd750b75"), "bd750b75")

    def test_leading_and_trailing_whitespace_matches_after_trim(self):
        self.assertEqual(detect_idea("  IDEA-bd750b75  "), "bd750b75")

    def test_no_prefix_does_not_match(self):
        self.assertIsNone(detect_idea("bd750b75"))

    def test_slash_command_leak_does_not_match(self):
        self.assertIsNone(detect_idea("/define-spec IDEA-bd750b75"))

    def test_too_few_hex_chars_does_not_match(self):
        self.assertIsNone(detect_idea("IDEA-bd750b7"))  # 7 chars

    def test_too_many_hex_chars_does_not_match(self):
        self.assertIsNone(detect_idea("IDEA-bd750b75a"))  # 9 chars

    def test_non_hex_chars_do_not_match(self):
        self.assertIsNone(detect_idea("IDEA-bd750bgg"))  # 'gg' not hex

    def test_legacy_todo_prefix_does_not_match(self):
        self.assertIsNone(detect_idea("TODO-bd750b75"))


if __name__ == "__main__":
    unittest.main()
