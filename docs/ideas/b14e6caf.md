{
  "id": "b14e6caf",
  "title": "Restore old todo-tool UX parity for Flow ideas",
  "tags": [
    "pi-flow",
    "idea",
    "regression",
    "tui",
    "ux"
  ],
  "status": "open",
  "created_at": "2026-05-21T06:10:07.728Z"
}

## Summary

Restore the human-facing workflow ergonomics that were lost when Flow moved from the old `todo` / `TODO-<id>` surface to the new `idea` / `IDEA-<id>` surface.

The durable artifacts moved successfully to `docs/ideas/<8hex>.md`, but the new idea surface is currently much thinner than the old todo extension:

- no browseable TUI;
- no first-class way to list/filter open ideas from the UI;
- no rich tool-result rendering;
- no append/delete/claim/release parity;
- `/flow:idea` directly transcribes text instead of using the agent/LLM to structure the artifact;
- the `idea` tool's `list` action rejects useful filters such as `status: "open"`.

## Conversation context that created this idea

- The user asked how to list ideas and where ideas are stored.
- We found ideas live in `docs/ideas/` and are shown as `IDEA-<8hex>`.
- The user remembered that the old todos tool had a nice TUI for browsing todos.
- We confirmed that the new `idea` surface currently has only `/flow:idea` for direct capture plus an agent-facing `idea` tool with `list | read | create | update`.
- Calling the current `idea` tool as `{ "action": "list", "status": "open" }` failed with `invalid fields for list: status`, because `list` currently accepts no filters.
- The user asked to inspect the old extension at `~/.pi/agent/extensions/todos.ts` and turn this idea into a mini-spec for equivalent idea functionality.
- The user then questioned whether `/flow:idea` should exist at all, since the old path was easy: ask the LLM to create a todo and let the LLM call the tool.

## Old todo extension audit

Source audited: `~/.pi/agent/extensions/todos.ts`.

The old extension did **not** internally call the LLM to elaborate todos. Its richer capture behavior came from exposing a good `todo` tool to the LLM: the user could ask in natural language, the agent would shape the title/body, and then call the tool.

Important old capabilities to preserve or intentionally adapt:

### Storage and metadata

- Stored markdown files under `.pi/todos` by default, with `PI_TODO_PATH` override.
- File format: JSON object front matter followed by markdown body.
- Metadata included `id`, `title`, `tags`, `status`, `created_at`, and optional `assigned_to_session`.
- Supported lock files (`<id>.lock`) with a 30-minute TTL to prevent concurrent edits.
- Had `settings.json` with GC settings and deleted old closed todos on startup.

For Flow ideas, keep the new canonical storage and identifier:

- `docs/ideas/<8hex>.md`
- `IDEA-<8hex>`
- no `TODO-` compatibility and no `docs/todos/` fallback.

Do **not** blindly port todo GC: Flow ideas are durable project artifacts and should not be auto-deleted just because they are done.

### Agent-facing tool API

The old `todo` tool supported:

- `list` — assigned + open todos, grouped for the agent;
- `list-all` — assigned + open + closed;
- `get`;
- `create`;
- `update`;
- `append`;
- `delete`;
- `claim`;
- `release`.

It returned structured `details` for custom rendering and for agent use.

The new `idea` tool currently supports only:

- `list`;
- `read`;
- `create`;
- `update`.

### TUI command

The old `/todos` command provided the browse/manage UI. In interactive mode it used `ctx.ui.custom()` and pi-tui components; in non-UI mode it printed a grouped text list.

The TUI included:

- fuzzy search across ID, raw ID, title, tags, status, and assignment;
- grouped/sorted display with open items before closed items and assigned items emphasized;
- header counts for open and closed items;
- keyboard navigation with configured TUI keybindings;
- `Enter` to open an action menu;
- `Esc` to close/back out;
- `Ctrl+Shift+W` quick action to work on the selected item;
- `Ctrl+Shift+R` quick action to refine the selected item;
- action menu entries: view, work, refine, close/reopen, release assignment, copy path, copy text, delete;
- delete confirmation;
- markdown detail overlay with scrolling/paging;
- notifications after close/reopen/release/delete/copy operations;
- editor handoff via `ctx.ui.setEditorText(...)` for work/refine prompts.

### Tool result rendering

The old tool implemented `renderCall` and `renderResult` so tool usage was readable in the Pi transcript:

- compact call line with action/id/title;
- grouped list rendering;
- expandable details;
- status/tag/created/body detail rendering;
- success prefixes for create/update/append/delete/claim/release.

## Product direction

### 1. Make natural-language capture the primary LLM-assisted path

The old workflow was pleasant because the user could say something like “create a todo for this” and the LLM would create a polished artifact via the tool. We should preserve that pattern for ideas.

Primary capture flow should be:

1. User asks naturally: “capture this as an idea”, “create an idea for this regression”, etc.
2. The agent uses the `idea` tool directly.
3. The agent writes a concise title and structured markdown body based on the current conversation context.

This means the `idea` tool description and prompt snippet should actively teach agents how to create high-quality ideas, not merely expose a storage primitive.

Suggested LLM-facing guidance for `idea create`:

- Use the current conversation context when the user asks to capture an idea.
- Preserve the user's intent; do not invent decisions that were not discussed.
- Prefer a body structure like:
  - `## Context`
  - `## Problem / opportunity`
  - `## Desired outcome`
  - `## Scope / possible approach`
  - `## Acceptance sketch`
  - `## Open questions`
- Ask one clarification first only when the missing information would materially change the artifact.
- Otherwise create the idea and report the resulting `IDEA-<id>`.

### 2. Reconsider `/flow:idea`

Do **not** make `/flow:idea` the only or preferred rich-capture path. The user already finds it easy to ask the LLM to create an artifact, and the old extension's “elaboration” came from the LLM/tool interaction rather than from a slash command.

Recommended command stance:

- Add `/flow:ideas` as the main human-facing command for browsing/managing ideas.
- Keep `/flow:idea` only if it has a clear narrow purpose:
  - raw/direct quick capture, equivalent to today's behavior; or
  - a thin handoff that sends/prefills a natural-language request asking the agent to create an idea from the provided text.
- If kept, document it as optional. Users should not need to know `/flow:idea` exists in order to create polished ideas.
- Consider soft-deprecating `/flow:idea` in favor of natural language + `/flow:ideas`, rather than deleting it immediately and breaking existing muscle memory.

Possible final shape:

- `/flow:ideas` — open the TUI browser/manager.
- `/flow:idea --raw <text>` — direct transcription for users who explicitly want raw capture.
- `/flow:idea <text>` — either:
  - preserve current raw behavior for backward compatibility; or
  - queue/prefill an LLM capture prompt using `pi.sendUserMessage(...)` / `ctx.ui.setEditorText(...)`.

Open decision: choose whether `/flow:idea <text>` defaults to raw capture or LLM-assisted capture. Given the latest user feedback, defaulting to natural-language LLM capture via ordinary chat may be cleaner than adding magic to the slash command.

### 3. Add `/flow:ideas` TUI parity

Implement `/flow:ideas` as the idea equivalent of old `/todos`.

Interactive behavior:

- Open a custom TUI over `docs/ideas/*.md`.
- Show header counts: `Ideas (N open, M done)`.
- Support initial search text from command args: `/flow:ideas regression`.
- Fuzzy-search across `IDEA-<id>`, raw id, title, tags, status, and optionally body text.
- Sort open ideas before done ideas; within each group use stable chronological order unless search scoring is active.
- Render done ideas dimmed.
- Show tags and status inline.
- Use injected `keybindings` (`tui.select.*`) instead of hard-coded escape sequences where possible.
- Preserve old quick keys where available:
  - arrows / configured select keys move;
  - `Enter` opens actions;
  - `Esc` closes/back;
  - `Ctrl+Shift+W` work on idea;
  - `Ctrl+Shift+R` refine idea.

Action menu:

- `view` — open markdown detail overlay.
- `work` — hand off to the agent with an editor prompt such as `work on idea IDEA-<id> "<title>"`.
- `refine` — hand off to the agent with a prompt asking clarifying questions before rewriting/updating the idea.
- `scout` — prefill or run `/flow:scout IDEA-<id>`.
- `spec` — prefill or run `/flow:spec IDEA-<id>`.
- `plan` — prefill or run `/flow:plan IDEA-<id>`.
- `done` / `reopen` — update status.
- `copy path` — copy absolute `docs/ideas/<id>.md` path.
- `copy text` — copy `# <title>\n\n<body>`.
- `delete` — require confirmation.

Detail overlay:

- Render body as markdown.
- Show title, id, status, tags, and created timestamp.
- Support scrolling/page navigation.
- `Enter` can choose the primary handoff action (probably `work` or action menu back to avoid surprises).
- `Esc` returns to the selector.

Non-interactive behavior:

- `/flow:ideas` prints a grouped text list instead of opening a TUI.
- Support flags such as `--open`, `--done`, `--all`, and search terms.

### 4. Expand the `idea` tool API

Bring the tool close to old `todo` parity while preserving current names where useful.

Proposed actions:

- `list` — list ideas; accept optional filters.
- `list-all` — explicit all-status listing, for old parity and clarity.
- `read` — current canonical read action.
- `get` — optional alias for `read` if useful for old-tool parity.
- `create` — create a structured idea.
- `update` — replace title/body/tags/status fields.
- `append` — append markdown to the body without replacing it.
- `delete` — delete an idea, returning the deleted record in details.
- `claim` — optional: assign an open idea to current session.
- `release` — optional: clear assignment.

`list` should accept optional fields rather than rejecting them:

- `status?: "open" | "done" | "all"`
- `query?: string`
- `includeBody?: boolean` only if needed; default false to avoid heavy output.

This fixes the observed failure where `{ "action": "list", "status": "open" }` returned `invalid fields for list: status`.

Structured details should include enough information for custom rendering and programmatic use:

- action name;
- returned ideas;
- current session id if assignment is supported;
- error field on failure.

### 5. Add custom rendering for the `idea` tool

Match the old todo tool's transcript ergonomics:

- `renderCall` should show action, id, and title compactly.
- `renderResult` for lists should group open/done ideas and be expandable.
- Single-idea results should show title, status, tags, created timestamp, and body when expanded.
- Mutating actions should show success prefixes such as `Created`, `Updated`, `Appended to`, `Deleted`, `Claimed`, `Released`.

### 6. Preserve Flow-specific semantics

Do not regress the migration goals:

- Keep `IDEA-<id>` as the only accepted/displayed prefix.
- Keep `docs/ideas/<id>.md` as canonical storage.
- Keep compatibility with existing files and metadata.
- Keep statuses aligned with current Flow ideas: `open` and `done` unless there is a deliberate migration.
- Avoid resurrecting generic `/todos` naming in pi-flow-core.
- Avoid auto-GC of done ideas by default.

Optional metadata additions must be backward-compatible:

- `assigned_to_session` can be added as optional metadata if claim/release is implemented.
- Existing files without that field must still parse and render.
- Writers must not discard unknown future fields unless intentionally normalizing the schema.

## Implementation notes

- Port the old TUI components conceptually, renaming `Todo*` to `Idea*` and adapting labels/statuses/paths.
- Use `ctx.ui.custom()` for the `/flow:ideas` selector and overlay, following Pi TUI docs.
- Use overlay options similar to the old detail view: centered, around 80% width/height.
- Use `ctx.ui.setEditorText(...)` for non-surprising handoffs from the TUI, as the old `/todos` command did.
- If `/flow:idea` becomes an LLM handoff, use `pi.sendUserMessage(...)` when idle or `deliverAs: "followUp"` when the agent is busy, following Pi extension docs. Alternatively, prefill editor text for user confirmation instead of auto-sending.
- Prefer direct storage helpers shared by command and tool (`readIdea`, `writeIdea`, `listIdeas`) rather than duplicating file parsing logic.
- If delete/append/claim/release are added, consider a lock helper equivalent to the old `.lock` behavior or another safe atomic update strategy.

## Test plan

Add/update tests around observable behavior:

- `idea` tool accepts `list` with `status: "open"` and returns only open ideas.
- `idea` tool supports `list-all` or equivalent all-status listing.
- `append` preserves existing body and adds markdown separated by a blank line.
- `delete` removes the file and returns the deleted record details.
- If implemented, `claim`/`release` persist optional `assigned_to_session` and reject unsafe conflicts unless forced.
- Existing `docs/ideas/<id>.md` files without optional assignment metadata still parse.
- `/flow:ideas` is registered and, without UI, prints a useful grouped list.
- `/flow:ideas <query>` filters results.
- TUI component unit tests cover filtering/sorting/action selection where practical.
- Tool renderers render list and single-idea results without throwing.
- If `/flow:idea` changes behavior, tests pin the chosen behavior:
  - raw write remains available; and/or
  - LLM handoff sends/prefills the expected capture prompt and does not directly write an unelaborated file.

## Acceptance criteria

- A user can run `/flow:ideas` and browse existing `docs/ideas/*.md` artifacts in a TUI comparable to the old `/todos` UI.
- A user can search, view, copy, mark done/reopen, delete with confirmation, and hand an idea back to the agent from that TUI.
- A user can list open ideas through a first-class command/tool path without shell snippets.
- The LLM can create polished, structured idea artifacts through the `idea` tool when asked naturally in conversation.
- `/flow:idea` is either clearly deprecated or has a documented narrow role that does not compete confusingly with natural-language capture.
- Existing idea files remain valid and continue to use `IDEA-<id>` / `docs/ideas/` only.

## Open questions

1. Should `/flow:idea <text>` keep today's raw direct-capture behavior, become an explicit LLM handoff, or be soft-deprecated?
2. Should `/flow:idea --raw <text>` be introduced to preserve raw capture if the default changes?
3. Should assignment (`claim` / `release`) be ported for ideas, or is that too task-oriented for durable intent artifacts?
4. Should the TUI include Flow-specific actions (`scout`, `spec`, `plan`) in addition to old-style `work` and `refine`?
5. Should `idea list` default to all ideas for backward compatibility, or open ideas for old todo parity? A `status` filter removes most of the pressure from this decision.
