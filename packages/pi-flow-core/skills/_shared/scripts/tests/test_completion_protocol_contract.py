"""Guardrail tests for the tool-first `subagent_done` completion protocol.

Codex-backed subagents stop after a terminal final answer when prompts describe
completion as "emit your final assistant message, then call `subagent_done`".
These tests enforce the tool-first contract defined in the shared snippet
`skills/_shared/completion-protocol.md`:

  - every runtime-dispatched prompt/agent describes the `subagent_done` tool
    call as the completion signal, with the visible output positioned
    immediately before the tool call;
  - marker-based prompts use the explicit DONE_MESSAGE contract
    (`subagent_done(message=DONE_MESSAGE)` byte-equal to the visible marker
    line);
  - no runtime prompt (or the shared snippet itself) reintroduces
    final-answer-first wording.

Tests assert string presence/absence rather than dispatching real subagents.
"""
import importlib.util
import os
import re
import unittest


REPO_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", "..")
)

# Load the sync helper as a module so the guardrail re-renders runtime regions
# from the canonical source and proves byte-coupling, not just phrase presence.
_SYNC_PATH = os.path.join(
    REPO_ROOT,
    "packages/pi-flow-core/skills/_shared/scripts/sync-completion-protocol.py",
)
_sync_spec = importlib.util.spec_from_file_location("sync_completion_protocol", _SYNC_PATH)
sync = importlib.util.module_from_spec(_sync_spec)
_sync_spec.loader.exec_module(sync)

SHARED_SNIPPET = "packages/pi-flow-core/skills/_shared/completion-protocol.md"

# Runtime prompts/agents that hand off an artifact path via an anchored
# marker line and must use the DONE_MESSAGE contract.
MARKER_FILES = [
    "packages/pi-flow-core/skills/scout/scout-prompt.md",
    "packages/pi-flow-core/agents/scout.md",
    "packages/pi-flow-core/skills/define-spec/spec-design-procedure.md",
    "packages/pi-flow-core/agents/spec-designer.md",
    "packages/pi-flow-core/skills/generate-plan/generate-plan-prompt.md",
    "packages/pi-flow-core/agents/planner.md",
    "packages/pi-flow-core/skills/requesting-code-review/review-code-prompt.md",
    "packages/pi-flow-core/skills/generate-plan/review-plan-prompt.md",
    "packages/pi-flow-core/agents/code-reviewer.md",
    "packages/pi-flow-core/agents/plan-reviewer.md",
    "packages/pi-flow-core/skills/_shared/test-runner-prompt.md",
    "packages/pi-flow-core/agents/test-runner.md",
]

# Runtime agents whose deliverable is the report text itself (no marker);
# they call subagent_done() with no message argument.
REPORT_FILES = [
    "packages/pi-flow-core/agents/coder.md",
    "packages/pi-flow-core/agents/verifier.md",
    "packages/pi-flow-core/agents/code-refiner.md",
    "packages/pi-flow-core/agents/plan-refiner.md",
]

ALL_RUNTIME_FILES = MARKER_FILES + REPORT_FILES

# Task prompt templates dispatched to subagents at runtime. They do not embed the
# canonical completion-protocol block themselves (their workers inherit it from the
# agent definitions above), so they are excluded from the byte-equality managed-region
# and required-phrase checks. They MUST still be scanned for forbidden final-answer-first
# wording so a regression in any dispatched prompt fails this suite.
TASK_PROMPT_FILES = [
    "packages/pi-flow-core/skills/execute-plan/execute-task-prompt.md",
    "packages/pi-flow-core/skills/execute-plan/verify-task-prompt.md",
    "packages/pi-flow-core/skills/fastlane/fastlane-coder-prompt.md",
    "packages/pi-flow-core/skills/generate-plan/edit-plan-prompt.md",
    "packages/pi-flow-core/skills/refine-code/refine-code-prompt.md",
    "packages/pi-flow-core/skills/refine-plan/refine-plan-prompt.md",
]

# Every runtime-dispatched subagent prompt that must avoid final-answer-first wording.
FORBIDDEN_SCAN_FILES = ALL_RUNTIME_FILES + TASK_PROMPT_FILES

# Final-answer-first wording: phrasings that describe the final assistant
# message as the completion act, with the tool call as an afterthought.
# Codex emits a terminal final answer and stops before the tool call when
# instructed this way.
FORBIDDEN_PATTERNS = [
    ("end your final assistant message",
     re.compile(r"end\s+your\s+final\s+assistant\s+message", re.I)),
    ("emit your final assistant message",
     re.compile(r"emit\s+your\s+final\s+assistant\s+message", re.I)),
    ("as your final assistant message",
     re.compile(r"as\s+your\s+final\s+assistant\s+message", re.I)),
    ("send one final assistant message",
     re.compile(r"send\s+one\s+final\s+assistant\s+message", re.I)),
    ("your final assistant message must/should ...",
     re.compile(r"your\s+final\s+assistant\s+message\s+(must|should)", re.I)),
    ("final assistant message should summarize",
     re.compile(r"final\s+assistant\s+message\s+should\s+summari[sz]e", re.I)),
    ("final assistant message ... then ... subagent_done",
     re.compile(
         r"final\s+assistant\s+message[^\n]{0,200}then[^\n]{0,200}subagent_done",
         re.I,
     )),
    ("in addition to the final-assistant-message ...",
     re.compile(r"in\s+addition\s+to\s+the\s+final[-\s]assistant[-\s]message", re.I)),
    ("final-assistant-message marker",
     re.compile(r"final[-\s]assistant[-\s]message\s+marker", re.I)),
]

# Tool-first phrases every runtime prompt (and the shared snippet) must carry.
REQUIRED_PHRASES_ALL = [
    "completion signal",
    "alone is not completion",
    "final answer alone",
    "immediately before the tool call",
]

# Marker-based prompts must additionally spell out the DONE_MESSAGE contract.
REQUIRED_PHRASES_MARKER = [
    "DONE_MESSAGE",
    "subagent_done(message=DONE_MESSAGE)",
]


def read(rel_path):
    abs_path = os.path.join(REPO_ROOT, rel_path)
    with open(abs_path, "r", encoding="utf-8") as fh:
        return fh.read()


class TestSharedSnippetExists(unittest.TestCase):
    def test_snippet_exists_and_defines_tool_first_protocol(self):
        body = read(SHARED_SNIPPET)
        self.assertIn("tool-first", body.lower())
        for phrase in REQUIRED_PHRASES_ALL + REQUIRED_PHRASES_MARKER:
            self.assertIn(
                phrase, body,
                msg=f"{SHARED_SNIPPET} is missing canonical phrase {phrase!r}",
            )


class TestNoFinalAnswerFirstWording(unittest.TestCase):
    def test_scanned_task_prompts_exist(self):
        # A rename that drops a dispatched prompt from the scan must fail loudly
        # rather than silently shrinking forbidden-wording coverage.
        for rel_path in TASK_PROMPT_FILES:
            with self.subTest(file=rel_path):
                self.assertTrue(
                    os.path.isfile(os.path.join(REPO_ROOT, rel_path)),
                    msg=f"runtime task prompt {rel_path} is missing from the repo",
                )

    def test_runtime_files_and_snippet_avoid_final_answer_first_wording(self):
        for rel_path in FORBIDDEN_SCAN_FILES + [SHARED_SNIPPET]:
            body = read(rel_path)
            for label, pattern in FORBIDDEN_PATTERNS:
                with self.subTest(file=rel_path, forbidden=label):
                    match = pattern.search(body)
                    self.assertIsNone(
                        match,
                        msg=(
                            f"{rel_path} contains final-answer-first completion "
                            f"wording ({label}): {match.group(0)!r}"
                            if match else None
                        ),
                    )


class TestToolFirstPhrasesPresent(unittest.TestCase):
    def test_every_runtime_file_describes_tool_first_completion(self):
        for rel_path in ALL_RUNTIME_FILES:
            body = read(rel_path)
            for phrase in REQUIRED_PHRASES_ALL:
                with self.subTest(file=rel_path, phrase=phrase):
                    self.assertIn(
                        phrase, body,
                        msg=f"{rel_path} is missing tool-first phrase {phrase!r}",
                    )

    def test_marker_files_use_done_message_contract(self):
        for rel_path in MARKER_FILES:
            body = read(rel_path)
            for phrase in REQUIRED_PHRASES_MARKER:
                with self.subTest(file=rel_path, phrase=phrase):
                    self.assertIn(
                        phrase, body,
                        msg=f"{rel_path} is missing DONE_MESSAGE contract phrase {phrase!r}",
                    )

    def test_every_runtime_file_references_shared_source(self):
        for rel_path in ALL_RUNTIME_FILES:
            body = read(rel_path)
            with self.subTest(file=rel_path):
                self.assertIn(
                    SHARED_SNIPPET, body,
                    msg=f"{rel_path} must reference the shared completion protocol source",
                )


class TestRuntimeRegionsGeneratedFromCanonicalSource(unittest.TestCase):
    """Prove the runtime completion wording is *produced* from the shared source.

    Phrase-presence alone cannot detect a hand-edited copy drifting from the
    canonical snippet. These tests render each runtime file's managed region from
    `completion-protocol.md`'s canonical blocks and assert byte-equality, so any
    hand-edit of a region (or of the canonical block) that leaves them out of sync
    fails the suite.
    """

    def test_sync_helper_reports_no_drift(self):
        problems = sync.check_all()
        self.assertEqual(
            problems, [],
            msg=(
                "managed completion-protocol regions drifted from the canonical "
                "source; run sync-completion-protocol.py --apply:\n"
                + "\n".join(problems)
            ),
        )

    def test_every_runtime_file_is_registered_for_a_canonical_block(self):
        # The coupling guarantee only holds if every guarded runtime file actually
        # carries a managed region. Keep the sync registry and the contract lists
        # in lockstep.
        self.assertEqual(
            sorted(sync.FILE_VARIANTS),
            sorted(ALL_RUNTIME_FILES),
            msg="sync-completion-protocol.py FILE_VARIANTS must cover exactly the "
                "runtime files guarded by this contract",
        )

    def test_each_region_matches_its_canonical_block_byte_for_byte(self):
        blocks = sync.parse_canonical_blocks(read(SHARED_SNIPPET))
        for rel_path, block_id in sync.FILE_VARIANTS.items():
            with self.subTest(file=rel_path, block=block_id):
                region = sync.extract_region(read(rel_path), block_id)
                self.assertIsNotNone(
                    region,
                    msg=f"{rel_path} is missing the completion-protocol:{block_id} region",
                )
                self.assertIn(
                    block_id, blocks,
                    msg=f"{SHARED_SNIPPET} is missing canonical block {block_id!r}",
                )
                self.assertEqual(
                    region, blocks[block_id],
                    msg=f"{rel_path} completion-protocol:{block_id} region is not "
                        f"byte-equal to the canonical block in {SHARED_SNIPPET}",
                )

    def test_canonical_blocks_carry_tool_first_safety_sentences(self):
        blocks = sync.parse_canonical_blocks(read(SHARED_SNIPPET))
        for block_id in ("marker-core", "report-core"):
            with self.subTest(block=block_id):
                self.assertIn(block_id, blocks)
                body = blocks[block_id]
                self.assertIn("completion signal", body)
                self.assertIn("alone is not completion", body)
                self.assertIn("final answer alone", body)
                for _label, pattern in FORBIDDEN_PATTERNS:
                    self.assertIsNone(
                        pattern.search(body),
                        msg=f"canonical block {block_id} reintroduced final-answer-first wording",
                    )


if __name__ == "__main__":
    unittest.main()
