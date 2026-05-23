# Coder report contract

## Why this exists

This contract documents the parser invocation, stdout JSON schema, status semantics, and protocol-error/warning labels that both `fastlane` and `execute-plan` consume when processing a coder subagent's final message. Workflow-specific routing — checkpoint blocks, retry rules, wave gates, verifier gates — is owned by each caller's SKILL.md and is not part of this contract.

## Parser invocation

```bash
pi-flow helper _shared/parse-coder-report --report <path-or-dash>
```

`<path-or-dash>` is the path to the coder's `finalMessage` content saved to disk, or `-` to read from stdin.

## Stdout JSON fields

- **`status`** — one of the four valid status tokens (see below)
- **`files_changed`** — list of file paths extracted from the `## Files Changed` bullet list
- **`concerns_block`** — verbatim text under `## Concerns / Needs / Blocker`
- **`blocker_text`** — `concerns_block` when status is `BLOCKED`, otherwise `null`
- **`needs_text`** — `concerns_block` when status is `NEEDS_CONTEXT`, otherwise `null`
- **`tests_block`** — verbatim text under `## Tests`
- **`completed_block`** — verbatim text under `## Completed`
- **`self_review_block`** — verbatim text under `## Self-Review Findings`
- **`protocol_warnings`** — list of non-fatal warning labels (see below); empty list when none

## Status semantics

- **`DONE`** — all acceptance criteria met; caller may proceed to the next step
- **`DONE_WITH_CONCERNS`** — work complete but the coder surfaced doubts; caller decides whether to surface them, gate on them, or proceed
- **`NEEDS_CONTEXT`** — coder cannot proceed without specific missing information; `needs_text` carries the details; caller must provide the missing context before re-dispatching
- **`BLOCKED`** — coder cannot complete the task; `blocker_text` carries the reason; caller must intervene before re-dispatching

## Protocol-error and warning labels

The following labels indicate a malformed or unreadable report. The first three are hard errors (written to stderr as JSON, exit 1); the fourth is a soft warning (included in `protocol_warnings` in the stdout JSON, exit 0).

- **`status_line_missing`** — no line matching `^#{0,6}\s*STATUS:\s*(\S+)` was found outside a fenced block
- **`status_token_invalid`** — the status token is not one of the four valid values
- **`report_unreadable`** — the report file could not be opened (OSError)
- **`concerns_block_missing`** — status is `DONE_WITH_CONCERNS` but `## Concerns / Needs / Blocker` is empty (warning only)

## Caller-owned routing

What the caller does with each status is entirely the caller's responsibility. Whether `DONE_WITH_CONCERNS` triggers a wave-level checkpoint, a verifier gate, or an immediate proceed; whether `BLOCKED` surfaces to the user or escalates to the orchestrator; and whether `NEEDS_CONTEXT` re-dispatches automatically or pauses for human input — all of this is specified in each caller's own SKILL.md and is outside the scope of this contract.
