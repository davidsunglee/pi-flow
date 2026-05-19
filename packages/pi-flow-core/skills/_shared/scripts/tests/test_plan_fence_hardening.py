import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from plan_fence_hardening import detect_ambiguous_nested_fences, rewrite_ambiguous_nested_fences

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "plan_fence_hardening.py")
EXTRACT_SCRIPT = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..", "..", "..", "execute-plan", "scripts", "extract-plan-tasks.py",
    )
)

# --- Fixtures ---

# Ambiguous: outer ``` has inner ```python block whose closer ``` prematurely terminates
# the outer fence. Inner payload has no ~~~, so rewrite prefers ~~~ outer.
AMBIGUOUS_BACKTICK = (
    "Before text.\n"
    "\n"
    "```\n"
    "```python\n"
    'print("hello")\n'
    "```\n"
    "```\n"
    "\n"
    "After text.\n"
)

AMBIGUOUS_BACKTICK_REWRITTEN_TILDE = (
    "Before text.\n"
    "\n"
    "~~~\n"
    "```python\n"
    'print("hello")\n'
    "```\n"
    "~~~\n"
    "\n"
    "After text.\n"
)

# Safe: outer uses ~~~ so inner ``` closer cannot prematurely terminate it.
SAFE_TILDE_OUTER = (
    "~~~\n"
    "```python\n"
    'print("hello")\n'
    "```\n"
    "~~~\n"
)

# Safe: outer uses ```` (4 backticks) so inner ``` (3) cannot terminate it.
SAFE_LONGER_BACKTICK_OUTER = (
    "````\n"
    "```python\n"
    'print("hello")\n'
    "```\n"
    "````\n"
)

# Safe: no nested fences at all.
SAFE_NO_NESTED = (
    "```\n"
    "just some text\n"
    "no fences here\n"
    "```\n"
)

# Ambiguous: outer ``` has inner ```python block that also contains ~~~ runs inside.
# The inner ```python closer prematurely terminates the outer ```.
# Since inner payload contains ~~~, rewrite must use longer backtick (4) instead of ~~~.
AMBIGUOUS_INNER_HAS_TILDE = (
    "```\n"
    "```python\n"
    "# uses ~~~\n"
    "~~~\n"
    "code\n"
    "~~~\n"
    "```\n"
    "```\n"
)

AMBIGUOUS_INNER_HAS_TILDE_REWRITTEN = (
    "````\n"
    "```python\n"
    "# uses ~~~\n"
    "~~~\n"
    "code\n"
    "~~~\n"
    "```\n"
    "````\n"
)

# Ambiguous: outer ``` has inner ```python block. Inner payload also has ~~~ blocks.
# Inner has both ``` and ~~~. Since inner has ~~~, use longer backtick (4).
AMBIGUOUS_INNER_HAS_BOTH = (
    "```\n"
    "```python\n"
    "code\n"
    "```\n"
    "~~~\n"
    "end\n"
    "~~~\n"
    "```\n"
)

AMBIGUOUS_INNER_HAS_BOTH_REWRITTEN = (
    "````\n"
    "```python\n"
    "code\n"
    "```\n"
    "~~~\n"
    "end\n"
    "~~~\n"
    "````\n"
)

# Two separate ambiguous blocks in same document.
MULTIPLE_AMBIGUOUS = (
    "```\n"
    "```python\n"
    "foo()\n"
    "```\n"
    "```\n"
    "\n"
    "Some text.\n"
    "\n"
    "```\n"
    "```shell\n"
    "bar()\n"
    "```\n"
    "```\n"
)

# Ambiguous: ONE outer ``` example contains TWO inner fenced snippets (```python, ```json).
# The first bare ``` after the outer opener is the inner1 closer (premature). The next
# bare ``` after that is the inner2 closer — NOT the intended outer closer. The real
# outer closer is the bare ``` after inner2's closer. Rewrite must change only the
# outer opener and the real outer closer, leaving every inner snippet fence intact.
AMBIGUOUS_TWO_NESTED_SNIPPETS = (
    "```\n"
    "```python\n"
    "foo()\n"
    "```\n"
    "```json\n"
    '{"a": 1}\n'
    "```\n"
    "```\n"
)

AMBIGUOUS_TWO_NESTED_SNIPPETS_REWRITTEN = (
    "~~~\n"
    "```python\n"
    "foo()\n"
    "```\n"
    "```json\n"
    '{"a": 1}\n'
    "```\n"
    "~~~\n"
)


# Ambiguous: outer ``` (3) contains an UNLABELED longer same-marker inner fence (4).
# CommonMark sees the first 4-backtick run as a valid outer closer (>= 3, no info),
# prematurely terminating the outer at line 1. The next 4-backtick run is then a new
# unclosed opener, and the trailing 3-backtick run cannot close it (3 < 4) — so
# everything after is in-fence. Intended structure: outer ``` opens, inner ```` is a
# nested snippet closed by the second ````, and the trailing ``` closes the outer.
AMBIGUOUS_LONGER_SAME_MARKER_INNER = (
    "Before.\n"
    "```\n"
    "````\n"
    "content\n"
    "````\n"
    "```\n"
    "After.\n"
)

AMBIGUOUS_LONGER_SAME_MARKER_INNER_REWRITTEN = (
    "Before.\n"
    "~~~\n"
    "````\n"
    "content\n"
    "````\n"
    "~~~\n"
    "After.\n"
)

# Same pattern embedded in a complete plan: required sections after the malformed
# fence are hidden by the unclosed inner-opener parse, so extract-plan-tasks.py
# fails until the rewrite repairs the outer fences.
MINIMAL_PLAN_WITH_LONGER_SAME_MARKER_INNER = (
    "## Goal\n"
    "\n"
    "Plan demonstrating an unlabeled longer same-marker inner fence.\n"
    "\n"
    "```\n"
    "````\n"
    "tool --help\n"
    "````\n"
    "```\n"
    "\n"
    "## Architecture summary\n"
    "\n"
    "Uses existing modules with no structural changes.\n"
    "\n"
    "## Tech stack\n"
    "\n"
    "Python 3.\n"
    "\n"
    "## File Structure\n"
    "\n"
    "- `example.py` (Modify) — example file.\n"
    "\n"
    "### Task 1: Update example\n"
    "\n"
    "**Files:**\n"
    "- Modify: `example.py`\n"
    "\n"
    "**Steps:**\n"
    "- [ ] **Step 1** — Write the failing test.\n"
    "- [ ] **Step 2** — Implement the update.\n"
    "\n"
    "**Acceptance criteria:**\n"
    "\n"
    "- The example file is updated correctly.\n"
    "  Verify: run `grep 'example' example.py` and confirm at least one match.\n"
    "\n"
    "**Model recommendation:** cheap\n"
    "\n"
    "## Dependencies\n"
    "\n"
    "## Risk Assessment\n"
    "\n"
    "Low risk; no external dependencies.\n"
)


MULTIPLE_AMBIGUOUS_REWRITTEN = (
    "~~~\n"
    "```python\n"
    "foo()\n"
    "```\n"
    "~~~\n"
    "\n"
    "Some text.\n"
    "\n"
    "~~~\n"
    "```shell\n"
    "bar()\n"
    "```\n"
    "~~~\n"
)


# Minimal complete plan with an ambiguous fence in the Goal body.
# The outer ``` at line 4 (0-indexed) is prematurely closed by the ``` at line 7
# (the ```bash inner closer), leaving the ``` at line 8 as an unclosed opener.
# compute_in_fence_lines marks lines 9+ as in-fence, causing ## Architecture summary
# and subsequent required sections to be invisible to extract-plan-tasks.py.
# After plan_fence_hardening.py --rewrite-in-place, lines 4 and 8 become ~~~,
# the sections are no longer in-fence, and extract-plan-tasks.py succeeds.
MINIMAL_PLAN_WITH_AMBIGUOUS_FENCE = (
    "## Goal\n"
    "\n"
    "Plan for fence hardening smoke test.\n"
    "\n"
    "```\n"
    "```bash\n"
    "tool --help\n"
    "```\n"
    "```\n"
    "\n"
    "## Architecture summary\n"
    "\n"
    "Uses existing modules with no structural changes.\n"
    "\n"
    "## Tech stack\n"
    "\n"
    "Python 3.\n"
    "\n"
    "## File Structure\n"
    "\n"
    "- `example.py` (Modify) — example file.\n"
    "\n"
    "### Task 1: Update example\n"
    "\n"
    "**Files:**\n"
    "- Modify: `example.py`\n"
    "\n"
    "**Steps:**\n"
    "- [ ] **Step 1** — Write the failing test.\n"
    "- [ ] **Step 2** — Implement the update.\n"
    "\n"
    "**Acceptance criteria:**\n"
    "\n"
    "- The example file is updated correctly.\n"
    "  Verify: run `grep 'example' example.py` and confirm at least one match.\n"
    "\n"
    "**Model recommendation:** cheap\n"
    "\n"
    "## Dependencies\n"
    "\n"
    "## Risk Assessment\n"
    "\n"
    "Low risk; no external dependencies.\n"
)


class TestDetectAmbiguousNestedFences(unittest.TestCase):

    def test_detects_malformed_backtick_nesting(self):
        issues = detect_ambiguous_nested_fences(AMBIGUOUS_BACKTICK)
        self.assertEqual(len(issues), 1)
        issue = issues[0]
        self.assertEqual(issue["marker"], "`")
        self.assertEqual(issue["outer_fence_length"], 3)
        self.assertEqual(issue["inner_run_length"], 3)
        self.assertIn("line", issue)
        self.assertGreater(issue["line"], 0)
        self.assertIn("hint", issue)

    def test_detect_returns_1_based_line_number(self):
        issues = detect_ambiguous_nested_fences(AMBIGUOUS_BACKTICK)
        self.assertEqual(len(issues), 1)
        # AMBIGUOUS_BACKTICK lines:
        # 1: "Before text."  2: ""  3: "```"  4: "```python"
        # 5: 'print("hello")'  6: "```"  <-- premature closer  7: "```"
        self.assertEqual(issues[0]["line"], 6)

    def test_detect_hint_mentions_remediation(self):
        issues = detect_ambiguous_nested_fences(AMBIGUOUS_BACKTICK)
        self.assertEqual(len(issues), 1)
        hint = issues[0]["hint"].lower()
        self.assertTrue(
            "~~~" in hint or "longer" in hint,
            msg=f"Expected hint to mention ~~~ or longer fence, got: {hint}",
        )

    def test_safe_tilde_outer_no_issues(self):
        issues = detect_ambiguous_nested_fences(SAFE_TILDE_OUTER)
        self.assertEqual(issues, [])

    def test_safe_longer_backtick_outer_no_issues(self):
        issues = detect_ambiguous_nested_fences(SAFE_LONGER_BACKTICK_OUTER)
        self.assertEqual(issues, [])

    def test_safe_no_nested_fences_no_issues(self):
        issues = detect_ambiguous_nested_fences(SAFE_NO_NESTED)
        self.assertEqual(issues, [])

    def test_empty_text_no_issues(self):
        issues = detect_ambiguous_nested_fences("")
        self.assertEqual(issues, [])

    def test_multiple_ambiguous_blocks_all_detected(self):
        issues = detect_ambiguous_nested_fences(MULTIPLE_AMBIGUOUS)
        self.assertEqual(len(issues), 2)

    def test_detects_unlabeled_longer_same_marker_inner_fence(self):
        # Outer ``` with no-info inner ```` (longer) same-marker run.
        # CommonMark prematurely closes the outer at the first ````, hiding
        # everything after. Detector must flag this as ambiguous.
        issues = detect_ambiguous_nested_fences(AMBIGUOUS_LONGER_SAME_MARKER_INNER)
        self.assertEqual(len(issues), 1, msg=f"got: {issues}")
        self.assertEqual(issues[0]["marker"], "`")
        self.assertEqual(issues[0]["outer_fence_length"], 3)

    def test_safe_tilde_inside_backtick_not_ambiguous(self):
        # Outer backtick with tilde inner block — tildes don't close backtick outer.
        text = "```\n~~~\nblock\n~~~\ncontent\n```\n"
        issues = detect_ambiguous_nested_fences(text)
        self.assertEqual(issues, [])


class TestRewriteAmbiguousNestedFences(unittest.TestCase):

    def test_rewrite_prefers_tilde_when_inner_has_backticks_and_no_tilde(self):
        result = rewrite_ambiguous_nested_fences(AMBIGUOUS_BACKTICK)
        self.assertEqual(result, AMBIGUOUS_BACKTICK_REWRITTEN_TILDE)

    def test_rewrite_preserves_inner_literal_payload(self):
        result = rewrite_ambiguous_nested_fences(AMBIGUOUS_BACKTICK)
        self.assertIn("```python\n" + 'print("hello")\n' + "```\n", result)

    def test_rewrite_uses_longer_backtick_when_inner_has_tilde(self):
        result = rewrite_ambiguous_nested_fences(AMBIGUOUS_INNER_HAS_TILDE)
        self.assertEqual(result, AMBIGUOUS_INNER_HAS_TILDE_REWRITTEN)

    def test_rewrite_uses_longer_backtick_when_inner_has_both(self):
        result = rewrite_ambiguous_nested_fences(AMBIGUOUS_INNER_HAS_BOTH)
        self.assertEqual(result, AMBIGUOUS_INNER_HAS_BOTH_REWRITTEN)

    def test_rewrite_multiple_ambiguous_blocks(self):
        result = rewrite_ambiguous_nested_fences(MULTIPLE_AMBIGUOUS)
        self.assertEqual(result, MULTIPLE_AMBIGUOUS_REWRITTEN)

    def test_no_rewrite_for_safe_tilde_outer(self):
        result = rewrite_ambiguous_nested_fences(SAFE_TILDE_OUTER)
        self.assertEqual(result, SAFE_TILDE_OUTER)

    def test_no_rewrite_for_safe_longer_backtick_outer(self):
        result = rewrite_ambiguous_nested_fences(SAFE_LONGER_BACKTICK_OUTER)
        self.assertEqual(result, SAFE_LONGER_BACKTICK_OUTER)

    def test_no_rewrite_for_safe_plain_content(self):
        result = rewrite_ambiguous_nested_fences(SAFE_NO_NESTED)
        self.assertEqual(result, SAFE_NO_NESTED)

    def test_rewrite_preserves_lines_outside_fence(self):
        result = rewrite_ambiguous_nested_fences(AMBIGUOUS_BACKTICK)
        self.assertIn("Before text.", result)
        self.assertIn("After text.", result)

    def test_rewrite_outer_with_two_nested_snippets_keeps_inner_intact(self):
        result = rewrite_ambiguous_nested_fences(AMBIGUOUS_TWO_NESTED_SNIPPETS)
        self.assertEqual(result, AMBIGUOUS_TWO_NESTED_SNIPPETS_REWRITTEN)
        # All inner snippet fences must be byte-for-byte preserved.
        self.assertIn("```python\nfoo()\n```\n", result)
        self.assertIn('```json\n{"a": 1}\n```\n', result)

    def test_rewrite_unlabeled_longer_same_marker_inner_fence(self):
        result = rewrite_ambiguous_nested_fences(AMBIGUOUS_LONGER_SAME_MARKER_INNER)
        self.assertEqual(result, AMBIGUOUS_LONGER_SAME_MARKER_INNER_REWRITTEN)

    def test_rewrite_inner_tilde_only_uses_longer_backtick(self):
        # Inner payload has only ~~~ (no backtick runs). Spec says prefer ~~~ when
        # payload has ``` and ~~~ is absent. Here payload has NO ```. Falls through
        # to "longer same-marker fence". Max inner backtick run = 0, outer = 3,
        # so new outer = 4 backticks.
        text = "```\n~~~\nblock\n~~~\ncontent\n```\n"
        # This is NOT ambiguous (tilde doesn't close backtick outer), so no rewrite.
        result = rewrite_ambiguous_nested_fences(text)
        self.assertEqual(result, text)


class TestCLI(unittest.TestCase):

    def _run(self, *args):
        return subprocess.run(
            [sys.executable, SCRIPT, *args],
            capture_output=True,
            text=True,
        )

    def test_cli_rewrite_in_place_converts_ambiguous_fence(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(AMBIGUOUS_BACKTICK)
            tmp = f.name
        try:
            result = self._run("--plan", tmp, "--rewrite-in-place")
            self.assertEqual(result.returncode, 0, msg=f"stderr: {result.stderr}")
            with open(tmp) as f:
                content = f.read()
            self.assertEqual(content, AMBIGUOUS_BACKTICK_REWRITTEN_TILDE)
        finally:
            os.unlink(tmp)

    def test_cli_rewrite_in_place_leaves_safe_plan_unchanged(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(SAFE_TILDE_OUTER)
            tmp = f.name
        try:
            result = self._run("--plan", tmp, "--rewrite-in-place")
            self.assertEqual(result.returncode, 0, msg=f"stderr: {result.stderr}")
            with open(tmp) as f:
                content = f.read()
            self.assertEqual(content, SAFE_TILDE_OUTER)
        finally:
            os.unlink(tmp)

    def test_cli_requires_plan_argument(self):
        result = self._run("--rewrite-in-place")
        self.assertNotEqual(result.returncode, 0)

    def test_cli_missing_file_errors(self):
        result = self._run("--plan", "/nonexistent/path.md", "--rewrite-in-place")
        self.assertNotEqual(result.returncode, 0)


class TestRewriteThenParseSmoke(unittest.TestCase):
    """Smoke test: rewrite a malformed plan in place, then verify extract-plan-tasks.py succeeds."""

    def _run_script(self, script, *args):
        return subprocess.run(
            [sys.executable, script, *args],
            capture_output=True,
            text=True,
        )

    def test_rewrite_in_place_then_extract_plan_tasks_succeeds_longer_inner(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(MINIMAL_PLAN_WITH_LONGER_SAME_MARKER_INNER)
            tmp = f.name
        try:
            pre = self._run_script(EXTRACT_SCRIPT, "--plan", tmp)
            self.assertNotEqual(
                pre.returncode,
                0,
                msg="Expected extract-plan-tasks.py to fail on the malformed plan before hardening",
            )
            rewrite = self._run_script(SCRIPT, "--plan", tmp, "--rewrite-in-place")
            self.assertEqual(
                rewrite.returncode,
                0,
                msg=f"plan_fence_hardening.py --rewrite-in-place failed: {rewrite.stderr}",
            )
            post = self._run_script(EXTRACT_SCRIPT, "--plan", tmp)
            self.assertEqual(
                post.returncode,
                0,
                msg=f"extract-plan-tasks.py failed after hardening: {post.stderr}",
            )
        finally:
            os.unlink(tmp)

    def test_rewrite_in_place_then_extract_plan_tasks_succeeds(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(MINIMAL_PLAN_WITH_AMBIGUOUS_FENCE)
            tmp = f.name
        try:
            # Confirm the malformed plan is NOT parseable before hardening.
            pre = self._run_script(EXTRACT_SCRIPT, "--plan", tmp)
            self.assertNotEqual(
                pre.returncode,
                0,
                msg="Expected extract-plan-tasks.py to fail on the ambiguous plan before hardening",
            )

            # Rewrite the plan in place.
            rewrite = self._run_script(SCRIPT, "--plan", tmp, "--rewrite-in-place")
            self.assertEqual(
                rewrite.returncode,
                0,
                msg=f"plan_fence_hardening.py --rewrite-in-place failed: {rewrite.stderr}",
            )

            # Confirm the hardened plan IS parseable.
            post = self._run_script(EXTRACT_SCRIPT, "--plan", tmp)
            self.assertEqual(
                post.returncode,
                0,
                msg=f"extract-plan-tasks.py failed after hardening: {post.stderr}",
            )
        finally:
            os.unlink(tmp)


if __name__ == "__main__":
    unittest.main()
