# Packaging and Workspace Organization

## Workspace Layout

The `pi-flow` workspace is organized as a pnpm monorepo with two primary packages:

- **`packages/pi-flow-core/`**: The core distribution containing all workflow skills, bundled agent definitions, shared Markdown contracts, Python helpers and tests, the helper runner, and model-tier configuration templates.
- **`packages/pi-flow/`**: An aggregate package that depends on `pi-flow-core` and re-exposes its resources through `node_modules/pi-flow-core/` for downstream consumers.

## Package Boundaries

### pi-flow-core

`pi-flow-core` is the authoritative source for:
- 15 non-browser workflow skills (extracted from `../pi-config/agent/skills/`) with their templates, fixtures, and per-skill helper scripts
- Bundled agent role definitions
- Shared Markdown contracts and resource definitions
- Python helper utilities and test utilities
- Helper runner executable for resolving and executing workflow resources

### pi-flow (Aggregate)

The `pi-flow` package does not duplicate resources. Instead, it **forwards only through `node_modules/`**: consumers that depend on `pi-flow` receive access to `pi-flow-core` resources via the standard Node.js module resolution at `node_modules/pi-flow-core/`.

This approach:
- Avoids duplication and maintenance burden
- Ensures a single source of truth
- Simplifies versioning and dependency management

## Resource Discovery

This slice does not yet implement automatic discovery of resources in the `agents/` directory. Resource discovery and `/flow:setup` orchestration are deferred to a later slice and will be implemented when the `/flow:setup` command is built.

## Model-Tier Configuration

The runtime source of truth for model selection remains `~/.pi/agent/model-tiers.json`. This file is user-owned and not managed by the workspace. See `packages/pi-flow-core/docs/model-tier-setup.md` for configuration guidance.

## Consumer Project Artifact Directories

Consumers using this workspace should adopt these standard artifact directories:

- `docs/specs/` — Workflow specification documents
- `docs/briefs/` — Skill execution briefing documents
- `docs/plans/` — Multi-step workflow plans
- `docs/plans/reviews/` — Plan review and analysis artifacts
- `docs/reviews/` — Post-execution workflow reviews
- `docs/test-runs/` — Test execution logs and results
- `docs/todos/` — Task and todo tracking

## Non-Goals for This Slice

As defined in the initial specification (`docs/specs/2026-05-19-cfcb8ede.md`), this slice explicitly does not implement:

- `/flow:*` command routing or CLI implementation
- `/flow:setup` flow initialization or project scaffolding
- Idea storage, retrieval, or management
- Browser-based UX package
- Automatic agent discovery from the `agents/` directory
- Runtime-driven skill loading from the filesystem

These capabilities are deferred to follow-up slices and will be implemented with appropriate architectural boundaries when the workflow runtime is built.
