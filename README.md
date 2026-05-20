# pi-flow

An opinionated pi workflow platform providing passive workflow resources and scalable skill distribution.

## Workspace Layout

```
packages/pi-flow-core/    Bundled workflow skills, agent definitions, markdown contracts, Python helpers/tests, and model-tier configuration templates
packages/pi-flow-ux/      Optional UX layer: footer extension, working indicator/message, Nord theme, and packaged working defaults
packages/pi-flow/         Aggregate package that re-exposes pi-flow-core and pi-flow-ux resources through node_modules/
```

## What's Shipped Today

This workspace exposes passive workflow resources (Markdown skill definitions, fixtures, and Python helper scripts) and optional UX enhancements (footer extension, working indicator/message, Nord theme). No `/flow:*` commands or `/flow:setup` flow initialization are available yet.

## What's Deferred

- `/flow:*` command implementations and routing
- `/flow:setup` flow initialization and project scaffolding
- `/flow:idea` idea storage and retrieval

## Required Companion

This workspace requires the `pi-interactive-subagent` — an agent that interprets and executes workflow steps at runtime. Install it alongside this package.

## Configuration

For model-tier setup and configuration, see [`packages/pi-flow-core/docs/model-tier-setup.md`](packages/pi-flow-core/docs/model-tier-setup.md).
