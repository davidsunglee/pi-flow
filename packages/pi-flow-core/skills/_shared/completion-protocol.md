# Completion Protocol (Tool-First)

Canonical `subagent_done` completion wording for every runtime-dispatched pi-flow subagent prompt and agent definition. This file is the single source of truth for that wording in two coupled ways:

1. **Generated managed region (byte-coupled).** The invariant tool-first safety sentences live in the `## Embedded canonical blocks` section below. Each runtime prompt/agent embeds the matching block verbatim inside a managed `<!-- BEGIN completion-protocol:<id> -->` … `<!-- END completion-protocol:<id> -->` region. The helper `skills/_shared/scripts/sync-completion-protocol.py` reads the blocks here and writes them into every region (`--apply`); the guardrail test `skills/_shared/scripts/tests/test_completion_protocol_contract.py` runs the same helper in `--check` mode and fails if any on-disk region drifts a single byte from its block here. This is what proves the runtime text is produced from this source rather than hand-copied: edit a block once here, re-run `--apply`, and every region updates; hand-edit a region and `--check` fails.
2. **File-specific framing (phrase-coupled).** The marker name, `DONE_MESSAGE` mechanics, and per-agent context vary by file and stay in prose outside the managed region. Each runtime file carries an explicit `Completion source: packages/pi-flow-core/skills/_shared/completion-protocol.md` reference, the tool-first sentences, and (for marker variants) the `subagent_done(message=DONE_MESSAGE)` contract; the guardrail fails if any of those drop out or drift back toward final-answer-first phrasing (instructing the agent to end with a final message and only afterwards call the tool).

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

## Embedded canonical blocks

The blocks below are the byte-exact text that every runtime prompt/agent embeds inside its managed `<!-- BEGIN completion-protocol:<id> -->` … `<!-- END completion-protocol:<id> -->` region. They carry the invariant tool-first safety sentences only; the marker name and `DONE_MESSAGE` mechanics stay in each file's surrounding prose. `sync-completion-protocol.py` parses the text between each `<!-- canonical:<id> -->` / `<!-- /canonical:<id> -->` delimiter pair, so edit the wording once here and re-run the helper — never hand-edit a managed region.

Marker variant (artifact-handoff prompts and agents):

<!-- canonical:marker-core -->
The `subagent_done` tool call is the completion signal: the visible marker line alone is not completion. Do not end the session by sending a final answer alone, and do not emit further output after `subagent_done`. If this environment's `subagent_done` tool has no `message` argument, call `subagent_done()` immediately after the visible marker line.
<!-- /canonical:marker-core -->

Report variant (report-is-the-deliverable agents):

<!-- canonical:report-core -->
The `subagent_done` tool call is the completion signal: the visible report alone is not completion. Do not end the session by sending a final answer alone, and do not emit further output after `subagent_done`.
<!-- /canonical:report-core -->
