# pi-flow-core

Workflow skills, bundled agent definitions, and helper runner for pi-flow.

## What Is Shipped

- **Workflow skills** — 15 non-browser skills under `skills/`, each with a
  `SKILL.md` contract, markdown templates, and per-skill Python helper scripts.
- **Shared markdown contracts** — reusable prose templates under
  `skills/_shared/`.
- **Prompt templates** — skill-scoped `.md` files consumed by agents at
  runtime via `pi-flow template <id>`.
- **Python helpers** — per-skill and shared scripts under `skills/*/scripts/`,
  invoked by `pi-flow helper <id>`.
- **Bundled agent definitions** — pre-built agent YAMLs under `agents/`.
  These are bundled for reference; automatic symlinking into `~/.pi` is not yet
  implemented (see below).
- **Helper-runner CLI** (`pi-flow`) — resolves logical resource IDs against the
  installed package and dispatches to helpers or templates. See
  [docs/helper-runner.md](docs/helper-runner.md).
- **Model-tier example** — `model-tiers.example.json` as a starting point for
  local model-tier configuration. See [docs/model-tier-setup.md](docs/model-tier-setup.md).

## What Is NOT Yet Shipped

- **Auto-symlinked agents** — bundled agent definitions are included but the
  `/flow:setup` command that symlinks them into `~/.pi` is not yet implemented.
- **`/flow:*` commands** — workflow slash-commands are deferred to a later spec.
- **`/flow:setup`** — environment setup command is deferred.
- **Idea storage** — not in scope for this package.
- **UX resources** — the `pi-flow-ux` package is a separate deliverable.

## Quick Start — Helper Runner

```sh
# Run a shared Python helper
pi-flow helper _shared/resolve-model-dispatch coder

# Run a skill-specific helper
pi-flow helper execute-plan/extract-plan-tasks plan.md

# Resolve a template path
TEMPLATE=$(pi-flow template fastlane/fastlane-coder-prompt)

# Full usage
pi-flow --help
```

See [docs/helper-runner.md](docs/helper-runner.md) for the complete contract,
resource ID grammar, path resolution rules, and off-PATH invocation.

## Model Tiers

Copy `model-tiers.example.json` to configure which Claude model tier is used for
each role. See [docs/model-tier-setup.md](docs/model-tier-setup.md) for details.

## Required Companion Package

`pi-flow-core` requires **`pi-interactive-subagent`** as a peer dependency. The
`peerDependencies` range is set to `"*"` intentionally — a stable companion
version pin is deferred to the setup/commands spec and will be tightened there.

Install it alongside this package:

```sh
pnpm add pi-interactive-subagent
```

## Agent Definitions

The `agents/` directory contains bundled agent definitions that ship with the core package. These agents are currently passive package files and are not yet auto-discovered by `pi-interactive-subagent`. Making these agent definitions discoverable through the package manager is the responsibility of the `/flow:setup` command in the follow-up specification. Users who want to manually wire these agents today can symlink them from `~/.pi/agent/agents/` or `.pi/agents/`.
