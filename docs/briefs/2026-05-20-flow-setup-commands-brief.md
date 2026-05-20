# Scout Brief: Flow Setup Commands Spec

Generated at: 2026-05-20T16:32:58Z
Git SHA: 97e597903197fd32c1d14ad26c7b97401713b2df
Model: anthropic/claude-sonnet-4-6

## Relevant Files

### Existing package files (modify)

| File | Why |
|------|-----|
| `packages/pi-flow-core/package.json` | Add `"extensions"` to `files[]` and `"pi.extensions"` key; possibly add `"pi.tools"` if the `idea` tool needs manifest declaration |
| `packages/pi-flow-core/tsconfig.json` | Currently includes only `bin/**/*.mjs`; must expand to `extensions/**/*.ts` |
| `packages/pi-flow/package.json` | Aggregate manifest forwards UX resources; must be updated to also forward new core extension(s) via `node_modules/pi-flow-core/extensions/...` |

### Existing test infrastructure (modify or extend)

| File | Why |
|------|-----|
| `packages/pi-flow-core/package.json` (scripts) | `test:node` is `find bin __tests__ -name '*.test.mjs' -print0 | xargs -0 node --test`; must add `extensions` tree with `--experimental-strip-types` if extension tests use `.ts` |
| `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs` | Contains `requiredExtensionSubstrings` list and `pi.extensions` forwarding assertions — must be extended to include the new core command extension entry |

### Existing reference implementations (read-only; patterns to follow)

| File | What to learn |
|------|--------------|
| `packages/pi-flow-ux/extensions/working/working.ts:342` | `pi.registerCommand("working", { description, handler })` — the only existing command registration in the repo |
| `packages/pi-flow-ux/extensions/working/indicator.test.ts` | Stub-based test pattern: construct a `stubPi` object with mock `on` and `registerCommand`, pass to the extension function, capture the registered command handler, invoke it with a fake `ctx` |
| `packages/pi-flow-ux/extensions/working/message.test.ts` | Same stub pattern; both tests use `mkdtemp`/`rm` for isolated temp state |
| `packages/pi-flow-core/bin/pi-flow.mjs` | Helper runner: resolves `PACKAGE_ROOT` via `import.meta.url`, parses `location/name` IDs, calls `python3`; shows the expected TS-free `.mjs` file style for non-extension entry points |
| `packages/pi-flow-core/__tests__/pi-flow.test.mjs` | Smoke-test pattern via `spawnSync('node', [CLI, ...args])` |
| `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs` | `readFileSync` on skill/shared files to assert exact guardrail strings byte-equal |
| `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs` | Full end-to-end: `expandGlob`, `realpathSync`, `existsSync`, `spawnSync` for install probe |

### Files to create

| Path | Purpose |
|------|---------|
| `packages/pi-flow-core/extensions/commands.ts` | Default export `(pi: ExtensionAPI) => void`; registers all `/flow:*` commands |
| `packages/pi-flow-core/extensions/idea.ts` | `/flow:idea` command + `idea` tool; owns `PI_TODO_PATH` resolution (folding env.ts behavior per `d9644bc0` note) |
| `packages/pi-flow-core/extensions/setup.ts` | `/flow:setup` deterministic symlink logic; may be inline in `commands.ts` if small |
| `packages/pi-flow-core/extensions/commands.test.ts` | Stub-based tests: registration, exact routing, interpreted-mode prompt construction |
| `packages/pi-flow-core/extensions/idea.test.ts` | Temp-dir tests: file creation, metadata fields, `TODO-<id>` compatibility identifier, freeform input, `idea` tool |
| `packages/pi-flow-core/extensions/setup.test.ts` | Temp-dir tests: global-scope, project-scope, idempotent, conflict, temporary-load refusal |
| `packages/pi-flow-core/__tests__/package-manifest.test.mjs` | If it does not exist yet: parallel to `pi-flow-ux/__tests__/package-manifest.test.mjs`, checks `pi.extensions` includes the new commands entry |

---

### Key path constants for the implementation

- `packages/pi-flow-core/agents/` — bundled agents that `/flow:setup` symlinks out; 10 files (`scout.md`, `spec-designer.md`, `planner.md`, `plan-reviewer.md`, `plan-refiner.md`, `coder.md`, `verifier.md`, `test-runner.md`, `code-reviewer.md`, `code-refiner.md`)
- Global agent dir target: `~/.pi/agent/agents/`
- Project-local agent dir target: `<cwd>/.pi/agents/`

## Key Interfaces and Types

### Command registration (confirmed)

From `packages/pi-flow-ux/extensions/working/working.ts:342`:
```ts
pi.registerCommand("working", {
  description: "Configure the working message and working indicator globally.",
  handler: async (args, ctx) => {
    await this.handleCommand(args, ctx);
  },
});
```

`args` is the raw string after the command name. `ctx` exposes `ctx.cwd`, `ctx.hasUI`, `ctx.ui.notify(msg, "info"|"error")`, and (per spec description) `ctx.ui` prompt primitives.

### `pi.sendUserMessage` (described in spec; not yet used in this repo)

The spec describes this as the mechanism for LLM-interpreted mode: send a structured user message that instructs the agent to invoke a skill, interpret the user's request, find valid arguments, and ask one clarification if needed. The exact API surface (`pi.sendUserMessage(text: string) => void|Promise<void>`) must be verified against Pi documentation before implementation — no in-repo precedent exists.

### `pi.getCommands()` with `sourceInfo` (described in spec; not yet used in this repo)

The spec calls out `sourceInfo.scope`, `sourceInfo.origin`, `sourceInfo.path`, and `sourceInfo.baseDir` as the fields available on each command entry. This API is entirely new to this codebase. `/flow:setup` depends on it to identify the package install scope. Exact schema must be confirmed; if `pi.getCommands()` is unavailable or its `sourceInfo` shape differs, the setup scope-detection strategy needs a fallback.

### `pi.exec(...)` (described in spec; not yet used in this repo)

Mentioned in the spec as available on extension contexts. Not yet called anywhere in the repo. May be needed for setup symlink logic or for invoking skill commands without `sendUserMessage`. Must be verified before depending on it.

### `ExtensionAPI` import (confirmed)

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
```

Used by `pi-flow-ux` extensions. `pi-flow-core` does not yet have any TypeScript extensions or peer dependencies on `@earendil-works/*`.

### Todo file format (confirmed from multiple sources)

```
{
  "id": "<8-hex>",
  "title": "...",
  "tags": [...],
  "status": "open|done",
  "created_at": "ISO8601"
}

Optional markdown body after the closing brace.
```

Stored at `docs/todos/<8-hex>.md` relative to the git root. `PI_TODO_PATH` defaults to `<git-root>/docs/todos`.

### Exact-mode artifact shape (from spec and existing skills)

Workflow commands should recognize these as exact-mode inputs:
- An 8-hex `TODO-<id>` identifier (expands to `docs/todos/<id>.md`)
- An explicit file path ending in `.md` that resolves to a known artifact type
- A `--exact` or `--no-interpret` flag that forces exact mode and errors on non-exact input

## Dependency / Call Graph

### New extension loading chain

```
packages/pi-flow-core/package.json (pi.extensions)
  → packages/pi-flow-core/extensions/commands.ts
      imports: idea.ts, setup.ts (or inline)
      calls: pi.registerCommand("flow:setup", ...)
             pi.registerCommand("flow:idea", ...)
             pi.registerCommand("flow:scout", ...)
             pi.registerCommand("flow:spec", ...)
             pi.registerCommand("flow:plan", ...)
             pi.registerCommand("flow:refine-plan", ...)
             pi.registerCommand("flow:execute", ...)
             pi.registerCommand("flow:refine-code", ...)
             pi.registerCommand("flow:fastlane", ...)

packages/pi-flow/package.json (pi.extensions)
  → forwards node_modules/pi-flow-core/extensions/commands.ts (new)
  → forwards node_modules/pi-flow-ux/extensions/footer.ts (existing)
  → forwards node_modules/pi-flow-ux/extensions/working/index.ts (existing)
```

### `/flow:setup` logic chain

```
/flow:setup handler
  → pi.getCommands() [unconfirmed API]
      → locate 'flow:setup' entry's sourceInfo.path, sourceInfo.baseDir, sourceInfo.scope
  → resolve PACKAGE_ROOT from import.meta.url as fallback if getCommands is unavailable
  → resolve agents/ dir: PACKAGE_ROOT/agents/*.md
  → determine target dir:
      global scope  → ~/.pi/agent/agents/
      project-local → ctx.cwd + '/.pi/agents/'
      temporary     → refuse unless --target flag provided
  → for each agent .md file:
      lstat target/<name>
      if missing: symlink(source, target)        → report "created"
      if symlink pointing to same source: skip    → report "skipped"
      if symlink pointing elsewhere: refuse       → report "conflict: expected <X> got <Y>"
      if real file: refuse                        → report "conflict: real file, not overwritten"
  → recommend reload/restart if any symlinks were created
```

### `/flow:idea` logic chain

```
/flow:idea handler(args, ctx)
  → resolve PI_TODO_PATH: getGitRoot(ctx.cwd) + '/docs/todos'
  → generate id: crypto.randomBytes(4).toString('hex')
  → parse args:
      if exact (structured JSON-like): use directly
      if freeform prose: LLM-parsed by handler or one-clarification-prompt
  → write docs/todos/<id>.md with JSON frontmatter + markdown body
  → report: "Idea captured. TODO-<id>: <title>"
```

### `/flow:scout` (and other workflow commands) logic chain

```
/flow:scout handler(args, ctx)
  → parse args for exact-mode shapes (TODO-<id>, file path)
  → if --exact or --no-interpret and args not exact: exit with error
  → if exact: pi.sendUserMessage("Use the scout skill. Brief path: <resolved path>") [unconfirmed API]
  → if interpreted: pi.sendUserMessage(
      "Use the scout skill. User request: <args>. Identify the correct spec or TODO artifact path,
       ask at most one clarification if needed, then invoke the skill.")
```

## Patterns and Conventions

### TypeScript extension file conventions (from pi-flow-ux)

- Files at `extensions/*.ts` or `extensions/**/*.ts`
- Import: `import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";`
- Default export: `export default function (pi: ExtensionAPI): void { ... }`
- No build step: Pi loads `.ts` directly with strip-types
- `allowImportingTsExtensions: true` in tsconfig

### Test stub pattern (from indicator.test.ts and message.test.ts)

```ts
// Collect registered commands in a Map
const commands = new Map<string, CommandDef>();
const stubPi = {
  on(event: string, handler: EventHandler) { ... },
  registerCommand(name: string, def: CommandDef) { commands.set(name, def); },
  sendUserMessage(text: string) { ... },   // mock for new API
  getCommands() { return [...]; },         // mock for new API
};
createExtension()(stubPi as any);
```

### Test file discovery (current `pi-flow-core` setup)

`test:node` in `packages/pi-flow-core/package.json`:
```
find bin __tests__ -name '*.test.mjs' -print0 | xargs -0 node --test
```

For TypeScript extension tests, this must be updated to (mirroring pi-flow-ux):
```
find bin __tests__ extensions \( -name '*.test.mjs' -o -name '*.test.ts' \) -print0 | xargs -0 node --experimental-strip-types --test
```

### Command name format

Pi supports colon-style command names: `pi.registerCommand("flow:setup", ...)` registers `/flow:setup`. This is stated in the spec and consistent with the Pi extension API as used by `pi.registerCommand("working", ...)`. No disambiguation is needed by character set — colons are valid.

### Symlink operations (Node builtins)

`/flow:setup` must use `fs.symlink`, `fs.lstat`, `fs.readlink`, `fs.mkdir` (with `{ recursive: true }`) from `node:fs/promises` — no external packages needed. Tests must use `mkdtempSync` for isolated temp directories to avoid mutating the developer's real `~/.pi` or project `.pi` dirs.

### `PI_TODO_PATH` resolution (env.ts pattern to fold in)

From the existing pi-config `env.ts` (not yet in pi-flow-core): call a `getGitRoot(cwd)` helper (spawns `git rev-parse --show-toplevel`) and set `PI_TODO_PATH` to `<root>/docs/todos`. The spec (`d9644bc0` note) says the `idea` extension should own this resolution rather than requiring a separate `env.ts` extension.

### ID generation for `idea`

`crypto.randomBytes(4).toString('hex')` (Node built-in `node:crypto`) produces an 8-hex string matching the existing `cfcb8ede`/`d9644bc0`/`ef562e4d` pattern.

### Package manifest (`pi` key) update

Current `pi-flow-core`:
```json
"pi": { "skills": ["skills/*/SKILL.md"] }
```

After this spec:
```json
"pi": {
  "skills": ["skills/*/SKILL.md"],
  "extensions": ["extensions/commands.ts"]
}
```

Current `pi-flow` (aggregate) — must forward the new extension:
```json
"pi": {
  "skills": ["node_modules/pi-flow-core/skills/*/SKILL.md"],
  "extensions": [
    "node_modules/pi-flow-core/extensions/commands.ts",
    "node_modules/pi-flow-ux/extensions/footer.ts",
    "node_modules/pi-flow-ux/extensions/working/index.ts"
  ],
  "themes": ["node_modules/pi-flow-ux/themes/nord.json"]
}
```

## Existing Tests and Test Patterns

### Node test runner (`.mjs`, no strip-types)

Used by `pi-flow-core/bin` and `__tests__`:
- `packages/pi-flow-core/__tests__/pi-flow.test.mjs` — CLI smoke tests via `spawnSync`
- `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs` — `readFileSync` string assertions
- `packages/pi-flow-core/bin/__tests__/helper-runner.test.mjs` — integration tests for `pi-flow helper` and `pi-flow template`

### Node test runner with `--experimental-strip-types` (`.ts`)

Used by `pi-flow-ux/extensions/**/*.test.ts`:
- `packages/pi-flow-ux/extensions/footer.test.ts`
- `packages/pi-flow-ux/extensions/working/indicator.test.ts`
- `packages/pi-flow-ux/extensions/working/message.test.ts`
- `packages/pi-flow-ux/extensions/working/working.test.ts`

All share the same stub-`pi` isolation pattern; none depend on a real Pi runtime.

### Python unittest

6 discovery roots in `pi-flow-core/package.json test:helpers`:
- `skills/_shared/scripts/tests/` — 17 test files
- `skills/define-spec/scripts/tests/`
- `skills/execute-plan/scripts/tests/`
- `skills/fastlane/scripts/tests/`
- `skills/refine-code/scripts/tests/`
- `skills/refine-plan/scripts/tests/`

### What's still absent

- No `packages/pi-flow-core/__tests__/package-manifest.test.mjs` yet (pi-flow-ux has one at `__tests__/package-manifest.test.mjs`)
- No TypeScript extension tests in `pi-flow-core`
- No smoke test for symlink setup behavior

## Risk Areas

### 1. `pi.sendUserMessage` API shape (high risk)

`pi.sendUserMessage` is central to interpreted-mode routing for all 7 workflow commands but is not used anywhere in this codebase. If the method doesn't exist on `ExtensionAPI`, the entire LLM-routing design fails. The implementation must verify its existence and exact signature before building on it. Fallback: if unavailable, send via `ctx.ui.notify` with a copy-pasteable skill command, or document that commands work in exact mode only.

### 2. `pi.getCommands()` with `sourceInfo` (high risk)

`/flow:setup` needs `sourceInfo.scope` to distinguish global vs. project-local installs. This API is described in the spec but is absent from the entire `packages/` tree. If the field is not populated or the API shape differs, setup cannot reliably infer scope without a fallback (e.g., checking if `PACKAGE_ROOT` is under `~/.pi/agent/` vs. a project `node_modules`). This is the riskiest unconfirmed API surface.

### 3. `@earendil-works/pi-coding-agent` peer dependency in `pi-flow-core` (medium risk)

`pi-flow-core` has no current `peerDependencies` on `@earendil-works/*`. Adding a TypeScript extension that imports from that package requires adding the peer dependency and a devDependency for tests. The `pnpm-workspace.yaml` has `autoInstallPeers: false`, so this must be explicit. Failure to add it leaves the extension without type definitions and likely breaks `node --experimental-strip-types` loading.

### 4. `pi-flow-core/package.json files` and `pi` manifest not yet wired for extensions (medium risk)

`"files": ["bin", "skills", "agents", "docs", "model-tiers.example.json"]` excludes `extensions/`. Adding the TypeScript extension without updating `files` means it won't be included in a published package. Also, `tsconfig.json` only includes `bin/**/*.mjs` — TypeScript type checking of the new extension files requires updating `include`.

### 5. `test:node` script in `pi-flow-core` doesn't cover `.ts` files (medium risk)

Current: `find bin __tests__ -name '*.test.mjs'` — won't discover `.ts` extension tests. Must be updated to include `extensions` tree with `--experimental-strip-types`. If forgotten, extension tests silently never run.

### 6. Temp-load scope detection ambiguity for `/flow:setup` (medium risk)

If `pi.getCommands()` is unavailable, setup must infer scope from `PACKAGE_ROOT`. The heuristic (global if under `~/.pi/agent/`, project-local if under `<cwd>/node_modules/`) can misfire in non-standard install layouts. The spec requires refusing durable setup for `pi -e` temporary loads — if detection is uncertain, setup must default to refusing rather than creating wrong-scope symlinks.

### 7. `pi-flow` aggregate manifest forwarding test breakage (low risk but immediate)

`packages/pi-flow/__tests__/aggregate-forwarding.test.mjs` asserts exact `requiredExtensionSubstrings`. Adding `node_modules/pi-flow-core/extensions/commands.ts` to `pi-flow/package.json` without updating that test will cause it to fail if the test ever checks that all forwarded extensions exist as real files. Check `existsSync` loop at the end of the test.

## Possible Misses

### A. `env.ts` behavior must be folded into `idea` extension — not a separate extension

The `d9644bc0.md` todo explicitly notes: "fold the current `env.ts` behavior directly into that extension instead of requiring users to list a separate runtime extension." `env.ts` sets `PI_TODO_PATH` to `<git-root>/docs/todos` via a `session_start` event handler. If the `idea` extension registers on `session_start` to set this env variable as well, the separate `env.ts` is not needed. The spec does not call out `env.ts` extraction, and the `pi-flow-ux/package-manifest.test.mjs` explicitly lists `env.ts` in `EXCLUDED_EXTENSIONS`. Confirm that `PI_TODO_PATH` is set (or resolved at call time) within the `idea` implementation.

### B. `pi.registerCommand` with colon-style names — not yet confirmed for the Pi version in use

`pi.registerCommand("working", ...)` is confirmed. `pi.registerCommand("flow:setup", ...)` with a colon is stated in the spec but not yet demonstrated in the repo. The Pi docs should be checked to confirm that colon-separated names are valid and produce `/flow:*` commands (rather than a `/flow` command with `:setup` args).

### C. `idea` tool registration — separate from `idea` command?

The spec says "Add a small `idea` tool if needed for LLM/workflow compatibility." Pi "tools" (accessible from LLM agents) are different from Pi "commands" (accessible from the user command line). The mechanism for registering a Pi tool from an extension is not demonstrated in this codebase. If `pi.registerTool(...)` exists, its API shape is unknown. If tools are declared in a separate `pi.tools` manifest key (as opposed to in an extension), the package.json structure is different. This is a distinct unconfirmed API surface.

### D. Command handler signature for `flow:*` names may differ from `"working"`

The `"working"` command is registered without a colon and its handler receives `(args: string, ctx: ExtensionContext)`. For colon-style names like `"flow:setup"`, the exact handler invocation shape may differ (e.g., `args` may already strip the `flow:` prefix, or may include the full command string). This must be verified before writing interpreted-mode routing.

### E. No `__tests__/package-manifest.test.mjs` in `pi-flow-core` yet

`pi-flow-ux` has `__tests__/package-manifest.test.mjs` but `pi-flow-core` does not. The spec requires a package smoke test showing `/flow:*` commands and the `idea` tool. This test file needs to be created fresh, not copied from pi-flow-ux (which tests UX-specific entries).

### F. `/flow:setup` reload/restart recommendation

The spec requires recommending a reload/restart step after symlinks are created. Whether Pi has a built-in command for this (e.g., `/restart`) is unknown. If the implementation calls `ctx.ui.notify("Reload Pi to make newly linked agents discoverable", "info")` that may be sufficient, but a stronger recommendation may need to name the exact reload mechanism.

## Open Questions / Ambiguities

1. **`pi.sendUserMessage` API**: What is the exact method signature on `ExtensionAPI`? Does it accept a plain string, or does it take a structured object? Is it synchronous or async? This is the core mechanism for all 7 workflow routing commands.

2. **`pi.getCommands()` and `sourceInfo`**: What does a `sourceInfo` entry look like at runtime? Specifically: what values does `scope` take (`"global"`, `"project"`, `"temp"`)?  Is `baseDir` the directory of the installed package? Is this API guaranteed to include the calling package's own command entry?

3. **`pi.exec(...)` availability and shape**: Is `pi.exec` a method on `ExtensionAPI` or on `ExtensionContext`? What is its call signature? Is it needed for symlink operations or is `node:fs/promises` sufficient?

4. **Colon-style command names**: Does `pi.registerCommand("flow:setup", ...)` register the slash-command as `/flow:setup`? Are there any restrictions on the colon character in command names? Is the `args` string passed to the handler the portion after the full name (i.e., after `flow:setup`)?

5. **`idea` tool vs. `idea` command**: Is there a `pi.registerTool(name, { description, inputSchema, handler })` API? If so, what does it expect? If tools are declared in the `"pi"` manifest rather than registered at runtime, what is the manifest structure?

6. **`pi.getCommands()` timing**: Must `/flow:setup` defer calling `pi.getCommands()` until a command is actually invoked (inside the handler), rather than during the `session_start` handler? Is the command registry populated by the time the extension's default function is called, or only after all extensions are loaded?

7. **`/flow:setup` for temporary (`pi -e`) loads**: Should the command emit a clear user-facing error and exit immediately, or should it accept an explicit `--target global|project` flag to allow opt-in setup even in temporary contexts?

8. **`/flow:idea` clarification prompt**: When input is too ambiguous to safely capture, the spec says the command "may use one clarification prompt." Is there a `ctx.ui.prompt(question)` or similar API for interactive prompts within a command handler? Or does clarification require `pi.sendUserMessage` to bounce back to the LLM?

9. **`/flow:idea` edit/confirm UI**: The spec open question asks whether `/flow:idea` should offer an optional edit/confirm UI before writing when `ctx.hasUI` is true. This needs a decision before implementation starts to avoid a later behavioral change.

10. **`pi-flow-core` peer dependency update**: Adding `@earendil-works/pi-coding-agent` as a peer/dev dependency requires verifying it is available in the workspace's `autoInstallPeers: false` environment. Is the current `pnpm` lockfile already aware of this package (it's a peer of `pi-flow-ux`), or does a new `pnpm add` step need to happen at the workspace root?
