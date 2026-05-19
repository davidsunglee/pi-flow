# pi-flow

An opinionated pi workflow platform providing passive workflow resources and scalable skill distribution.

## Workspace Layout

```
packages/pi-flow-core/    Bundled workflow skills, agent definitions, markdown contracts, Python helpers/tests, and model-tier configuration templates
packages/pi-flow/         Aggregate package that re-exposes pi-flow-core resources through node_modules/
```

## What's Shipped Today

This slice exposes passive workflow resources only — Markdown skill definitions, fixtures, and Python helper scripts. No `/flow:*` commands or `/flow:setup` flow initialization are available yet.

## What's Deferred

- `/flow:*` command implementations and routing
- `/flow:setup` flow initialization and project scaffolding
- `/flow:idea` idea storage and retrieval
- UX package for browser-based workflow interfaces

## Required Companion

This workspace requires the `pi-interactive-subagent` — an agent that interprets and executes workflow steps at runtime. Install it alongside this package.

## Configuration

For model-tier setup and configuration, see [`packages/pi-flow-core/docs/model-tier-setup.md`](packages/pi-flow-core/docs/model-tier-setup.md).
