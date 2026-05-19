# Flow Setup and Command Surface

Source: TODO-cfcb8ede
Scout brief: docs/briefs/TODO-cfcb8ede-brief.md

## Goal

Add the active command layer that makes the extracted `pi-flow-core` resources usable from a fresh Pi setup. This includes explicit agent-definition setup for `pi-interactive-subagent`, stable `/flow:*` commands, forgiving command input handling, and a first-class `idea` intent-capture surface that remains compatible with legacy `TODO-<id>` artifacts.

## Context

The core extraction spec (`docs/specs/2026-05-19-cfcb8ede.md`) establishes the package-loadable core resources: `pi-flow-core` skills, helper runner, bundled agent definitions, and the aggregate `pi-flow` package. That slice intentionally defers active command behavior and agent discovery setup.

Pi extension commands are registered with `pi.registerCommand(name, { handler })`. Command names may include colon-style names, and Pi lists command provenance via `pi.getCommands()` entries with `sourceInfo.scope`, `sourceInfo.origin`, `sourceInfo.path`, and `sourceInfo.baseDir`. Command handlers can send agent-visible user messages with `pi.sendUserMessage(...)`, and extension contexts expose `ctx.cwd`, `ctx.ui`, `pi.exec(...)`, and UI prompt primitives.

Pi skill commands remain available as `/skill:<name>` when skill commands are enabled. The Flow commands should provide stable user-facing entry points even if generic skill commands are hidden later, while still keeping each workflow skill as the source of truth for orchestration. The command layer should not reimplement `scout`, `define-spec`, `generate-plan`, `refine-plan`, `execute-plan`, `refine-code`, or `fastlane` in TypeScript.

`pi-interactive-subagent` is still required for subagent-backed workflow paths. It discovers agent definitions from project-local `.pi/agents/`, global `~/.pi/agent/agents/`, and its own bundled agents, but not arbitrary Pi package `agents/` directories. The core package therefore needs an explicit setup command that makes bundled `pi-flow-core/agents/` discoverable from the matching install scope.

The current workflow uses `TODO-<8-hex>` identifiers and stores intent files at `docs/todos/<id>.md` with a JSON metadata block followed by markdown body. The durable rename to `IDEA-<id>` is out of scope and tracked by TODO-d9644bc0, but the user-facing command/tool surface should use “idea” terminology now to avoid generic todo/checklist collisions.

## Requirements

- Add a core TypeScript extension in `pi-flow-core` that registers the active Flow command and tool surface.
- Register these Flow commands:
  - `/flow:setup`
  - `/flow:idea`
  - `/flow:scout`
  - `/flow:spec`
  - `/flow:plan`
  - `/flow:refine-plan`
  - `/flow:execute`
  - `/flow:refine-code`
  - `/flow:fastlane`
- Keep each workflow skill as the source of truth. Flow workflow commands must route to the packaged skill workflows rather than duplicating the skill orchestrators in TypeScript.
- Support dual-mode input handling for workflow commands other than `/flow:setup`:
  - **Exact mode:** when arguments already match a known artifact/path/flag shape for the target skill, route directly to the canonical skill invocation.
  - **LLM-interpreted mode:** when arguments are prompt-like, incomplete, or otherwise not exact, send a structured user message that tells the agent to use the relevant skill, interpret the user request, find or construct the correct artifact arguments, and ask at most one clarification if needed.
- Provide an explicit `--exact` or `--no-interpret` flag for workflow commands so scripts/tests can fail fast instead of falling back to LLM interpretation.
- In exact mode, preserve existing skill input expectations rather than inventing new artifact formats.
- In interpreted mode, preserve the flexibility users get from skills being LLM-executed; do not reject human-friendly prose merely because it is not already in exact parser form.
- `/flow:setup` must be deterministic and must not use LLM interpretation.
- `/flow:setup` must locate bundled `pi-flow-core/agents/` from package provenance and make those agent definitions discoverable by `pi-interactive-subagent`.
- `/flow:setup` must infer the matching install scope from Pi package/command provenance where possible: global package loads set up global agents, project-local package loads set up project-local agents, and temporary `pi -e` package loads are treated as non-durable by default.
- `/flow:setup` must refuse to pretend a temporary `pi -e` load is a durable install. If temporary setup is supported at all, it must require an explicit user opt-in and a valid explicit target scope/path.
- `/flow:setup` must be conservative and idempotent: create missing symlinks, leave matching symlinks unchanged, refuse to overwrite real files or symlinks pointing elsewhere, and report exact created/skipped/conflict paths.
- `/flow:setup` must not intentionally mix scopes. A global install should not create project-local links unless the user explicitly requests that supported mode; a project-local install should not mutate global agent directories by default.
- `/flow:setup` must report enough information for users to resolve conflicts manually.
- `/flow:setup` must perform or recommend a reload/restart step if needed for newly linked agents to become discoverable.
- Implement `/flow:idea` as the first-class user-facing intent capture command.
- `/flow:idea` must write current legacy-compatible files under `docs/todos/<8-hex>.md` with the existing JSON metadata block plus markdown body shape.
- `/flow:idea` user-facing language should call the artifact an “idea” while returning the current artifact identifier as `TODO-<id>` for compatibility.
- `/flow:idea` must accept freeform prose and produce a useful title/body/tags/status artifact. If the input is too ambiguous to safely capture, it may use one clarification prompt.
- `/flow:idea` must not use `IDEA-<id>` as the durable identifier in this slice.
- Add a small `idea` tool if needed for LLM/workflow compatibility. It must use `idea` naming, operate on the same `docs/todos/*.md` storage, and accept `TODO-<id>` compatibility identifiers.
- Do not introduce an old `todo` command or `todo` tool name in `pi-flow`.
- Keep existing Python workflow helpers in Python behind the helper runner established by the core extraction spec. The new command/setup/idea layer should be TypeScript.
- Add tests for command registration, exact-mode routing, interpreted-mode prompt construction, setup symlink behavior, idea file creation, and the `idea` tool if included.
- Document the command surface, exact vs interpreted modes, setup behavior, idea/TODO compatibility, and the required `pi-interactive-subagent` companion.

## Constraints

- Do not reimplement workflow skill orchestration logic in TypeScript.
- Do not rewrite existing Python helper scripts into TypeScript as part of this spec.
- Do not automatically create global or project-local agent symlinks on package load; setup must be an explicit command.
- Do not create or emit `IDEA-<id>` artifacts yet.
- Do not introduce `/todo` or a `todo` tool through `pi-flow`.
- Do not depend on `pi-web-access` or `pi-processes` for the command/setup layer unless a direct implementation need is proven.
- Do not include UX resources such as footer, working indicator, working config, or nord theme in this spec.
- Do not require changes to `pi-interactive-subagent` unless implementation discovers already-available package-agent discovery support and documents the minimum version.

## Approach

**Chosen approach:** Implement a thin TypeScript command/router extension with deterministic setup and idea storage. Exact artifact-shaped inputs route directly to canonical skill invocations. Prompt-like inputs fall back to an LLM-interpreted user message that instructs the agent to use the relevant skill and derive or clarify the correct arguments. `/flow:setup` remains deterministic, scope-aware, and conflict-safe. New command/setup/idea code is TypeScript; existing workflow helpers remain Python behind the package helper runner.

**Why this over alternatives:** This preserves one source of truth for workflow orchestration in the skills, keeps commands scriptable for exact use cases, and preserves the flexible “describe what you want” interaction style for humans. It avoids a large TypeScript rewrite of tested helper/protocol code while still putting Pi-native command and tool behavior in TypeScript where it belongs.

**Considered and rejected:**

- TypeScript orchestration layer for every `/flow:*` command — more deterministic, but it duplicates skill logic and would drift as workflow skills evolve.
- Pure prompt aliases for every `/flow:*` command — maximally flexible, but weak for scripting, tests, and direct artifact workflows.
- Rewriting Python helpers into TypeScript now — unnecessary risk because those helpers already encode parser/protocol contracts and have tests/fixtures.
- Setup side effects during package load — convenient initially, but unsafe because it mutates global/project agent directories without explicit user intent.
- Reintroducing a `todo` tool/command for compatibility — collides with generic todo/checklist terminology and conflicts with the desired Flow-facing idea language.

## Acceptance Criteria

- `pi-flow-core` exposes a TypeScript extension that loads from the package manifest and registers all required `/flow:*` commands.
- `/flow:setup` creates missing agent-definition symlinks from bundled `pi-flow-core/agents/` to the matching `pi-interactive-subagent` discovery directory for the install scope.
- `/flow:setup` leaves matching symlinks unchanged and reports them as skipped or already configured.
- `/flow:setup` refuses to overwrite real files or divergent symlinks and reports exact conflict paths and expected targets.
- `/flow:setup` does not mutate global/project agent directories during package load or during non-setup commands.
- `/flow:setup` handles temporary package loads safely by refusing durable setup by default.
- Tests cover global-scope, project-scope, temporary-scope, idempotent, and conflict setup cases.
- `/flow:scout`, `/flow:spec`, `/flow:plan`, `/flow:refine-plan`, `/flow:execute`, `/flow:refine-code`, and `/flow:fastlane` route exact artifact-shaped inputs to the corresponding packaged skill workflows.
- Workflow commands support an exact/no-interpret flag that prevents LLM fallback and produces a clear error for non-exact input.
- Workflow commands turn non-exact prompt-like input into structured LLM-interpreted prompts that name the target skill, include the user’s original request, direct the agent to derive valid arguments, and limit clarification to one question when possible.
- Tests verify representative exact routing and interpreted fallback prompt construction for each workflow command.
- `/flow:idea` creates a `docs/todos/<8-hex>.md` file with a JSON metadata block containing at least `id`, `title`, `tags`, `status`, and `created_at`, followed by markdown body content.
- `/flow:idea` reports the created artifact as an idea and includes the compatibility identifier `TODO-<id>`.
- `/flow:idea` handles freeform input without requiring users to know the JSON metadata format.
- If an `idea` tool is included, it lists/reads/creates/updates legacy-compatible `docs/todos/*.md` artifacts through an `idea`-named API and accepts `TODO-<id>` identifiers.
- No `/todo` command or `todo` tool is registered by `pi-flow`.
- Command/idea tests use controlled temporary directories and do not mutate the developer’s real `~/.pi/agent/agents/` or project `.pi/agents/` directories.
- Documentation explains exact vs interpreted command modes, setup safety, scope behavior, idea/TODO compatibility, and how to run setup after installation.
- A real package-load smoke test shows the `/flow:*` commands and `idea` tool, if included, are available.
- A real setup verification confirms subagent definitions are discoverable after `/flow:setup` and a minimal subagent-backed workflow can dispatch.

## Non-Goals

- Extracting or packaging the UX layer.
- Implementing the durable `TODO-<id>` to `IDEA-<id>` migration.
- Rewriting existing workflow helper scripts from Python to TypeScript.
- Replacing the existing workflow skills with TypeScript implementations.
- Supporting unrelated external packages as command-layer dependencies.
- Publishing to npm.

## Open Questions

- What is the most reliable way for an extension command to identify its own package command provenance when multiple packages or duplicate command suffixes are loaded? `pi.getCommands()` exposes `sourceInfo`, but implementation must verify the current command can select the correct entry deterministically.
- Should `/flow:idea` always create an idea immediately from freeform input, or should it offer an optional edit/confirm UI before writing when `ctx.hasUI` is true?
- Which exact artifact shapes should each workflow command recognize for direct routing beyond obvious paths and `TODO-<id>` identifiers?
- If Pi skill commands are disabled, what is the best supported way for a Flow command to invoke a packaged skill without relying on visible `/skill:*` syntax? The implementation should prefer a Pi-supported direct mechanism if available; otherwise it should document the compatibility assumption.
- Should temporary `pi -e` setup support an explicit `--target project|global` escape hatch, or should temporary loads always refuse setup and instruct users to install first?
