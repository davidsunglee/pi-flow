# pi-flow

`pi-flow` is a pnpm monorepo for packaging Flow's Pi workflow resources: skills, subagent definitions, `/flow:*` commands, helper scripts, and optional UX polish.

## Packages

| Package | Purpose | Install when... |
| --- | --- | --- |
| `@aphotic/pi-flow` | Aggregate package that forwards the workflow, UX, and ideas resources from the bundled suite. | You want the default full Flow experience. |
| `@aphotic/pi-flow-core` | Headless workflow package: skills, agents, helper runner, `/flow:*` commands, `idea` tool, `/flow:ideas` browser, and `/flow:setup`. | You want workflow automation without the UI extras. |
| `@aphotic/pi-flow-ux` | Optional UX package: border status element and status placement extension (`/status`: border editor, footer, or off), working indicator/message, Nord theme, and packaged defaults. | You only want the UI layer or want to combine it manually. |
| `@aphotic/pi-ideas` | Standalone configurable idea-capture package: `idea` tool, `/ideas` browser, and JSON-configurable work-menu actions backed by `docs/ideas/<8hex>.md`. | You want idea capture and browsing without the rest of pi-flow. |

The repository root is the development workspace. The distributable package entry points live under `packages/`.

## Install

### Default aggregate install

Use the aggregate package for the normal setup:

```sh
pi install npm:@aphotic/pi-flow
```

Or, for a git-pinned install while developing/testing this repo:

```sh
pi install git:github.com/davidsunglee/pi-flow
```

After installing the aggregate package, run:

```text
/flow:setup
```

`/flow:setup` links bundled `@aphotic/pi-flow-core/agents/*.md` into the matching Pi agent-discovery directory so `@aphotic/pi-mux-subagents` can find the packaged subagents.

### Headless workflow install

Install only the workflow layer when you do not want the UX extensions/theme:

```sh
pi install npm:@aphotic/pi-flow-core
```

Then run `/flow:setup` for the same agent-discovery setup.

### UX-only install

Install only the UI layer when you want the border status element, footer/status placement controls, working indicator, and Nord theme without workflow commands:

```sh
pi install npm:@aphotic/pi-flow-ux
```

### Ideas-only install

Install only the standalone idea-capture layer when you want the `idea` tool and `/ideas` browser without workflow commands or UX extras:

```sh
pi install npm:@aphotic/pi-ideas
```

## Required companion

`@aphotic/pi-flow` and `@aphotic/pi-flow-core` require `@aphotic/pi-mux-subagents` for subagent-backed workflows (`scout`, `define-spec`, `generate-plan`, `execute-plan`, `refine-plan`, `refine-code`, `fastlane`). Install it alongside the workflow package if your Pi package source does not install peers automatically.

## Development

```sh
pnpm install
pnpm test
pnpm check
```

For flow config setup and configuration, see [`packages/pi-flow-core/docs/flow-config-setup.md`](packages/pi-flow-core/docs/flow-config-setup.md).
