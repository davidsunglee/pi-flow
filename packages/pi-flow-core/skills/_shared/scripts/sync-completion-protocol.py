#!/usr/bin/env python3
"""Generate and verify the managed completion-protocol regions in runtime prompts.

The shared snippet `skills/_shared/completion-protocol.md` is the single source of
truth for the invariant tool-first `subagent_done` safety sentences. Its
`## Embedded canonical blocks` section holds one block per variant, delimited by
`<!-- canonical:<id> -->` / `<!-- /canonical:<id> -->`.

Every runtime prompt/agent embeds the block for its variant verbatim inside a
managed region delimited by:

    <!-- BEGIN completion-protocol:<id> ... -->
    <block text>
    <!-- END completion-protocol:<id> -->

This helper closes the loop the reviewer asked for: the runtime region text is
*produced* from the canonical block, not hand-copied.

  - `--apply` rewrites every managed region with the canonical block text.
  - `--check` (default) fails if any on-disk region differs by a single byte from
    its canonical block, or if a registered region marker is missing.

The guardrail test `tests/test_completion_protocol_contract.py` imports this
module and asserts `check_all()` reports no drift, so a hand-edit of any region
breaks the suite.
"""
import argparse
import os
import re
import sys


REPO_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..")
)

SHARED_SNIPPET = "packages/pi-flow-core/skills/_shared/completion-protocol.md"

# Runtime prompts/agents that hand off an artifact path via an anchored marker
# line embed the marker-core block; report-deliverable agents embed report-core.
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

REPORT_FILES = [
    "packages/pi-flow-core/agents/coder.md",
    "packages/pi-flow-core/agents/verifier.md",
    "packages/pi-flow-core/agents/code-refiner.md",
    "packages/pi-flow-core/agents/plan-refiner.md",
]

# Runtime file -> canonical block id it embeds.
FILE_VARIANTS = {}
for _f in MARKER_FILES:
    FILE_VARIANTS[_f] = "marker-core"
for _f in REPORT_FILES:
    FILE_VARIANTS[_f] = "report-core"


def _abs(rel_path):
    return os.path.join(REPO_ROOT, rel_path)


def read(rel_path):
    with open(_abs(rel_path), "r", encoding="utf-8") as fh:
        return fh.read()


def parse_canonical_blocks(snippet_text):
    """Return {block_id: text} parsed from the shared snippet's canonical delimiters."""
    blocks = {}
    for match in re.finditer(
        r"<!--\s*canonical:(?P<id>[A-Za-z0-9_-]+)\s*-->\n"
        r"(?P<body>.*?)\n"
        r"<!--\s*/canonical:(?P=id)\s*-->",
        snippet_text,
        re.DOTALL,
    ):
        blocks[match.group("id")] = match.group("body")
    return blocks


def _region_pattern(block_id):
    return re.compile(
        r"(?P<begin><!--\s*BEGIN completion-protocol:"
        + re.escape(block_id)
        + r"\b[^>]*-->\n)"
        r"(?P<body>.*?)"
        r"(?P<end>\n<!--\s*END completion-protocol:"
        + re.escape(block_id)
        + r"\s*-->)",
        re.DOTALL,
    )


def extract_region(file_text, block_id):
    """Return the managed region body for block_id, or None if the markers are absent."""
    match = _region_pattern(block_id).search(file_text)
    if match is None:
        return None
    return match.group("body")


def _load_canonical():
    blocks = parse_canonical_blocks(read(SHARED_SNIPPET))
    missing = sorted(set(FILE_VARIANTS.values()) - set(blocks))
    if missing:
        raise SystemExit(
            f"shared snippet {SHARED_SNIPPET} is missing canonical blocks: {missing}"
        )
    return blocks


def check_all():
    """Return a list of human-readable drift messages (empty == in sync)."""
    blocks = _load_canonical()
    problems = []
    for rel_path, block_id in FILE_VARIANTS.items():
        body = read(rel_path)
        region = extract_region(body, block_id)
        if region is None:
            problems.append(
                f"{rel_path}: missing managed region "
                f"<!-- BEGIN/END completion-protocol:{block_id} -->"
            )
            continue
        if region != blocks[block_id]:
            problems.append(
                f"{rel_path}: managed completion-protocol:{block_id} region drifted "
                f"from {SHARED_SNIPPET}; run sync-completion-protocol.py --apply"
            )
    return problems


def apply_all():
    """Rewrite every managed region with its canonical block text. Returns changed paths."""
    blocks = _load_canonical()
    changed = []
    for rel_path, block_id in FILE_VARIANTS.items():
        body = read(rel_path)
        pattern = _region_pattern(block_id)
        if pattern.search(body) is None:
            raise SystemExit(
                f"{rel_path}: missing managed region "
                f"<!-- BEGIN/END completion-protocol:{block_id} -->; cannot apply"
            )

        def _replace(match):
            return match.group("begin") + blocks[block_id] + match.group("end")

        new_body = pattern.sub(_replace, body)
        if new_body != body:
            with open(_abs(rel_path), "w", encoding="utf-8") as fh:
                fh.write(new_body)
            changed.append(rel_path)
    return changed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--check",
        action="store_true",
        help="Fail if any managed region drifts from its canonical block (default).",
    )
    group.add_argument(
        "--apply",
        action="store_true",
        help="Rewrite every managed region with its canonical block text.",
    )
    args = parser.parse_args(argv)

    if args.apply:
        changed = apply_all()
        if changed:
            for rel_path in changed:
                sys.stdout.write(f"updated {rel_path}\n")
        else:
            sys.stdout.write("all managed regions already in sync\n")
        return 0

    problems = check_all()
    if problems:
        for problem in problems:
            sys.stderr.write(problem + "\n")
        return 1
    sys.stdout.write("all managed completion-protocol regions match the canonical source\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
