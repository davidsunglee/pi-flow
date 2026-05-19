"""Tests that pin the todo-input-shape detection rule documented in
spec-design-procedure.md Step 1.

The procedure says: trim leading/trailing whitespace and lowercase the
captured hex segment of the input before matching against
^TODO-([0-9a-f]{8})$ exactly. This test pins that behavior — if a future
PR changes the procedure's normalization rules, the test must change in
lockstep, catching drift between the prose and any consumer's
interpretation."""
import re
import unittest


# Pinned regex pattern from spec-design-procedure.md Step 1.
# Surrounding whitespace must be trimmed and the input lowercased before
# applying this regex. The IGNORECASE flag tolerates uppercase prefix
# variants — `TODO-`, `todo-`, and case-mixed `Todo-` all match — so the
# `.lower()` on the normalized input only affects the captured hex
# segment, yielding the canonical lowercase form used downstream as
# `docs/todos/<hex>.md`.
TODO_PATTERN = re.compile(r"^TODO-([0-9a-f]{8})$", re.IGNORECASE)


def normalize(user_input: str) -> str:
    """Strip surrounding whitespace and lowercase, per the procedure.

    The TODO_PATTERN regex is compiled with `re.IGNORECASE` so the
    `TODO-` prefix matches case-insensitively. Lowercasing the entire
    normalized input here also lowercases the captured hex segment to
    the canonical form (lowercase) used downstream as
    `docs/todos/<hex>.md`."""
    return user_input.strip().lower()


def detect_todo(user_input: str):
    """Returns the captured hex if the input matches the todo branch
    after normalization, else None."""
    normalized = normalize(user_input)
    m = TODO_PATTERN.match(normalized)
    return m.group(1) if m else None


class TestTodoInputShape(unittest.TestCase):

    def test_lowercase_hex_matches(self):
        self.assertEqual(detect_todo("TODO-bd750b75"), "bd750b75")

    def test_uppercase_hex_matches_after_lowercasing(self):
        self.assertEqual(detect_todo("TODO-BD750B75"), "bd750b75")

    def test_trailing_whitespace_matches_after_trim(self):
        self.assertEqual(detect_todo("TODO-bd750b75 "), "bd750b75")

    def test_leading_whitespace_matches_after_trim(self):
        self.assertEqual(detect_todo(" TODO-bd750b75"), "bd750b75")

    def test_leading_and_trailing_whitespace_matches_after_trim(self):
        self.assertEqual(detect_todo("  TODO-bd750b75  "), "bd750b75")

    def test_no_prefix_does_not_match(self):
        # Bare hex with no TODO- prefix → freeform branch
        self.assertIsNone(detect_todo("bd750b75"))

    def test_slash_command_leak_does_not_match(self):
        # Slash command leakage (extraneous prefix) → freeform branch
        self.assertIsNone(detect_todo("/define-spec TODO-bd750b75"))

    def test_too_few_hex_chars_does_not_match(self):
        self.assertIsNone(detect_todo("TODO-bd750b7"))  # 7 chars

    def test_too_many_hex_chars_does_not_match(self):
        self.assertIsNone(detect_todo("TODO-bd750b75a"))  # 9 chars

    def test_non_hex_chars_do_not_match(self):
        self.assertIsNone(detect_todo("TODO-bd750bgg"))  # 'gg' not hex


if __name__ == "__main__":
    unittest.main()
