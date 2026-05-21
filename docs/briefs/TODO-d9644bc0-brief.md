# Scout Brief: Rebrand workflow artifacts from TODO-<id> to IDEA-<id>

Source: TODO-d9644bc0
Generated at: 2026-05-21T01:06:06Z
Git SHA: 544755837f0de99ba8d7d01bb7e0bb1ecf9d2cd7
Model: anthropic/claude-sonnet-4-6

## Relevant Files

**Extension layer (TypeScript):**
- `packages/pi-flow-core/extensions/idea.ts` — `registerIdea()` registers `flow:idea` command and `idea` tool; all tool/command output currently uses `TODO-${id}` as the visible identifier (lines 98, 110, 126, 147, 179)
- `packages/pi-flow-core/extensions/storage.ts` — `IdeaArtifact` interface; `normalizeIdeaId()` strips `TODO-` (not `IDEA-`) prefix; `isLegacyTodoId()` tests for `TODO-` prefix form; artifact files stored at `docs/todos/<8hex>.md`
- `packages/pi-flow-core/extensions/router.ts` — `TODO_RE = /^(TODO-)?([0-9a-f]{8})$/` (line 60); `recognizeExact()` returns canonical `TODO-${m[2]}` (line 109); no `IDEA-` awareness
- `packages/pi-flow-core/extensions/workflow.ts` — `COMMAND_DESCRIPTIONS` user-visible strings reference `TODO-<id>` for scout/spec/plan commands
- `packages/pi-flow-core/extensions/commands.ts` — entry point registering setup, idea, and workflow commands; no direct `TODO-` strings
- `packages/pi-flow-core/extensions/idea.test.ts` — asserts `TODO-[0-9a-f]{8}` in notification output (line 134); checks tool output uses `TODO-` prefix (lines 233, 259)
- `packages/pi-flow-core/extensions/router.test.ts` — all test fixtures use `TODO-abcd1234` as canonical; 5 matrix tests asserting `TODO-` canonical form

**Skill markdown files:**
- `packages/pi-flow-core/skills/generate-plan/SKILL.md` — Step 1a (lines 12–18) and Edge Cases (line 144) require the external `todo` tool to read a todo artifact before inlining into the planner prompt
- `packages/pi-flow-core/skills/execute-plan/SKILL.md` — Step 9 table (line 271) lists `todo tool`; Step 16.2 (lines 541–548) uses `todo` tool to read then close a linked todo; Step 16.3 (line 552) reports `"Closed TODO-5735f43b"`
- `packages/pi-flow-core/skills/fastlane/SKILL.md` — Step 10.2 (line 364) uses `todo` tool to read todo before closing
- `packages/pi-flow-core/skills/scout/SKILL.md` — Step 1 input detection regex `^TODO-([0-9a-f]{8})$` (case-sensitive; line 16); brief output path `docs/briefs/TODO-<raw-id>-brief.md` (line 19); continuation offer `Run /define-spec TODO-<id> next?` (lines 146, 149)
- `packages/pi-flow-core/skills/define-spec/SKILL.md` — Step 3a pre-dispatch resolution detects `^TODO-[0-9a-f]{8}$` input (line 32); transcript-backed recovery expects exact provenance line `Source: TODO-<id>` (line 116)
- `packages/pi-flow-core/skills/define-spec/spec-design-procedure.md` — Step 1 input shape table (line 28) uses `^TODO-[0-9a-f]{8}$` case-insensitively; preamble lines `Source: TODO-<id>` (line 119) and `Scout brief: docs/briefs/TODO-<id>-brief.md` (line 120); brief-detection path `docs/briefs/TODO-<raw-id>-brief.md` (line 28)
- `packages/pi-flow-core/skills/refine-plan/SKILL.md` — Step 3 auto-discover matches `**Source:** TODO-<id>` (line 45); sets `SOURCE_TODO = "Source todo: TODO-<id>"`
- `packages/pi-flow-core/skills/scout/scout-prompt.md` — brief format specifies `Source: TODO-<id>` on todo branch (lines 55, 61)
- `packages/pi-flow-core/agents/planner.md` — plan header: `**Source:** \`TODO-<id>\`` (line 95); passed through as `Source todo: TODO-<id>` in provenance block

**Python helpers:**
- `packages/pi-flow-core/skills/_shared/scripts/extract-provenance-preamble.py` — `_RE_SOURCE = re.compile(r"^(?:Source:|\*\*Source:\*\*) (TODO-[0-9a-f]{8})$")` (line 35); accepts only `TODO-` prefix; emits `{"source_todo": "TODO-<id>"}` in output JSON

**Test fixtures and tests:**
- `packages/pi-flow-core/skills/_shared/scripts/tests/fixtures/preamble-spec-clean.md` — `Source: TODO-12345678` and `Source: TODO-99999999` (lines 5, 15)
- `packages/pi-flow-core/skills/_shared/scripts/tests/fixtures/preamble-spec-fenced-heading.md` — `Source: TODO-12345678`, `Source: TODO-deadbeef` (lines 5, 13)
- `packages/pi-flow-core/skills/_shared/scripts/tests/test_extract_provenance_preamble.py` — ~15 test cases all use `TODO-` prefix; expected output `"source_todo": "TODO-<id>"`
- `packages/pi-flow-core/skills/define-spec/scripts/tests/test_todo_input_shape.py` — pins `TODO_PATTERN = re.compile(r"^TODO-([0-9a-f]{8})$", re.IGNORECASE)` (line 21); named after "todo"
- `packages/pi-flow-core/skills/refine-plan/scripts/tests/test_prepare_plan_review_prompt.py` — passes `--source-todo "Source todo: TODO-1234"` (line 37)
- `packages/pi-flow-core/skills/refine-plan/scripts/tests/test_prepare_plan_edit_prompt.py` — passes `--source-todo "Source todo: TODO-1234"` (line 43)

**Existing data:**
- `docs/todos/cfcb8ede.md`, `docs/todos/8c3886f2.md`, `docs/todos/ef562e4d.md`, `docs/todos/e13e219c.md`, `docs/todos/d9644bc0.md` — 5 existing artifacts stored under `docs/todos/`; JSON metadata uses bare `id` field (no prefix in storage)

## Key Interfaces and Types

**`IdeaArtifact` interface** (`storage.ts:6-13`):
```typescript
interface IdeaArtifact {
  id: string;        // bare 8-hex, never prefixed (e.g. "d9644bc0")
  title: string;
  tags: string[];
  status: "open" | "done";
  createdAt: string;
  body: string;
}
```
The bare-hex `id` field is stored in the on-disk JSON block; the `TODO-`/`IDEA-` prefix is only a display and routing concern.

**`normalizeIdeaId(value: string): string | undefined`** (`storage.ts:31-35`):
```typescript
export function normalizeIdeaId(value: string): string | undefined {
  const stripped = value.replace(/^TODO-/i, "").toLowerCase();
  if (/^[0-9a-f]{8}$/.test(stripped)) return stripped;
  return undefined;
}
```
Strips only `TODO-` prefix. Must be extended to also strip `IDEA-`.

**`isLegacyTodoId(value: string): boolean`** (`storage.ts:27-29`):
```typescript
export function isLegacyTodoId(value: string): boolean {
  return /^(TODO-)?[0-9a-f]{8}$/i.test(value);
}
```
Tests bare hex or `TODO-`-prefixed IDs. Name implies legacy; not yet used in this package — its role in the migration surface is currently undefined.

**`_RE_SOURCE` in `extract-provenance-preamble.py`** (line 35):
```python
_RE_SOURCE = re.compile(r"^(?:Source:|\*\*Source:\*\*) (TODO-[0-9a-f]{8})$")
```
Authoritative parser for provenance `Source:` lines. The sole change point for making IDEA- parseable in spec/plan preambles.

**`TODO_RE` in `router.ts`** (line 60):
```typescript
const TODO_RE = /^(TODO-)?([0-9a-f]{8})$/;
```
Used in `recognizeExact()` to detect artifact IDs; canonical output is `TODO-${m[2]}`. Needs to also recognize `IDEA-` prefix and return `IDEA-${m[2]}` as canonical.

**`source_todo` JSON field** (output of `extract-provenance-preamble.py`):
Current emitted shape: `{"source_todo": "TODO-<id>", ...}`. After migration, this field will carry `IDEA-<id>` values for new artifacts. Field rename (to `source_idea`) is a wider breaking change — its downstream consumers in `generate-plan/SKILL.md` and `refine-plan/SKILL.md` must be evaluated before any rename.

## Dependency / Call Graph

**Idea creation (write path):**
```
/flow:idea <seed>
  → registerIdea() / idea.ts:handler
  → newArtifact()  → storage.ts:generateIdeaId()
  → writeIdea()    → docs/todos/<id>.md
  → notify "TODO-<id>: <title>"   ← THIS becomes "IDEA-<id>: <title>"
```

**Idea reading via external `todo` tool (3 sites to remove):**
```
generate-plan/SKILL.md Step 1a
  → `todo` tool (external extension, NOT built-in)
  → reads docs/todos/<id>.md body
  → inline into {TASK_DESCRIPTION} for planner

execute-plan/SKILL.md Step 16.2
  → `todo` tool read  (external)
  → `todo` tool update status "done"  (external)

fastlane/SKILL.md Step 10.2
  → `todo` tool read then update  (external)
```
All three sites must switch to the built-in `idea` tool (`action: "read"` / `action: "update"`) or direct file reads of `docs/todos/<id>.md`.

**Identifier routing from slash commands:**
```
/flow:scout TODO-<id>  (or IDEA-<id> after rebrand)
  → workflow.ts:handleWorkflowCommand()
  → router.ts:routeArgs()
  → recognizeExact()  →  TODO_RE match  →  returns "TODO-${m[2]}"
  → buildExactPrompt()  →  "Use the scout skill. Argument: TODO-<id>."
  → sent to agent context
```
After rebrand, canonical output should be `IDEA-${m[2]}`.

**Provenance extraction chain:**
```
generate-plan/SKILL.md Step 1b (spec input)
  → pi-flow helper _shared/extract-provenance-preamble --mode spec
  → _RE_SOURCE matches "Source: TODO-<id>"
  → returns {"source_todo": "TODO-<id>"}
  → generate-plan populates {SOURCE_TODO} = "Source todo: TODO-<id>"
  → planner writes **Source:** `TODO-<id>` in plan header
  → execute-plan/SKILL.md Step 16.2 scans "**Source:** TODO-<id>"
  → closes linked todo via `todo` tool
```
This chain spans: `extract-provenance-preamble.py` → `generate-plan/SKILL.md` → `planner.md` → `execute-plan/SKILL.md`. All four must be updated together to maintain end-to-end consistency.

**Scout brief naming:**
```
scout/SKILL.md Step 1 (todo branch)
  → output path: docs/briefs/TODO-<raw-id>-brief.md

spec-design-procedure.md Step 1 (todo branch)
  → checks: docs/briefs/TODO-<raw-id>-brief.md
  → reads as scout context
```
Brief path change from `TODO-` to `IDEA-` must be coordinated between scout and spec-design-procedure (and SKILL.md define-spec Step 3a).

## Patterns and Conventions

1. **Bare-hex storage, prefix-at-display**: IDs are stored as bare 8-hex in file names (`docs/todos/<id>.md`) and JSON metadata (`id` field). The `TODO-`/`IDEA-` prefix is applied at display and routing time only. File renames are NOT required for the identifier rebrand — only the prefix in user-facing output, routing, and provenance strings needs to change.

2. **`normalizeIdeaId` as the normalization entry point**: All code that accepts user-supplied IDs should pass them through `normalizeIdeaId()` first. The function is the correct extension point for `IDEA-` support; no other code should independently parse prefixes.

3. **Regex pinning in Python tests**: `test_todo_input_shape.py` explicitly pins the input-detection regex as a test contract. A parallel `test_idea_input_shape.py` (or an updated file covering both prefixes) is the expected pattern for the new canonical form.

4. **Provenance chain exactness**: Each link in the provenance chain (brief → spec → plan → execute) uses exact-match regex or literal string comparison — no fuzzy matching. Every change in the provenance line format must be propagated through the whole chain.

5. **Skill input detection is case-insensitive for the prefix, but lowercase-normalized for the hex**: Both `spec-design-procedure.md` and `define-spec/SKILL.md` Step 3a normalize to lowercase before matching. The `TODO_RE` in `router.ts` is case-insensitive for the prefix via the `?`. `IDEA-` must receive the same case-folding treatment.

6. **`todo` tool vs `idea` tool**: The `todo` tool is an external extension (legacy; from `@earendil-works/pi-coding-agent`'s todos package). The `idea` tool is the built-in registered by `registerIdea()`. The task removes the dependency on the external `todo` tool by having generate-plan, execute-plan, and fastlane call the built-in `idea` tool instead.

7. **`promptSnippet` field in tool definition**: `idea.ts` line 187 sets `promptSnippet: "idea — capture/read/list/update Flow ideas (TODO-<id> compatible)."`. This LLM-visible hint governs when agents choose to invoke the tool — it must be updated to name `IDEA-<id>` as canonical.

## Existing Tests and Test Patterns

**TypeScript (Node `--test`):**
- `extensions/storage.test.ts` — format/parse/read/write/list roundtrips; no prefix assertions
- `extensions/idea.test.ts` — `assert.match(notify.message, /TODO-[0-9a-f]{8}/)` (line 134); tool create asserts `result.content[0].text` matches `/TODO-[0-9a-f]{8}/` (line 233); tool update output contains `TODO-fedcba98` (line 259); `registerIdea does not leak todo command or tool names` test (line 269) — verifies no `todo`/`flow:todo` names are registered
- `extensions/router.test.ts` — 50+ tests; all ID fixtures use `TODO-abcd1234`; three tests assert canonical return `'TODO-abcd1234'` (lines 29, 33, 107 etc.)

**Python (unittest):**
- `skills/define-spec/scripts/tests/test_todo_input_shape.py` — 9 cases pinning `TODO_PATTERN`; named "test_todo_input_shape"; should gain a parallel IDEA suite or be renamed/extended
- `skills/_shared/scripts/tests/test_extract_provenance_preamble.py` — covers `Source: TODO-<id>` detection including bold variant, fenced-block exclusion, boundary conditions; fixture files must gain IDEA equivalents
- `skills/refine-plan/scripts/tests/test_prepare_plan_review_prompt.py` and `test_prepare_plan_edit_prompt.py` — pass `Source todo: TODO-1234` as argument; no IDEA equivalent

**What is NOT tested today:**
- Routing / normalizing `IDEA-<id>` input
- `extract-provenance-preamble.py` with `Source: IDEA-<id>` input
- `execute-plan` or `generate-plan` behavior when no `todo` tool is registered
- Brief output path for `IDEA-<id>` in scout

## Risk Areas

1. **`_RE_SOURCE` in `extract-provenance-preamble.py`**: Hardcodes `TODO-[0-9a-f]{8}`. Any artifact whose preamble contains `Source: IDEA-<id>` will silently return `null` for `source_todo` — generate-plan will generate a plan without a `**Source:**` header, and execute-plan Step 16.2 will skip the todo-close step entirely. This is silent data loss in the provenance chain.

2. **execute-plan Step 16.2 scan string**: The skill scans for the literal `**Source:** TODO-<id>` in the plan body. New plans generated after the rebrand will contain `**Source:** IDEA-<id>`, which will not match — linked artifacts will never be closed. Must accept both forms during the transition window.

3. **Brief path naming collision**: The scout skill produces `docs/briefs/TODO-<id>-brief.md`. The spec-design-procedure checks the same path. Renaming to `IDEA-<id>-brief.md` without also updating spec-design-procedure (and define-spec SKILL) breaks the scout-to-spec handoff for ideas going through the full workflow chain.

4. **External `todo` tool removal timing**: Three skills (generate-plan, execute-plan, fastlane) call the external `todo` tool. Removing the tool before updating the skill prose will cause silent failures at runtime (tool not found), not at load time. The migration must update the skill prose first, then document the `todo` extension as removable.

5. **router.ts bare-hex normalization**: `recognizeExact('scout', 'abcd1234')` currently returns `'TODO-abcd1234'`. After rebrand it returns `'IDEA-abcd1234'`. The downstream skill (scout/SKILL.md) input-detection regex must be updated in the same changeset or the agent will reject the exact-routed argument.

6. **Test fixture files are shared across test suites**: `preamble-spec-clean.md` and `preamble-spec-fenced-heading.md` are referenced by `test_extract_provenance_preamble.py`. Adding IDEA fixtures or replacing TODO fixtures changes test inputs for existing passing tests — must be done carefully (add parallel fixtures, not replace).

7. **`isLegacyTodoId` is defined but unused in this package**: Its presence and name (`legacy`) implies it was intended for a compatibility-detection role. Before removing or repurposing it, verify no external consumer imports it from `storage.ts`.

8. **`env.ts` / `PI_TODO_PATH`**: No `env.ts` file exists in this repo. The task note about folding `env.ts` behavior into the idea extension appears to describe a future addition (env-var override for the ideas storage path). The current `getTodoDir()` in `storage.ts` resolves the git root but does NOT read `PI_TODO_PATH` or any environment variable. Adding `PI_IDEA_PATH` support is additive and carries no migration risk for existing users.

## Possible Misses

1. **`fastlane/SKILL.md` Step 6 test-run directory naming**: When input is a todo ID and no spec is involved, the test-run directory is named `docs/test-runs/TODO-<id>/` (line 217). After rebrand this should become `docs/test-runs/IDEA-<id>/`. Not mentioned in the task body but is a user-visible path.

2. **`workflow.ts` COMMAND_DESCRIPTIONS**: User-visible strings for `/flow:scout`, `/flow:spec`, `/flow:plan` all reference `TODO-<id>`. These are shown in the UI command picker and must be updated alongside the router change.

3. **`generate-plan/SKILL.md` Step 3 `{SOURCE_TODO}` placeholder comment**: Step 3 fill-instructions (line 67) describe filling `{SOURCE_TODO}` as `Source todo: TODO-<id>`. This is prose-only documentation in the skill; it must be updated to `IDEA-<id>`.

4. **`refine-plan/SKILL.md` input table** (line 22): The `SOURCE_TODO` row example shows `--source-todo TODO-<id>`. Must be updated to `IDEA-<id>`.

5. **`define-spec/SKILL.md` Step 3a slug derivation**: The pre-dispatch path resolution reads `docs/todos/<raw-id>.md` to derive a slug. This file path already uses bare hex, so no change needed there — but the input detection regex `^TODO-[0-9a-f]{8}$` that triggers this branch must also accept `^IDEA-[0-9a-f]{8}$`.

6. **`spec-design-procedure.md` Step 1 scout brief path**: Checks `docs/briefs/TODO-<raw-id>-brief.md` (line 28). After scout emits `IDEA-<id>` briefs, the procedure must check `docs/briefs/IDEA-<raw-id>-brief.md` as canonical and optionally fall back to the `TODO-` path for backward compat.

7. **`define-spec/SKILL.md` Step 4 transcript-backed recovery provenance check**: "the candidate file must contain the exact provenance line `Source: TODO-<id>`" (line 116). After rebrand, new specs will contain `Source: IDEA-<id>`. This check will fail on freshly generated specs, causing transcript-backed recovery to reject them.

8. **`source_todo` JSON key name**: The `extract-provenance-preamble.py` output field is named `source_todo`. After migration, the field will carry `IDEA-<id>` values. The generate-plan and refine-plan skills parse this field by name — renaming it to `source_idea` is a wider breaking change requiring coordinated updates. Consider keeping the field name `source_todo` for backward compatibility during the transition window, with the value changing to `IDEA-<id>`.

## Open Questions / Ambiguities

1. **Storage path change**: Should `docs/todos/` be renamed to `docs/ideas/`? The task says "provide migration guidance or tooling for existing `docs/todos/*.md` data **if** storage paths or metadata names change" — but does not mandate a path change. The `getTodoDir()` function hardcodes `"docs", "todos"`. If storage paths are to change, this is the modification site, and migration tooling for the 5 existing artifacts would be needed.

2. **Transition window for `TODO-` input acceptance**: Should skills and the router stop accepting `TODO-<id>` as input immediately after the rebrand, or remain dual-accepting indefinitely? The task says "explicit compatibility path" but does not define a deadline. A concrete recommendation (e.g., accept both for one major version, then deprecate) is needed for implementation.

3. **`source_todo` field rename**: The `extract-provenance-preamble.py` output field `source_todo` will carry `IDEA-<id>` values after the rebrand. Renaming to `source_idea` is cleaner but breaks any external consumer that reads this JSON. The brief does not know if external consumers exist; the implementer should audit all `source_todo` consumers before deciding.

4. **Brief path backward compatibility**: After changing scout to emit `docs/briefs/IDEA-<id>-brief.md`, specs and plans that reference the old `docs/briefs/TODO-<id>-brief.md` path in their `Scout brief:` preamble will no longer resolve. Should `define-spec`/`spec-design-procedure` check both paths? Or is a one-time migration script sufficient?

5. **`PI_TODO_PATH` / `PI_IDEA_PATH` env var support**: The task note mentions this as a migration path if the canonical env name changes. Since `getTodoDir()` currently ignores environment variables entirely, adding env-var support is a new feature. Is it in scope for this task, or deferred?

6. **`isLegacyTodoId` function role**: Currently defined in `storage.ts` but not imported anywhere within this package. Is this function intended to be exported for use by external consumers (e.g., for them to detect legacy IDs during their own migration), or is it an internal dead letter that should be removed?

7. **`IDEA_TOOL_DESCRIPTION` constant scope**: The description string in `idea.ts` is LLM-visible (agent prompt injection). After rebrand it says "Identifiers are IDEA-<8-hex>; TODO-<8-hex> accepted for backward compat." The exact wording shapes agent behavior. The implementer should decide the exact description before writing it, since it's harder to change post-deployment.
