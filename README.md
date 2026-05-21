# pi-flow

`pi-flow` is a pnpm monorepo for packaging Flow's Pi workflow resources: skills, subagent definitions, `/flow:*` commands, helper scripts, and optional UX polish.

## Packages

| Package | Purpose | Install when... |
| --- | --- | --- |
| `pi-flow` | Aggregate package that forwards `pi-flow-core` and `pi-flow-ux` resources. | You want the default full Flow experience. |
| `pi-flow-core` | Headless workflow package: skills, agents, helper runner, `/flow:*` commands, `/flow:idea`, `idea` tool, and `/flow:setup`. | You want workflow automation without the UI extras. |
| `pi-flow-ux` | Optional UX package: footer extension, working indicator/message, Nord theme, and packaged defaults. | You only want the UI layer or want to combine it manually. |

The repository root is the development workspace. The distributable package entry points live under `packages/`.

## Install

### Default aggregate install

Use the aggregate package for the normal setup:

```sh
pi install npm:pi-flow
```

Or, for a git-pinned install while developing/testing this repo:

```sh
pi install git:github.com/davidsunglee/pi-flow
```

After installing the aggregate package, run:

```text
/flow:setup
```

`/flow:setup` links bundled `pi-flow-core/agents/*.md` into the matching Pi agent-discovery directory so `@aphotic/pi-mux-subagents` can find the packaged subagents.

### Headless workflow install

Install only the workflow layer when you do not want the UX extensions/theme:

```sh
pi install npm:pi-flow-core
```

Then run `/flow:setup` for the same agent-discovery setup.

### UX-only install

Install only the UI layer when you want the footer, working indicator, and Nord theme without workflow commands:

```sh
pi install npm:pi-flow-ux
```

## Required companion

`pi-flow` and `pi-flow-core` require `@aphotic/pi-mux-subagents` for subagent-backed workflows (`scout`, `define-spec`, `generate-plan`, `execute-plan`, `refine-plan`, `refine-code`, `fastlane`). Install it alongside the workflow package if your Pi package source does not install peers automatically.

## Development

```sh
pnpm install
pnpm test
pnpm check
```

For model-tier setup and configuration, see [`packages/pi-flow-core/docs/model-tier-setup.md`](packages/pi-flow-core/docs/model-tier-setup.md).
