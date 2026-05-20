# Flow Setup and Command Surface

**Source:** TODO-cfcb8ede
**Spec:** `docs/specs/2026-05-19-flow-setup-commands.md`
**Scout brief:** `docs/briefs/2026-05-20-flow-setup-commands-brief.md`

## Goal

Add a `pi-flow-core` TypeScript extension that registers the active Flow command surface (`/flow:setup`, `/flow:idea`, `/flow:scout`, `/flow:spec`, `/flow:plan`, `/flow:refine-plan`, `/flow:execute`, `/flow:refine-code`, `/flow:fastlane`) plus an `idea` LLM tool. `/flow:setup` makes the bundled `pi-flow-core/agents/*.md` discoverable by `pi-interactive-subagent` from the matching install scope using deterministic, scope-aware, idempotent symlink logic. `/flow:idea` writes legacy-compatible `docs/todos/<8-hex>.md` artifacts with the existing JSON+markdown shape. Workflow commands route exact artifact-shaped inputs directly to the canonical packaged skill invocation, and fall back to LLM-interpreted `pi.sendUserMessage(...)` prompts for prose-like inputs. A `--exact`/`--no-interpret` flag forces the exact path. Each workflow skill remains the single source of truth for orchestration.

## Architecture summary

- The extension is structured as one entry-point file plus per-feature modules.
  - `extensions/commands.ts` is the Pi extension default export — it imports and wires `setup`, `idea`, and `workflow` registrations onto the `ExtensionAPI`.
  - `extensions/workflow.ts` registers the 7 `/flow:<workflow>` commands (each has the same router shape: parse `--exact`/`--no-interpret`, try exact routing, else send LLM prompt).
  - `extensions/setup.ts` registers `/flow:setup` and owns the symlink loop and scope detection.
  - `extensions/idea.ts` registers `/flow:idea`, registers the LLM-facing `idea` tool, and owns `docs/todos/` resolution against the git root (folding the personal `env.ts` behavior into the idea surface).
  - `extensions/router.ts` is the shared exact/interpreted router — pure functions that take raw `args`, resolve to either an exact skill invocation string or an LLM prompt envelope, with no side effects, fully unit-testable.
  - `extensions/storage.ts` owns `docs/todos/<id>.md` JSON+markdown read/write, ID generation, git-root resolution, and the `TODO-<id>` compatibility regex. Both `idea.ts` (command) and the `idea` tool share this module so the LLM-callable tool reads/writes the same artifacts the command produces.
- The aggregate `pi-flow` package forwards the new extension through `node_modules/pi-flow-core/extensions/commands.ts`, mirroring the existing UX forwarding pattern.
- Workflow commands delegate via `pi.sendUserMessage(...)` — `pi-flow-core` does NOT reimplement skill orchestrators. Exact mode sends a deterministic "Use the `<skill>` skill with input `<resolved-artifact>`" prompt; interpreted mode sends a structured "Use the `<skill>` skill. The user wrote: `<args>`. Resolve the correct artifact and ask at most one clarification before invoking." prompt.
- `/flow:setup` resolves its own package origin first via `pi.getCommands()` (matching the registered `flow:setup` entry), then falls back to `import.meta.url` resolution if `getCommands()` cannot disambiguate. Scope is derived from the matching `SlashCommandInfo.sourceInfo.scope` (`"user"`, `"project"`, or `"temporary"`); `"temporary"` refuses durable setup unless the user passes `--target user|project` explicitly. The symlink target is `~/.pi/agent/agents/` for `user` and `<cwd>/.pi/agents/` for `project`.
- All file mutations use `node:fs/promises` (`lstat`, `readlink`, `symlink`, `mkdir`, `readFile`, `writeFile`, `rename`); no third-party deps. Tests use `mkdtempSync` for isolated sandboxes; no test ever touches the developer's real `~/.pi/agent/agents/` or `.pi/agents/`.

## Tech stack

- TypeScript loaded via Node `--experimental-strip-types` (no build step), matching the existing `pi-flow-ux` extension shipping shape.
- `@earendil-works/pi-coding-agent` for `ExtensionAPI`, `ExtensionCommandContext`, `SlashCommandInfo`, `SourceInfo`, `ToolDefinition` types.
- TypeBox declared as a direct dependency of `pi-flow-core` (its `Type` constructors are not re-exported by `@earendil-works/pi-coding-agent`, so under pnpm strict resolution we must list it explicitly) for the `idea` tool's parameter schema.
- Node built-ins: `node:fs/promises`, `node:path`, `node:os`, `node:crypto`, `node:child_process` (for `git rev-parse --show-toplevel`).
- Tests: built-in `node:test` + `node:assert/strict`, using `node --experimental-strip-types --test` for `.ts` test files.

## File Structure

### `packages/pi-flow-core/` (new TypeScript surface)

- `packages/pi-flow-core/extensions/commands.ts` (Create) — Default-export Pi extension factory `(pi: ExtensionAPI) => void` that calls `registerSetup(pi)`, `registerIdea(pi)`, and `registerWorkflowCommands(pi)`. No event subscriptions in this file beyond what each module needs internally.
- `packages/pi-flow-core/extensions/setup.ts` (Create) — Exports `registerSetup(pi)` which registers `/flow:setup` with a deterministic handler. Owns: locating the bundled `agents/` directory (`pi.getCommands()` + `import.meta.url` fallback), scope detection (`user`/`project`/`temporary`), `--target` flag parsing, symlink loop (`created`/`skipped`/`conflict`), result reporting via `ctx.ui.notify`.
- `packages/pi-flow-core/extensions/idea.ts` (Create) — Exports `registerIdea(pi)`. Registers `/flow:idea` command (deterministic header-line parse with optional clarification prompt) AND the LLM-callable `idea` tool (`pi.registerTool({ name: "idea", ... })`) with list/read/create/update actions that share the same storage as the command.
- `packages/pi-flow-core/extensions/workflow.ts` (Create) — Exports `registerWorkflowCommands(pi)`. Wires `/flow:scout`, `/flow:spec`, `/flow:plan`, `/flow:refine-plan`, `/flow:execute`, `/flow:refine-code`, `/flow:fastlane` against a shared `routeArgs` from `router.ts`.
- `packages/pi-flow-core/extensions/router.ts` (Create) — Pure router: `parseArgs(rawArgs: string): { exactFlag: boolean; rest: string }`, `tryExactRoute(skillName, rest, ctx): { kind: "exact"; prompt: string } | { kind: "non-exact" }`, `buildInterpretedPrompt(skillName, rawArgs): string`. The exact recognizer handles `TODO-<8hex>` IDs, `docs/specs/*.md` / `docs/plans/*.md` / `docs/briefs/*.md` / `docs/reviews/*.md` paths, and a `(empty args)` case that maps to "run the skill with no argument".
- `packages/pi-flow-core/extensions/storage.ts` (Create) — `getTodoDir(cwd)` (uses `git rev-parse --show-toplevel`, falls back to `cwd` when not in a git repo), `generateIdeaId()` (`crypto.randomBytes(4).toString("hex")`), `formatIdeaArtifact({id, title, tags, status, createdAt, body})`, `parseIdeaArtifact(raw)`, `readIdea(dir, id)`, `writeIdea(dir, artifact)`, `listIdeas(dir)`, `isLegacyTodoId(s)` (matches `^[0-9a-f]{8}$` and `^TODO-[0-9a-f]{8}$`), `normalizeIdeaId(s)` (strip optional `TODO-` prefix). Atomic writes (temp + rename) for `writeIdea` so a crash mid-write cannot leave a truncated artifact.
- `packages/pi-flow-core/extensions/commands.test.ts` (Create) — Stub-`pi` tests: extension default export registers all 9 expected commands and the `idea` tool with the expected names.
- `packages/pi-flow-core/extensions/router.test.ts` (Create) — Pure-function tests for `parseArgs`, `tryExactRoute`, `buildInterpretedPrompt` covering: `--exact` flag, `--no-interpret` flag, `TODO-<id>` recognition, `docs/<dir>/*.md` recognition, empty args, unknown args.
- `packages/pi-flow-core/extensions/workflow.test.ts` (Create) — Stub-`pi` tests: each of the 7 workflow commands is registered, exact routing calls `pi.sendUserMessage` with the deterministic skill-name+resolved-artifact prompt, interpreted routing calls `pi.sendUserMessage` with the structured "Use the `<skill>` skill … resolve … ask one clarification" prompt, `--exact` (or `--no-interpret`) on non-exact input emits an error via `ctx.ui.notify` and does NOT call `pi.sendUserMessage`.
- `packages/pi-flow-core/extensions/setup.test.ts` (Create) — Temp-dir tests using `mkdtempSync`: global-scope path (`user`), project-scope path (`project`), idempotent re-run reports `skipped`, conflict on a real file reports `conflict: real file`, conflict on a divergent symlink reports `conflict: expected <expected> got <actual>`, temporary scope refuses without `--target` and accepts with `--target user`. None of these tests touch real `~/.pi` or project `.pi/`.
- `packages/pi-flow-core/extensions/idea.test.ts` (Create) — Temp-dir tests: `/flow:idea "Some prose title"` writes `docs/todos/<8hex>.md` whose JSON block has `id`/`title`/`tags`/`status`/`created_at`, body is the input prose minus the title line; success notification includes `TODO-<id>`; the `idea` tool's `create` action writes the same shape; the `read` action accepts both bare `<8hex>` and `TODO-<8hex>` identifiers; `list` returns all `docs/todos/*.md` IDs+titles; `update` round-trips status.
- `packages/pi-flow-core/extensions/storage.test.ts` (Create) — Pure tests for `formatIdeaArtifact`/`parseIdeaArtifact` round trips (including bodies that contain `}` characters that are not metadata terminators), `isLegacyTodoId`/`normalizeIdeaId` corner cases, atomic write via process-isolated temp dir.
- `packages/pi-flow-core/__tests__/package-manifest.test.mjs` (Create) — Mirrors `pi-flow-ux/__tests__/package-manifest.test.mjs`: asserts `pi.extensions` lists exactly `extensions/commands.ts`, that file exists, `files` array includes `extensions`, `peerDependencies` declare `@earendil-works/pi-coding-agent`, and there are no install-time side-effect scripts.
- `packages/pi-flow-core/__tests__/pi-loader-smoke.test.mjs` (Create) — Mirrors `pi-flow-ux/__tests__/pi-loader-smoke.test.mjs`: uses `DefaultResourceLoader` against an isolated sandbox to confirm Pi discovers `extensions/commands.ts` and registers the `flow:setup`, `flow:idea`, and 7 workflow commands plus the `idea` tool.

### `packages/pi-flow-core/` (modified files)

- `packages/pi-flow-core/package.json` (Modify) — Add `extensions` to `files[]`; add `"extensions": ["extensions/commands.ts"]` to `pi`; add `peerDependencies["@earendil-works/pi-coding-agent"] = "*"` and matching `devDependencies` entry so the workspace materializes the package for type checking and tests; update `test:node` script to walk `extensions/` with `.test.ts` discovery under `--experimental-strip-types`.
- `packages/pi-flow-core/tsconfig.json` (Modify) — Expand `include` from `["bin/**/*.mjs"]` to `["bin/**/*.mjs", "extensions/**/*.ts"]`.
- `packages/pi-flow-core/README.md` (Modify) — Add a "Commands" section describing all 9 `/flow:*` commands, the exact-vs-interpreted contract, `--exact`/`--no-interpret`, the `/flow:setup` scope rules and conflict reporting, the `idea` tool, and the required `pi-interactive-subagent` companion.

### `packages/pi-flow/` (aggregate forwarding)

- `packages/pi-flow/package.json` (Modify) — Add `"node_modules/pi-flow-core/extensions/commands.ts"` to the existing `pi.extensions` array (which already lists `node_modules/pi-flow-ux/extensions/footer.ts` and `.../working/index.ts`).
- `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs` (Modify) — Add `"node_modules/pi-flow-core/extensions/commands"` to the existing `requiredExtensionSubstrings` array so the aggregate forwarding test verifies the new core extension is forwarded and resolves on disk.
- `packages/pi-flow/README.md` (Modify, if present; create if absent per Task 8) — Document that `/flow:*` and the `idea` tool ship via the aggregate install and require `/flow:setup` after install for subagent discovery.

## Tasks

### Task 1: Wire `pi-flow-core` for TypeScript extensions

Set up the package so it can ship and test `.ts` extension files alongside the existing `.mjs` helper runner. No extension logic in this task — only the package plumbing.

**Files:**
- Modify: `packages/pi-flow-core/package.json`
- Modify: `packages/pi-flow-core/tsconfig.json`
- Create: `packages/pi-flow-core/extensions/.gitkeep` (empty marker so the directory exists before later tasks add files)

**Steps:**
- [ ] **Step 1: Update `files[]`** — In `packages/pi-flow-core/package.json`, change `"files": ["bin", "skills", "agents", "docs", "model-tiers.example.json"]` to `"files": ["bin", "skills", "agents", "docs", "extensions", "model-tiers.example.json"]`.
- [ ] **Step 2: Update `pi` manifest** — Change `"pi": { "skills": ["skills/*/SKILL.md"] }` to `"pi": { "skills": ["skills/*/SKILL.md"], "extensions": ["extensions/commands.ts"] }`. The extension file does not exist yet; later tasks create it. The manifest entry MUST be the exact string `extensions/commands.ts`.
- [ ] **Step 3: Add peer + dev dependency** — Add `"@earendil-works/pi-coding-agent": "*"` to both `peerDependencies` (existing block already has `pi-interactive-subagent`) and add a new `devDependencies` block with `"@earendil-works/pi-coding-agent": "*"`. This mirrors `packages/pi-flow-ux/package.json` so `tsc` and the test runner can resolve the package without forcing consumers to install it twice. Additionally add `"typebox": "*"` to both `peerDependencies` and `devDependencies` — `pi-coding-agent` declares typebox as a regular `dependencies` entry but does not re-export `Type`/`Static`, so `pi-flow-core` must declare typebox itself to allow `import { Type } from "typebox"` under pnpm strict resolution. Confirmed: the workspace lockfile already pins `typebox@1.1.38` via `pi-coding-agent`'s dependency tree, so the `"*"` constraint resolves without a separate install. Also add `"pi-interactive-subagent": "*"` to `devDependencies` (it is already declared as a `peerDependencies` entry) — the Task 8 setup-dispatch smoke test (Step 7) loads `pi-interactive-subagent`'s extension via `DefaultResourceLoader` to verify real subagent discovery and dispatch after `/flow:setup`, so the package must be materialized into `packages/pi-flow-core/node_modules/` for the test to resolve it via `require.resolve`/`createRequire`.
- [ ] **Step 4: Update `test:node` to discover `.ts` extension tests** — Change the existing `test:node` script from `find bin __tests__ -name '*.test.mjs' -print0 | xargs -0 node --test` to `find bin __tests__ extensions \\( -name '*.test.mjs' -o -name '*.test.ts' \\) -print0 | xargs -0 node --experimental-strip-types --test`. (Mirrors `pi-flow-ux/package.json` exactly.)
- [ ] **Step 5: Update `tsconfig.json`** — Change `"include": ["bin/**/*.mjs"]` to `"include": ["bin/**/*.mjs", "extensions/**/*.ts"]` so `tsc --noEmit` covers the new TS files.
- [ ] **Step 6: Create the empty `extensions/` directory** — Create `packages/pi-flow-core/extensions/.gitkeep` so the directory is committed and the `find ... extensions` script does not fail before later tasks add real files.
- [ ] **Step 7: Run `pnpm install` from the workspace root** — Materializes `@earendil-works/pi-coding-agent`, `typebox`, AND `pi-interactive-subagent` into `packages/pi-flow-core/node_modules` so subsequent tasks can `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"`, `import { Type } from "typebox"`, and the Task 8 setup-dispatch smoke test can `createRequire(import.meta.url)` against `pi-interactive-subagent`.

**Acceptance criteria:**

- `packages/pi-flow-core/package.json` includes `extensions` in `files[]`, declares `pi.extensions` with the single entry `extensions/commands.ts`, lists `@earendil-works/pi-coding-agent` and `typebox` in both `peerDependencies` and `devDependencies`, lists `pi-interactive-subagent` in `devDependencies` (it remains a `peerDependencies` entry as well), and its `test:node` script discovers `.test.ts` files under `extensions/` with `--experimental-strip-types`.
  Verify: `node -e "const p=require('/Users/david/Code/pi-flow/packages/pi-flow-core/package.json'); if(!p.files.includes('extensions')) throw new Error('files'); if(!p.pi.extensions || p.pi.extensions.length!==1 || p.pi.extensions[0]!=='extensions/commands.ts') throw new Error('pi.extensions'); if(p.peerDependencies['@earendil-works/pi-coding-agent']!=='*') throw new Error('peer-pca'); if(p.devDependencies['@earendil-works/pi-coding-agent']!=='*') throw new Error('dev-pca'); if(p.peerDependencies['typebox']!=='*') throw new Error('peer-typebox'); if(p.devDependencies['typebox']!=='*') throw new Error('dev-typebox'); if(p.peerDependencies['pi-interactive-subagent']!=='*') throw new Error('peer-pis'); if(p.devDependencies['pi-interactive-subagent']!=='*') throw new Error('dev-pis'); if(!p.scripts['test:node'].includes('--experimental-strip-types')||!p.scripts['test:node'].includes('extensions')||!p.scripts['test:node'].includes('test.ts')) throw new Error('test:node');"` exits 0.
- `packages/pi-flow-core/tsconfig.json` includes `extensions/**/*.ts` in addition to `bin/**/*.mjs`.
  Verify: `node -e "const c=require('/Users/david/Code/pi-flow/packages/pi-flow-core/tsconfig.json'); if(!c.include.includes('extensions/**/*.ts')||!c.include.includes('bin/**/*.mjs')) throw new Error('include');"` exits 0.
- The `extensions/` directory exists with a `.gitkeep` marker so the empty directory is tracked.
  Verify: `test -d /Users/david/Code/pi-flow/packages/pi-flow-core/extensions && test -f /Users/david/Code/pi-flow/packages/pi-flow-core/extensions/.gitkeep` exits 0.
- After `pnpm install`, `packages/pi-flow-core/node_modules/@earendil-works/pi-coding-agent/package.json` resolves to the installed package, confirming the workspace materialized the new peer dependency.
  Verify: `test -f /Users/david/Code/pi-flow/packages/pi-flow-core/node_modules/@earendil-works/pi-coding-agent/package.json` exits 0.
- After `pnpm install`, `packages/pi-flow-core/node_modules/typebox/package.json` resolves to the installed package, confirming the workspace materialized the typebox peer dependency so `import { Type } from "typebox"` works at runtime under pnpm strictness.
  Verify: `test -f /Users/david/Code/pi-flow/packages/pi-flow-core/node_modules/typebox/package.json` exits 0.
- After `pnpm install`, `packages/pi-flow-core/node_modules/pi-interactive-subagent/package.json` resolves to the installed package so the Task 8 Step 7 setup-dispatch smoke test can `require.resolve('pi-interactive-subagent', { paths: [packages/pi-flow-core] })` to find its extension entry.
  Verify: `test -f /Users/david/Code/pi-flow/packages/pi-flow-core/node_modules/pi-interactive-subagent/package.json` exits 0.

**Model recommendation:** cheap

### Task 2: Implement the shared idea storage module

Write `extensions/storage.ts` first because both the `/flow:idea` command and the `idea` LLM tool depend on it. This module is pure I/O — no Pi types — so it can be tested in isolation before any extension wiring.

**Files:**
- Create: `packages/pi-flow-core/extensions/storage.ts`
- Test: `packages/pi-flow-core/extensions/storage.test.ts`

**Steps:**
- [ ] **Step 1: Define the shape and exports** — In `storage.ts`, export `interface IdeaArtifact { id: string; title: string; tags: string[]; status: "open" | "done"; createdAt: string; body: string }` and the following functions (signatures listed; full implementations in subsequent steps): `getTodoDir(cwd: string): Promise<string>`, `generateIdeaId(): string`, `isLegacyTodoId(value: string): boolean`, `normalizeIdeaId(value: string): string | undefined`, `formatIdeaArtifact(a: IdeaArtifact): string`, `parseIdeaArtifact(raw: string): IdeaArtifact | undefined`, `readIdea(dir: string, id: string): Promise<IdeaArtifact | undefined>`, `writeIdea(dir: string, a: IdeaArtifact): Promise<string>`, `listIdeas(dir: string): Promise<Array<{ id: string; title: string; status: string }>>`.
- [ ] **Step 2: Implement `getTodoDir`** — Spawn `git rev-parse --show-toplevel` synchronously via `child_process.spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })`. If `status === 0` and `stdout` is non-empty, return `path.join(stdout.trim(), 'docs', 'todos')`. Otherwise return `path.join(cwd, 'docs', 'todos')`. Do not throw on a non-git cwd — the storage module should remain usable in tests that do not initialize git.
- [ ] **Step 3: Implement ID helpers** — `generateIdeaId` returns `crypto.randomBytes(4).toString('hex')`. `isLegacyTodoId(v)` returns `/^(TODO-)?[0-9a-f]{8}$/i.test(v)`. `normalizeIdeaId(v)` strips an optional `TODO-` prefix (case-insensitive) and lowercases the hex, returning `undefined` when the result is not 8 hex chars.
- [ ] **Step 4: Implement `formatIdeaArtifact`** — Produce `JSON.stringify({ id, title, tags, status, created_at: createdAt }, null, 2)` followed by `\n\n` and the `body`. Trailing newline at end-of-file. This is the exact existing shape used by `docs/todos/cfcb8ede.md` and `docs/todos/d9644bc0.md`.
- [ ] **Step 5: Implement `parseIdeaArtifact`** — Scan the raw string for the JSON metadata block: the file must start with `{` on its first non-whitespace byte; walk the string tracking brace depth while respecting JSON-string contexts (a `{` or `}` inside a `"..."` string with backslash-aware escaping does not change depth). When depth returns to 0, slice the metadata text, `JSON.parse` it, and treat the remainder of the file (after stripping leading blank lines) as the body. Reuse the brace-depth scanner from `skills/_shared/scripts/fence_aware.py` semantics in spirit, but implement in TypeScript since this is a separate process. On any parse failure, return `undefined`.
- [ ] **Step 6: Implement `readIdea`/`listIdeas`** — `readIdea(dir, id)` normalizes the id, reads `path.join(dir, normalized+'.md')`, calls `parseIdeaArtifact`. `listIdeas(dir)` reads the directory, filters entries matching `^[0-9a-f]{8}\\.md$`, reads each, returns `{id, title, status}` for parseable ones.
- [ ] **Step 7: Implement `writeIdea` atomically** — `mkdir({recursive:true})` the dir, write to `<dir>/<id>.md.<pid>.<randomHex>.tmp`, `rename` into place. Return the final absolute path. On error, `rm(tmp, {force:true}).catch(()=>{})` and rethrow. This mirrors the `saveWorkingSettings` pattern in `packages/pi-flow-ux/extensions/working/working.ts:130`.
- [ ] **Step 8: Write `storage.test.ts`** — Tests: round-trip `formatIdeaArtifact` → `parseIdeaArtifact`; `parseIdeaArtifact` correctly handles bodies that contain literal `}` characters (e.g. inline JSON examples in the body); `isLegacyTodoId` accepts `TODO-cfcb8ede` and `cfcb8ede`, rejects `TODO-abc` (too short), `cfcb8edf-extra` (too long), `cfcb8edg` (non-hex); `normalizeIdeaId` returns `cfcb8ede` for both `TODO-cfcb8ede` and `cfcb8ede`, returns `undefined` for `garbage`; `generateIdeaId` returns 8 hex chars; `writeIdea` followed by `readIdea` round-trips in a `mkdtempSync` directory; `listIdeas` returns parseable entries and silently skips malformed files; `getTodoDir` returns `<cwd>/docs/todos` in a sandbox not inside a git repo.

**Acceptance criteria:**

- `storage.ts` exports all 9 documented functions and the `IdeaArtifact` interface.
  Verify: `cd /Users/david/Code/pi-flow && node --experimental-strip-types -e "import('./packages/pi-flow-core/extensions/storage.ts').then(m => { for (const n of ['getTodoDir','generateIdeaId','isLegacyTodoId','normalizeIdeaId','formatIdeaArtifact','parseIdeaArtifact','readIdea','writeIdea','listIdeas']) if (typeof m[n] !== 'function') throw new Error('missing '+n); }).catch(e => { console.error(e); process.exit(1); })"` exits 0.
- All storage tests pass.
  Verify: `cd /Users/david/Code/pi-flow && node --experimental-strip-types --test packages/pi-flow-core/extensions/storage.test.ts` exits 0 with no failing subtests.
- `parseIdeaArtifact` correctly recovers an artifact whose body contains a literal `}` outside the metadata block.
  Verify: open `packages/pi-flow-core/extensions/storage.test.ts` and confirm there is at least one subtest whose name contains `body` and `}` (or equivalent — e.g. "body containing literal closing brace") and that the assertion calls `formatIdeaArtifact` then `parseIdeaArtifact` and checks that the parsed `body` equals the original.
- `writeIdea` is atomic — a temp file matching the staging pattern does not survive a successful write.
  Verify: open `packages/pi-flow-core/extensions/storage.ts` and confirm `writeIdea` builds a temp path containing `process.pid` and `randomBytes`, calls `fs.writeFile` to that path, then `fs.rename` to the final path, with an `await fs.rm(tmp, { force: true }).catch(() => {})` cleanup in the error branch.

**Model recommendation:** standard

### Task 3: Implement the router pure functions

Build the exact-vs-interpreted argument router as a side-effect-free module. The workflow command handlers in Task 5 consume this; isolating the logic here means we can test every input shape without booting an extension.

**Files:**
- Create: `packages/pi-flow-core/extensions/router.ts`
- Test: `packages/pi-flow-core/extensions/router.test.ts`

**Steps:**
- [ ] **Step 1: Define the contract types** — In `router.ts`, export `type SkillKey = "scout" | "define-spec" | "generate-plan" | "refine-plan" | "execute-plan" | "refine-code" | "fastlane"` and a `SLASH_TO_SKILL` map exporting `{ "flow:scout": "scout", "flow:spec": "define-spec", "flow:plan": "generate-plan", "flow:refine-plan": "refine-plan", "flow:execute": "execute-plan", "flow:refine-code": "refine-code", "flow:fastlane": "fastlane" }`. Also export `interface ParsedArgs { exactFlag: boolean; rest: string }` and `interface RouteOutcome { kind: "exact" | "interpreted" | "exact-required-but-non-exact"; prompt?: string; reason?: string }`.
- [ ] **Step 2: Implement `parseArgs(rawArgs)`** — Tokenize `rawArgs` on whitespace; if any token is exactly `--exact` or `--no-interpret`, set `exactFlag = true` and remove that token; return the remaining tokens rejoined with a single space as `rest`. Empty input → `{ exactFlag: false, rest: "" }`.
- [ ] **Step 3: Implement `recognizeExact(skill, rest)`** — Returns `string | undefined` for the canonical skill invocation argument. Each artifact directory (and the empty/TODO shapes) is gated per-skill by an explicit matrix so a script using `--exact` that aims an artifact at the wrong skill fails fast instead of routing into the wrong workflow. The per-skill exact-input matrix is:

  | Skill | Empty | TODO-<id> | docs/briefs/*.md | docs/specs/*.md | docs/plans/*.md | docs/reviews/*.md |
  |-------|-------|-----------|------------------|-----------------|-----------------|-------------------|
  | scout | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
  | define-spec | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
  | generate-plan | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
  | refine-plan | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
  | execute-plan | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
  | refine-code | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
  | fastlane | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |

  Encode this matrix as an `EXACT_INPUT_MATRIX: Record<SkillKey, { empty: boolean; todoId: boolean; briefs: boolean; specs: boolean; plans: boolean; reviews: boolean }>` constant at the top of `router.ts`. `recognizeExact(skill, rest)` consults that constant for each candidate shape. Recognized shapes:
  - **Empty** `rest === ""` → return `""` only when `EXACT_INPUT_MATRIX[skill].empty === true`; otherwise return `undefined`.
  - **`TODO-<8hex>` or bare `<8hex>`** (only when the whole `rest` matches `^(TODO-)?[0-9a-f]{8}$`) → return the canonical `TODO-<hex>` form (uppercase `TODO`, lowercase hex), only when `EXACT_INPUT_MATRIX[skill].todoId === true`.
  - **`docs/<dir>/*.md`** path (recognized when `rest` ends with `.md` and contains `docs/<dir>/`, where `<dir>` is one of `briefs`, `specs`, `plans`, `reviews`) → return as-is only when the matching `EXACT_INPUT_MATRIX[skill]` column (`briefs`, `specs`, `plans`, or `reviews`) is `true`. If the directory is recognized but the matrix column is `false`, return `undefined` so `routeArgs` produces either an interpreted fallback or an `exact-required-but-non-exact` rejection.
  - **`--tier <name>` and other flag-shaped arguments** are passed through verbatim when combined with one of the above shapes; pure flag-only input (e.g. `--tier capable` with nothing else) routes as exact with `rest` passed verbatim only when `EXACT_INPUT_MATRIX[skill].empty === true` (flags without a positional argument are treated as the empty-input case).
  - Anything else → return `undefined` (non-exact).
- [ ] **Step 4: Implement `buildExactPrompt(skill, resolvedArg)`** — Produce the deterministic prompt string sent to `pi.sendUserMessage` in exact mode. Format: `"Use the ${skill} skill. Argument: ${resolvedArg || '(none)'}."` Single line, no extra prose. Tests will pin this exact string.
- [ ] **Step 5: Implement `buildInterpretedPrompt(skill, rawArgs)`** — Produce the structured fallback prompt. Format (multi-line, no trailing whitespace per line):
  ```
  Use the ${skill} skill to handle the following user request.

  User wrote: ${rawArgs || '(no arguments)'}

  Resolve the correct artifact path or identifier for the skill. If the request is unambiguous, invoke the skill directly. If the request is ambiguous, ask at most one clarifying question before invoking the skill.
  ```
  Tests will pin this exact body — line-by-line comparison.
- [ ] **Step 6: Implement `routeArgs(skill, rawArgs): RouteOutcome`** — Compose the above. Call `parseArgs`, then `recognizeExact(skill, rest)`. If a resolved arg is returned, return `{ kind: "exact", prompt: buildExactPrompt(skill, resolved) }`. If non-exact AND `exactFlag === true`, return `{ kind: "exact-required-but-non-exact", reason: \`/flow:${slashFor(skill)} requires an exact artifact when --exact/--no-interpret is set; got: \${rawArgs || '(empty)'}\` }`. Otherwise return `{ kind: "interpreted", prompt: buildInterpretedPrompt(skill, rawArgs) }`. Add a small helper `slashFor(skill)` that reverses the `SLASH_TO_SKILL` map.
- [ ] **Step 7: Write `router.test.ts`** — Each test names the expected route and asserts byte-equal prompts. The matrix coverage block at the bottom (`recognizeExact: per-skill matrix rejections`) MUST cover every ✗ cell so the unit suite catches a script that aims an artifact at the wrong skill:
  - `parseArgs("--exact docs/specs/x.md")` returns `{exactFlag:true, rest:"docs/specs/x.md"}`.
  - `parseArgs("--no-interpret TODO-abcd1234")` returns `{exactFlag:true, rest:"TODO-abcd1234"}`.
  - `parseArgs("")` returns `{exactFlag:false, rest:""}`.
  - `recognizeExact("scout", "TODO-abcd1234")` returns `"TODO-abcd1234"`.
  - `recognizeExact("scout", "abcd1234")` returns `"TODO-abcd1234"`.
  - `recognizeExact("scout", "docs/briefs/2026-05-20-x-brief.md")` returns `"docs/briefs/2026-05-20-x-brief.md"`.
  - `recognizeExact("scout", "docs/plans/x.md")` returns `undefined` (wrong artifact dir for scout).
  - `recognizeExact("execute-plan", "docs/plans/x.md")` returns `"docs/plans/x.md"`.
  - `recognizeExact("scout", "")` returns `""` (empty is exact-valid).
  - `recognizeExact("scout", "investigate the auth flow")` returns `undefined` (prose).
  - **Matrix coverage — accepted cells** (one assertion per ✓ cell in the table above): `recognizeExact("scout", "docs/briefs/x.md")` returns the path; `recognizeExact("define-spec", "docs/specs/x.md")` returns the path; `recognizeExact("generate-plan", "docs/briefs/x.md")` returns the path; `recognizeExact("refine-plan", "docs/plans/x.md")` returns the path; `recognizeExact("execute-plan", "docs/plans/x.md")` returns the path; `recognizeExact("refine-code", "docs/reviews/x.md")` returns the path; `recognizeExact("fastlane", "docs/specs/x.md")` returns the path. For each skill where the Empty column is ✓ (`scout`, `define-spec`, `generate-plan`, `fastlane`), `recognizeExact(skill, "")` returns `""`; for each skill where TODO-<id> is ✓ (`scout`, `define-spec`, `generate-plan`), `recognizeExact(skill, "TODO-abcd1234")` returns `"TODO-abcd1234"`.
  - **Matrix coverage — rejected cells** (one assertion per ✗ cell in the table above): `recognizeExact("scout", "docs/specs/x.md")` returns `undefined`; `recognizeExact("scout", "docs/plans/x.md")` returns `undefined`; `recognizeExact("scout", "docs/reviews/x.md")` returns `undefined`; `recognizeExact("define-spec", "docs/briefs/x.md")` returns `undefined`; `recognizeExact("define-spec", "docs/plans/x.md")` returns `undefined`; `recognizeExact("define-spec", "docs/reviews/x.md")` returns `undefined`; `recognizeExact("generate-plan", "docs/specs/x.md")` returns `undefined`; `recognizeExact("generate-plan", "docs/plans/x.md")` returns `undefined`; `recognizeExact("generate-plan", "docs/reviews/x.md")` returns `undefined`; `recognizeExact("refine-plan", "")` returns `undefined`; `recognizeExact("refine-plan", "TODO-abcd1234")` returns `undefined`; `recognizeExact("refine-plan", "docs/specs/x.md")` returns `undefined`; `recognizeExact("refine-plan", "docs/briefs/x.md")` returns `undefined`; `recognizeExact("refine-plan", "docs/reviews/x.md")` returns `undefined`; `recognizeExact("execute-plan", "")` returns `undefined`; `recognizeExact("execute-plan", "TODO-abcd1234")` returns `undefined`; `recognizeExact("execute-plan", "docs/specs/x.md")` returns `undefined`; `recognizeExact("execute-plan", "docs/briefs/x.md")` returns `undefined`; `recognizeExact("execute-plan", "docs/reviews/x.md")` returns `undefined`; `recognizeExact("refine-code", "")` returns `undefined`; `recognizeExact("refine-code", "TODO-abcd1234")` returns `undefined`; `recognizeExact("refine-code", "docs/specs/x.md")` returns `undefined`; `recognizeExact("refine-code", "docs/briefs/x.md")` returns `undefined`; `recognizeExact("refine-code", "docs/plans/x.md")` returns `undefined`; `recognizeExact("fastlane", "TODO-abcd1234")` returns `undefined`; `recognizeExact("fastlane", "docs/briefs/x.md")` returns `undefined`; `recognizeExact("fastlane", "docs/plans/x.md")` returns `undefined`; `recognizeExact("fastlane", "docs/reviews/x.md")` returns `undefined`.
  - `buildExactPrompt("scout", "TODO-abcd1234")` returns exactly `"Use the scout skill. Argument: TODO-abcd1234."`.
  - `buildExactPrompt("scout", "")` returns exactly `"Use the scout skill. Argument: (none)."`.
  - `buildInterpretedPrompt("scout", "investigate auth")` returns the exact multi-line body specified in Step 5 with `${skill}` replaced by `scout` and `${rawArgs}` by `investigate auth`.
  - `routeArgs("scout", "--exact investigate auth")` returns `{kind:"exact-required-but-non-exact", reason: containing "/flow:scout" and "investigate auth"}`.
  - `routeArgs("scout", "TODO-abcd1234")` returns `{kind:"exact", prompt:"Use the scout skill. Argument: TODO-abcd1234."}`.
  - `routeArgs("scout", "investigate auth")` returns `{kind:"interpreted", prompt: <buildInterpretedPrompt output>}`.
  - `routeArgs("execute-plan", "--exact docs/specs/x.md")` returns `{kind:"exact-required-but-non-exact", reason: containing "/flow:execute" and "docs/specs/x.md"}` — proves the matrix rejection composes into the `--exact` fail-fast path for cross-skill artifact misrouting.

**Acceptance criteria:**

- `router.ts` exports `parseArgs`, `recognizeExact`, `buildExactPrompt`, `buildInterpretedPrompt`, `routeArgs`, `SLASH_TO_SKILL`, and the `SkillKey`/`ParsedArgs`/`RouteOutcome` types.
  Verify: `cd /Users/david/Code/pi-flow && node --experimental-strip-types -e "import('./packages/pi-flow-core/extensions/router.ts').then(m => { for (const n of ['parseArgs','recognizeExact','buildExactPrompt','buildInterpretedPrompt','routeArgs','SLASH_TO_SKILL']) if (m[n]===undefined) throw new Error('missing '+n); }).catch(e => { console.error(e); process.exit(1); })"` exits 0.
- `SLASH_TO_SKILL` covers all 7 workflow commands and maps each to the correct skill directory name.
  Verify: open `packages/pi-flow-core/extensions/router.ts` and confirm the `SLASH_TO_SKILL` object literal contains exactly these 7 key→value pairs: `flow:scout`→`scout`, `flow:spec`→`define-spec`, `flow:plan`→`generate-plan`, `flow:refine-plan`→`refine-plan`, `flow:execute`→`execute-plan`, `flow:refine-code`→`refine-code`, `flow:fastlane`→`fastlane`.
- All router tests pass.
  Verify: `cd /Users/david/Code/pi-flow && node --experimental-strip-types --test packages/pi-flow-core/extensions/router.test.ts` exits 0 with no failing subtests.
- The exact-prompt and interpreted-prompt strings are pinned byte-equal so future drift is caught.
  Verify: `grep -n "Use the \${skill} skill. Argument:" packages/pi-flow-core/extensions/router.ts` returns at least one match AND `grep -n "Use the scout skill. Argument: TODO-abcd1234" packages/pi-flow-core/extensions/router.test.ts` returns at least one match (the test pin against the literal output).
- `router.ts` encodes the per-skill exact-input matrix as a single named constant and `router.test.ts` exercises every ✗ cell.
  Verify: `grep -n "EXACT_INPUT_MATRIX" packages/pi-flow-core/extensions/router.ts` returns at least one match, the constant declares all 7 skill keys (`scout`, `define-spec`, `generate-plan`, `refine-plan`, `execute-plan`, `refine-code`, `fastlane`) with the six column booleans (`empty`, `todoId`, `briefs`, `specs`, `plans`, `reviews`), AND `grep -c "returns \`undefined\`\\|returns undefined" packages/pi-flow-core/extensions/router.test.ts` returns at least 25 (matching the rejected-cell count enumerated in Step 7's matrix coverage block).

**Model recommendation:** standard

### Task 4: Implement `/flow:setup` symlink logic

Make bundled `pi-flow-core/agents/*.md` discoverable by `pi-interactive-subagent` from the matching install scope. The handler must refuse durable setup for `temporary` package loads by default and never overwrite existing real files or divergent symlinks.

**Files:**
- Create: `packages/pi-flow-core/extensions/setup.ts`
- Test: `packages/pi-flow-core/extensions/setup.test.ts`

**Steps:**
- [ ] **Step 1: Define the public API** — Export `function registerSetup(pi: ExtensionAPI): void` (call site for `commands.ts`); a separately exported `async function runSetup(opts: { agentsDir: string; targetDir: string; scope: "user" | "project" | "temporary"; explicitTarget?: "user" | "project"; ui: { notify: (msg: string, level: "info" | "warning" | "error") => void } }): Promise<{ created: string[]; skipped: string[]; conflicts: Array<{ path: string; reason: string; expected?: string; actual?: string }> }>` (the test seam for the symlink loop); AND a separately exported `async function resolveScope(opts: { ownPackageRoot: string; commands: SlashCommandInfo[]; homeDir: string; cwd: string }): Promise<{ scope: "user" | "project" | "temporary"; matchedBaseDir?: string }>` (the test seam for scope detection — takes the realpath'd package root, the commands list, the home dir, and the cwd; performs `fs.realpath` normalization on each candidate `sourceInfo.baseDir` internally before comparing). The handler in `registerSetup` is the only function that touches `import.meta.dirname` or `os.homedir()`; it calls `resolveScope` first, then `runSetup`, so the symlinked-baseDir test (Step 11.5) can exercise `resolveScope` directly without stubbing `import.meta`.
- [ ] **Step 2: Implement scope detection inside `registerSetup` and `resolveScope`** — Inside the handler, compute the package's own root once via `const ownPackageRoot = await fs.realpath(path.resolve(import.meta.dirname, '..'))`. Pass `ownPackageRoot`, the result of `pi.getCommands()`, `os.homedir()`, and `ctx.cwd` into `resolveScope`. Inside `resolveScope`:
  1. Filter `commands` to entries with `name === "flow:setup"`.
  2. For each candidate, attempt `const candidateBaseDir = await fs.realpath(entry.sourceInfo.baseDir)` inside a `try`/`catch`; on `ENOENT` (the baseDir no longer exists), skip the candidate rather than throwing.
  3. Pick candidates where `candidateBaseDir === ownPackageRoot`. This `fs.realpath` normalization on BOTH sides is load-bearing: workspace-symlinked installs (pnpm `node_modules` content-addressable store, `npm link`, `pnpm` workspace links) deliver the package via a symlink, so a string compare against the un-resolved `import.meta.dirname` parent would miss legitimate matches and force the heuristic fallback, which can mis-classify the install as `temporary` and refuse setup. Compare realpath-normalized paths only.
  4. If exactly one realpath-normalized match remains, return `{ scope: entry.sourceInfo.scope, matchedBaseDir: candidateBaseDir }`.
  5. Otherwise (zero or multiple matches), fall back to the deterministic heuristic evaluated against `ownPackageRoot` (already realpath-normalized): if `ownPackageRoot` starts with `path.join(opts.homeDir, '.pi')` → `{ scope: "user" }`; else if `ownPackageRoot` contains the segment `node_modules/pi-flow-core` AND `path.join(opts.cwd, 'node_modules')` exists → `{ scope: "project" }`; else `{ scope: "temporary" }`.
- [ ] **Step 3: Implement `--target` flag parsing** — Inside the handler, split `args` on whitespace and look for `--target user` or `--target project`. If present, set `explicitTarget` to that value. The handler does NOT perform the temporary-scope refusal itself — it passes `scope` and `explicitTarget` through to `runSetup`, which is the single source of truth for the refusal (see Step 5). This keeps the direct-test path (Step 10 calls `runSetup` without going through the handler) and the user-invoked path consistent — both refuse temporary loads identically. If `explicitTarget` is provided in a non-`temporary` scope, the explicit target wins (allows the user to install a project-local symlink set from a global package).
- [ ] **Step 4: Resolve `agentsDir` and `targetDir`** — `agentsDir = path.resolve(import.meta.dirname, '..', 'agents')` — the bundled `pi-flow-core/agents/`. `targetDir`: if effective target is `user` → `path.join(os.homedir(), '.pi', 'agent', 'agents')`; if effective target is `project` → `path.join(ctx.cwd, '.pi', 'agents')`. Pass both into `runSetup` along with `scope`, `explicitTarget`, and a thin `ui` shim that forwards to `ctx.ui.notify`.
- [ ] **Step 5: Implement `runSetup` symlink loop** — Before reading any directory or mutating any file, perform the temporary-scope guard: if `opts.scope === "temporary"` AND `opts.explicitTarget === undefined`, call `opts.ui.notify("/flow:setup detected a temporary package load (pi -e). Re-run with --target user or --target project to perform a durable setup.", "error")` and immediately return `{ created: [], skipped: [], conflicts: [] }`. This guard is the single source of truth for temporary refusal — both the registered command handler and direct test callers (Step 10) reach it through this single code path. After the guard passes: read `agentsDir` for `*.md` files (filter on `endsWith('.md')`); `mkdir(targetDir, { recursive: true })`. For each agent file with absolute source path `src` and target path `dst = path.join(targetDir, name)`:
  - Try `await fs.lstat(dst)`.
  - **If `lstat` throws `ENOENT`:** call `await fs.symlink(src, dst)` and push `dst` to `created`.
  - **If `lstat` returns a symlink:** call `await fs.readlink(dst)`. Resolve both sides (the read link can be relative — resolve against `targetDir`) and compare with `path.resolve`. If they match → push to `skipped`. If they differ → push `{ path: dst, reason: "divergent symlink", expected: src, actual: <resolved actual> }` to `conflicts`.
  - **If `lstat` returns a regular file:** push `{ path: dst, reason: "real file at target — refusing to overwrite" }` to `conflicts`.
  - **If `lstat` returns a directory:** push `{ path: dst, reason: "directory at target — refusing to overwrite" }` to `conflicts`.
- [ ] **Step 6: Report results** — After the loop, build a single multi-line notify body: `"/flow:setup (<scope>"` (append `" → <explicitTarget>"` when override is in effect) + `"):\n"` + zero or more `"  created: <relative-target-path>"` lines + `"  skipped: <relative-target-path>"` lines + `"  conflict: <relative-target-path> — <reason>"` lines + a trailing `"Reload Pi or run /reload to make newly linked agents discoverable."` line iff `created.length > 0`. Choose `ctx.ui.notify` level: `"error"` if conflicts > 0, else `"warning"` if scope was `temporary` and accepted via `--target` (advisory), else `"info"`. Return the `{ created, skipped, conflicts }` object so tests can assert on it directly.
- [ ] **Step 7: Register the command** — `registerSetup` calls `pi.registerCommand("flow:setup", { description: "Symlink bundled pi-flow agent definitions into the matching pi-interactive-subagent discovery directory.", handler: async (args, ctx) => { ... } })`. The handler does scope detection, calls `runSetup`, and never throws past the `pi.registerCommand` boundary — caught errors become an `error`-level `ctx.ui.notify`.
- [ ] **Step 8: Write `setup.test.ts` — happy paths** — Each test uses `mkdtempSync` to build an isolated `<sandbox>/pkg/agents/` with three sample `.md` files (e.g. `a.md`, `b.md`, `c.md`) and an empty `<sandbox>/target/`. Then call `runSetup({ agentsDir: <sandbox>/pkg/agents, targetDir: <sandbox>/target, scope: "user", ui: <captured notifier> })`. Assert: three files in `created`, zero in `skipped`/`conflicts`; `lstat(<sandbox>/target/a.md).isSymbolicLink()` is true; `readlink(<sandbox>/target/a.md)` resolves to `<sandbox>/pkg/agents/a.md`. Re-running on the same sandbox: three in `skipped`, zero in `created`/`conflicts`.
- [ ] **Step 9: Write `setup.test.ts` — conflict paths** — Test 1: pre-create `<sandbox>/target/a.md` as a regular file with content `"existing"`. Run `runSetup`. Assert `conflicts[0]` has `path = .../a.md`, `reason = "real file at target — refusing to overwrite"`; `a.md` content is unchanged after the run. Test 2: pre-create `<sandbox>/target/a.md` as a symlink to an unrelated path. Run. Assert `conflicts[0].reason === "divergent symlink"` and `conflicts[0].expected` and `conflicts[0].actual` reflect the two resolved paths.
- [ ] **Step 10: Write `setup.test.ts` — temporary refusal** — Call `runSetup({ ..., scope: "temporary" })` and assert it returns immediately with `created.length === 0`, `skipped.length === 0`, `conflicts.length === 0`, AND the captured `ui.notify` log contains an `error`-level line including `"temporary"` and `"--target"`. Then call `runSetup({ ..., scope: "temporary", explicitTarget: "user" })` and assert it proceeds (created length > 0 once agentsDir is populated).
- [ ] **Step 11: Write `setup.test.ts` — scope detection isolation** — Call `resolveScope` directly with `ownPackageRoot: <sandbox>/pkg`, `commands: [{ name: "flow:setup", sourceInfo: { scope: "project", baseDir: <sandbox>/pkg, path: ..., source: ..., origin: "package" } }]`, `homeDir: <sandbox>/home`, `cwd: <sandbox>/cwd`. Assert the returned `scope === "project"` and `matchedBaseDir === <sandbox>/pkg`. Also exercise the heuristic fallback: pass `commands: []` (no `flow:setup` entries) with `ownPackageRoot: <sandbox>/home/.pi/agent/extensions/pi-flow-core/extensions` (i.e. under the home `.pi` tree) and `homeDir: <sandbox>/home`, assert `scope === "user"`. Then pass `ownPackageRoot: <sandbox>/cwd/node_modules/pi-flow-core/extensions` and pre-create `<sandbox>/cwd/node_modules` so the project heuristic activates, assert `scope === "project"`. Then pass `ownPackageRoot: <sandbox>/tmp/standalone`, assert `scope === "temporary"`.
- [ ] **Step 11.5: Write `setup.test.ts` — symlinked baseDir matches via realpath** — In a `mkdtempSync` sandbox, create `<sandbox>/real-pkg/` (a real directory). Create `<sandbox>/symlinked-pkg` as a symlink pointing at `<sandbox>/real-pkg`. Call `resolveScope` directly with `ownPackageRoot: await fs.realpath('<sandbox>/symlinked-pkg')` (which equals `<sandbox>/real-pkg`), `commands: [{ name: "flow:setup", sourceInfo: { scope: "user", baseDir: "<sandbox>/symlinked-pkg", path: ..., source: ..., origin: "package" } }]`, `homeDir: <sandbox>/home`, `cwd: <sandbox>/cwd`. Assert the returned `scope === "user"` — the un-resolved baseDir string (`<sandbox>/symlinked-pkg`) differs from `ownPackageRoot` (`<sandbox>/real-pkg`), so a naive string compare would skip the candidate and fall through to the `temporary` default; only the realpath-normalized comparison can detect the match. Add a second assertion: call `resolveScope` with `commands` whose `baseDir` points to a non-existent `<sandbox>/missing-pkg` (so `fs.realpath` throws `ENOENT` internally), assert the candidate is silently skipped rather than throwing, and the function falls through to the heuristic fallback (returning `temporary` for the sandbox path used here).

**Acceptance criteria:**

- `runSetup` creates missing symlinks, leaves matching symlinks unchanged, and refuses to overwrite real files or divergent symlinks, reporting each case in the returned `{ created, skipped, conflicts }` object.
  Verify: `cd /Users/david/Code/pi-flow && node --experimental-strip-types --test packages/pi-flow-core/extensions/setup.test.ts` exits 0 and the printed test names include the happy-path, idempotent, conflict-on-real-file, conflict-on-divergent-symlink, and temporary-refusal cases described in Steps 8–10.
- `/flow:setup` refuses durable setup when scope is `temporary` and `--target` is not provided, with the guard living inside `runSetup` so both handler-invoked and direct-test invocations refuse identically.
  Verify: open `packages/pi-flow-core/extensions/setup.ts` and confirm `runSetup` begins with a branch that, when `opts.scope === "temporary"` and `opts.explicitTarget === undefined`, calls `opts.ui.notify` with a message containing both `"temporary"` and `"--target"` and returns `{ created: [], skipped: [], conflicts: [] }` before any `fs.readdir`/`fs.mkdir`/`fs.lstat`/`fs.symlink` call. The corresponding test in `setup.test.ts` MUST call `runSetup` directly (not via the handler) with `scope: "temporary"` and `explicitTarget: undefined` and assert no `created`/`skipped`/`conflict` entries and an `error`-level notify line.
- `runSetup` writes a `Reload Pi` recommendation line only when at least one symlink was created.
  Verify: open `packages/pi-flow-core/extensions/setup.ts` and confirm the notify body is constructed by appending `"Reload Pi or run /reload to make newly linked agents discoverable."` only inside a guard `if (created.length > 0)`. The test file MUST include one assertion that the reload line is absent when only `skipped` entries are reported.
- Scope detection prefers `pi.getCommands()`'s matching `sourceInfo.scope` over the `import.meta.url` heuristic, AND realpath-normalizes both the candidate `sourceInfo.baseDir` and the package's own root before comparing so symlink-traversed installs match correctly.
  Verify: open `packages/pi-flow-core/extensions/setup.ts` and confirm (a) `registerSetup` resolves `ownPackageRoot` via `await fs.realpath(path.resolve(import.meta.dirname, '..'))`; (b) `resolveScope` is exported as a separate function that takes `ownPackageRoot`/`commands`/`homeDir`/`cwd`, iterates commands, calls `await fs.realpath(entry.sourceInfo.baseDir)` inside a try/catch (skipping `ENOENT`), and only string-compares the two realpath'd paths; (c) only when zero or multiple realpath-normalized matches remain does the implementation fall back to the homedir/`node_modules/pi-flow-core` heuristic. The tests in Step 11 (scope detection isolation, including heuristic branches) AND Step 11.5 (symlinked baseDir) MUST exercise both code paths and assert the symlinked-baseDir candidate matches by realpath.
- `resolveScope` is robust to candidate `sourceInfo.baseDir` entries that no longer exist on disk.
  Verify: open `packages/pi-flow-core/extensions/setup.ts` and confirm the `resolveScope` candidate loop wraps `await fs.realpath(entry.sourceInfo.baseDir)` in a `try { ... } catch { continue; }` (or equivalent that skips `ENOENT`/`ENOTDIR`) so a stale registry entry pointing at a missing baseDir does not throw past the function boundary. Confirm the second assertion in Step 11.5 exercises this branch by passing a non-existent baseDir.

**Model recommendation:** capable

### Task 5: Implement workflow command routing

Register the 7 workflow commands; each delegates to the shared `routeArgs` and dispatches via `pi.sendUserMessage` or an `error` notify.

**Files:**
- Create: `packages/pi-flow-core/extensions/workflow.ts`
- Test: `packages/pi-flow-core/extensions/workflow.test.ts`

**Steps:**
- [ ] **Step 1: Define `registerWorkflowCommands(pi)`** — Iterate `Object.entries(SLASH_TO_SKILL)` (imported from `./router.ts`). For each `[slashName, skill]`, register the command with a description tied to the underlying skill. Use the descriptions: `flow:scout` → `"Run scout. Routes a TODO-<id>, brief path, or freeform request to the scout skill."`, `flow:spec` → `"Run define-spec. Routes a TODO-<id>, spec path, or freeform request to the define-spec skill."`, `flow:plan` → `"Run generate-plan. Routes a TODO-<id>, brief path, or freeform request to the generate-plan skill."`, `flow:refine-plan` → `"Run refine-plan against a plan file."`, `flow:execute` → `"Run execute-plan against a plan file."`, `flow:refine-code` → `"Run refine-code against a review."`, `flow:fastlane` → `"Run fastlane for a spec or freeform request."`.
- [ ] **Step 2: Implement the shared handler** — For each registration, construct the handler as `async (args, ctx) => handleWorkflowCommand(pi, ctx, skill, args)`. Implement `handleWorkflowCommand(pi, ctx, skill, args)`:
  - Call `const outcome = routeArgs(skill, args)`.
  - If `outcome.kind === "exact-required-but-non-exact"`: call `ctx.ui.notify(outcome.reason!, "error")` and return.
  - Else: call `pi.sendUserMessage(outcome.prompt!)`. (Note: `pi.sendUserMessage` returns `void` per the type declaration; no `await` needed but tolerate a thenable return so the handler stays compatible if Pi later widens the type.)
- [ ] **Step 3: Write `workflow.test.ts` — registration** — Boot the extension with a stub `pi` (matching the pattern in `packages/pi-flow-ux/extensions/working/indicator.test.ts:38`). Assert that after `registerWorkflowCommands(stubPi)`, exactly these 7 command names are registered: `flow:scout`, `flow:spec`, `flow:plan`, `flow:refine-plan`, `flow:execute`, `flow:refine-code`, `flow:fastlane`. Assert each registered command's `description` matches the strings in Step 1 byte-equal.
- [ ] **Step 4: Write `workflow.test.ts` — exact routing** — For each of the 7 commands, invoke its handler with a representative exact input (e.g. `flow:scout` with `TODO-abcd1234`, `flow:execute` with `docs/plans/x.md`) and a stub `pi` that captures `sendUserMessage` calls. Assert `sendUserMessage` was called exactly once with the body `"Use the <skill> skill. Argument: <resolved>."` byte-equal.
- [ ] **Step 5: Write `workflow.test.ts` — interpreted routing** — Invoke each handler with a prose input (e.g. `flow:scout` with `"investigate the auth flow"`) and assert `sendUserMessage` was called exactly once with the multi-line body produced by `buildInterpretedPrompt(skill, rawArgs)`. Pin the exact string via `assert.equal` so any drift in the interpreted-prompt template is caught.
- [ ] **Step 6: Write `workflow.test.ts` — `--exact` rejection** — Invoke a handler with `"--exact investigate the auth flow"` and assert: `pi.sendUserMessage` was NOT called; `ctx.ui.notify` was called exactly once with level `"error"` and a message containing the substring `"/flow:scout"` (or whichever slash name) and the substring `"--exact"` or `"--no-interpret"`.
- [ ] **Step 7: Write `workflow.test.ts` — `--no-interpret` alias** — Same as Step 6 but with `"--no-interpret"` instead of `"--exact"`. Both flags must produce identical rejection behavior.

**Acceptance criteria:**

- `registerWorkflowCommands(pi)` registers exactly the 7 `/flow:<workflow>` commands with the descriptions pinned in Step 1.
  Verify: open `packages/pi-flow-core/extensions/workflow.ts` and confirm it imports `SLASH_TO_SKILL` from `./router.ts`, iterates the map, and calls `pi.registerCommand(<slashName>, ...)` for each. The test in `workflow.test.ts` MUST contain a registration test that asserts exactly the 7 names (no more, no less) and a byte-equal description per command.
- Exact-mode routing sends the deterministic `"Use the <skill> skill. Argument: <resolved>."` prompt via `pi.sendUserMessage` and skips `ctx.ui.notify`.
  Verify: `cd /Users/david/Code/pi-flow && node --experimental-strip-types --test packages/pi-flow-core/extensions/workflow.test.ts` exits 0; the printed test names include at least one exact-routing case per command (or a parameterized case that covers all 7) and an explicit assertion that `sendUserMessage` was called exactly once.
- Interpreted-mode routing sends the multi-line structured prompt from `buildInterpretedPrompt`.
  Verify: open `packages/pi-flow-core/extensions/workflow.test.ts` and confirm at least one subtest asserts the captured `sendUserMessage` body byte-equal to the output of `buildInterpretedPrompt(skill, rawArgs)` (i.e. the test imports `buildInterpretedPrompt` from `./router.ts` and uses its return value as the expected value).
- `--exact`/`--no-interpret` on non-exact input emits an `error` notify and does NOT call `sendUserMessage`.
  Verify: open `packages/pi-flow-core/extensions/workflow.test.ts` and confirm there are at least two subtests — one named/described for `--exact` and one for `--no-interpret` — each asserting (a) `sendUserMessage` was not called and (b) `ctx.ui.notify` was called exactly once with level `"error"`.

**Model recommendation:** standard

### Task 6: Implement `/flow:idea` command and `idea` LLM tool

Register the user-facing `/flow:idea` command and the LLM-callable `idea` tool. Both share the storage module from Task 2 so writes from either path are interchangeable.

**Files:**
- Create: `packages/pi-flow-core/extensions/idea.ts`
- Test: `packages/pi-flow-core/extensions/idea.test.ts`

**Steps:**
- [ ] **Step 1: Define `registerIdea(pi)`** — Single exported function that calls `pi.registerCommand("flow:idea", ...)` and `pi.registerTool({ name: "idea", ... })`. Import all storage primitives from `./storage.ts`.
- [ ] **Step 2: Implement the `/flow:idea` command handler** — Steps inside the handler:
  - Trim `args`. If empty AND `ctx.hasUI`, call `await ctx.ui.input("Capture idea", "Title (or first line of body)")` and use the result as the seed. If empty AND `!ctx.hasUI`, call `ctx.ui.notify("/flow:idea requires a title or body. Usage: /flow:idea <title or prose>", "error")` and return.
  - Treat the resolved seed as `title = first line` and `body = remaining lines` (split on the first `\n`; if no `\n`, body is empty).
  - Build `IdeaArtifact { id: generateIdeaId(), title, tags: [], status: "open", createdAt: new Date().toISOString(), body }`.
  - Call `const dir = await getTodoDir(ctx.cwd)` and `const finalPath = await writeIdea(dir, artifact)`.
  - Call `ctx.ui.notify(\`Idea captured. TODO-\${artifact.id}: \${artifact.title}\\n  → \${finalPath}\`, "info")`.
- [ ] **Step 3: Define the `idea` tool schema** — Use TypeBox via `@earendil-works/pi-coding-agent`'s re-exported `defineTool` helper. The schema is a discriminated union on `action`:
  - `action: "list"` — no other params.
  - `action: "read"` — `id: string` (accepts `TODO-<8hex>` or bare `<8hex>`).
  - `action: "create"` — `title: string`, optional `body: string`, optional `tags: string[]`, optional `status: "open" | "done"` (default `"open"`).
  - `action: "update"` — `id: string`, optional `title`, optional `body`, optional `tags`, optional `status`.
  Use a single object schema with `action: Type.Union([Type.Literal("list"), ...])` and per-action optional fields; validate the action+field combination inside `execute`. Import `Type` directly from `typebox` (declared as an explicit peer + dev dependency in Task 1 Step 3 — `pi-coding-agent` does not re-export `Type`, so this is the only supported path under pnpm strict mode). Use `defineTool` from `@earendil-works/pi-coding-agent` to construct the tool definition before passing it to `pi.registerTool(...)`.
- [ ] **Step 4: Implement the tool `execute` function** — Branches on `params.action`:
  - `list` → `await listIdeas(await getTodoDir(ctx.cwd))`, return a structured result containing the list and a text summary.
  - `read` → `const norm = normalizeIdeaId(params.id); if (!norm) return { content: [{ type: "text", text: \`invalid id: \${params.id}\` }], isError: true };` else `await readIdea(dir, norm)` and return JSON-stringified result, or `isError: true` with `not found: TODO-<norm>`.
  - `create` → build a new `IdeaArtifact` (same shape as the command path) and `await writeIdea`. Return `{ content: [{ type: "text", text: \`TODO-\${id}\\n\${finalPath}\` }] }`.
  - `update` → `readIdea` first; if absent, return `not found`. Merge non-undefined fields from `params` onto the existing artifact, `writeIdea` again, return updated id and path.
  - The tool's response shape must match the `AgentToolResult` contract — `{ content: (TextContent | ImageContent)[], isError?: boolean, details?: unknown }`. Use only `TextContent` (`{ type: "text", text: ... }`).
- [ ] **Step 5: Tool description and prompt snippet** — `description: "Capture, read, list, and update Flow ideas backed by docs/todos/<8-hex>.md artifacts. Use this for durable user intent. Identifiers are TODO-<8-hex> (legacy compatibility); the user-facing surface calls them ideas."`. `promptSnippet: "idea — capture/read/list/update Flow ideas (TODO-<id> compatible)."`.
- [ ] **Step 6: Write `idea.test.ts` — command happy path** — Boot the extension with stub `pi` and stub `ctx` that points `cwd` at a `mkdtempSync` sandbox. Invoke the `flow:idea` handler with `"Add scout dispatch retry\\nBackground prose..."`. Assert: a single file matches `<sandbox>/docs/todos/[0-9a-f]{8}.md`; its JSON metadata has `title === "Add scout dispatch retry"`, `tags === []`, `status === "open"`, valid ISO `created_at`; its body is `"Background prose..."`; the captured notify includes both `"TODO-"` and the title.
- [ ] **Step 7: Write `idea.test.ts` — empty-args interactive prompt** — Boot with stub `ctx.hasUI = true` and a stub `ctx.ui.input` that resolves to `"Title from prompt"`. Invoke handler with empty `args`. Assert the input dialog was called, an artifact was written with `title === "Title from prompt"`.
- [ ] **Step 8: Write `idea.test.ts` — empty-args no-UI rejection** — Boot with `ctx.hasUI = false`. Invoke handler with empty `args`. Assert no file was created and `ctx.ui.notify` was called with level `"error"` and a usage message.
- [ ] **Step 9: Write `idea.test.ts` — tool `list`/`read`/`create`/`update`** — Each subtest uses a fresh sandbox. (a) Seed two `docs/todos/<id>.md` files manually, then call the tool with `{ action: "list" }`, assert returned list has both entries. (b) Call `{ action: "read", id: "TODO-<id>" }` AND `{ action: "read", id: "<id>" }` and assert both succeed. (c) Call `{ action: "create", title: "From tool", tags: ["a","b"] }` and assert a new `<id>.md` exists with those values. (d) Call `{ action: "update", id: "<id>", status: "done" }` and assert the metadata `status` is now `"done"` and other fields are preserved.
- [ ] **Step 10: Write `idea.test.ts` — no `todo` command/tool leaks** — Walk the extension's command/tool registrations (captured via stub `pi`) and assert NO registration named `"todo"` or `"flow:todo"` exists. Also assert that the command `"flow:idea"` IS registered.

**Acceptance criteria:**

- `/flow:idea` with a prose argument writes `docs/todos/<8hex>.md` with the JSON metadata block (`id`, `title`, `tags`, `status`, `created_at`) plus markdown body, and reports the artifact with `TODO-<id>`.
  Verify: `cd /Users/david/Code/pi-flow && node --experimental-strip-types --test packages/pi-flow-core/extensions/idea.test.ts` exits 0 and includes a subtest named (or described) along the lines of "command happy path" that asserts both the on-disk shape and the `TODO-<id>` in the notify message.
- The `idea` tool registers with the LLM-facing name `idea` (not `todo`), supports `list`/`read`/`create`/`update`, and accepts both `TODO-<id>` and bare `<id>` identifiers in `read`/`update`.
  Verify: open `packages/pi-flow-core/extensions/idea.ts` and confirm `pi.registerTool({ name: "idea", ... })` is called with a TypeBox parameter schema whose `action` literal union includes exactly `"list"`, `"read"`, `"create"`, `"update"`. The tests in `idea.test.ts` MUST cover all four actions and MUST exercise both ID forms (with and without `TODO-`) at least once.
- No `todo` command or `todo` tool is registered.
  Verify: open `packages/pi-flow-core/extensions/idea.ts` and confirm `pi.registerCommand` is called only with `"flow:idea"` (single call, no `"todo"` or `"flow:todo"`) and `pi.registerTool` is called only with `{ name: "idea", ... }` (no `{ name: "todo", ... }`). The test in `idea.test.ts` Step 10 MUST iterate captured registrations and assert no `"todo"` name appears.
- `getTodoDir` resolves to `<git-root>/docs/todos` when inside a git repo and to `<cwd>/docs/todos` otherwise, folding the legacy `env.ts` PI_TODO_PATH behavior into the idea surface.
  Verify: open `packages/pi-flow-core/extensions/storage.ts` and confirm `getTodoDir` calls `git rev-parse --show-toplevel`, treats `stdout.trim()` as the git root when `status === 0`, and falls back to `cwd` otherwise. The `storage.test.ts` from Task 2 MUST include a subtest that runs in a non-git sandbox and asserts the fallback path.

**Model recommendation:** capable

### Task 7: Wire the extension entry point and aggregate forwarding

Author the extension default export, wire forwarding in the `pi-flow` aggregate, and add the package-level smoke tests.

**Files:**
- Create: `packages/pi-flow-core/extensions/commands.ts`
- Create: `packages/pi-flow-core/extensions/commands.test.ts`
- Create: `packages/pi-flow-core/__tests__/package-manifest.test.mjs`
- Create: `packages/pi-flow-core/__tests__/pi-loader-smoke.test.mjs`
- Modify: `packages/pi-flow/package.json`
- Modify: `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs`

**Steps:**
- [ ] **Step 1: Author `commands.ts`** — Body:
  ```ts
  import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

  import { registerSetup } from "./setup.ts";
  import { registerIdea } from "./idea.ts";
  import { registerWorkflowCommands } from "./workflow.ts";

  export default function (pi: ExtensionAPI): void {
    registerSetup(pi);
    registerIdea(pi);
    registerWorkflowCommands(pi);
  }
  ```
  No event subscriptions or runtime state at this level. Each sub-module owns its own internal state.
- [ ] **Step 2: Author `commands.test.ts`** — Boot the default export against a stub `pi` (capturing `registerCommand` and `registerTool` calls into Maps). Assert that after one invocation, the registered command set is exactly `{ "flow:setup", "flow:idea", "flow:scout", "flow:spec", "flow:plan", "flow:refine-plan", "flow:execute", "flow:refine-code", "flow:fastlane" }` (9 entries, no more no less) and the registered tool set contains exactly `"idea"`.
- [ ] **Step 3: Author `package-manifest.test.mjs`** — Mirror `pi-flow-ux/__tests__/package-manifest.test.mjs`:
  - `package.json.name === "pi-flow-core"` and `keywords` includes `"pi-package"`.
  - `pi.extensions` is the array `["extensions/commands.ts"]` and that file exists on disk.
  - `pi.skills` is the array `["skills/*/SKILL.md"]` and the glob still resolves to the 15 expected SKILL.md files (mirroring the EXPECTED_SKILL_NAMES list from the aggregate forwarding test).
  - `files` array includes `extensions`.
  - `peerDependencies` declares `@earendil-works/pi-coding-agent`.
  - No install-time side-effect scripts (`preinstall`, `install`, `postinstall`, `setup`).
- [ ] **Step 4: Author `pi-loader-smoke.test.mjs`** — Mirror `pi-flow-ux/__tests__/pi-loader-smoke.test.mjs` shape using `DefaultResourceLoader` from `@earendil-works/pi-coding-agent`. In an `mkdtempSync` sandbox:
  - Construct a loader with `cwd: <sandbox>`, `agentDir: <sandbox>/agent`, `additionalExtensionPaths: [<absolute path to packages/pi-flow-core/extensions/commands.ts>]`, `noSkills: true`, `noPromptTemplates: true`, `noContextFiles: true`.
  - Call `await loader.reload()`.
  - Assert `extensions.errors` is empty.
  - Find the loaded extension with `resolvedPath === <absolute path to commands.ts>` and assert: its `commands` Map contains exactly these 9 keys: `flow:setup`, `flow:idea`, `flow:scout`, `flow:spec`, `flow:plan`, `flow:refine-plan`, `flow:execute`, `flow:refine-code`, `flow:fastlane`; its `tools` Map contains the key `idea`.
- [ ] **Step 5: Update `packages/pi-flow/package.json`** — In the `pi.extensions` array, add `"node_modules/pi-flow-core/extensions/commands.ts"` so the final array is `["node_modules/pi-flow-core/extensions/commands.ts", "node_modules/pi-flow-ux/extensions/footer.ts", "node_modules/pi-flow-ux/extensions/working/index.ts"]`. Preserve the existing UX entries verbatim.
- [ ] **Step 6: Update `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs`** — In the existing `requiredExtensionSubstrings` array (currently `['node_modules/pi-flow-ux/extensions/footer', 'node_modules/pi-flow-ux/extensions/working/index']`), insert `'node_modules/pi-flow-core/extensions/commands'` so the test verifies all three forwarded extensions are present in the aggregate manifest AND resolve to a real file. The existing `existsSync` loop already runs for every forwarded path; this single addition extends coverage to the new entry without further changes.
- [ ] **Step 7: Run the workspace test suite** — From the workspace root, run `pnpm -r run test` and confirm all three packages pass.

**Acceptance criteria:**

- The default export of `extensions/commands.ts` registers exactly 9 `/flow:*` commands and 1 `idea` tool, in that combined count.
  Verify: `cd /Users/david/Code/pi-flow && node --experimental-strip-types --test packages/pi-flow-core/extensions/commands.test.ts` exits 0 and the printed assertions confirm the 9 expected command names and 1 tool name; no other names appear.
- The Pi loader smoke test discovers all 9 commands and the `idea` tool from `extensions/commands.ts` without errors.
  Verify: `cd /Users/david/Code/pi-flow && node --test packages/pi-flow-core/__tests__/pi-loader-smoke.test.mjs` exits 0 (no `--experimental-strip-types` flag needed for `.mjs`; the loader internally handles `.ts` stripping). The test must explicitly check `extensions.errors` is empty and that the loaded `Extension.commands` Map contains each of the 9 expected keys.
- The aggregate `pi-flow` package forwards the new core extension.
  Verify: `node -e "const p=require('/Users/david/Code/pi-flow/packages/pi-flow/package.json'); const ext=p.pi.extensions; if(!ext.some(e=>e.includes('node_modules/pi-flow-core/extensions/commands'))) throw new Error('aggregate missing forwarded core extension'); if(!ext.some(e=>e.includes('node_modules/pi-flow-ux/extensions/footer'))) throw new Error('UX footer no longer forwarded'); if(!ext.some(e=>e.includes('node_modules/pi-flow-ux/extensions/working/index'))) throw new Error('UX working no longer forwarded');"` exits 0.
- The aggregate forwarding test now asserts presence of the new core extension entry.
  Verify: `grep -n "node_modules/pi-flow-core/extensions/commands" packages/pi-flow/__tests__/aggregate-forwarding.test.mjs` returns at least one match inside the `requiredExtensionSubstrings` array.
- `packages/pi-flow-core/__tests__/package-manifest.test.mjs` covers the new manifest fields without regressing the existing skill glob check.
  Verify: `cd /Users/david/Code/pi-flow && node --test packages/pi-flow-core/__tests__/package-manifest.test.mjs` exits 0 and the test set includes one assertion that `pi.extensions` equals `["extensions/commands.ts"]` and another that the existing `pi.skills` glob still resolves to 15 SKILL.md files.

**Model recommendation:** standard

### Task 8: Documentation and end-to-end verification

Document the new surface in the core and aggregate READMEs, add a real setup-and-dispatch verification covering the final spec acceptance criterion, and run the full workspace test suite.

**Files:**
- Modify: `packages/pi-flow-core/README.md`
- Modify: `packages/pi-flow/README.md` (Create if absent — `Glob` confirms its presence below; check before modifying)
- Create: `packages/pi-flow-core/__tests__/setup-dispatch-smoke.test.mjs`

**Steps:**
- [ ] **Step 1: Check whether `packages/pi-flow/README.md` exists** — Run `test -f /Users/david/Code/pi-flow/packages/pi-flow/README.md`. If present, modify; if absent, create with the documented sections below.
- [ ] **Step 2: Document commands in `packages/pi-flow-core/README.md`** — Add (after the existing helper-runner section) a new `## Commands` section listing all 9 `/flow:*` commands with a one-line description each. Include a subsection `### Exact vs interpreted input` explaining: workflow commands accept either an exact artifact-shaped argument (a `TODO-<8hex>` ID, a `docs/<dir>/<file>.md` path, or no arguments) that routes directly to the named skill, OR a freeform prose argument that is forwarded to the agent with a structured "use the <skill> skill, resolve the argument, ask one clarification if needed" prompt. The `--exact` (or `--no-interpret`) flag suppresses the LLM fallback and emits a usage error for non-exact input.
- [ ] **Step 3: Document `/flow:setup`** — Add subsection `### /flow:setup`: explain scope detection (`user`/`project`/`temporary`) via `pi.getCommands()` + `import.meta.url` fallback, the `--target user|project` flag for temporary loads, the symlink loop (`created`/`skipped`/`conflict`), conflict reporting (real file, divergent symlink), and the reload recommendation when new symlinks are created.
- [ ] **Step 4: Document `/flow:idea` and the `idea` tool** — Add subsection `### /flow:idea and the \`idea\` tool`: explain that the command writes legacy-compatible `docs/todos/<8hex>.md` artifacts (JSON metadata block + markdown body), reports the artifact as `TODO-<id>` for compatibility with existing workflow skills, and that the `idea` LLM tool (`action: list | read | create | update`) operates on the same storage and accepts both `TODO-<id>` and bare `<id>` identifiers. Note that the durable `IDEA-<id>` rebrand is tracked separately by `TODO-d9644bc0`.
- [ ] **Step 5: Document the required companion** — Add one paragraph stating that `/flow:setup` is required after installation so `pi-interactive-subagent` can discover the bundled `pi-flow-core/agents/*.md` definitions, and that subagent-backed workflows (`scout`, `define-spec`, `generate-plan`, `execute-plan`, `refine-plan`, `refine-code`, `fastlane`) depend on `pi-interactive-subagent` being installed (already declared as a peer dependency).
- [ ] **Step 6: Update `packages/pi-flow/README.md`** — Add (or, if creating, populate) a `## /flow:* commands and idea tool` section that points the user to `packages/pi-flow-core/README.md` for full documentation and explicitly notes: (a) `/flow:setup` must be run after `pnpm add pi-flow` for subagents to be discoverable, (b) the aggregate install includes the UX layer (footer, working indicator, Nord theme) but users who want a headless install can `pnpm add pi-flow-core` directly.
- [ ] **Step 7: Author `setup-dispatch-smoke.test.mjs` — real setup + subagent dispatch verification** — Create `packages/pi-flow-core/__tests__/setup-dispatch-smoke.test.mjs` covering the spec's final acceptance criterion ("A real setup verification confirms subagent definitions are discoverable after `/flow:setup` and a minimal subagent-backed workflow can dispatch"). The test must:
  - Use `mkdtempSync` to create an isolated sandbox; bind `cwd: <sandbox>` and an `HOME: <sandbox>/home` env so no real `~/.pi` or project `.pi/` directory is touched.
  - Resolve `pi-interactive-subagent`'s extension entry from `packages/pi-flow-core/node_modules/pi-interactive-subagent/package.json`'s `pi.extensions[0]` (or `main`/`exports` if it does not declare a `pi` manifest entry — read the manifest with `JSON.parse(readFileSync(...))` and pick whichever entry the package itself uses to register tools/commands). Use `createRequire(import.meta.url)` rooted at `packages/pi-flow-core` to perform the resolution; do NOT hardcode a path inside `node_modules/.pnpm/...`. Capture the resolved absolute path as `subagentExtensionPath`.
  - Load BOTH extensions via `DefaultResourceLoader` (exactly the construction shape used by the `pi-loader-smoke` test in Task 7 Step 4), with `additionalExtensionPaths: [<absolute path to packages/pi-flow-core/extensions/commands.ts>, subagentExtensionPath]`, `cwd: <sandbox>`, `agentDir: <sandbox>/home/.pi/agent`. Call `loader.reload()`. Assert `loader.getExtensions().errors` is empty after both extensions load.
  - Construct a fake `ctx` (with `cwd: <sandbox>`, `hasUI: false`, and a captured `ui.notify` recorder) and invoke the loaded `flow:setup` handler with `--target project`. Assert: the handler returns; `ctx.ui.notify` was called with an `"info"`-level message that includes `"created"`; `<sandbox>/.pi/agents/` contains an `.md` symlink for every file under `packages/pi-flow-core/agents/` (assert `lstat(...).isSymbolicLink() === true` and `realpathSync(...)` resolves back into `packages/pi-flow-core/agents/`).
  - **Real filesystem-level subagent discovery** — `pi-interactive-subagent` discovers agents from project-local `.pi/agents/` by reading each `*.md` file and parsing its YAML frontmatter. The test must reproduce this discovery contract directly: `readdirSync('<sandbox>/.pi/agents')` returns a non-empty list of `.md` filenames whose set equals the basenames of `packages/pi-flow-core/agents/*.md`; for at least one entry (e.g. `scout.md`), `readFileSync(<sandbox>/.pi/agents/scout.md, 'utf8')` resolves through the symlink, begins with `---` on line 1, and contains both a `name:` field equal to `scout` and a `description:` field — proving the symlinks deliver readable agent definitions to any consumer (including `pi-interactive-subagent`) that follows the `.pi/agents/*.md` contract.
  - **Real `pi-interactive-subagent` extension discovery** — Locate the loaded extension whose `resolvedPath === subagentExtensionPath`. Assert it exists in `loader.getExtensions().extensions` and that its `tools` Map (or `commands` Map, whichever the installed version uses for subagent dispatch — inspect the loaded extension surface and use the actual key) contains at least one entry whose name matches `/subagent[_-]?run/i` (i.e. a subagent dispatch primitive such as `subagent_run_serial` or `subagent_run_parallel`, both of which the workflow skills under `packages/pi-flow-core/skills/` already invoke by name). If the loaded extension exposes a discovery accessor that enumerates project-local agents (e.g. a `list_subagents` tool or an exported `discoverAgents()` function), invoke it with `cwd: <sandbox>` and assert the returned agent set is a non-strict superset of the linked filenames in `<sandbox>/.pi/agents/`. If no such accessor exists on the installed version, document that fact inline as a code comment and rely on the filesystem-level discovery assertion above plus the `tools`/`commands` registration assertion to cover the discovery seam.
  - **Minimal subagent-backed workflow dispatch** — Capture `pi.sendUserMessage` calls into an array on the stub. Invoke the loaded `flow:scout` handler with `"TODO-abcd1234"` and assert `sendUserMessage` was called exactly once with the byte-equal string `"Use the scout skill. Argument: TODO-abcd1234."`. The dispatch message names the `scout` skill, which in production routes through `pi-interactive-subagent`'s `subagent_run_serial { agent: "scout" }` path. Because `<sandbox>/.pi/agents/scout.md` is the symlink created by `/flow:setup` above, the dispatch resolves against the just-linked agent definition — this is the minimal end-to-end seam the spec's final acceptance criterion mandates.
  - Re-run `flow:setup` against the same sandbox and assert it now reports `skipped` for every entry (idempotency carried into the real-loader path, not just the unit test).
- [ ] **Step 8: Run the full workspace test suite** — From the workspace root: `pnpm -r run test`. All three packages (`pi-flow`, `pi-flow-core`, `pi-flow-ux`) must pass. Capture the test output for the implementation commit message.

**Acceptance criteria:**

- `packages/pi-flow-core/README.md` documents all 9 `/flow:*` commands, the exact-vs-interpreted contract, `/flow:setup`'s scope behavior, and the `/flow:idea` + `idea` tool surface.
  Verify: open `packages/pi-flow-core/README.md` and confirm the file contains a top-level `## Commands` heading whose body lists each of these literal command names: `/flow:setup`, `/flow:idea`, `/flow:scout`, `/flow:spec`, `/flow:plan`, `/flow:refine-plan`, `/flow:execute`, `/flow:refine-code`, `/flow:fastlane`. Confirm the file also contains the substring `--exact` or `--no-interpret` AND the substring `TODO-` (for legacy compatibility note) AND the substring `pi-interactive-subagent` (for the required-companion paragraph).
- `packages/pi-flow/README.md` directs aggregate users to run `/flow:setup` after install and points to core docs for the command surface.
  Verify: open `packages/pi-flow/README.md` and confirm it contains the substring `/flow:setup` AND the phrase `pi-flow-core` (linking aggregate users to the core docs).
- A real setup-and-dispatch verification confirms (a) `/flow:setup` produces agent symlinks at the location `pi-interactive-subagent` actually discovers (project-local `.pi/agents/`), (b) the installed `pi-interactive-subagent` extension loads alongside `pi-flow-core/extensions/commands.ts` without errors and registers a subagent-dispatch primitive, (c) each linked agent definition is readable through the symlink with parseable YAML frontmatter, and (d) a minimal subagent-backed workflow command dispatches via `pi.sendUserMessage` end-to-end.
  Verify: `cd /Users/david/Code/pi-flow && node --test packages/pi-flow-core/__tests__/setup-dispatch-smoke.test.mjs` exits 0 with no failing subtests; the output must include passing subtests whose names cover (1) `/flow:setup --target project` creates symlinks in `<sandbox>/.pi/agents/` and every `pi-flow-core/agents/*.md` source has a corresponding symlink whose `realpath` resolves back into the package, (2) `pi-interactive-subagent`'s extension is resolved from `packages/pi-flow-core/node_modules` and loaded by `DefaultResourceLoader` with `extensions.errors === []`, (3) the loaded `pi-interactive-subagent` extension's registered tools (or commands) include at least one entry whose name matches `/subagent[_-]?run/i`, (4) reading at least one linked agent file (e.g. `scout.md`) through the symlink returns content beginning with `---` and containing both `name: scout` and a `description:` field, (5) a workflow command (`/flow:scout`) invocation with `TODO-abcd1234` produces exactly one `pi.sendUserMessage` call with the byte-equal `"Use the scout skill. Argument: TODO-abcd1234."` body, and (6) a second `/flow:setup` run reports all entries as `skipped`.
- The full workspace test suite passes after all tasks are complete.
  Verify: from `/Users/david/Code/pi-flow`, run `pnpm -r run test` and confirm exit code 0; the output must report passing tests for `pi-flow-core` (including `extensions/*.test.ts`, `__tests__/*.test.mjs`, and the new `__tests__/setup-dispatch-smoke.test.mjs`), `pi-flow-ux`, and `pi-flow` (including the modified `aggregate-forwarding.test.mjs`).

**Model recommendation:** standard

## Dependencies

- Task 1 depends on: (none)
- Task 2 depends on: Task 1
- Task 3 depends on: Task 1
- Task 4 depends on: Task 1
- Task 5 depends on: Task 3
- Task 6 depends on: Task 2
- Task 7 depends on: Task 4, Task 5, Task 6
- Task 8 depends on: Task 7

## Risk Assessment

- **`pi.getCommands()` scope-detection ambiguity in `/flow:setup`.** The `SlashCommandInfo[]` returned by `pi.getCommands()` may include multiple `flow:setup` entries (e.g. if a developer has both a global and a project install of `pi-flow`), and the `sourceInfo.baseDir` matching needs to be robust to symlink-traversed `import.meta.dirname` paths. Mitigation implemented in Task 4 Step 2 / Step 11.5: `registerSetup` realpath-normalizes `path.resolve(import.meta.dirname, '..')` once into `ownPackageRoot`, and the exported `resolveScope` realpath-normalizes each candidate `sourceInfo.baseDir` (skipping `ENOENT`) before string-comparing. Only when zero or multiple realpath-normalized matches remain does it fall back to the deterministic heuristic (homedir → `user`, under `node_modules/pi-flow-core` with `<cwd>/node_modules` present → `project`, else → `temporary`). The temporary default is the safe failure mode because it refuses durable setup. Step 11.5 exercises the symlinked-baseDir case explicitly so workspace-link installs (pnpm content-addressable store, `npm link`, monorepo workspace links) are covered.

- **`@earendil-works/pi-coding-agent` TypeBox availability.** The `idea` tool's parameter schema uses TypeBox (`Type.Union(Type.Literal(...))` etc.). Inspection of `pi-coding-agent`'s `dist/index.d.ts` confirms it does NOT re-export `Type` (only `defineTool` is exported from its extensions module, and `TSchema`/`Static` are imported as types from `typebox` internally). Mitigation: Task 1 Step 3 declares `typebox` as an explicit `peerDependencies` + `devDependencies` entry on `pi-flow-core`, and Task 1's acceptance criterion verifies both the manifest entries and that `node_modules/typebox` resolves after install. This makes `import { Type } from "typebox"` work consistently under pnpm strict mode for both `pi-flow-core`'s own tests and downstream consumers of the published package.

- **Colon-style command names in Pi.** Brief Risk #B raised whether `pi.registerCommand("flow:setup", ...)` produces a `/flow:setup` invocation surface. The existing `working` command (no colon) is confirmed; colon-named commands are not yet exercised in this repo. Mitigation: the Pi loader's `Extension.commands` Map is keyed by the registered name (per `loadExtensions` in `@earendil-works/pi-coding-agent`), so the smoke test in Task 7 Step 4 directly verifies the colon-named keys are in the Map after load. If Pi rejects colon-named commands, that test will fail loudly and the implementation can iterate (e.g. switch to a dash separator) before publishing.

- **`pi.sendUserMessage` queuing semantics.** Per the API type, `sendUserMessage` "always triggers a turn" and accepts a `deliverAs: "steer" | "followUp"` option when the agent is streaming. Workflow commands invoked while the agent is mid-turn could pile up. Mitigation: not passing `deliverAs` means Pi uses its default (next turn), which is the natural user expectation — the user typed a command, they expect the agent to act when ready. No special handling is needed in this slice.

- **Idea body containing literal `}` characters.** The metadata block boundary is determined by JSON brace depth. A naive substring search for `}` would break on body content that includes JSON examples. Mitigation: Task 2 Step 5 implements brace counting that respects `"..."` string contexts with backslash-aware escaping. Task 2 Step 8 includes an explicit test for this case so regressions are caught.

- **Atomic write contention.** If multiple `idea` tool calls run concurrently for the same id (unlikely but possible with parallel subagent runs), the temp-file naming `<id>.md.<pid>.<randomHex>.tmp` keeps writes from colliding even within the same process, but `fs.rename` overwriting on the final path is a last-write-wins race. Mitigation: this is the same race as the existing `saveWorkingSettings` in `pi-flow-ux` and is acceptable for the user-facing `/flow:idea` command. Concurrent tool updates to the same artifact are not supported in this slice; if they appear in practice, the future `IDEA-<id>` rebrand work (TODO-d9644bc0) can introduce a CAS layer.

- **Aggregate test breakage from manifest change.** `packages/pi-flow/__tests__/aggregate-forwarding.test.mjs` already iterates the full `pi.extensions` list and asserts every entry resolves to a real file. Adding `node_modules/pi-flow-core/extensions/commands.ts` to that list while `commands.ts` does not yet exist (i.e. running tests partway through implementation) will fail the existing loop. Mitigation: implementation order in the task graph above ensures `commands.ts` lands in Task 7 Step 1 before the manifest change in Task 7 Step 5, and the matching test update in Task 7 Step 6. Avoid running the aggregate test in isolation before Task 7 is complete.

## Test Command

```bash
pnpm -r run test
```

PLAN_ARTIFACT: /Users/david/Code/pi-flow/docs/plans/2026-05-20-flow-setup-commands.md
