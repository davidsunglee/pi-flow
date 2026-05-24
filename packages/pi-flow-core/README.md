# @aphotic/pi-flow-core

Workflow skills, bundled agent definitions, slash commands, and helper runner for pi-flow.

## What Is Shipped

- **Workflow skills** — 15 non-browser skills under `skills/`, each with a `SKILL.md` contract, markdown templates, and per-skill Python helper scripts.
- **Shared markdown contracts** — reusable prose templates under `skills/_shared/`.
- **Prompt templates** — skill-scoped `.md` files consumed by agents at runtime via `pi-flow template <id>`.
- **Python helpers** — per-skill and shared scripts under `skills/*/scripts/`, invoked by `pi-flow helper <id>`.
- **Bundled agent definitions** — pre-built agent YAMLs under `agents/`, linked into `.pi/agents/` or `~/.pi/agent/agents/` by `/flow:setup`.
- **Slash commands** — `/flow:setup`, `/flow:ideas`, and the 7 workflow `/flow:*` dispatch commands exposed by `extensions/commands.ts`.
- **Idea storage and tooling** — the `idea` LLM tool (the primary capture surface, invoked from natural-language conversation) plus the `/flow:ideas` browser, both backed by `docs/ideas/<8hex>.md` artifacts.
- **Helper-runner CLI** (`pi-flow`) — resolves logical resource IDs against the installed package and dispatches to helpers or templates. See [docs/helper-runner.md](docs/helper-runner.md).
- **Model-tier example** — `model-tiers.example.json` as a starting point for local model-tier configuration. See [docs/model-tier-setup.md](docs/model-tier-setup.md).

## Quick Start — Helper Runner

```sh
# Run a shared Python helper
pi-flow helper _shared/resolve-model-dispatch --tier capable --agent coder

# Run a skill-specific helper
pi-flow helper execute-plan/extract-plan-tasks --plan plan.md

# Resolve a template path
TEMPLATE=$(pi-flow template fastlane/fastlane-coder-prompt)

# Full usage
pi-flow --help
```

See [docs/helper-runner.md](docs/helper-runner.md) for the complete contract, resource ID grammar, path resolution rules, and off-PATH invocation.

## Commands

- `/flow:setup` — symlink bundled agent definitions into the `@aphotic/pi-mux-subagents` discovery directory for the current install scope.
- `/flow:ideas` — browse and manage existing IDEA artifacts in `docs/ideas/` (TUI when interactive; grouped text list otherwise). Idea capture itself is now driven by natural-language conversation through the `idea` LLM tool.
- `/flow:scout` — route an IDEA, brief path, or prose request to the `scout` skill.
- `/flow:spec` — route an IDEA, spec path, or prose request to the `define-spec` skill.
- `/flow:plan` — route an IDEA, brief/spec path, or prose request to the `generate-plan` skill.
- `/flow:refine-plan` — route a plan file or prose request to the `refine-plan` skill.
- `/flow:execute` — route a plan file or prose request to the `execute-plan` skill.
- `/flow:refine-code` — route a review file or prose request to the `refine-code` skill.
- `/flow:fastlane` — route a spec file or prose request to the `fastlane` skill.

### Exact vs interpreted input

Workflow commands accept either an exact artifact-shaped argument or freeform prose. Exact inputs are routed directly to the named skill: an `IDEA-<8hex>` ID, a `docs/<dir>/<file>.md` path, or no arguments when the skill accepts an empty invocation. Any other argument is treated as prose and forwarded to the agent with a structured prompt telling it to use the target skill, resolve the argument, and ask one clarification if needed. Pass `--exact` or `--no-interpret` to suppress that fallback; non-exact input then fails with a usage error instead of invoking the LLM.

### /flow:setup

`/flow:setup` detects whether `@aphotic/pi-flow-core` was loaded from `user`, `project`, or `temporary` scope by consulting `pi.getCommands()` metadata first and falling back to an `import.meta.url`/filesystem heuristic when registry metadata is missing. Temporary loads (`pi -e ...`) must be made durable with `--target user` or `--target project`; that flag lets a temporary session choose the destination scope explicitly.

The command walks every bundled `agents/*.md` file and attempts to create the matching symlink in the chosen discovery directory. Each entry is reported as `created`, `skipped`, or `conflict`. Conflicts distinguish between a real file already occupying the destination path and a divergent symlink that points somewhere other than the bundled agent source. When any new symlink is created, `/flow:setup` recommends reloading Pi (or running `/reload`) so newly linked agents are discoverable immediately.

In addition to the bundled-agent symlinks, `/flow:setup --target user` creates or verifies a `pi-flow` helper-runner shim at `~/.pi/agent/bin/pi-flow` pointing at this package's `bin/pi-flow.mjs`. Pi prepends `~/.pi/agent/bin` to `PATH`, so the shim makes `pi-flow` resolve inside Pi tool and subagent execution contexts even when the npm `bin` entry is not exposed (e.g. `pi install git:...`). The shim is reported alongside the agent entries with the same `created` / `skipped` / `conflict` vocabulary, and is never silently overwritten. Project-target setup never creates or replaces the global shim: if it is missing or points at another install, `/flow:setup --target project` emits guidance instead of touching it. See `docs/helper-runner.md` for the full bootstrap matrix and conflict-resolution steps.

### The `idea` tool and `/flow:ideas`

Idea capture is driven by natural-language conversation: ask the agent to "capture an idea" (or any informal phrasing) and it invokes the `idea` LLM tool, which writes `docs/ideas/<8hex>.md` artifacts consisting of a JSON metadata block followed by the markdown body, then reports the artifact as `IDEA-<id>`. The tool supports `action: list | read | create | update | append | delete` and accepts either `IDEA-<id>` or bare `<id>` identifiers. `/flow:ideas` opens the browser/manager UI over the same storage. Identifiers using the legacy-prefix form are no longer recognized — see the migration section below for the one-time user migration step.

`/flow:setup` is required after installation so `@aphotic/pi-mux-subagents` can discover the bundled `@aphotic/pi-flow-core/agents/*.md` definitions. Subagent-backed workflows — `scout`, `define-spec`, `generate-plan`, `execute-plan`, `refine-plan`, `refine-code`, and `fastlane` — also depend on `@aphotic/pi-mux-subagents` being installed alongside this package, which is why it is already declared as a peer dependency.

### Migration from docs/todos/

pi-flow's durable-intent artifacts were previously surfaced as `TODO-<id>` and stored under `docs/todos/<8hex>.md`. The rebrand renames the visible identifier to `IDEA-<id>` and the storage directory to `docs/ideas/` — this avoids clashing with the generic "todo" terminology used by other LLM checklist/planning tools and plugins.

**One-time user migration (per project):**

```sh
mv docs/todos docs/ideas
```

Run this once per project that previously stored ideas under `docs/todos/`. The migration is documented but not executed by `pi-flow` itself; the rebrand is a hard cutover with no compatibility window — pi-flow no longer reads `docs/todos/` or accepts `TODO-<id>` as an artifact-token shape. Existing artifact filenames (bare 8-hex) and on-disk JSON metadata are unchanged; only the parent directory and the user-facing prefix change.

Preamble lines in existing on-disk specs, plans, briefs, or reviews that say `Source: TODO-<id>` or `Scout brief: docs/briefs/TODO-<id>-brief.md` will no longer be parsed by `pi-flow`'s provenance extractor (which now matches only `IDEA-<id>` / `docs/briefs/IDEA-<id>-brief.md`). pi-flow does not rewrite these preambles automatically — manually update them, or treat affected artifacts as historical (the plan/spec content still reads correctly to humans, but downstream workflows like execute-plan's "close linked idea" substep will silently skip).

## Model Tiers

Copy `model-tiers.example.json` to configure which Claude model tier is used for each role. See [docs/model-tier-setup.md](docs/model-tier-setup.md) for details.

## Required Companion Package

`@aphotic/pi-flow-core` requires **`@aphotic/pi-mux-subagents`** as a peer dependency.

Install it alongside this package if your Pi package source does not install peers automatically:

```sh
pi install npm:@aphotic/pi-mux-subagents
```
