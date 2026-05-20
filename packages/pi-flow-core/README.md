# pi-flow-core

Workflow skills, bundled agent definitions, slash commands, and helper runner for pi-flow.

## What Is Shipped

- **Workflow skills** — 15 non-browser skills under `skills/`, each with a `SKILL.md` contract, markdown templates, and per-skill Python helper scripts.
- **Shared markdown contracts** — reusable prose templates under `skills/_shared/`.
- **Prompt templates** — skill-scoped `.md` files consumed by agents at runtime via `pi-flow template <id>`.
- **Python helpers** — per-skill and shared scripts under `skills/*/scripts/`, invoked by `pi-flow helper <id>`.
- **Bundled agent definitions** — pre-built agent YAMLs under `agents/`, linked into `.pi/agents/` or `~/.pi/agent/agents/` by `/flow:setup`.
- **Slash commands** — `/flow:setup`, `/flow:idea`, and the 7 workflow `/flow:*` dispatch commands exposed by `extensions/commands.ts`.
- **Idea storage and tooling** — the `idea` tool plus `/flow:idea`, both backed by `docs/todos/<8hex>.md` artifacts.
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

- `/flow:setup` — symlink bundled agent definitions into the `pi-interactive-subagent` discovery directory for the current install scope.
- `/flow:idea` — create or update a TODO artifact in `docs/todos/` and report it as `TODO-<id>`.
- `/flow:scout` — route a TODO, brief path, or prose request to the `scout` skill.
- `/flow:spec` — route a TODO, spec path, or prose request to the `define-spec` skill.
- `/flow:plan` — route a TODO, brief/spec path, or prose request to the `generate-plan` skill.
- `/flow:refine-plan` — route a plan file or prose request to the `refine-plan` skill.
- `/flow:execute` — route a plan file or prose request to the `execute-plan` skill.
- `/flow:refine-code` — route a review file or prose request to the `refine-code` skill.
- `/flow:fastlane` — route a spec file or prose request to the `fastlane` skill.

### Exact vs interpreted input

Workflow commands accept either an exact artifact-shaped argument or freeform prose. Exact inputs are routed directly to the named skill: a `TODO-<8hex>` ID, a `docs/<dir>/<file>.md` path, or no arguments when the skill accepts an empty invocation. Any other argument is treated as prose and forwarded to the agent with a structured prompt telling it to use the target skill, resolve the argument, and ask one clarification if needed. Pass `--exact` or `--no-interpret` to suppress that fallback; non-exact input then fails with a usage error instead of invoking the LLM.

### /flow:setup

`/flow:setup` detects whether `pi-flow-core` was loaded from `user`, `project`, or `temporary` scope by consulting `pi.getCommands()` metadata first and falling back to an `import.meta.url`/filesystem heuristic when registry metadata is missing. Temporary loads (`pi -e ...`) must be made durable with `--target user` or `--target project`; that flag lets a temporary session choose the destination scope explicitly.

The command walks every bundled `agents/*.md` file and attempts to create the matching symlink in the chosen discovery directory. Each entry is reported as `created`, `skipped`, or `conflict`. Conflicts distinguish between a real file already occupying the destination path and a divergent symlink that points somewhere other than the bundled agent source. When any new symlink is created, `/flow:setup` recommends reloading Pi (or running `/reload`) so newly linked agents are discoverable immediately.

### /flow:idea and the `idea` tool

`/flow:idea` writes legacy-compatible `docs/todos/<8hex>.md` artifacts consisting of a JSON metadata block followed by the markdown body, then reports the artifact as `TODO-<id>` so existing workflow skills keep working unchanged. The `idea` LLM tool operates on the same storage with `action: list | read | create | update` and accepts either `TODO-<id>` or bare `<id>` identifiers. The durable `IDEA-<id>` rebrand is tracked separately by `TODO-d9644bc0`.

`/flow:setup` is required after installation so `pi-interactive-subagent` can discover the bundled `pi-flow-core/agents/*.md` definitions. Subagent-backed workflows — `scout`, `define-spec`, `generate-plan`, `execute-plan`, `refine-plan`, `refine-code`, and `fastlane` — also depend on `pi-interactive-subagent` being installed alongside this package, which is why it is already declared as a peer dependency.

## Model Tiers

Copy `model-tiers.example.json` to configure which Claude model tier is used for each role. See [docs/model-tier-setup.md](docs/model-tier-setup.md) for details.

## Required Companion Package

`pi-flow-core` requires **`pi-interactive-subagent`** as a peer dependency.

Install it alongside this package:

```sh
pnpm add pi-interactive-subagent
```
