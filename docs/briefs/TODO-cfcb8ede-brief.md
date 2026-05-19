# Scout Brief: Extract current pi-config workflow into pi-flow packages

Source: TODO-cfcb8ede
Generated at: 2026-05-19T17:54:10Z
Git SHA: 51041c74b1a48c28efeb653395611488bf8886ec
Model: anthropic/claude-sonnet-4-6

## Relevant Files

### pi-flow (target repo — currently nearly empty)

```
README.md                        — "# pi-flow / An opinionated pi workflow" (two lines only)
.gitignore                       — standard Node ignores, no pnpm-workspace.yaml yet
docs/specs/2026-05-19-cfcb8ede.md  — the spec for this task
docs/todos/cfcb8ede.md              — source todo (also has GOAL / REQUIREMENTS / CONSTRAINTS / APPROACH / AC sections)
docs/todos/d9644bc0.md              — related TODO for IDEA-<id> rename (out of scope here)
```

No `package.json`, no `packages/` tree, no workspace setup exists yet.

---

### pi-config (source repo — `../pi-config` relative to pi-flow)

The full source root path is `/Users/david/Code/pi-config`. The checked-in subtree of interest is:

#### Top-level config

| File | Notes |
|------|-------|
| `agent/settings.json` | Only `./extensions/env.ts` is in `extensions[]`. `packages[]` loads `git:github.com/davidsunglee/pi-interactive-subagent@v4.0.0`, `npm:pi-web-access`, `npm:@aliou/pi-processes`. Theme is `"nord"`. |
| `agent/model-tiers.json` | Personal example: capable/standard/cheap × anthropic + crossProvider × openai-codex, dispatch map `anthropic → claude`, `openai-codex → pi`. |
| `agent/working.json` | Working indicator config (pulse shape, nord-blue `#81A1C1` colors). |
| `agent/package.json` | Private, ESM. devDependencies use **`@mariozechner/*`** names. Test scripts run `node --experimental-strip-types` for TS tests and `python3 -m unittest discover` for Python tests across 6 skill script directories. |
| `agent/tsconfig.json` | ESNext/NodeNext, strict, `allowImportingTsExtensions: true`, includes `extensions/**/*.ts`. |

#### Agents (10 files at `agent/agents/`)

All files use frontmatter (name, description, tools, thinking, session-mode, spawning, auto-exit):

| Agent | Thinking | Notable traits |
|-------|----------|---------------|
| `scout.md` | high | tools: read, write, grep, find, ls; no bash |
| `spec-designer.md` | — | — |
| `planner.md` | xhigh | tools: read, write, edit, grep, find, ls; no bash |
| `plan-reviewer.md` | — | — |
| `plan-refiner.md` | — | — |
| `coder.md` | medium (per-call override to high by fastlane/execute-plan) | tools include bash; reports STATUS: DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT; must call `subagent_done()` |
| `verifier.md` | — | — |
| `test-runner.md` | — | — |
| `code-reviewer.md` | — | — |
| `code-refiner.md` | — | — |

The scout agent has the most detailed contract: ends with `BRIEF_ARTIFACT: <abs-path>` as last line of final message AND calls `subagent_done(message="BRIEF_ARTIFACT: <abs-path>")`.

#### Extensions (at `agent/extensions/`)

**Include in pi-flow-core:**

| File | Tests | Purpose |
|------|-------|---------|
| `env.ts` | `env.test.ts` | Sets `PI_TODO_PATH` to `<git-root>/docs/todos` via `getGitRoot(cwd)`. No external package imports. |
| `todos.ts` | `todos.test.ts` | Visual todo manager; heavy imports from `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, `@mariozechner/pi-tui`, and `typebox`. Not currently enabled in settings.json. |

**Include in pi-flow-ux:**

| File | Tests | Purpose |
|------|-------|---------|
| `footer.ts` | `footer.test.ts` | Custom footer. Imports `ExtensionAPI`, `ThemeColor` from `@mariozechner/pi-coding-agent`; `truncateToWidth`, `visibleWidth` from `@mariozechner/pi-tui`. ~700 lines. |
| `working/index.ts` | `working/working.test.ts` | Entry point: calls `workingIndicator(pi)` and `workingMessage(pi)`. |
| `working/indicator.ts` | `working/indicator.test.ts` | `/working` command; reads `~/.pi/agent/working.json`. Imports from `@mariozechner/pi-coding-agent`. |
| `working/message.ts` | `working/message.test.ts` | Working message display. |
| `working/effects.ts` | (no test) | Animation effects for working indicator. |
| `working/working.ts` | `working/working.test.ts` | Internal working module. |

**Excluded (personal utilities — do not copy):**
`answer.ts`, `context.ts`, `files.ts`, `session-breakdown.ts` + `.test.ts`, `usage-bar.ts`, `guardrails.ts` + `.test.ts`, `herdr-agent-state.ts`

#### Themes

`agent/themes/nord.json` — includes `$schema`, `name`, and a complete `vars` object with nord0–nord15 plus `status*` tokens. Goes into pi-flow-ux.

#### Skills (at `agent/skills/`)

**15 skills to include (non-browser):**

| Skill | Per-skill scripts | Script tests |
|-------|------------------|-------------|
| `scout/` | none | none |
| `define-spec/` | `scripts/detect-mux-backend.py` | `scripts/tests/{test_detect_mux_backend,test_todo_input_shape}.py` |
| `fastlane/` | `scripts/recommend-workflow.py` | `scripts/tests/test_recommend_workflow.py` |
| `generate-plan/` | none (uses shared + execute-plan scripts) | none |
| `refine-plan/` | `scripts/{validate-and-parse-plan-review,prepare-plan-review-prompt,prepare-plan-edit-prompt,fill-refine-plan-prompt,parse-refine-plan-summary}.py` | none found |
| `execute-plan/` | `scripts/{extract-plan-tasks,parse-coder-report,parse-verifier-report,compute-verifier-file-set,collect-diff-context,assemble-verifier-prompt,assemble-coder-prompt}.py` + many fixtures | `scripts/tests/{test_extract_plan_tasks,test_parse_coder_report,test_parse_verifier_report,test_compute_verifier_file_set,test_collect_diff_context,test_assemble_verifier_prompt,test_assemble_coder_prompt}.py` |
| `refine-code/` | `scripts/{parse-refine-code-summary,fill-refine-code-prompt}.py` | `scripts/tests/{test_parse_refine_code_summary,test_fill_refine_code_prompt}.py` |
| `commit/` | none | none |
| `test-driven-development/` | none | none |
| `systematic-debugging/` | none; has sub-docs `{root-cause-tracing,defense-in-depth,condition-based-waiting}.md` | none |
| `verification-before-completion/` | none | none |
| `using-git-worktrees/` | none | none |
| `finishing-a-development-branch/` | none | none |
| `requesting-code-review/` | none | none |
| `receiving-code-review/` | none | none |

**Excluded:** `web-browser/` and its `scripts/` subtree.

**Shared layer (`agent/skills/_shared/`):**

Markdown docs (human-readable contracts used by multiple skills):
- `model-tier-resolution.md`, `workflow-artifact-paths.md`, `orchestrator-verification-boundary.md`, `test-runner-dispatch.md`, `coordinator-dispatch.md`

Python scripts at `_shared/scripts/` (12 standalone scripts + 2 shared modules):

```
resolve-model-dispatch.py   — reads ~/.pi/agent/model-tiers.json; outputs {model, cli, provider, tier} JSON
fill-template.py            — fills {{PLACEHOLDER}} templates from a JSON file
parse-artifact-handoff.py   — validates PLAN_ARTIFACT: / SPEC_ARTIFACT: / BRIEF_ARTIFACT: markers
parse-test-runner-artifact.py
reconcile-test-run.py
detect-test-command.py
extract-provenance-preamble.py
git-workspace-status.py
validate-review-provenance.py
cleanup-test-runs.py
cleanup-pycache.py
classify-workflow-drift.py
plan_fence_hardening.py     — shared module (underscore naming, used as standalone script too)
fence_aware.py              — pure library module imported via sys.path by per-skill scripts
```

Python tests at `_shared/scripts/tests/` (17 test files + a fixtures/ subdirectory).

## Key Interfaces and Types

### Pi package manifest (the `pi` key in package.json)

The spec requires each distributable package to have `keywords: ["pi-package"]` and a `pi` manifest key. The exact JSON schema is not present in this repo; the spec calls out `extensions`, `skills`, and `themes` as example manifest fields. Extension glob patterns should exclude test files. This schema must be verified against current Pi documentation before implementation.

### Agent definition frontmatter

```yaml
---
name: <agent-name>
description: <description for Pi's agent registry>
tools: read, write, edit, grep, find, ls, bash   # comma-separated tool allowlist
thinking: medium | high | xhigh
session-mode: lineage-only
system-prompt: append
spawning: false
auto-exit: true
---
```

Every agent ends with a `subagent_done()` call. Scout additionally passes `message="BRIEF_ARTIFACT: <abs-path>"` — the message must byte-equal the final marker line.

### Extension API surface (from `@mariozechner/*` → `@earendil-works/*` after update)

Key imports used by included extensions:

- `footer.ts`: `ExtensionAPI`, `ThemeColor` from `pi-coding-agent`; `truncateToWidth`, `visibleWidth` from `pi-tui`
- `working/indicator.ts`: `ExtensionAPI` from `pi-coding-agent`
- `todos.ts`: `DynamicBorder`, `copyToClipboard`, `getMarkdownTheme`, `keyHint`, `ExtensionAPI`, `ExtensionContext`, `KeybindingsManager`, `Theme` from `pi-coding-agent`; `StringEnum` from `pi-ai`; `Type`, `Static` from `typebox`; plus named exports from `pi-tui`
- `env.ts`: no external package imports — pure Node builtins

Extensions export a default function with signature `(pi: ExtensionAPI) => void` or `(pi: ExtensionAPI) => void` on `session_start` / `session_shutdown` events.

### Todo storage format

Managed by `todos.ts` / `env.ts`. Each todo is a file at `<PI_TODO_PATH>/<id>.md`:

```
{
  "id": "<8-char hex>",
  "title": "...",
  "tags": [...],
  "status": "open|done",
  "created_at": "ISO8601"
}

Optional markdown body after the closing brace.
```

`PI_TODO_PATH` defaults to `<git-root>/docs/todos` (set by `env.ts`). This convention must be preserved in the packaged `env.ts` without hardcoding `agent/` paths.

### Python script I/O contracts

The scripts follow a consistent pattern:
- Input: argparse flags
- Success: JSON to stdout, exit 0
- Failure: JSON with `{"failure": ...}` or a template-numbered message to stderr, exit 1

`fence_aware.py` is a library module (not a CLI script). It must be on `sys.path` for any script that imports it. Per-skill scripts use `sys.path.insert(0, Path(__file__).resolve().parents[N] / "_shared" / "scripts")` where N varies by script depth — this is path-relative to `__file__` and works regardless of working directory.

### Subagent dispatch contract

Skills dispatch agents via:
```
subagent_run_serial { tasks: [{ name, agent, task, model, cli, thinking? }], wait: true }
subagent_run_parallel { tasks: [...] }
```
Results read from `results[N].finalMessage`. `pi-interactive-subagent` provides these tools; version v4.0.0 is the current pin in `settings.json`.

### Skill SKILL.md format

```yaml
---
name: <skill-name>
description: <one-line description used in skill selection>
---
# Skill Title
<Markdown instructions interpreted by the Pi agent>
```

Skills may reference per-skill scripts, shared scripts, other skills, and agents. The current source uses paths rooted at `agent/skills/...` relative to the project working directory.

## Dependency / Call Graph

### Skill orchestration chain

```
/flow:scout      → scout skill → scout agent → writes docs/briefs/<id>-brief.md
/flow:spec       → define-spec skill → spec-designer agent → writes docs/specs/<slug>.md
/flow:plan       → generate-plan skill → planner agent → refine-plan skill → plan-reviewer/refiner agents
/flow:refine-plan → refine-plan skill → plan-reviewer → plan-refiner agents
/flow:execute    → execute-plan skill → coder agents (parallel) → verifier agent → refine-code skill → code-reviewer/refiner agents
/flow:fastlane   → fastlane skill → coder agent → test-runner agent → commit skill → refine-code skill → finishing-a-development-branch skill
/flow:refine-code → refine-code skill → code-reviewer → code-refiner agents
```

### Python script dependencies

```
fence_aware.py (shared library)
  ← imported by: parse-coder-report.py, parse-verifier-report.py, parse-refine-code-summary.py,
                  validate-and-parse-plan-review.py, extract-provenance-preamble.py, plan_fence_hardening.py

plan_fence_hardening.py
  ← called from: generate-plan SKILL.md, refine-plan-prompt.md

execute-plan/scripts/extract-plan-tasks.py
  ← called from: execute-plan SKILL.md Step 2, generate-plan SKILL.md Step 5a (parseability guardrail),
                  and fastlane references execute-plan SKILL.md Step 9

execute-plan/scripts/parse-coder-report.py
  ← called from: execute-plan SKILL.md Step 9, fastlane SKILL.md Step 5

_shared/scripts/resolve-model-dispatch.py
  ← called from: scout, generate-plan, execute-plan, fastlane, refine-code SKILL.md files

_shared/scripts/reconcile-test-run.py
  ← called from: fastlane SKILL.md Steps 7, execute-plan SKILL.md
```

### Skill cross-references (hardcoded `agent/skills/...` paths in SKILL.md prose)

Fastlane SKILL.md references:
- `agent/skills/_shared/scripts/detect-test-command.py`
- `agent/skills/_shared/scripts/git-workspace-status.py`
- `agent/skills/_shared/scripts/resolve-model-dispatch.py`
- `agent/skills/_shared/scripts/fill-template.py`
- `agent/skills/_shared/scripts/parse-test-runner-artifact.py`
- `agent/skills/_shared/scripts/reconcile-test-run.py`
- `agent/skills/_shared/scripts/cleanup-test-runs.py`
- `agent/skills/_shared/scripts/cleanup-pycache.py`
- `agent/skills/_shared/test-runner-dispatch.md`
- `agent/skills/execute-plan/scripts/parse-coder-report.py`
- `agent/skills/execute-plan/tdd-block.md`
- `agent/skills/fastlane/fastlane-coder-prompt.md`
- `agent/skills/define-spec/spec-design-procedure.md` (Step 0 mirrors it)

Generate-plan SKILL.md references:
- `agent/skills/_shared/scripts/extract-provenance-preamble.py`
- `agent/skills/_shared/scripts/classify-workflow-drift.py`
- `agent/skills/_shared/scripts/plan_fence_hardening.py`
- `agent/skills/_shared/scripts/parse-artifact-handoff.py`
- `agent/skills/_shared/workflow-artifact-paths.md`
- `agent/skills/_shared/orchestrator-verification-boundary.md`
- `agent/skills/execute-plan/scripts/extract-plan-tasks.py`
- `agent/skills/refine-plan/scripts/parse-refine-plan-summary.py`
- `agent/skills/generate-plan/generate-plan-prompt.md`
- `agent/skills/refine-plan/SKILL.md`

Execute-plan SKILL.md references:
- `agent/skills/_shared/scripts/git-workspace-status.py`
- `agent/skills/execute-plan/scripts/extract-plan-tasks.py`
- `agent/skills/execute-plan/scripts/*.py` (assemble-coder-prompt, compute-verifier-file-set, etc.)
- `agent/skills/_shared/test-runner-dispatch.md`
- `agent/skills/_shared/scripts/resolve-model-dispatch.py`
- `agent/skills/execute-plan/tdd-block.md`

These are the primary path references that must be updated or redirected after extraction.

## Patterns and Conventions

### Skill authoring

- SKILL.md frontmatter: `name:` (slug, matches directory name), `description:` (used in skill discovery). No per-skill README.md files — the SKILL.md is the sole doc.
- Steps are numbered within the skill; external skills are invoked by name ("invoke the commit skill", "invoke the refine-code skill") rather than by path.
- Shell commands written in SKILL.md are run by the Pi agent in the project's working directory. This is the fundamental portability gap: paths like `agent/skills/...` will not resolve after extraction.
- Prompt templates (`.md` files in the skill directory, e.g., `fastlane-coder-prompt.md`) use `{UPPERCASE_PLACEHOLDERS}` filled by `fill-template.py`.

### Python script conventions

- All scripts: `#!/usr/bin/env python3`, argparse, JSON to stdout (exit 0), named error JSON or template message to stderr (exit 1).
- Cross-skill imports: `sys.path.insert(0, Path(__file__).resolve().parents[N] / "_shared" / "scripts")`. This resolves relative to the script file — portable after extraction as long as the directory structure is preserved within the package.
- Test discovery: `python3 -m unittest discover -s <dir> -p "test_*.py"`.
- Python version: standard library only (no extra pip installs found); scripts use `argparse`, `json`, `pathlib`, `subprocess`, `re`, `os`, `sys`.

### TypeScript extension conventions

- ESM (`"type": "module"` in package.json), TypeScript with `.ts` extensions in imports (`allowImportingTsExtensions: true`).
- Test framework: Node built-in `node:test` + `node:assert/strict`. Run via `node --experimental-strip-types`.
- No build step: extensions are loaded by Pi directly from source TS (strip-types mode).
- All extension files export a default function.

### Pi package conventions (inferred from spec/todo)

- `package.json` has `"keywords": ["pi-package"]` and a `"pi"` manifest key.
- Pi manifest describes which resources the package ships (extensions, skills, themes, commands).
- Extensions in the manifest glob should exclude `*.test.ts` files.
- Packages can be loaded via `npm:<name>` or `git:<url>` in `settings.json`.

### Artifact directory conventions (consumer-project runtime)

```
docs/todos/          — PI_TODO_PATH; todo file storage
docs/specs/          — define-spec output
docs/briefs/         — scout output
docs/plans/          — generate-plan / refine-plan output
docs/plans/reviews/  — (referenced in some skills)
docs/reviews/        — refine-code / code-reviewer output
docs/test-runs/      — fastlane / execute-plan test evidence
```

These are runtime conventions enforced by the skills, not installed files.

### Model-tier resolution at runtime

`resolve-model-dispatch.py` reads from `~/.pi/agent/model-tiers.json` by default (overridable via `--model-tiers`). This file is user-owned and NOT shipped as a runtime file — only a documented template/example is packaged.

### Agent completion contract

Every agent must:
1. Write its artifact to the orchestrator-supplied path
2. Emit a final assistant message ending with `<ARTIFACT_TYPE>: <abs-path>` as the last non-empty line
3. Call `subagent_done(message="<same marker line>")` as the terminal tool action (for agents whose marker carries the path, e.g., scout) or `subagent_done()` with no args (for coder, verifier, etc.)

## Existing Tests and Test Patterns

### TypeScript tests (Node test runner)

| File | What it tests |
|------|--------------|
| `extensions/env.test.ts` | `configureTodoPath()`: sets `PI_TODO_PATH` in isolated process state, preserves existing override |
| `extensions/footer.test.ts` | `computeVisibility()` priority dropper, `formatContextTokenWindow()`, `getProviderPrefix()`, `getThinkingLabel()`, `joinMetrics()`, `sanitizeStatusTexts()` — pure functions testable without the Pi runtime |
| `extensions/todos.test.ts` | Todo storage operations |
| `extensions/working/indicator.test.ts` | Working indicator |
| `extensions/working/message.test.ts` | Working message |
| `extensions/working/working.test.ts` | Working module integration |
| `extensions/guardrails.test.ts` | **Excluded** (guardrails.ts is excluded from pi-flow) |
| `extensions/session-breakdown.test.ts` | **Excluded** |

Run command: `find extensions -name '*.test.ts' -print0 | xargs -0 node --experimental-strip-types --test`

### Python tests (unittest discover)

Test directories from `agent/package.json test:helpers` script:
- `skills/_shared/scripts/tests/` — 17 test files covering all 12 shared scripts + shared modules
- `skills/execute-plan/scripts/tests/` — 7 test files + 20+ plan/report fixtures
- `skills/refine-code/scripts/tests/` — 2 test files
- `skills/refine-plan/scripts/tests/` — (scripts exist but no test files found in this scan)
- `skills/define-spec/scripts/tests/` — 2 test files
- `skills/fastlane/scripts/tests/` — 1 test file

All Python tests import local scripts using relative `sys.path` or `importlib`; they require no installed packages beyond the standard library.

### New tests required by the task

- Package manifest smoke test: `pi -e <package>` lists expected skills/extensions/themes/commands
- Setup symlink test: `/flow:setup` creates, skips, and refuses correctly for all three cases
- Real install/setup verification: subagent definitions discoverable after `/flow:setup`
- Migrated TypeScript tests for all included extensions (some tests cover excluded extensions and must be dropped)

## Risk Areas

### 1. Skill SKILL.md path references (highest risk)

Every workflow skill in SKILL.md files calls Python scripts with paths rooted at `agent/skills/...` (relative to the consumer project's working directory). After extraction into a Pi package, these paths will not exist in consumer projects. This is the single largest portability task.

The Python scripts themselves use `Path(__file__).resolve().parents[N]` to import `fence_aware` — this is already portable. The only broken references are the string literals in SKILL.md prose that the Pi agent executes as shell commands.

Resolution options (for the implementer to decide):
- **Option A:** Rewrite each path to an absolute path derived from the package install location. Requires a way to know the install path from within a skill (e.g., a Pi-provided variable, or a helper script on PATH).
- **Option B:** `/flow:setup` installs a `scripts/` symlink or wrapper at `~/.pi/agent/scripts/` or `.pi/scripts/` so skills can call `~/.pi/agent/scripts/<script>` (a stable runtime path).
- **Option C:** Convert each skill's Python invocations to calls through a thin wrapper binary installed by the package (e.g., `pi-flow-exec resolve-model-dispatch --tier ...`).

The number of affected path strings is large: fastlane alone has ~10+ distinct `agent/skills/...` references. A systematic search-and-replace guided by a clear resolution strategy is required.

### 2. `@mariozechner/*` → `@earendil-works/*` import updates

`footer.ts`, `todos.ts`, `working/*.ts`, `guardrails.ts`, and `session-breakdown.ts` all import from `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, and/or `@mariozechner/pi-tui`. The `agent/package.json` devDependencies also use these names. All must be updated to `@earendil-works/...` equivalents. The API surface is assumed to be compatible (not a port), but type signatures must be verified after the rename. The `typebox` import in `todos.ts` (`import { Type, type Static } from "typebox"`) may need a version check.

### 3. Agent discovery gap for `pi-interactive-subagent`

`pi-interactive-subagent` discovers agents from `.pi/agents/` (project-local), `~/.pi/agent/agents/` (global), and its own bundled agents. It does NOT scan Pi package directories for agent definitions. `/flow:setup` must bridge this gap via symlinks. The symlink behavior must be:
- Scope-aware (global install → global agents, project-local install → project-local agents)
- Idempotent (matching symlinks left alone)
- Conflict-safe (refuses to overwrite real files or divergent symlinks, reports paths)
- Explicit only (not triggered on package load)

The implementation needs to know both the install scope and the package install path at setup time. This requires a mechanism to discover which `pi` install scope the package was loaded into.

### 4. `todos.ts` scope decision

`todos.ts` is not currently enabled in `settings.json`. It is not in the explicit exclusion list in the task. It provides the `/todos` visual UI and the underlying `todo` CRUD tool that skills like `fastlane` and `scout` rely on (e.g., `Read the todo via the 'todo' tool`). If `todos.ts` is omitted, the `todo` tool may not be available and those skill steps would fail. However, `todos.ts` is a heavy extension with many UI dependencies. Decision needed: include in `pi-flow-core` or depend on a separate `todos.ts`-providing package.

### 5. `working/indicator.ts` reads from `~/.pi/agent/working.json`

The working indicator config is read from a hardcoded `~/.pi/agent/working.json` path. After packaging, the default config file at `agent/working.json` in pi-config should move to `pi-flow-ux` and the indicator must either (a) ship a default embedded config, (b) look for the config at a package-relative path first and fall back to the user's global config, or (c) keep `~/.pi/agent/working.json` as the sole runtime path and ship `working.json` only as documentation/template.

### 6. `todos.ts` imports `StringEnum` from `@mariozechner/pi-ai` — API availability

If `todos.ts` is included, it imports `StringEnum` from `pi-ai` and several named UI components (`DynamicBorder`, `copyToClipboard`, `getMarkdownTheme`, `keyHint`, `KeybindingsManager`) from `pi-coding-agent`. These must exist in the `@earendil-works/...` equivalents. The import update cannot be purely mechanical — the API surface must be verified.

### 7. New `/flow:idea` command implementation

The task requires `/flow:idea` as a new Flow-facing command for intent capture that creates `TODO-<id>` files in `docs/todos/`. This command does not currently exist in pi-config. The implementation must create a new skill or extension command and integrate with the `todos.ts` storage contract (JSON frontmatter + markdown body). The interface must avoid naming it "todo" while remaining compatible with existing `TODO-<id>` files.

## Possible Misses

### A. `plan_fence_hardening.py` naming exception

`plan_fence_hardening.py` uses underscores (unlike all other scripts which use hyphens). It is called both as a standalone CLI script (`python3 agent/skills/_shared/scripts/plan_fence_hardening.py`) and imported as a module. The extraction must preserve the underscore name and maintain both usage modes. The `fence_aware.py` shared module has the same issue — it is a library-only module, never invoked as a CLI script but essential to 5+ other scripts via dynamic `sys.path` insertion.

### B. Refine-plan scripts have no test coverage

`refine-plan/scripts/` has 5 Python scripts but no corresponding test directory was found. Either tests exist in a location not yet scanned (the `agent/package.json` includes `skills/refine-plan/scripts/tests/` in `test:helpers`), or that directory is empty/absent. This should be verified before migration. If no tests exist, the task's "migrate or replace" requirement leaves a gap.

### C. `define-spec/spec-design-procedure.md` is a critical referenced file

`define-spec/SKILL.md` reads `spec-design-procedure.md` from disk at Step 2 and fails hard if missing (`cannot run define-spec`). The fastlane skill mirrors its Step 0's strictness. This file must be extracted alongside `define-spec/SKILL.md`. It was not verified to exist in this scan but should be present given the skill references it.

### D. Multiple prompt template `.md` files inside skill directories

Several skills reference prompt template files that are not SKILL.md:
- `fastlane/fastlane-coder-prompt.md` (used by fastlane Step 4)
- `execute-plan/tdd-block.md` (used by fastlane Step 4 and execute-plan)
- `generate-plan/generate-plan-prompt.md` (used by generate-plan Step 3)
- `refine-plan/refine-plan-prompt.md` (calls `plan_fence_hardening.py`)
- `define-spec/spec-design-procedure.md` (required by define-spec)

These are part of the skill's runtime and must be extracted. They also contain `agent/skills/...` path references that need updating.

### E. `herdr-agent-state.ts` import check

`herdr-agent-state.ts` is excluded but must not be imported by any included extension. A cross-reference check is needed before removal to avoid broken imports.

### F. `plan-reviewer` agent not in the todo's agent list

The todo lists 10 required agents including `plan-reviewer`. The grep confirmed `plan-reviewer.md` exists in `agent/agents/`. No miss here, but the plan-reviewer is distinct from `plan-refiner` and both are needed.

### G. No tsconfig or package.json in the target packages yet

Each new package (`pi-flow`, `pi-flow-core`, `pi-flow-ux`) needs its own `tsconfig.json` (or references the workspace tsconfig). The root workspace needs `pnpm-workspace.yaml`. None of these files exist in pi-flow yet.

### H. Pi package discovery scope for commands

The task requires `/flow:setup`, `/flow:idea`, `/flow:scout`, etc. as registered commands. How Pi registers commands from packages (whether via a `commands` field in the pi manifest or a different mechanism) is not confirmed by files in this repo. This must be checked against Pi documentation.

## Open Questions / Ambiguities

1. **Pi package manifest schema**: What are the exact field names and types for the `"pi"` key in `package.json`? Specifically: how are `skills`, `extensions`, `themes`, and `commands` declared? How does Pi resolve the paths they reference? Is there a JSON schema available?

2. **How Pi sets working directory when agents run skill shell commands**: Skills write `python3 agent/skills/...` — does Pi run these shell commands relative to the consumer project's cwd? If so, after extraction the paths break. Is there a `{SKILL_DIR}` or `{PACKAGE_DIR}` variable that skills can use in shell invocations?

3. **`pi-interactive-subagent` v4.0.0 agent discovery API**: Does v4.0.0 already support reading agents from arbitrary Pi package directories (which would eliminate the symlink approach)? If so, document the minimum companion version and skip symlink setup.

4. **Pi install scope detection**: How does a Pi package's extension or command know whether it was installed globally (`pi install -g`) vs. project-locally? This is needed by `/flow:setup` for scope-aware symlink creation.

5. **`todos.ts` inclusion decision**: Should `todos.ts` be in `pi-flow-core`? The `todo` tool (read/create/update todos) used by skills like `fastlane` and `scout` appears to come from `todos.ts`. Without it, skill steps that call `Read the todo via the 'todo' tool` would fail. If `todos.ts` must be included, its `@earendil-works/*` API compatibility must be confirmed.

6. **`working/indicator.ts` config path**: Should the package ship a `working.json` as the default working indicator config at `~/.pi/agent/working.json`, or should the indicator read a package-bundled default and fall back to the user's global config? The current hardcoded path `~/.pi/agent/working.json` will silently use no config if the user hasn't run setup.

7. **Refine-plan script tests**: Does `agent/skills/refine-plan/scripts/tests/` exist and contain test files? The `agent/package.json test:helpers` script expects it. If it does not exist, the `pnpm test:helpers` command will fail after migration.

8. **pnpm workspace package naming**: Will the packages be published as `pi-flow`, `pi-flow-core`, `pi-flow-ux` (unscoped) or under a scope like `@earendil-works/pi-flow-core`? The Pi `npm:` install syntax and the keywords requirement suggest unscoped, but npm availability must be checked.

9. **`fence_aware.py` as a shared module**: The per-skill scripts compute a path to `fence_aware.py` via `Path(__file__).resolve().parents[N] / "_shared" / "scripts"`. After packaging into `packages/pi-flow-core/`, the directory depth changes. All `sys.path.insert` invocations that use a fixed `parents[N]` offset must be audited and updated to match the new layout.

10. **`/flow:idea` implementation**: What is the exact interface for creating a `TODO-<id>` file from a Flow command? Should it open an interactive prompt, accept freeform text as a command argument, or delegate to `todos.ts`? The current pi-config has no `idea` entry point.
