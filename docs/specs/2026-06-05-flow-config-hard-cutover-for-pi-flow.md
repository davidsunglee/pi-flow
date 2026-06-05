# Flow Config Hard Cutover for pi-flow

## Goal

Replace pi-flow's runtime model-tier configuration (`~/.pi/agent/model-tiers.json` / packaged `model-tiers.example.json`) with a broader flow configuration (`~/.pi/agent/flow.json` / packaged `flow.example.json`) that configures, in one place, how pi-flow uses pi-mux-subagents: model-tier dispatch, coordinator dispatch, and a unified subagent execution policy that pi-flow passes explicitly on every workflow dispatch. This is a hard cutover with no backwards compatibility (single known user). Alongside the rename, consolidate the per-skill dispatch instructions behind a single shared dispatch contract so future contract changes — and an eventual subagent-framework swap — stop being a twelve-site sweep.

Motivation: pi-flow subagent dispatches currently fall to pi-mux-subagents' conservative `guarded` default, which produces excessive permission prompts in Claude Code and Codex for a trusted single-user setup. The user configures the policy once in `flow.json`; pi-flow then injects it explicitly per dispatch. This is preferable to setup-time generation or mutation of agent YAML frontmatter because `/flow:setup` symlinks bundled agent definitions, and explicit per-dispatch parameters cannot go stale.

## Context

All paths are under `packages/pi-flow-core/` unless noted.

**Config today.** `~/.pi/agent/model-tiers.json` is the runtime source of truth; `model-tiers.example.json` ships in the package (pinned by the `files` array in `package.json` and by `__tests__/packlist.test.mjs`). Current schema: top-level `capable`/`standard`/`cheap` model strings; optional `crossProvider.{capable,standard,cheap}`; required `dispatch` provider-prefix→CLI map; `coordinatorDispatch.modelChain` (consumed only by coordinator workflows).

**Runtime helpers.** `skills/_shared/scripts/resolve-model-dispatch.py` (inputs: `--tier` dot-path, `--agent`, `--model-tiers` path defaulting to the runtime file; output: `{model, cli, provider, tier}`) and `skills/_shared/scripts/resolve-coordinator-dispatch.py` (validates `coordinatorDispatch` wholesale; output: `{modelChain, cli: "pi"}`). Both embed canonical hard-stop error templates emitted byte-equal on stderr.

**Canonical templates.** Four leaf-dispatch templates plus three coordinator templates, duplicated byte-equal across the helper scripts, `skills/_shared/model-tier-resolution.md`, `skills/_shared/coordinator-dispatch.md`, and `docs/model-tier-setup.md`, and pinned by `__tests__/guardrail-strings.test.mjs` plus the Python helper tests. Additional stop strings exist in refine-plan/refine-code SKILL.md ("requires ~/.pi/agent/model-tiers.json — see model matrix configuration").

**Dispatch sites.** Twelve prose dispatch sites construct `subagent_run_serial` / `subagent_run_parallel` task entries shaped `{name, agent, task, model, cli}` (plus per-site extras such as fastlane's `thinking: "high"`). pi-flow ships no dispatch runtime — these sites are instructions executed by the orchestrating LLM, and the resolution helpers are the only code seam:

1. `skills/scout/SKILL.md` (scout)
2. `skills/define-spec/SKILL.md` (spec-designer)
3. `skills/generate-plan/SKILL.md` (planner)
4. `skills/execute-plan/SKILL.md` (coder; parallel and serial)
5. `skills/execute-plan/acceptance-criteria-verification.md` (verifier)
6. `skills/_shared/test-runner-dispatch.md` (test-runner)
7. `skills/requesting-code-review/SKILL.md` (code-reviewer)
8. `skills/fastlane/SKILL.md` (coder)
9. `skills/refine-plan/SKILL.md` (plan-refiner coordinator; hardcoded `cli: "pi"`)
10. `skills/refine-code/SKILL.md` (code-refiner coordinator; hardcoded `cli: "pi"`)
11. `skills/refine-plan/refine-plan-prompt.md` (worker dispatches issued inside the coordinator)
12. `skills/refine-code/refine-code-prompt.md` (worker dispatches issued inside the coordinator)

**"Model matrix" wording.** refine-plan/refine-code SKILL steps ("Read model matrix"), the fill-prompt helpers (`--model-matrix` flag and `MODEL_MATRIX` placeholder in `skills/refine-plan/scripts/fill-refine-plan-prompt.py`, `skills/refine-code/scripts/fill-refine-code-prompt.py`, and their tests), and "### Model Matrix" sections in both coordinator prompts. The placeholder is filled with the pretty-printed runtime config file.

**Tests and fixtures.** `skills/_shared/scripts/tests/fixtures/model-tiers-*.json` (complete, no-dispatch, missing-provider, coordinator), `test_resolve_model_dispatch.py`, `test_resolve_coordinator_dispatch.py`, `bin/__tests__/helper-runner.test.mjs` (consumes the complete fixture and asserts an error-string fragment), `__tests__/guardrail-strings.test.mjs`, `__tests__/packlist.test.mjs`, and the fill-prompt Python tests.

**Docs.** `docs/model-tier-setup.md` (first-time setup copy command, schema reference, canonical templates, verification commands), `README.md` ("Model Tiers" section, shipped-files list, doc links), and the two shared contract docs named above.

**pi-mux-subagents executionPolicy contract (verified in installed package source).** `executionPolicy` is a tool parameter on `subagent` and on `subagent_run_serial` / `subagent_run_parallel` task entries; `execution-policy` is the agent-YAML-frontmatter equivalent. Values: `guarded` | `unrestricted`; resolution order: tool parameter → agent frontmatter → `guarded` default. Backend mappings: Claude `guarded` → `--permission-mode auto`, `unrestricted` → `--dangerously-skip-permissions` (pane) / `--permission-mode bypassPermissions` (headless); Codex `guarded` → `--sandbox workspace-write` plus approval-policy behavior, `unrestricted` → `--dangerously-bypass-approvals-and-sandbox`. The `pi` backend has no guarded mode: an explicitly passed `guarded` emits a one-line warning and runs unrestricted; the implicit default does not warn.

**Plan artifacts.** Plans reference tiers as aliases (`**Model recommendation:** cheap|standard|capable`, validated by `skills/execute-plan/scripts/extract-plan-tasks.py`); they do not embed config key paths.

## Requirements

Schema and files:

1. The runtime config is `~/.pi/agent/flow.json`; the packaged example is `flow.example.json`. The old file names are removed from package source entirely (no dual-read, no mention except where setup docs describe the one-time manual migration).
2. `flow.json` has five top-level sections:
   - `modelTiers` — `{capable, standard, cheap}`, each a non-empty model string; same semantics as today's top-level tiers (required when consumed).
   - `crossProviderModelTiers` — optional; `{capable, standard, cheap}`; same semantics as today's `crossProvider`.
   - `subagentDispatch` — required; provider-prefix → CLI-name map; same semantics as today's `dispatch`.
   - `coordinatorSubagentDispatch` — `{modelChain: [...]}`; same semantics as today's `coordinatorDispatch` (consumed only by coordinator workflows; ordered exact model identifiers, not tier aliases; wholesale validation with no entry-skipping; CLI hardcoded to `pi`, no `cli` key).
   - `executionPolicy` — required; exactly `"guarded"` or `"unrestricted"`.
3. Tier dot-paths used by skills, prompts, and helpers become section-qualified (`modelTiers.capable`, `crossProviderModelTiers.capable`, …). Plan-artifact tier aliases (`cheap|standard|capable`) are unchanged.
4. `flow.example.json` ships a working five-section configuration with `"executionPolicy": "guarded"`; the `package.json` `files` array and the packlist test track the new file name.

Execution policy behavior:

5. `executionPolicy` validation is strict: an absent key, or any value other than the two allowed strings, hard-stops with a new canonical template that joins the existing template family (parameterized with `<agent>`, emitted byte-equal, pinned in guardrail and helper tests like the others). No silent default.
6. Every pi-flow workflow dispatch task entry passes the configured `executionPolicy` explicitly — uniformly at all twelve sites, including the `cli: "pi"` coordinator hops (the benign pi-backend warning for explicit `guarded` is accepted) and including worker dispatches issued from inside the coordinator prompts. The coordinator must receive the resolved policy value as part of its instructions/inputs so its worker dispatches can carry it.
7. The resolution helpers emit the full dispatch envelope: leaf resolution output includes at minimum `model`, `cli`, and the resolved `executionPolicy`; coordinator validation output includes at minimum `modelChain`, `cli: "pi"`, and the resolved `executionPolicy`. A dispatch site needs no second config read to assemble its task entry.

Dispatch-contract consolidation:

8. A single shared dispatch-contract authority (markdown, following the established `_shared` single-authority pattern) owns: the task-entry shape, the flow.json → dispatch-parameter mapping, the executionPolicy injection rule, and the usage rules for the canonical templates. The twelve dispatch sites reference it and supply only their site-specific variation (agent name, prompt, role→tier mapping, serial vs parallel, per-site extras). The existing shared resolution and coordinator-dispatch contracts are subsumed by or rewritten consistently with this authority — no duplicated, divergent copies of the procedure remain.
9. Per-site extras remain expressible at the call site (e.g., fastlane's `thinking: "high"`; the coordinator's hardcoded `cli: "pi"`).

Naming sweep:

10. All canonical error templates and stop strings reference `flow.json` and the new section names (`subagentDispatch`, `coordinatorSubagentDispatch`, section-qualified tier paths). Helper flag names, helper docstrings, and doc wording follow. Exact template byte-strings are chosen by the planner and pinned in tests.
11. "Model matrix" terminology is retired in favor of flow-config terminology across SKILL steps, prompt section headings, helper flags/placeholders, and their tests.
12. Docs are updated end-to-end: the setup doc (copy command, schema reference, canonical templates, verification commands, "what is NOT shipped" guidance), README sections and links, and the shared contract docs all present the config as `flow.json`. Setup guidance documents the one-time manual migration of an existing `model-tiers.json` into the new name and shape (user-performed; no code assistance).
13. Tests and fixtures are updated to the new schema and naming: Python helper unit tests, helper-runner integration test, guardrail-strings pins (including removal-style assertions if the planner carries that pattern forward), packlist test, fill-prompt tests, and renamed fixtures.

## Constraints

- Hard cutover: no dual-read, no fallback to `model-tiers.json`, no deprecation window, no auto-migration code.
- The coordinator CLI remains hardcoded `"pi"` — a system invariant (coordinators require pi-mux-subagents orchestration tools such as `subagent_run_serial`); there is no `cli` key in `coordinatorSubagentDispatch`.
- No generation or mutation of agent YAML frontmatter; `/flow:setup`'s symlink model is untouched; no `execution-policy` frontmatter is added to bundled agents.
- pi-mux-subagents is consumed as-is; its existing `executionPolicy` contract is the integration surface. No changes to that package.
- The strict-by-default hard-stop policy and byte-equal canonical-template pinning are preserved as patterns.
- Resolution semantics are preserved — tier-path lookup, provider-prefix extraction, `subagentDispatch[<prefix>]` lookup, wholesale `modelChain` validation, and in-order `modelChain` attempts change in naming/location only.
- Plan artifact format and `extract-plan-tasks.py` validation (`cheap|standard|capable`) are unchanged.

## Approach

**Chosen approach:** Config-driven per-dispatch injection behind a shared dispatch contract. `flow.json` holds `executionPolicy` once; every pi-flow dispatch task entry passes it explicitly (coordinator hops included — uniform, exception-free injection); a single shared markdown contract plus helper-emitted dispatch envelopes own the task-entry shape and the config→parameter mapping; bundled agent YAMLs remain untouched symlinks.

**Why this over alternatives:** Runtime behavior is a pure function of `flow.json` — edit the file and the next dispatch obeys, with nothing to regenerate and nothing to go stale. It preserves the symlink-based `/flow:setup` model. The unconditional injection rule is trivially auditable, and the consolidation captures most of the framework-swap readiness (blast radius shrinks from "every skill" to "one contract + helpers") without speculative machinery.

**Considered and rejected:**

- Setup-time agent-frontmatter generation (`/flow:setup` writing `execution-policy:` into agent definitions from config) — setup symlinks bundled definitions today; generated copies go stale on package updates and every policy change would require re-running setup.
- Pluggable dispatch-abstraction layer now (capability matrix + adapter seam for swappable subagent frameworks) — with exactly one framework in existence, the mandatory/optional capability matrix would merely re-encode pi-mux-subagents' shapes; recorded as future direction, not designed here.
- Leaf-only injection (omitting the policy on `cli: "pi"` hops to avoid the pi guarded-mode warning) — makes the invariant conditional and harder to audit; the warning is truthful, benign, fires only for `guarded` configurations, and uniform injection starts working automatically if pi ever gains a guarded mode.
- Optional `executionPolicy` with a `guarded` default — would introduce the first silent default into a config whose contract is strict-by-default with canonical hard stops.

## Acceptance Criteria

- A case-insensitive search for `model-tiers` across `packages/pi-flow-core/` source returns no matches (installed copies under `.pi/` and historical artifacts under the repo-root `docs/` tree are out of scope).
- `MODEL_MATRIX`, `--model-matrix`, and "model matrix" wording are likewise absent from package source; the embedded-config placeholder and surrounding headings use flow-config terminology.
- With a valid five-section `~/.pi/agent/flow.json`, the leaf-resolution helper resolves section-qualified tier paths (e.g. `modelTiers.capable`, `crossProviderModelTiers.capable`) to an envelope containing `model`, `cli`, and the configured `executionPolicy`; the coordinator helper validates `coordinatorSubagentDispatch` and returns `modelChain`, `cli: "pi"`, and the configured `executionPolicy`. The setup doc's verification commands match actual helper outputs.
- Missing/unreadable file, missing/empty tier, missing `subagentDispatch` map, missing provider entry, missing `coordinatorSubagentDispatch` section, unusable `modelChain`, and missing/invalid `executionPolicy` each hard-stop with a canonical template; guardrail tests pin every template byte-equal; Python helper tests cover the new `executionPolicy` failure cases.
- Every dispatch task-entry instruction across the twelve sites includes `executionPolicy` and references the shared dispatch contract rather than restating the resolution procedure; both coordinator prompts instruct worker dispatches to carry the policy.
- `flow.example.json` ships with `"executionPolicy": "guarded"`, parses against the documented schema, and is tracked by the `package.json` `files` array and the packlist test.
- The full package test suites (node:test and Python unittest) pass after the cutover.

## Non-Goals

- No changes to pi-mux-subagents.
- No `execution-policy` agent frontmatter and no setup-time generation/mutation of agent definitions.
- No pluggable multi-framework dispatch abstraction or capability matrix in this change (future direction only; the shared contract is the only swap-readiness delivered).
- Direct manual dispatches of bundled agents outside pi-flow workflows remain governed by pi-mux-subagents defaults/frontmatter — pi-flow does not police them.
- No compatibility shim, dual-read, or migration code for `model-tiers.json`; the user migration is a documented one-time manual step.
- Historical artifacts are not rewritten: `docs/ideas/*`, `docs/plans/*`, and prior specs/reviews keep their `model-tiers` references (e.g., open idea `9dfc2062`).
- No per-agent or per-skill `executionPolicy` overrides — one global value; finer-grained config evolution is not designed here.
- No fastlane customize-menu entry for execution policy.
- Plan artifact format and tier-alias validation are unchanged.
