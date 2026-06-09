**Reviewer:** openai-codex/gpt-5.5 via codex

### Outcome

**Verdict:** Approved

**Reasoning:** The final range implements tool-first `subagent_done` completion wording from a shared canonical source, preserves visible marker and byte-equality contracts, and adds guardrail coverage for runtime-dispatched task prompts plus the shared snippet. The prior blocking gap in `test_completion_protocol_contract.py` is fixed, and no Critical or Important issues remain.

### Strengths

- `completion-protocol.md` clearly defines the marker and report variants and explains why the tool call, not the visible line alone, is the completion signal.
- Managed `completion-protocol:<id>` regions are byte-coupled to the shared canonical blocks through `sync-completion-protocol.py --check/--apply`.
- Marker-based prompts continue to require an anchored visible marker line and a byte-equal `subagent_done(message=DONE_MESSAGE)` handoff.
- The contract test now scans the runtime-dispatched task prompt templates (`execute-task`, `verify-task`, `fastlane-coder`, planner edit, code refiner, and plan refiner) for forbidden final-answer-first wording.
- Verification passed: `python3 -m unittest packages/pi-flow-core/skills/_shared/scripts/tests/test_completion_protocol_contract.py`, `python3 packages/pi-flow-core/skills/_shared/scripts/sync-completion-protocol.py --check`, `python3 -m unittest packages/pi-flow-core/skills/_shared/scripts/tests/test_marker_emit_contract.py`, `python3 -m unittest discover -s packages/pi-flow-core/skills/_shared/scripts/tests`, and `git diff --check 1bc52d19f59bf9f6c25a42c06fdecb6f1b087771..58f63f33eb6369dddc3be11b37c362a4ce49575f`.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

_None._

### Recommendations

_None._
