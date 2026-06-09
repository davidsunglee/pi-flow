# Completion Protocol (Tool-First)

Canonical `subagent_done` completion wording for every runtime-dispatched pi-flow subagent prompt and agent definition. This file is the single source of truth for that wording: runtime prompts and agent definitions embed the sentences below (with their marker name and path filled in), and the guardrail test `skills/_shared/scripts/tests/test_completion_protocol_contract.py` fails if a runtime prompt drops the tool-first sentences or drifts back toward final-answer-first phrasing (instructing the agent to end with a final message and only afterwards call the tool).

Why tool-first: some backends (e.g. Codex) treat "emit your final message, and only afterwards call `subagent_done`" as permission to stop after the final message — they emit a terminal final answer and never make the tool call, stranding the parent under `auto-exit: true`. Completion must therefore be described as the tool call itself, with the visible output positioned relative to that call ("immediately before the tool call") — never as a final message that the tool call merely follows.

The visible marker/report lines remain mandatory in all variants: cross-backend fallback parsing reads the transcript's last assistant message when the tool channel is unavailable, and parent orchestrators keep their existing byte-equality and marker-parsing contracts.

## Marker variant (artifact handoff)

For prompts that hand off an artifact path via an anchored marker line (`BRIEF_ARTIFACT`, `SPEC_ARTIFACT`, `PLAN_ARTIFACT`, `REVIEW_ARTIFACT`, `TEST_RESULT_ARTIFACT`). Substitute the concrete marker name and path for `<MARKER>` / `<absolute path>`.

Completion protocol (tool-first):

1. Set DONE_MESSAGE to `<MARKER>: <absolute path>`, where `<absolute path>` is character-for-character identical to the orchestrator-supplied output path.
2. Emit DONE_MESSAGE visibly as the final visible line of your output — anchored at column 1 on its own line, no surrounding backticks, no leading whitespace, no trailing commentary, nothing after it on subsequent lines — immediately before the tool call.
3. Then call `subagent_done(message=DONE_MESSAGE)` — i.e. `subagent_done(message="<MARKER>: <absolute path>")` — as your terminal tool action. The `message` argument MUST be byte-equal to the visible marker line. The tool call is the completion signal.
4. The visible marker line alone is not completion. Do not end the session by sending a final answer alone. Do not emit further output after `subagent_done`.
5. If this environment's `subagent_done` tool has no `message` argument, call `subagent_done()` immediately after the visible marker line.

## Report variant (no marker)

For prompts whose deliverable is the report text itself (coder status report, verifier report, standalone reviews, planner edit mode).

Completion protocol (tool-first):

1. Prepare the full report in the prompt's required format.
2. Emit the report visibly as your final visible output, immediately before the tool call.
3. Then call `subagent_done()` — with no `message` argument — as your terminal tool action, so the parent receives the full report from the transcript's last assistant message. The tool call is the completion signal.
4. The visible report alone is not completion. Do not end the session by sending a final answer alone. Do not emit further output after `subagent_done`.
