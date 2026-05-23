# Linked-idea closure

## Why this exists

This contract documents the `idea`-tool-driven closure procedure shared by `fastlane` Step 10 and `execute-plan` Step 16.2. Each caller resolves its own `idea_id` and `completion_note` string via caller-local rules. This procedure owns only the tool-call sequence.

## Inputs

- `idea_id` — string, required. The bare ID without the `IDEA-` prefix.
- `completion_note` — string, required. The line to append to the idea body upon closure.

## Procedure

1. Call the built-in `idea` tool with `action: "read"`, `id: "<idea_id>"`.
2. If the read returns `isError`, the idea is missing, or `details.status` is already `"closed"`, skip silently and return; do not surface an error to the user.
3. Otherwise call the built-in `idea` tool with `action: "update"`, `id: "<idea_id>"`, `status: "closed"`, and `body: "<details.body + \n + completion_note>"`. The existing body is preserved; the `completion_note` is appended on a new line.

## Caller-owned concerns

Idea-ID resolution (which source line to scan, fastlane's spec-preamble extraction vs. execute-plan's `**Source:** IDEA-<id>` plan-body scan) and completion-note authoring (`Completed via fastlane: ...` vs. `Completed via plan: ...`) stay caller-local. This contract does not standardize them.
