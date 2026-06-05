# Flow Config Hard Cutover for pi-flow

**Spec:** `docs/specs/2026-06-05-flow-config-hard-cutover-for-pi-flow.md`

## Goal

Replace pi-flow's runtime model-tier configuration (`~/.pi/agent/model-tiers.json` / packaged `model-tiers.example.json`) with a five-section flow configuration (`~/.pi/agent/flow.json` / packaged `flow.example.json`) that configures model-tier dispatch, coordinator dispatch, and a required `executionPolicy` in one place. Every pi-flow workflow dispatch task entry passes the configured `executionPolicy` explicitly — uniformly at all twelve dispatch sites, including `cli: "pi"` coordinator hops and worker dispatches inside coordinator prompts. A new single shared dispatch-contract authority (`skills/_shared/dispatch-contract.md`) subsumes the existing `model-tier-resolution.md` and `coordinator-dispatch.md` contracts, so future contract changes touch one file plus the helpers instead of twelve sites. This is a hard cutover: no dual-read, no fallback, no migration code; "model matrix" terminology and all `model-tiers` naming are removed from package source.

## Architecture summary

pi-flow ships no dispatch runtime — the twelve dispatch sites are prose instructions executed by the orchestrating LLM, and two Python resolution helpers are the only code seam. The cutover therefore has four layers, each a wave:

1. **Config + helper layer** (code): `flow.example.json` replaces `model-tiers.example.json`; `resolve-model-dispatch.py` and `resolve-coordinator-dispatch.py` read `~/.pi/agent/flow.json`, resolve section-qualified tier paths (`modelTiers.capable`, `crossProviderModelTiers.cheap`, …), validate `executionPolicy` strictly, and emit full dispatch envelopes (`{model, cli, provider, tier, executionPolicy}` / `{modelChain, cli: "pi", executionPolicy}`) so no dispatch site needs a second config read. `validate-review-provenance.py`, `validate-and-parse-plan-review.py`, and the two fill-prompt helpers follow with flag/placeholder renames (`--model-tiers`/`--model-matrix` → `--flow-config`; `{MODEL_MATRIX}` → `{FLOW_CONFIG}`). Fixtures and the Python/node tests that pin helper behavior move in the same wave so every wave ends green.
2. **Shared contract layer** (markdown authority): a new `skills/_shared/dispatch-contract.md` owns the task-entry shape, the flow.json → dispatch-parameter mapping, the unconditional executionPolicy injection rule, the canonical hard-stop templates (five leaf + three coordinator), and the coordinator modelChain procedure. `model-tier-resolution.md` and `coordinator-dispatch.md` are deleted. The guardrail test re-points its template pins in the same wave.
3. **Dispatch-site layer** (prose): all twelve sites switch to section-qualified tier paths, reference `dispatch-contract.md` instead of restating procedure, and add `executionPolicy` to their task-entry shapes. Per-site extras (fastlane's `thinking: "high"`, define-spec's `systemPrompt`, the coordinators' hardcoded `cli: "pi"`) stay at the call sites.
4. **Docs + sweep layer**: the setup doc is rewritten as `docs/flow-config-setup.md` (copy command, five-section schema, executionPolicy semantics, canonical templates, verification commands matching actual helper output, one-time manual migration guidance); README and `docs/helper-runner.md` follow; a final guardrail test mechanically enforces the acceptance criteria's naming sweep (no `model-tiers`, no model-matrix wording in package source).

The chosen approach from the spec (`config-driven per-dispatch injection behind a shared dispatch contract`) is implemented exactly: `flow.json` holds `executionPolicy` once, helpers emit it per dispatch, every task entry carries it, bundled agent YAMLs stay untouched symlinks.

## Tech stack

- **Markdown skill/contract files** under `packages/pi-flow-core/skills/` (prose contracts executed by the orchestrating LLM).
- **Python 3 helper scripts** (stdlib only: `argparse`, `json`, `os`, `sys`) under `skills/*/scripts/`, invoked via `pi-flow helper <id>`; tested with `unittest` (`pnpm run test:helpers`).
- **node:test** suites (`*.test.mjs`) under `__tests__/` and `bin/__tests__/`, run via `pnpm run test:node` (node `--experimental-strip-types --test`).
- **pnpm workspace**; package manifest `files` array + `pnpm pack --dry-run` packlist test pin shipped files.

## File Structure

All paths relative to `packages/pi-flow-core/` unless noted.

- `flow.example.json` (Create) — packaged five-section example config with `"executionPolicy": "guarded"`.
- `model-tiers.example.json` (Delete) — replaced by `flow.example.json`.
- `package.json` (Modify) — `files` array tracks `flow.example.json` instead of `model-tiers.example.json`.
- `__tests__/packlist.test.mjs` (Modify) — required-files list tracks `flow.example.json`.
- `skills/_shared/scripts/resolve-model-dispatch.py` (Modify) — `--flow-config` flag, flow.json default, section-qualified tier docs, new canonical templates (1)–(5), `executionPolicy` in output envelope. Script filename intentionally unchanged (see Risk Assessment).
- `skills/_shared/scripts/resolve-coordinator-dispatch.py` (Modify) — `--flow-config` flag, `coordinatorSubagentDispatch` section, new templates, `executionPolicy` in output envelope.
- `skills/_shared/scripts/validate-review-provenance.py` (Modify) — `--flow-config` flag, `subagentDispatch` lookup, `flow.json missing or unreadable` failure label.
- `skills/refine-plan/scripts/validate-and-parse-plan-review.py` (Modify) — `--flow-config` flag forwarded to validate-review-provenance.
- `skills/_shared/scripts/tests/fixtures/flow-complete.json` (Create) / `model-tiers-complete.json` (Delete) — reshaped complete fixture.
- `skills/_shared/scripts/tests/fixtures/flow-no-dispatch.json` (Create) / `model-tiers-no-dispatch.json` (Delete) — reshaped no-subagentDispatch fixture.
- `skills/_shared/scripts/tests/fixtures/flow-missing-provider.json` (Create) / `model-tiers-missing-provider.json` (Delete) — reshaped missing-provider fixture.
- `skills/_shared/scripts/tests/fixtures/flow-coordinator.json` (Create) / `model-tiers-coordinator.json` (Delete) — reshaped coordinator fixture.
- `skills/_shared/scripts/tests/test_resolve_model_dispatch.py` (Modify) — new fixtures, section-qualified tiers, templates byte-equal, executionPolicy cases.
- `skills/_shared/scripts/tests/test_resolve_coordinator_dispatch.py` (Modify) — same, for the coordinator helper.
- `skills/_shared/scripts/tests/test_validate_review_provenance.py` (Modify) — new flag/fixture/tier paths/failure label.
- `skills/refine-plan/scripts/tests/test_validate_and_parse_plan_review.py` (Modify) — new config shape and flag.
- `bin/__tests__/helper-runner.test.mjs` (Modify) — fixture path and error-fragment assertion.
- `skills/refine-plan/scripts/fill-refine-plan-prompt.py` (Modify) — `--flow-config` flag, `{FLOW_CONFIG}` placeholder.
- `skills/refine-code/scripts/fill-refine-code-prompt.py` (Modify) — same.
- `skills/refine-plan/scripts/tests/test_fill_refine_plan_prompt.py` (Modify) — placeholder/flag renames.
- `skills/refine-code/scripts/tests/test_fill_refine_code_prompt.py` (Modify) — placeholder/flag renames.
- `skills/_shared/dispatch-contract.md` (Create) — single shared dispatch-contract authority.
- `skills/_shared/model-tier-resolution.md` (Delete) — subsumed by dispatch-contract.md.
- `skills/_shared/coordinator-dispatch.md` (Delete) — subsumed by dispatch-contract.md.
- `skills/_shared/orchestrator-verification-boundary.md` (Modify) — references dispatch-contract.md.
- `__tests__/guardrail-strings.test.mjs` (Modify, twice: Task 4 re-points template pins; Task 10 adds the naming-sweep and stop-string pins).
- `skills/scout/SKILL.md` (Modify) — dispatch site 1.
- `skills/define-spec/SKILL.md` (Modify) — dispatch site 2.
- `skills/generate-plan/SKILL.md` (Modify) — dispatch site 3.
- `skills/requesting-code-review/SKILL.md` (Modify) — dispatch site 7.
- `skills/execute-plan/SKILL.md` (Modify) — dispatch site 4.
- `skills/execute-plan/acceptance-criteria-verification.md` (Modify) — dispatch site 5.
- `skills/_shared/test-runner-dispatch.md` (Modify) — dispatch site 6.
- `skills/fastlane/SKILL.md` (Modify) — dispatch site 8.
- `skills/refine-plan/SKILL.md` (Modify) — dispatch site 9.
- `skills/refine-plan/refine-plan-prompt.md` (Modify) — dispatch site 11.
- `skills/refine-code/SKILL.md` (Modify) — dispatch site 10.
- `skills/refine-code/refine-code-prompt.md` (Modify) — dispatch site 12.
- `docs/flow-config-setup.md` (Create) / `docs/model-tier-setup.md` (Delete) — rewritten setup doc.
- `docs/helper-runner.md` (Modify) — example commands use new section names/tier paths.
- `README.md` (Modify) — shipped-files list, quick-start example, "Model Tiers" section → "Flow Config".

## Canonical strings (single source for all tasks)

Every task below that mentions a template or stop string MUST use these exact byte sequences (em dash is U+2014 `—`, matching the existing templates). Do not paraphrase.

**Leaf templates** (emitted by `resolve-model-dispatch.py`; Template 1 and 5 shared with the coordinator helper):

```
~/.pi/agent/flow.json missing or unreadable — cannot dispatch <agent>.
flow.json has no usable "<tier>" model — cannot dispatch <agent>.
flow.json has no subagentDispatch map — cannot dispatch <agent>.
flow.json has no subagentDispatch.<provider> mapping for <tier> model <model> — cannot dispatch <agent>.
flow.json has no usable executionPolicy ("guarded" or "unrestricted") — cannot dispatch <agent>.
```

Numbered (1) file missing/unreadable, (2) missing/empty selected tier, (3) missing `subagentDispatch` map, (4) missing/empty `subagentDispatch.<provider>`, (5) missing/invalid `executionPolicy`.

**Coordinator templates** (the first two emitted by `resolve-coordinator-dispatch.py`, which also reuses Templates (1) and (5); the third emitted by the orchestrating procedure):

```
flow.json has no coordinatorSubagentDispatch section — cannot dispatch <agent>.
flow.json coordinatorSubagentDispatch has no usable modelChain — cannot dispatch <agent>.
coordinator-dispatch: all coordinatorSubagentDispatch.modelChain models failed; last attempt: <model> via pi — <error>
```

**Skill stop strings:**

```
refine-plan requires ~/.pi/agent/flow.json — see flow config setup.
refine-code requires ~/.pi/agent/flow.json — see flow config setup.
```

**Provenance failure label** (`validate-review-provenance.py`): `flow.json missing or unreadable`

**Tier-path mapping** (old → new, used everywhere a tier path appears):

| Old | New |
|---|---|
| `capable` | `modelTiers.capable` |
| `standard` | `modelTiers.standard` |
| `cheap` | `modelTiers.cheap` |
| `crossProvider.capable` | `crossProviderModelTiers.capable` |
| `crossProvider.standard` | `crossProviderModelTiers.standard` |
| `crossProvider.cheap` | `crossProviderModelTiers.cheap` |

Plan-artifact tier aliases (`**Model recommendation:** cheap|standard|capable`) and `extract-plan-tasks.py` are unchanged.

**Helper envelope shapes:**

- Leaf success stdout: `{"model": "<provider>/<model>", "cli": "<cli>", "provider": "<provider>", "tier": "<tier-path-as-passed>", "executionPolicy": "guarded"|"unrestricted"}`
- Coordinator success stdout: `{"modelChain": ["<exact model id>", ...], "cli": "pi", "executionPolicy": "guarded"|"unrestricted"}`

**Validation order:** leaf helper — file → tier → subagentDispatch map → provider entry → executionPolicy. Coordinator helper — file → coordinatorSubagentDispatch section → modelChain → executionPolicy.

**Flag renames:** `--model-tiers` → `--flow-config` (default `~/.pi/agent/flow.json`) in `resolve-model-dispatch.py`, `resolve-coordinator-dispatch.py`, `validate-review-provenance.py`, `validate-and-parse-plan-review.py`. `--model-matrix` → `--flow-config` in `fill-refine-plan-prompt.py`, `fill-refine-code-prompt.py`. Placeholder `{MODEL_MATRIX}` → `{FLOW_CONFIG}`; prompt heading `### Model Matrix` → `### Flow Config`. Helper script FILENAMES are intentionally unchanged.

## Tasks

### Task 1: Packaged example config and packlist tracking

**Files:**
- Create: `packages/pi-flow-core/flow.example.json`
- Delete: `packages/pi-flow-core/model-tiers.example.json`
- Modify: `packages/pi-flow-core/package.json`
- Modify: `packages/pi-flow-core/__tests__/packlist.test.mjs`

**Steps:**
- [ ] **Step 1: Create `flow.example.json`** — write exactly this content (4-space indent, matching the deleted example's style):

  ```json
  {
      "modelTiers": {
          "capable": "anthropic/claude-opus-4-7",
          "standard": "anthropic/claude-sonnet-4-6",
          "cheap": "anthropic/claude-haiku-4-5"
      },
      "crossProviderModelTiers": {
          "capable": "openai-codex/gpt-5.5",
          "standard": "openai-codex/gpt-5.4",
          "cheap": "openai-codex/gpt-5.4-mini"
      },
      "subagentDispatch": {
          "anthropic": "claude",
          "openai-codex": "codex"
      },
      "coordinatorSubagentDispatch": {
          "modelChain": ["openai-codex/gpt-5.4"]
      },
      "executionPolicy": "guarded"
  }
  ```

- [ ] **Step 2: Delete `model-tiers.example.json`** — `git rm packages/pi-flow-core/model-tiers.example.json` (or delete and stage).
- [ ] **Step 3: Update `package.json` `files` array** — replace the entry `"model-tiers.example.json"` with `"flow.example.json"`. Touch nothing else in the manifest.
- [ ] **Step 4: Update `packlist.test.mjs`** — in the `required` array of the `'packlist includes required files'` test, replace `'model-tiers.example.json'` with `'flow.example.json'`.
- [ ] **Step 5: Run the packlist test** — `cd packages/pi-flow-core && node --test __tests__/packlist.test.mjs` and confirm it passes.

**Acceptance criteria:**

- `flow.example.json` exists in the package root, parses as JSON, and has exactly the five top-level keys `modelTiers`, `crossProviderModelTiers`, `subagentDispatch`, `coordinatorSubagentDispatch`, `executionPolicy`, with `executionPolicy` equal to `"guarded"`.
  Verify: run `python3 -c "import json; d=json.load(open('packages/pi-flow-core/flow.example.json')); assert sorted(d)==['coordinatorSubagentDispatch','crossProviderModelTiers','executionPolicy','modelTiers','subagentDispatch'], sorted(d); assert d['executionPolicy']=='guarded'; print('ok')"` and confirm it prints `ok`.
- `model-tiers.example.json` no longer exists and is not referenced by the package manifest.
  Verify: run `ls packages/pi-flow-core/model-tiers.example.json` and confirm "No such file"; run `grep -c "model-tiers" packages/pi-flow-core/package.json` and confirm it reports `0` matches (exit code 1).
- The packlist test passes and pins `flow.example.json` as a required packed file.
  Verify: run `cd packages/pi-flow-core && node --test __tests__/packlist.test.mjs` and confirm exit code 0 with no failing subtests; run `grep -n "flow.example.json" packages/pi-flow-core/__tests__/packlist.test.mjs` and confirm at least one match in the `required` array.

**Model recommendation:** cheap

### Task 2: Helper-layer cutover — resolution/provenance helpers, fixtures, and their tests

**Files:**
- Modify: `packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py`
- Modify: `packages/pi-flow-core/skills/_shared/scripts/resolve-coordinator-dispatch.py`
- Modify: `packages/pi-flow-core/skills/_shared/scripts/validate-review-provenance.py`
- Modify: `packages/pi-flow-core/skills/refine-plan/scripts/validate-and-parse-plan-review.py`
- Create: `packages/pi-flow-core/skills/_shared/scripts/tests/fixtures/flow-complete.json`, `flow-no-dispatch.json`, `flow-missing-provider.json`, `flow-coordinator.json`
- Delete: `packages/pi-flow-core/skills/_shared/scripts/tests/fixtures/model-tiers-complete.json`, `model-tiers-no-dispatch.json`, `model-tiers-missing-provider.json`, `model-tiers-coordinator.json`
- Test: `packages/pi-flow-core/skills/_shared/scripts/tests/test_resolve_model_dispatch.py`
- Test: `packages/pi-flow-core/skills/_shared/scripts/tests/test_resolve_coordinator_dispatch.py`
- Test: `packages/pi-flow-core/skills/_shared/scripts/tests/test_validate_review_provenance.py`
- Test: `packages/pi-flow-core/skills/refine-plan/scripts/tests/test_validate_and_parse_plan_review.py`
- Test: `packages/pi-flow-core/bin/__tests__/helper-runner.test.mjs`

All template strings come byte-equal from `## Canonical strings` above.

**Steps:**
- [ ] **Step 1: Write the four reshaped fixtures.** Create the new `flow-*.json` files with this exact content, then delete the four `model-tiers-*.json` files.

  `flow-complete.json` (note `openai-codex` maps to `pi`, preserving the existing cli expectation; no coordinator section, matching the old complete fixture):

  ```json
  {
      "modelTiers": {
          "capable": "anthropic/claude-opus-4-7",
          "standard": "anthropic/claude-sonnet-4-6",
          "cheap": "anthropic/claude-haiku-4-5"
      },
      "crossProviderModelTiers": {
          "capable": "openai-codex/gpt-5.5",
          "standard": "openai-codex/gpt-5.4",
          "cheap": "openai-codex/gpt-5.4-mini"
      },
      "subagentDispatch": {
          "anthropic": "claude",
          "openai-codex": "pi"
      },
      "executionPolicy": "guarded"
  }
  ```

  `flow-no-dispatch.json`: same `modelTiers` and `crossProviderModelTiers` objects plus `"executionPolicy": "guarded"`, and NO `subagentDispatch` key.

  `flow-missing-provider.json`: same `modelTiers` and `crossProviderModelTiers` objects, `"subagentDispatch": {"anthropic": "claude"}`, `"executionPolicy": "guarded"`.

  `flow-coordinator.json`: same `modelTiers` and `crossProviderModelTiers` objects, `"subagentDispatch": {"anthropic": "claude", "openai-codex": "codex"}`, `"coordinatorSubagentDispatch": {"modelChain": ["openai-codex/gpt-5.4", "anthropic/claude-sonnet-4-6"]}`, `"executionPolicy": "guarded"`.
- [ ] **Step 2: Update `resolve-model-dispatch.py`.** (a) Rename the `--model-tiers` argument to `--flow-config` with default `~/.pi/agent/flow.json` and help text `"Path to flow config JSON file (default: ~/.pi/agent/flow.json)"`; read it via `args.flow_config`. (b) Replace the four `die(...)` messages with leaf Templates (1)–(4) byte-equal (f-string parameter substitution as today). (c) After the provider lookup succeeds, add the strict executionPolicy check:

  ```python
  policy = data.get("executionPolicy")
  if policy not in ("guarded", "unrestricted"):
      die(
          'flow.json has no usable executionPolicy ("guarded" or "unrestricted") '
          f"— cannot dispatch {args.agent}."
      )
  ```

  (d) Extend the success output to `print(json.dumps({"model": model, "cli": cli, "provider": provider, "tier": args.tier, "executionPolicy": policy}))`. (e) Rewrite the module docstring: tier examples become `"modelTiers.capable"`, `"crossProviderModelTiers.capable"`; the Inputs block documents `--flow-config`; the Outputs block adds `"executionPolicy"`; the Failure-templates block lists Templates (1)–(5) byte-equal. Keep `resolve_tier` and all resolution semantics unchanged — `modelTiers.capable` resolves through the existing dot-path walk.
- [ ] **Step 3: Run the leaf helper manually to confirm RED→GREEN direction** — `cd packages/pi-flow-core && python3 skills/_shared/scripts/resolve-model-dispatch.py --tier modelTiers.capable --agent coder --flow-config skills/_shared/scripts/tests/fixtures/flow-complete.json` prints a JSON object with `"executionPolicy": "guarded"`.
- [ ] **Step 4: Update `test_resolve_model_dispatch.py`.** Fixture constants → `flow-complete.json` / `flow-no-dispatch.json` / `flow-missing-provider.json`. Tier args → `modelTiers.capable` / `crossProviderModelTiers.capable` / `crossProviderModelTiers.cheap`; `--model-tiers` → `--flow-config`. Success tests additionally assert `data["executionPolicy"] == "guarded"` and `data["tier"]` echoes the passed path (e.g. `"modelTiers.capable"`). Error-string assertions become the new templates byte-equal, e.g. Template 4 expectation: `flow.json has no subagentDispatch.openai-codex mapping for crossProviderModelTiers.capable model openai-codex/gpt-5.5 — cannot dispatch coder.\n`. The inline tempfile config in `test_template_2_empty_tier_value` becomes `{"modelTiers": {"capable": "anthropic/claude-opus-4-7"}, "crossProviderModelTiers": {"cheap": ""}, "subagentDispatch": {"anthropic": "claude"}, "executionPolicy": "guarded"}` with tier `crossProviderModelTiers.cheap`. Add three new tests: (a) `test_template_5_missing_execution_policy` — tempfile config equal to the complete fixture's content minus `executionPolicy`, tier `modelTiers.capable`, expect stderr exactly Template (5) with `<agent>=coder` plus trailing newline; (b) `test_template_5_invalid_execution_policy` — same config with `"executionPolicy": "permissive"`, same expectation; (c) `test_execution_policy_unrestricted_passes_through` — same config with `"executionPolicy": "unrestricted"`, expect exit 0 and `data["executionPolicy"] == "unrestricted"`.
- [ ] **Step 5: Update `resolve-coordinator-dispatch.py`.** (a) `--model-tiers` → `--flow-config`, default `~/.pi/agent/flow.json`. (b) Section lookup `data.get("coordinatorDispatch")` → `data.get("coordinatorSubagentDispatch")`. (c) Replace the three `die(...)` messages with Template (1) and the two coordinator templates byte-equal. (d) After the modelChain check, add the same strict executionPolicy check as Step 2c (identical template, `args.agent` substitution). (e) Success output: `print(json.dumps({"modelChain": chain, "cli": "pi", "executionPolicy": policy}))`. (f) Update the module docstring (section name, `--flow-config`, output shape with `executionPolicy`, failure templates incl. Template (5)); keep the Pi-invariant explanation, renaming `coordinatorDispatch` → `coordinatorSubagentDispatch` throughout.
- [ ] **Step 6: Update `test_resolve_coordinator_dispatch.py`.** `COORDINATOR` constant → `flow-coordinator.json`; `--model-tiers` → `--flow-config`. Every `run_with_config` payload that expects success gains `"executionPolicy": "guarded"` (e.g. `{"coordinatorSubagentDispatch": {"modelChain": [...]}, "executionPolicy": "guarded"}`); section key renamed in every payload. Error expectations become the new templates byte-equal (missing-section, no-usable-modelChain, Template 1 with the flow.json path). Success tests assert `data["executionPolicy"] == "guarded"`. `test_leaf_resolution_unaffected_by_coordinator_section` switches tiers to `modelTiers.capable` / `crossProviderModelTiers.capable` and flag to `--flow-config` (cli expectations stay `claude` / `codex` per `flow-coordinator.json`). Add two tests: `test_missing_execution_policy` (valid section+chain, no policy → Template (5) with the coordinator agent name) and `test_invalid_execution_policy` (`"executionPolicy": "Guarded"` → Template (5); the check is case-sensitive).
- [ ] **Step 7: Run both helper test files** — `cd packages/pi-flow-core && python3 -m unittest discover -s skills/_shared/scripts/tests -p 'test_resolve_*.py' -v` and confirm all pass.
- [ ] **Step 8: Update `validate-review-provenance.py`.** (a) `--model-tiers` → `--flow-config`, default `~/.pi/agent/flow.json`. (b) `fail("model-tiers.json missing or unreadable")` → `fail("flow.json missing or unreadable")`. (c) `data.get("dispatch", {})` → `data.get("subagentDispatch", {})`. (d) Docstring/epilog: flag rename, failure-label rename, `--allowed-tiers` example becomes `"crossProviderModelTiers.capable,modelTiers.capable"`. Do NOT add executionPolicy validation here — this script validates provenance, not dispatch; `resolve_tier` is unchanged.
- [ ] **Step 9: Update `test_validate_review_provenance.py`.** `COMPLETE` → `flow-complete.json`; all `--allowed-tiers` values → `crossProviderModelTiers.capable,modelTiers.capable`; `--model-tiers` → `--flow-config`; `matched_tier` expectations → `crossProviderModelTiers.capable` / `modelTiers.capable`; rename `test_missing_model_tiers_file` → `test_missing_flow_config_file` with nonexistent path `/nonexistent/path/flow.json` and failure label `flow.json missing or unreadable`.
- [ ] **Step 10: Update `validate-and-parse-plan-review.py` and its test.** In the script: `--model-tiers` → `--flow-config` (default `~/.pi/agent/flow.json`, help text updated) and forward it to the provenance helper as `"--flow-config", args.flow_config`. In `test_validate_and_parse_plan_review.py`: rename `self.model_tiers` → `self.flow_config`; the setUp payload becomes `{"crossProviderModelTiers": {"capable": "openai/reviewer-v1"}, "modelTiers": {"capable": "anthropic/reviewer-fallback"}, "subagentDispatch": {"openai": "pi", "anthropic": "claude", "inline": "pi"}, "executionPolicy": "guarded"}`; every `--model-tiers` arg → `--flow-config`; every `--allowed-tiers` value `crossProvider.capable,capable` → `crossProviderModelTiers.capable,modelTiers.capable` (including the override-tiers case around line 217 — reshape that inline payload the same way).
- [ ] **Step 11: Update `bin/__tests__/helper-runner.test.mjs`.** Rename the constant `FIXTURE_MODEL_TIERS` → `FIXTURE_FLOW_CONFIG` pointing at `skills/_shared/scripts/tests/fixtures/flow-complete.json`; the first subtest passes `'--flow-config', FIXTURE_FLOW_CONFIG` and asserts `r.stderr.includes('flow.json has no usable "nosuchtier" model')`.
- [ ] **Step 12: Run the full helper + node suites** — `cd packages/pi-flow-core && pnpm run test:helpers` and `node --test bin/__tests__/helper-runner.test.mjs`; confirm both exit 0.

**Acceptance criteria:**

- The leaf helper resolves section-qualified tier paths against a five-section config and emits the full envelope including `executionPolicy`.
  Verify: run `cd packages/pi-flow-core && python3 skills/_shared/scripts/resolve-model-dispatch.py --tier crossProviderModelTiers.capable --agent verifier --flow-config skills/_shared/scripts/tests/fixtures/flow-complete.json` and confirm stdout JSON is `{"model": "openai-codex/gpt-5.5", "cli": "pi", "provider": "openai-codex", "tier": "crossProviderModelTiers.capable", "executionPolicy": "guarded"}`.
- The coordinator helper validates `coordinatorSubagentDispatch` and emits `modelChain`, `cli: "pi"`, and `executionPolicy`.
  Verify: run `cd packages/pi-flow-core && python3 skills/_shared/scripts/resolve-coordinator-dispatch.py --agent plan-refiner --flow-config skills/_shared/scripts/tests/fixtures/flow-coordinator.json` and confirm stdout JSON is `{"modelChain": ["openai-codex/gpt-5.4", "anthropic/claude-sonnet-4-6"], "cli": "pi", "executionPolicy": "guarded"}`.
- A missing or invalid `executionPolicy` hard-stops both helpers with canonical Template (5) byte-equal; there is no silent default.
  Verify: run `cd packages/pi-flow-core && python3 -c "import json,subprocess,sys,tempfile; d=json.load(open('skills/_shared/scripts/tests/fixtures/flow-complete.json')); d.pop('executionPolicy'); f=tempfile.NamedTemporaryFile('w',suffix='.json',delete=False); json.dump(d,f); f.close(); r=subprocess.run([sys.executable,'skills/_shared/scripts/resolve-model-dispatch.py','--tier','modelTiers.capable','--agent','coder','--flow-config',f.name],capture_output=True,text=True); assert r.returncode!=0; assert r.stderr=='flow.json has no usable executionPolicy (\"guarded\" or \"unrestricted\") — cannot dispatch coder.\n', repr(r.stderr); print('ok')"` and confirm it prints `ok`.
- All four Python test files pass with the new schema, flags, fixtures, and templates, including the new executionPolicy failure cases.
  Verify: run `cd packages/pi-flow-core && python3 -m unittest discover -s skills/_shared/scripts/tests -p 'test_*.py' && python3 -m unittest discover -s skills/refine-plan/scripts/tests -p 'test_validate_and_parse_plan_review.py'` and confirm exit code 0; run `grep -n "test_template_5_missing_execution_policy\|test_template_5_invalid_execution_policy" packages/pi-flow-core/skills/_shared/scripts/tests/test_resolve_model_dispatch.py` and confirm both test names exist.
- The helper-runner integration test consumes the renamed fixture and asserts the new error fragment.
  Verify: run `cd packages/pi-flow-core && node --test bin/__tests__/helper-runner.test.mjs` and confirm exit 0; run `grep -n "flow-complete.json" packages/pi-flow-core/bin/__tests__/helper-runner.test.mjs` and confirm one match.
- No `model-tiers-*.json` fixture remains.
  Verify: run `ls packages/pi-flow-core/skills/_shared/scripts/tests/fixtures/ | grep -c "model-tiers"` and confirm it reports `0` (exit code 1).

**Model recommendation:** capable

### Task 3: Fill-prompt helper cutover ({FLOW_CONFIG})

**Files:**
- Modify: `packages/pi-flow-core/skills/refine-plan/scripts/fill-refine-plan-prompt.py`
- Modify: `packages/pi-flow-core/skills/refine-code/scripts/fill-refine-code-prompt.py`
- Test: `packages/pi-flow-core/skills/refine-plan/scripts/tests/test_fill_refine_plan_prompt.py`
- Test: `packages/pi-flow-core/skills/refine-code/scripts/tests/test_fill_refine_code_prompt.py`

**Steps:**
- [ ] **Step 1: Update `fill-refine-plan-prompt.py`.** Rename the `--model-matrix` argument to `--flow-config` (help: `"Flow config content (path or -)"`); rename the local variable `model_matrix` → `flow_config`; placeholder map key `"{MODEL_MATRIX}"` → `"{FLOW_CONFIG}"`. Update the module docstring's thirteen-placeholder list and the argparse epilog: `MODEL_MATRIX - Model matrix content (path or -)` → `FLOW_CONFIG - Flow config content (path or -)`. Owned-placeholder derivation (`owned = {...}`) follows automatically from the map.
- [ ] **Step 2: Update `test_fill_refine_plan_prompt.py`.** In the synthetic template strings replace `{MODEL_MATRIX}` with `{FLOW_CONFIG}` (lines with `Matrix: {MODEL_MATRIX}` and the all-13 one-liner); replace every `"--model-matrix"` arg with `"--flow-config"`; replace `assertNotIn("{MODEL_MATRIX}", ...)` with `assertNotIn("{FLOW_CONFIG}", ...)`; in the help test's placeholder list replace `"MODEL_MATRIX"` with `"FLOW_CONFIG"`. Variable names like `matrix_file` may be renamed to `flow_config_file` for clarity (optional, keep consistent).
- [ ] **Step 3: Update `fill-refine-code-prompt.py`.** Same rename: `--model-matrix` → `--flow-config`; `model_matrix` variable → `flow_config`; placeholder key `"MODEL_MATRIX"` → `"FLOW_CONFIG"`; docstring intro ("plan-goal, plan-contents, model-matrix" → "plan-goal, plan-contents, flow-config"), epilog line `MODEL_MATRIX — JSON with model tier configurations` → `FLOW_CONFIG — JSON with the flow configuration (model tiers, dispatch maps, execution policy)`, and the example invocation's `--model-matrix /path/to/models.json` → `--flow-config /path/to/flow.json`.
- [ ] **Step 4: Update `test_fill_refine_code_prompt.py`.** Replace `### Model Matrix` heading and `{MODEL_MATRIX}` in the synthetic template with `### Flow Config` / `{FLOW_CONFIG}`; `json.dump({"crossProvider.capable": "model1"}, f)` → `json.dump({"crossProviderModelTiers.capable": "model1"}, f)` and the matching `assertIn("crossProvider.capable", content)` → `assertIn("crossProviderModelTiers.capable", content)`; every `"--model-matrix"` → `"--flow-config"`; `assertNotIn("{MODEL_MATRIX}", ...)` → `assertNotIn("{FLOW_CONFIG}", ...)`; rename `model_matrix_file` variables → `flow_config_file`.
- [ ] **Step 5: Run both test files** — `cd packages/pi-flow-core && python3 -m unittest discover -s skills/refine-plan/scripts/tests -p 'test_fill_refine_plan_prompt.py' && python3 -m unittest discover -s skills/refine-code/scripts/tests -p 'test_fill_refine_code_prompt.py'`; confirm exit 0. (The real-template tests in these files only exercise the early missing-input exit, so they stay green while `refine-plan-prompt.md` / `refine-code-prompt.md` still contain `{MODEL_MATRIX}` until Tasks 7–8.)

**Acceptance criteria:**

- Both fill helpers accept `--flow-config` and substitute `{FLOW_CONFIG}`; `--model-matrix` and `MODEL_MATRIX` are gone from both scripts.
  Verify: run `grep -rn "MODEL_MATRIX\|model-matrix\|model_matrix" packages/pi-flow-core/skills/refine-plan/scripts/fill-refine-plan-prompt.py packages/pi-flow-core/skills/refine-code/scripts/fill-refine-code-prompt.py` and confirm zero matches; run `grep -c "FLOW_CONFIG" packages/pi-flow-core/skills/refine-plan/scripts/fill-refine-plan-prompt.py` and confirm at least 2 matches.
- A round-trip substitution works with the new flag and placeholder.
  Verify: run `cd packages/pi-flow-core && printf 'Cfg: {FLOW_CONFIG}\n' > /tmp/t-fc.md && printf '{"executionPolicy": "guarded"}' > /tmp/t-fc.json && python3 skills/refine-code/scripts/fill-refine-code-prompt.py --template /tmp/t-fc.md --plan-goal - --plan-contents /tmp/t-fc.json --base-sha a --head-sha b --review-output-path r --max-iterations 1 --flow-config /tmp/t-fc.json --working-dir /w --carry-over-review "" --output - <<< "goal"` and confirm stdout contains `Cfg: {"executionPolicy": "guarded"}`.
- Both fill-prompt test suites pass with the renamed flag/placeholder.
  Verify: run `cd packages/pi-flow-core && python3 -m unittest discover -s skills/refine-plan/scripts/tests -p 'test_fill_refine_plan_prompt.py' -v && python3 -m unittest discover -s skills/refine-code/scripts/tests -p 'test_fill_refine_code_prompt.py' -v` and confirm exit 0 and no `FAIL`.

**Model recommendation:** standard

### Task 4: Shared dispatch-contract authority and guardrail re-point

**Files:**
- Create: `packages/pi-flow-core/skills/_shared/dispatch-contract.md`
- Delete: `packages/pi-flow-core/skills/_shared/model-tier-resolution.md`
- Delete: `packages/pi-flow-core/skills/_shared/coordinator-dispatch.md`
- Modify: `packages/pi-flow-core/skills/_shared/orchestrator-verification-boundary.md`
- Test: `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs`

**Steps:**
- [ ] **Step 1: Read the two files being subsumed** (`skills/_shared/model-tier-resolution.md`, `skills/_shared/coordinator-dispatch.md`) so no semantic content is lost in the merge.
- [ ] **Step 2: Create `skills/_shared/dispatch-contract.md`** titled `# Dispatch contract` with exactly these level-2 sections, in order, carrying the listed content:
  1. `## Why this exists` — this file is the single authority for every pi-flow workflow dispatch: the runtime config schema, the task-entry shape, the flow.json → dispatch-parameter mapping, the executionPolicy injection rule, the canonical hard-stop templates, and the coordinator dispatch procedure. Dispatch sites reference this file and supply only site-specific variation (agent name, prompt, role→tier mapping, serial vs parallel, per-site extras). Consolidating here shrinks future contract changes — and an eventual subagent-framework swap — from a twelve-site sweep to one contract plus the two resolution helpers.
  2. `## Input: ~/.pi/agent/flow.json` — the five-section JSON schema block:

     ~~~
     ```json
     {
       "modelTiers": {
         "capable":  "<non-empty model string>",
         "standard": "<non-empty model string>",
         "cheap":    "<non-empty model string>"
       },
       "crossProviderModelTiers": {
         "capable":  "<non-empty model string>",
         "standard": "<non-empty model string>",
         "cheap":    "<non-empty model string>"
       },
       "subagentDispatch": {
         "<provider-prefix>": "<cli-name>",
         "anthropic":         "claude",
         "openai-codex":      "codex"
       },
       "coordinatorSubagentDispatch": {
         "modelChain": ["<exact model id>", "..."]
       },
       "executionPolicy": "guarded"
     }
     ```
     ~~~

     With bullets: `modelTiers` required when consumed (each tier a non-empty model string); `crossProviderModelTiers` optional, same three tier names; `subagentDispatch` required, provider-prefix → CLI-name map; `coordinatorSubagentDispatch` read only by coordinator dispatch (ordered exact model identifiers, not tier aliases; no `cli` key — the coordinator CLI is a system invariant); `executionPolicy` required, exactly `"guarded"` or `"unrestricted"`, no silent default.
  3. `## Task-entry shape` — every pi-flow workflow dispatch via `subagent_run_serial` / `subagent_run_parallel` uses task entries shaped `{ name, agent, task, model, cli, executionPolicy }`. Per-site extras (e.g. fastlane's `thinking: "high"`, define-spec's `systemPrompt`) remain expressible at the call site; `wait` is a top-level orchestration option, not a per-task field.
  4. `## flow.json → dispatch-parameter mapping` — two subsections. **Leaf dispatch:** run `pi-flow helper _shared/resolve-model-dispatch --tier <tier> --agent <agent>`; the helper resolves the section-qualified tier path to `model`, extracts the provider prefix, looks up `subagentDispatch[<prefix>]` for `cli`, validates `executionPolicy`, and prints `{"model", "cli", "provider", "tier", "executionPolicy"}` — the complete envelope; the site copies `model`, `cli`, and `executionPolicy` into its task entry with no second config read. **Coordinator dispatch:** run `pi-flow helper _shared/resolve-coordinator-dispatch --agent <agent>`; the helper validates `coordinatorSubagentDispatch` wholesale (no entry-skipping) and prints `{"modelChain", "cli": "pi", "executionPolicy"}`; the caller attempts each `modelChain` entry in order via `subagent_run_serial` with that entry passed verbatim as `model` (no provider-prefix extraction, no `subagentDispatch` lookup), `cli: "pi"`, and the envelope's `executionPolicy`, stopping at the first success.
  5. `## executionPolicy injection rule` — every pi-flow workflow dispatch task entry passes the resolved `executionPolicy` explicitly. The rule is uniform and exception-free: it applies to leaf workers, to the `cli: "pi"` coordinator hops, and to worker dispatches issued from inside coordinator prompts. The pi backend has no guarded mode — an explicitly passed `"guarded"` emits a one-line warning and runs unrestricted; that warning is expected and benign, and uniform injection starts working automatically if pi ever gains a guarded mode. No site may omit the parameter or inject it conditionally.
  6. `## Primitive operations` — the three numbered primitives carried over from the old resolution contract, renamed: (1) tier-path resolution over section-qualified paths (`modelTiers.capable`, …, `crossProviderModelTiers.cheap`), (2) provider-prefix extraction (substring before the first `/`), (3) `subagentDispatch[<prefix>]` lookup.
  7. `## Strict-by-default policy` — every dispatch site MUST stop on any failure condition below; no silent fallback to `"pi"` or any other CLI default, and no silent executionPolicy default. Consumers emit the corresponding canonical template byte-equal after parameter substitution and MUST NOT extend, paraphrase, or wrap the templates.
  8. `## Canonical templates` — fenced, numbered, byte-equal: leaf Templates (1)–(5) and the three coordinator templates from this plan's `## Canonical strings` section, with the parameter-substitution paragraph (parameters `<agent>`, `<tier>`, `<provider>`, `<model>`, `<error>` substituted verbatim; `<tier>` is a section-qualified path like `crossProviderModelTiers.cheap` substituted as-is). Note which templates each helper emits and that the exhaustion template is emitted by the orchestrating procedure, not the helper.
  9. `## Coordinator dispatch procedure` — carried over from `coordinator-dispatch.md`: why coordinators (`plan-refiner`, `code-refiner`) must run on `pi` (nested orchestration tools exist only there; system invariant, hardcoded `cli: "pi"`, no `cli` key in config); the numbered procedure (run the validation helper → on non-zero exit surface stderr verbatim and do NOT dispatch → on success attempt each `modelChain` entry in order, recording failures and advancing → stop at first success); the exhaustion template rule; and the `### Note on worker subagents` paragraph (workers inside coordinators do NOT read `coordinatorSubagentDispatch`; the coordinator re-resolves each worker via the leaf path above and passes the leaf envelope's `cli` and `executionPolicy` explicitly — no silent default).
  10. `## Skill-specific fallback chains` — carried over: the `skills/refine-plan/refine-plan-prompt.md` plan-reviewer pair (primary `crossProviderModelTiers.capable`, fallback `modelTiers.capable`) is an approved skill-local chain; `skills/refine-code/refine-code-prompt.md` uses role-to-tier mappings, not a fallback chain.
  11. `## Use from consumers` — consumers reference this document, supply `<agent>`/`<tier>` for their site, emit templates byte-equal, and list of the twelve dispatch sites: `skills/scout/SKILL.md` Step 2, `skills/define-spec/SKILL.md` Step 3a, `skills/generate-plan/SKILL.md` Step 2, `skills/execute-plan/SKILL.md` Step 6, `skills/execute-plan/acceptance-criteria-verification.md`, `skills/_shared/test-runner-dispatch.md`, `skills/requesting-code-review/SKILL.md` Step 2b, `skills/fastlane/SKILL.md` Step 4, `skills/refine-plan/SKILL.md` Step 8, `skills/refine-code/SKILL.md` Step 4, `skills/refine-plan/refine-plan-prompt.md`, `skills/refine-code/refine-code-prompt.md`.
- [ ] **Step 3: Delete the two subsumed files** — `git rm packages/pi-flow-core/skills/_shared/model-tier-resolution.md packages/pi-flow-core/skills/_shared/coordinator-dispatch.md`.
- [ ] **Step 4: Update `orchestrator-verification-boundary.md`** — in `## Sanctioned mechanical surface`, replace the bullet "Model-tier resolution via `resolve-model-dispatch.py`, and coordinator-dispatch validation via `resolve-coordinator-dispatch.py` followed by the `modelChain` iteration procedure in `skills/_shared/coordinator-dispatch.md`." with "Model dispatch resolution via `resolve-model-dispatch.py`, and coordinator-dispatch validation via `resolve-coordinator-dispatch.py` followed by the `modelChain` iteration procedure in `skills/_shared/dispatch-contract.md`."
- [ ] **Step 5: Re-point `guardrail-strings.test.mjs`.** (a) Replace the test `'model-tier-resolution canonical templates 1 through 4 are preserved byte-equal'` with `'dispatch-contract canonical leaf templates 1 through 5 are preserved byte-equal'`: read `sharedPath('dispatch-contract.md')` and `assert.ok(content.includes(...))` for each of the five leaf templates byte-equal (from `## Canonical strings`). (b) Replace `'coordinator-dispatch canonical templates are preserved byte-equal'` with `'dispatch-contract coordinator templates are preserved byte-equal'`: same file, pin the missing-section template, the no-usable-modelChain template, and the exhaustion template byte-equal. (c) In `'old four-tier coordinator chain strings are gone'`, replace the two `sharedPath(...)` entries with the single `sharedPath('dispatch-contract.md')` (keep the refine-plan/refine-code skill entries and the stale-string list unchanged). Leave every other test in the file untouched.
- [ ] **Step 6: Run the guardrail test** — `cd packages/pi-flow-core && node --test --experimental-strip-types __tests__/guardrail-strings.test.mjs` and confirm exit 0.

**Acceptance criteria:**

- `dispatch-contract.md` exists with all eleven required sections and contains all eight canonical templates byte-equal.
  Verify: run `grep -c "^## " packages/pi-flow-core/skills/_shared/dispatch-contract.md` and confirm at least 11; run `grep -Fc 'flow.json has no usable executionPolicy ("guarded" or "unrestricted") — cannot dispatch <agent>.' packages/pi-flow-core/skills/_shared/dispatch-contract.md` and confirm at least 1; run `grep -Fc 'coordinator-dispatch: all coordinatorSubagentDispatch.modelChain models failed; last attempt: <model> via pi — <error>' packages/pi-flow-core/skills/_shared/dispatch-contract.md` and confirm at least 1.
- The contract states the unconditional executionPolicy injection rule covering coordinator hops and coordinator-internal worker dispatches, and documents the benign pi-backend warning.
  Verify: open `packages/pi-flow-core/skills/_shared/dispatch-contract.md`, read the `## executionPolicy injection rule` section, and confirm it (a) requires every task entry to pass `executionPolicy` explicitly, (b) explicitly includes `cli: "pi"` coordinator hops and worker dispatches inside coordinator prompts, and (c) describes the pi guarded-mode warning as expected and benign.
- The two subsumed shared contracts are deleted and the boundary doc points at the new authority.
  Verify: run `ls packages/pi-flow-core/skills/_shared/model-tier-resolution.md packages/pi-flow-core/skills/_shared/coordinator-dispatch.md 2>&1 | grep -c "No such file"` and confirm `2`; run `grep -n "dispatch-contract.md" packages/pi-flow-core/skills/_shared/orchestrator-verification-boundary.md` and confirm one match.
- The guardrail suite passes with the re-pointed pins.
  Verify: run `cd packages/pi-flow-core && node --test --experimental-strip-types __tests__/guardrail-strings.test.mjs` and confirm exit 0 and no lines containing `not ok`.

**Model recommendation:** capable

### Task 5: Leaf dispatch sites A — scout, define-spec, generate-plan, requesting-code-review

**Files:**
- Modify: `packages/pi-flow-core/skills/scout/SKILL.md`
- Modify: `packages/pi-flow-core/skills/define-spec/SKILL.md`
- Modify: `packages/pi-flow-core/skills/generate-plan/SKILL.md`
- Modify: `packages/pi-flow-core/skills/requesting-code-review/SKILL.md`

For all four files: tier paths follow the `## Canonical strings` mapping table; every reference to `skills/_shared/model-tier-resolution.md` (including relative-link forms `../_shared/model-tier-resolution.md` and `_shared/model-tier-resolution.md`) becomes the same form of `dispatch-contract.md`; template ranges `(1)–(4)` become `(1)–(5)`; every dispatch task entry gains `executionPolicy` sourced from the resolution helper's envelope. Do not alter any guardrail-pinned string (scout's commit-gate menu, define-spec's `cannot run define-spec` error).

**Steps:**
- [ ] **Step 1: scout — Step 1 `--tier` parsing.** After the recognized-values sentence, state the mapping: the parsed alias maps to tier path `modelTiers.<name>` (default `modelTiers.standard` when absent). Update the unrecognized-value sentence: an unrecognized value is passed through as `modelTiers.<value>` and fails at resolution with Template (2).
- [ ] **Step 2: scout — Step 2.** Helper invocation becomes `pi-flow helper _shared/resolve-model-dispatch --tier modelTiers.<tier> --agent scout`; the procedure link points at `[skills/_shared/dispatch-contract.md](../_shared/dispatch-contract.md)`; note that the helper's envelope includes `executionPolicy`, consumed in Step 5.
- [ ] **Step 3: scout — Step 5 dispatch block.** Add `executionPolicy: "<resolved executionPolicy from Step 2>"` after the `cli:` line inside the task object.
- [ ] **Step 4: scout — Edge cases.** First bullet becomes: "**Missing `flow.json` or any of the five resolution failures:** emit Template (1)–(5) byte-equal with the supplied parameters and stop. No dispatch occurs."
- [ ] **Step 5: define-spec — Step 3a.** Helper invocation → `--tier modelTiers.capable --agent spec-designer`; procedure reference → `skills/_shared/dispatch-contract.md`; in the dispatch block change `model: "<capable tier from model-tiers.json>"` → `model: "<modelTiers.capable from flow.json>"` and add `executionPolicy: "<resolved executionPolicy>"` after `cli:`; update the Notes bullet to "**`model:`, `cli:`, and `executionPolicy:` come from `flow.json`, not from agent frontmatter.**" (keep the rest of that bullet's rationale).
- [ ] **Step 6: define-spec — Edge cases.** Replace the `model-tiers.json` bullet with: "**`flow.json` missing / no `modelTiers.capable` model / no `subagentDispatch.<provider>` mapping / no usable `executionPolicy`.** Fail at Step 3a per the canonical procedure in `skills/_shared/dispatch-contract.md` — emit the corresponding template (1)–(5) byte-equal with `<agent> = spec-designer`, `<tier> = modelTiers.capable` and stop. Do not fall back to a CLI default — the explicit resolution keeps dispatch on the Opus-tier / Claude-CLI route."
- [ ] **Step 7: generate-plan — Step 2.** Heading stays; body: tier-role assignment "plan generation uses `modelTiers.capable`"; helper command `pi-flow helper _shared/resolve-model-dispatch --tier modelTiers.capable --agent planner`; failure sentence → "(canonical Templates (1)–(5) from `_shared/dispatch-contract.md`)".
- [ ] **Step 8: generate-plan — Step 3.3 dispatch block.** Task entry becomes `{ name: "planner", agent: "planner", task: "<filled template>", model: "<model from Step 2>", cli: "<cli from Step 2>", executionPolicy: "<executionPolicy from Step 2>" }`.
- [ ] **Step 9: requesting-code-review — Steps 2b/3.** Step 2b: `--tier modelTiers.capable --agent code-reviewer`. Step 3 task entry: `{ name: "code-reviewer", agent: "code-reviewer", task: "<filled review-code-prompt.md>", model: "<modelTiers.capable from flow.json>", cli: "<subagentDispatch for modelTiers.capable>", executionPolicy: "<resolved executionPolicy>" }`. Following prose: "Use the `modelTiers.capable` model from `flow.json` in a fresh context — …".
- [ ] **Step 10: Sweep check.** Run `grep -rn -i "model-tiers\|model-tier-resolution" packages/pi-flow-core/skills/scout/SKILL.md packages/pi-flow-core/skills/define-spec/SKILL.md packages/pi-flow-core/skills/generate-plan/SKILL.md packages/pi-flow-core/skills/requesting-code-review/SKILL.md` and confirm zero matches.
- [ ] **Step 11: Run the guardrail suite** — `cd packages/pi-flow-core && node --test --experimental-strip-types __tests__/guardrail-strings.test.mjs` and confirm exit 0 (the pinned scout/define-spec strings must survive).

**Acceptance criteria:**

- All four sites use section-qualified tier paths, reference `dispatch-contract.md`, and include `executionPolicy` in their dispatch task entries.
  Verify: run `grep -n "executionPolicy" packages/pi-flow-core/skills/scout/SKILL.md packages/pi-flow-core/skills/define-spec/SKILL.md packages/pi-flow-core/skills/generate-plan/SKILL.md packages/pi-flow-core/skills/requesting-code-review/SKILL.md` and confirm each file has at least one match inside its dispatch task entry; run `grep -n "dispatch-contract" packages/pi-flow-core/skills/scout/SKILL.md packages/pi-flow-core/skills/define-spec/SKILL.md packages/pi-flow-core/skills/generate-plan/SKILL.md packages/pi-flow-core/skills/requesting-code-review/SKILL.md` and confirm each file has at least one match.
- No `model-tiers`, `model-tier-resolution`, or unqualified tier path remains in the four files.
  Verify: run `grep -rn -i "model-tiers\|model-tier-resolution" packages/pi-flow-core/skills/scout/SKILL.md packages/pi-flow-core/skills/define-spec/SKILL.md packages/pi-flow-core/skills/generate-plan/SKILL.md packages/pi-flow-core/skills/requesting-code-review/SKILL.md` and confirm zero matches; run `grep -n -- "--tier capable\|--tier standard\|--tier cheap\|--tier crossProvider" packages/pi-flow-core/skills/scout/SKILL.md packages/pi-flow-core/skills/define-spec/SKILL.md packages/pi-flow-core/skills/generate-plan/SKILL.md packages/pi-flow-core/skills/requesting-code-review/SKILL.md` and confirm zero matches.
- Guardrail-pinned strings in scout and define-spec are intact.
  Verify: run `cd packages/pi-flow-core && node --test --experimental-strip-types __tests__/guardrail-strings.test.mjs` and confirm exit 0.

**Model recommendation:** standard

### Task 6: Leaf dispatch sites B — execute-plan, verifier protocol, test-runner protocol, fastlane

**Files:**
- Modify: `packages/pi-flow-core/skills/execute-plan/SKILL.md`
- Modify: `packages/pi-flow-core/skills/execute-plan/acceptance-criteria-verification.md`
- Modify: `packages/pi-flow-core/skills/_shared/test-runner-dispatch.md`
- Modify: `packages/pi-flow-core/skills/fastlane/SKILL.md`

Same global rules as Task 5. Do NOT alter execute-plan's guardrail-pinned menu strings, the `MUST NOT` blockquotes, the expected-failure-skip strings, or fastlane's pinned customize-submenu/BLOCKED-banner strings.

**Steps:**
- [ ] **Step 1: execute-plan — Step 6.** Replace the mapping table rows with `modelTiers.capable` / `modelTiers.standard` / `modelTiers.cheap` from `flow.json` (left column keeps the plan aliases `capable`/`standard`/`cheap`). Replace the per-task invocation paragraph with: "For each task, invoke `pi-flow helper _shared/resolve-model-dispatch --tier <mapped tier path> --agent coder` and pass the resolved `model`, `cli`, and `executionPolicy` on every orchestration call, even when `cli` is `pi`. On non-zero exit, surface the byte-equal canonical Templates (1)-(5) from [`../_shared/dispatch-contract.md`](../_shared/dispatch-contract.md) and stop."
- [ ] **Step 2: execute-plan — Step 8.3 task shape.** `{ name: '<task-N>: <task-title>', agent: 'coder', task: '<filled prompt>', model: '<resolved>', cli: '<resolved>', executionPolicy: '<resolved>' }`.
- [ ] **Step 3: execute-plan — Step 9 mechanical-glue table.** Rename the row label `Model-tier resolution` → `Model dispatch resolution` (helper id unchanged).
- [ ] **Step 4: acceptance-criteria-verification.md.** Step d → "Resolve the dispatch envelope `(model, cli, executionPolicy)` by invoking `pi-flow helper _shared/resolve-model-dispatch --tier crossProviderModelTiers.standard --agent verifier`. On resolution failure, surface the byte-equal canonical Templates (1)–(5) per `skills/_shared/dispatch-contract.md`." Step e task entry gains `executionPolicy: <resolved>` after `cli: <resolved>`.
- [ ] **Step 5: test-runner-dispatch.md.** Step 2 → "Resolve the dispatch envelope `(model, cli, executionPolicy)`. Invoke `pi-flow helper _shared/resolve-model-dispatch --tier crossProviderModelTiers.cheap --agent test-runner`. The tier is hardcoded as `crossProviderModelTiers.cheap`; it is not caller-configurable. On resolution failure, surface byte-equal canonical Templates (1)–(5) per `skills/_shared/dispatch-contract.md` and stop the call site." Step 4 dispatch line gains `executionPolicy: <resolved>` inside the task object.
- [ ] **Step 6: fastlane — Step 4.** Resolve block → `pi-flow helper _shared/resolve-model-dispatch --tier modelTiers.<coder_tier> --agent coder` with the following sentence noting `<coder_tier>` is the Step 2 run-state alias (`cheap`/`standard`/`capable`) mapped into the `modelTiers` section, and "(canonical templates (1)–(5))" in the failure sentence. The `subagent_run_serial` block gains `executionPolicy: "<resolved executionPolicy>"` between `cli:` and `thinking:`. Keep `thinking: "high"` and its surrounding rules verbatim.
- [ ] **Step 7: fastlane — Step 5 NEEDS_CONTEXT retry.** Update "re-dispatch once with the same model, cli, and `thinking: "high"`" → "re-dispatch once with the same model, cli, executionPolicy, and `thinking: "high"`".
- [ ] **Step 8: Sweep check.** `grep -rn -i "model-tiers\|model-tier-resolution\|crossProvider\." packages/pi-flow-core/skills/execute-plan/SKILL.md packages/pi-flow-core/skills/execute-plan/acceptance-criteria-verification.md packages/pi-flow-core/skills/_shared/test-runner-dispatch.md packages/pi-flow-core/skills/fastlane/SKILL.md` — zero matches (note `crossProviderModelTiers.` does not match `crossProvider\.`).
- [ ] **Step 9: Run the guardrail suite** — `cd packages/pi-flow-core && node --test --experimental-strip-types __tests__/guardrail-strings.test.mjs` and confirm exit 0 (execute-plan menus and fastlane pins must survive).

**Acceptance criteria:**

- Step 6 of execute-plan maps plan aliases to `modelTiers.*` paths and requires passing `model`, `cli`, and `executionPolicy` on every orchestration call.
  Verify: read the `## Step 6` section of `packages/pi-flow-core/skills/execute-plan/SKILL.md` and confirm the table's right column reads `modelTiers.capable|standard|cheap` from `flow.json` and the invocation paragraph names all three envelope fields and Templates (1)-(5).
- The verifier and test-runner protocols resolve `crossProviderModelTiers.standard` / `crossProviderModelTiers.cheap` respectively and inject `executionPolicy` in their dispatch shapes.
  Verify: run `grep -n "crossProviderModelTiers.standard" packages/pi-flow-core/skills/execute-plan/acceptance-criteria-verification.md && grep -n "crossProviderModelTiers.cheap" packages/pi-flow-core/skills/_shared/test-runner-dispatch.md && grep -n "executionPolicy" packages/pi-flow-core/skills/execute-plan/acceptance-criteria-verification.md packages/pi-flow-core/skills/_shared/test-runner-dispatch.md` and confirm all four greps match.
- Fastlane's task entry carries both `executionPolicy` and the preserved `thinking: "high"` extra.
  Verify: read Step 4 of `packages/pi-flow-core/skills/fastlane/SKILL.md` and confirm the `subagent_run_serial` block contains both `executionPolicy: "<resolved executionPolicy>"` and `thinking: "high"`; run `cd packages/pi-flow-core && node --test --experimental-strip-types __tests__/guardrail-strings.test.mjs` and confirm exit 0.
- No legacy naming remains in the four files.
  Verify: run `grep -rn -i "model-tiers\|model-tier-resolution" packages/pi-flow-core/skills/execute-plan/SKILL.md packages/pi-flow-core/skills/execute-plan/acceptance-criteria-verification.md packages/pi-flow-core/skills/_shared/test-runner-dispatch.md packages/pi-flow-core/skills/fastlane/SKILL.md` and confirm zero matches.

**Model recommendation:** standard

### Task 7: Coordinator site — refine-plan SKILL and coordinator prompt

**Files:**
- Modify: `packages/pi-flow-core/skills/refine-plan/SKILL.md`
- Modify: `packages/pi-flow-core/skills/refine-plan/refine-plan-prompt.md`

Do NOT alter the guardrail-pinned coverage-gate error (`refine-plan: no coverage source available and --structural-only not set.`) or introduce any string from the stale list (`no model tier in`, `pi-eligible`, `four-tier`, `skip-silently`, `resolves to a pi CLI`).

**Steps:**
- [ ] **Step 1: SKILL Step 5.** Heading → `## Step 5: Read flow config`. Command → `cat ~/.pi/agent/flow.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), indent=2))"`. Stop string → byte-equal `refine-plan requires ~/.pi/agent/flow.json — see flow config setup.`
- [ ] **Step 2: SKILL Step 5 dispatch-resolution subsection.** Reference `[skills/_shared/dispatch-contract.md](../_shared/dispatch-contract.md)` and its coordinator procedure to validate the `coordinatorSubagentDispatch` section and obtain the coordinator `modelChain` plus `executionPolicy` before Step 8; keep the "single authority / do not duplicate / surface template verbatim, STATUS = failed" sentences with the file name swapped.
- [ ] **Step 3: SKILL Step 7.** In the fill-helper invocation, rename `--model-matrix <path-to-model-matrix-json>` → `--flow-config <path-to-flow-config-json>` (the path is the pretty-printed config captured in Step 5, written to a temp file, or `~/.pi/agent/flow.json` directly).
- [ ] **Step 4: SKILL Step 8.** "Dispatch per the shared `dispatch-contract.md` coordinator procedure using the `modelChain` validated in Step 5 …" and the task entry becomes `{ name: "plan-refiner", agent: "plan-refiner", task: "<filled refine-plan-prompt.md>", model: "<modelChain entry under attempt — exact string from coordinatorSubagentDispatch.modelChain>", cli: "pi", executionPolicy: "<executionPolicy from the Step 5 validation-helper envelope>" }` (the benign pi warning for explicit `guarded` is accepted per the contract).
- [ ] **Step 5: SKILL Step 9.5.** `--allowed-tiers crossProviderModelTiers.capable,modelTiers.capable`.
- [ ] **Step 6: SKILL Edge Cases.** The coordinator-dispatch bullet defers to "the shared `dispatch-contract.md` coordinator procedure" and names the renamed section (`coordinatorSubagentDispatch`) in its template list.
- [ ] **Step 7: prompt — Flow Config section.** `### Model Matrix` → `### Flow Config`; `{MODEL_MATRIX}` → `{FLOW_CONFIG}`. Tier assignments: `crossProviderModelTiers.capable` — primary plan reviewer; `modelTiers.capable` — fallback plan reviewer and the planner edit pass.
- [ ] **Step 8: prompt — Dispatch resolution section.** Update to: resolve each subagent dispatch via `pi-flow helper _shared/resolve-model-dispatch --tier <tier> --agent <agent>`, whose envelope includes `model`, `cli`, and `executionPolicy`; on any of the five documented failure conditions emit the canonical template byte-equal and `STATUS: failed`; never silently fall back; "Always pass `cli` and `executionPolicy` explicitly on every `subagent_run_serial` task."
- [ ] **Step 9: prompt — tier-path updates throughout.** Per-Iteration Step 2 → `--tier crossProviderModelTiers.capable`; Step 4a fallback → `--tier modelTiers.capable`; Step 5 and carry-over Step 3 `--allowed-tiers crossProviderModelTiers.capable,modelTiers.capable`; provenance-stamping paragraph's example → "if iteration 1 used `crossProviderModelTiers.capable` and iteration 2 fell back to `modelTiers.capable`"; Hard rule 2's parenthetical → "(primary `crossProviderModelTiers.capable` AND fallback `modelTiers.capable`)".
- [ ] **Step 10: prompt — Planner Edit Pass Step 2.** Dispatch fields become `model: <modelTiers.capable from the flow config>`, `cli: <subagentDispatch lookup for modelTiers.capable>`, `executionPolicy: <executionPolicy from the resolution-helper envelope>`, `task: <filled edit prompt at .prompt_path>`.
- [ ] **Step 11: Validate the fill helper against the updated template** — `cd packages/pi-flow-core && python3 skills/refine-plan/scripts/fill-refine-plan-prompt.py --template skills/refine-plan/refine-plan-prompt.md --plan-path /p.md --task-artifact "" --source-idea "" --source-spec "" --scout-brief "" --original-spec-inline /dev/null --structural-only-note /dev/null --max-iterations 3 --starting-era 1 --review-output-path r --working-dir /w --flow-config flow.example.json --carry-over-review "" --output -` exits 0 (proves `{FLOW_CONFIG}` is the only config placeholder and no unknown placeholders remain).
- [ ] **Step 12: Run guardrail + refine-plan python suites** — `cd packages/pi-flow-core && node --test --experimental-strip-types __tests__/guardrail-strings.test.mjs && python3 -m unittest discover -s skills/refine-plan/scripts/tests -p 'test_*.py'`; confirm exit 0.

**Acceptance criteria:**

- The refine-plan stop string and config read use `flow.json`, and the coordinator task entry carries `executionPolicy`.
  Verify: run `grep -Fn 'refine-plan requires ~/.pi/agent/flow.json — see flow config setup.' packages/pi-flow-core/skills/refine-plan/SKILL.md` and confirm one match; read Step 8 of the same file and confirm the task entry includes `cli: "pi"` and an `executionPolicy:` field sourced from the validation-helper envelope.
- The coordinator prompt embeds the flow config and instructs worker dispatches to carry the policy.
  Verify: run `grep -n "### Flow Config" packages/pi-flow-core/skills/refine-plan/refine-plan-prompt.md && grep -n "{FLOW_CONFIG}" packages/pi-flow-core/skills/refine-plan/refine-plan-prompt.md` and confirm both match; read the `### Dispatch resolution` section of that file and confirm it requires passing `cli` and `executionPolicy` explicitly on every `subagent_run_serial` task.
- The fill helper succeeds against the updated real template (placeholder contract intact).
  Verify: run the Step 11 command exactly as written and confirm exit code 0.
- All tier paths in both files are section-qualified and `model matrix` wording is gone.
  Verify: run `grep -rn -i "model.matrix\|model-tiers\|MODEL_MATRIX" packages/pi-flow-core/skills/refine-plan/SKILL.md packages/pi-flow-core/skills/refine-plan/refine-plan-prompt.md` and confirm zero matches; run `grep -n "crossProvider\.\(capable\|standard\|cheap\)" packages/pi-flow-core/skills/refine-plan/SKILL.md packages/pi-flow-core/skills/refine-plan/refine-plan-prompt.md` and confirm zero matches.

**Model recommendation:** standard

### Task 8: Coordinator site — refine-code SKILL and coordinator prompt

**Files:**
- Modify: `packages/pi-flow-core/skills/refine-code/SKILL.md`
- Modify: `packages/pi-flow-core/skills/refine-code/refine-code-prompt.md`

Do NOT alter the guardrail-pinned `STATUS:` handler strings or introduce stale-list strings.

**Steps:**
- [ ] **Step 1: SKILL Step 2.** Heading → `## Step 2: Read flow config`. Command → `cat ~/.pi/agent/flow.json | python3 ...` (same pipeline). Worker tier-mapping bullets → `crossProviderModelTiers.capable` (first-pass and final verification reviews), `modelTiers.standard` (hybrid re-reviews), `modelTiers.capable` (remediator). The coordinator-model sentence names `coordinatorSubagentDispatch.modelChain`. Dispatch-resolution subsection references `skills/_shared/dispatch-contract.md` (validation yields `modelChain` plus `executionPolicy`). Stop string → byte-equal `refine-code requires ~/.pi/agent/flow.json — see flow config setup.`
- [ ] **Step 2: SKILL Step 3.** Fill-helper invocation: `--model-matrix <path>` → `--flow-config <path>`.
- [ ] **Step 3: SKILL Step 4.** "Dispatch per the shared `dispatch-contract.md` coordinator procedure using the `modelChain` validated in Step 2 …"; task entry → `{ name: "code-refiner", agent: "code-refiner", task: "<filled refine-code-prompt.md>", model: "<modelChain entry under attempt — exact string from coordinatorSubagentDispatch.modelChain>", cli: "pi", executionPolicy: "<executionPolicy from the Step 2 validation-helper envelope>" }`.
- [ ] **Step 4: SKILL Step 6.** Allowed-tiers updates: approved paths → `--allowed-tiers crossProviderModelTiers.capable`; not_approved_within_budget → `--allowed-tiers crossProviderModelTiers.capable,modelTiers.standard`.
- [ ] **Step 5: SKILL Edge Cases.** Coordinator-dispatch bullet defers to `dispatch-contract.md` and names `coordinatorSubagentDispatch`.
- [ ] **Step 6: prompt — Flow Config section.** `### Model Matrix` → `### Flow Config`; `{MODEL_MATRIX}` → `{FLOW_CONFIG}`; tier assignments → `crossProviderModelTiers.capable` / `modelTiers.standard` / `modelTiers.capable` with the same role notes.
- [ ] **Step 7: prompt — Dispatch resolution section.** Same rewrite as Task 7 Step 8 ("five failure conditions (templates (1)–(5))", envelope includes `executionPolicy`, "Always pass `cli` and `executionPolicy` explicitly").
- [ ] **Step 8: prompt — per-pass tier and entry updates.** Provenance-stamping role list ("first-pass uses `crossProviderModelTiers.capable`, hybrid re-review uses `modelTiers.standard`, final-verification uses `crossProviderModelTiers.capable`"). Iteration 1 Step 2 `{REVIEWER_PROVENANCE}` note → "this is `crossProviderModelTiers.capable` and its dispatch CLI". Iteration 1 Step 3: "Dispatch `code-reviewer` with model `crossProviderModelTiers.capable` and corresponding `cli` from the flow config", task entry → `{ name: "code-reviewer", agent: "code-reviewer", task: "<filled review-code-prompt.md>", model: "<crossProviderModelTiers.capable from flow.json>", cli: "<subagentDispatch for crossProviderModelTiers.capable>", executionPolicy: "<resolved executionPolicy>" }`; Step 3d `--allowed-tiers crossProviderModelTiers.capable`. Step 6 remediator: "use model `modelTiers.capable` and corresponding `cli` from the flow config", entry → `{ name: "coder", agent: "coder", task: "<filled remediation prompt>", model: "<modelTiers.capable from flow.json>", cli: "<subagentDispatch for modelTiers.capable>", executionPolicy: "<resolved executionPolicy>" }`. Hybrid re-review (Iteration 2..N steps 4–5): `{REVIEWER_PROVENANCE}` from `modelTiers.standard`; dispatch "with model `modelTiers.standard` and corresponding `cli` from the flow config"; `validate-review-provenance.py --allowed-tiers modelTiers.standard`. Final Verification step 1: model `crossProviderModelTiers.capable`, `{REVIEWER_PROVENANCE}` from `crossProviderModelTiers.capable`, `validate-review-provenance.py --allowed-tiers crossProviderModelTiers.capable`.
- [ ] **Step 9: Validate the fill helper against the updated template** — `cd packages/pi-flow-core && printf 'goal' > /tmp/g.txt && python3 skills/refine-code/scripts/fill-refine-code-prompt.py --template skills/refine-code/refine-code-prompt.md --plan-goal /tmp/g.txt --plan-contents /tmp/g.txt --base-sha a --head-sha b --review-output-path r --max-iterations 3 --flow-config flow.example.json --working-dir /w --carry-over-review "" --output -` exits 0.
- [ ] **Step 10: Run guardrail + refine-code python suites** — `cd packages/pi-flow-core && node --test --experimental-strip-types __tests__/guardrail-strings.test.mjs && python3 -m unittest discover -s skills/refine-code/scripts/tests -p 'test_*.py'`; confirm exit 0.

**Acceptance criteria:**

- The refine-code stop string and config read use `flow.json`, and the coordinator task entry carries `executionPolicy`.
  Verify: run `grep -Fn 'refine-code requires ~/.pi/agent/flow.json — see flow config setup.' packages/pi-flow-core/skills/refine-code/SKILL.md` and confirm one match; read Step 4 of the same file and confirm the task entry includes `cli: "pi"` and `executionPolicy:`.
- Every reviewer/remediator dispatch instruction in the prompt names a section-qualified tier and includes `executionPolicy` in its task entry.
  Verify: run `grep -c "executionPolicy" packages/pi-flow-core/skills/refine-code/refine-code-prompt.md` and confirm at least 3 matches; read Iteration 1 Steps 3 and 6 and the Final Verification section and confirm each dispatch entry/instruction carries the policy and a `crossProviderModelTiers.*` or `modelTiers.*` tier.
- The fill helper succeeds against the updated real template.
  Verify: run the Step 9 command exactly as written and confirm exit code 0.
- Legacy naming is gone from both files.
  Verify: run `grep -rn -i "model.matrix\|model-tiers\|MODEL_MATRIX" packages/pi-flow-core/skills/refine-code/SKILL.md packages/pi-flow-core/skills/refine-code/refine-code-prompt.md` and confirm zero matches; run `grep -n "crossProvider\.\(capable\|standard\|cheap\)" packages/pi-flow-core/skills/refine-code/SKILL.md packages/pi-flow-core/skills/refine-code/refine-code-prompt.md` and confirm zero matches.

**Model recommendation:** standard

### Task 9: Docs end-to-end — setup doc, helper-runner doc, README

**Files:**
- Create: `packages/pi-flow-core/docs/flow-config-setup.md`
- Delete: `packages/pi-flow-core/docs/model-tier-setup.md`
- Modify: `packages/pi-flow-core/docs/helper-runner.md`
- Modify: `packages/pi-flow-core/README.md`

**Steps:**
- [ ] **Step 1: Create `docs/flow-config-setup.md`** (delete `docs/model-tier-setup.md` in the same change) with these sections:
  1. `# Flow Config Setup` / `## Why this file exists` — `~/.pi/agent/flow.json` is the runtime source of truth read by `pi-flow helper _shared/resolve-model-dispatch` and `pi-flow helper _shared/resolve-coordinator-dispatch`; the packaged `flow.example.json` is a starting template only, never read at runtime.
  2. `## First-time setup` — copy commands:

     ```sh
     cp node_modules/@aphotic/pi-flow-core/flow.example.json ~/.pi/agent/flow.json
     ```

     and the dynamic variant:

     ```sh
     cp $(pi-flow template _shared/dispatch-contract | sed 's|/skills/_shared/dispatch-contract.md|/flow.example.json|') ~/.pi/agent/flow.json
     ```

     plus the edit-before-use sentence naming `coordinatorSubagentDispatch.modelChain`.
  3. `## Schema reference` — the five-section JSON shape (same block as `dispatch-contract.md`'s Input section) with one bullet per section, including: `executionPolicy` is required and must be exactly `"guarded"` or `"unrestricted"`; pi-flow injects it explicitly on every workflow dispatch. Document the backend semantics: Claude `guarded` → `--permission-mode auto`, `unrestricted` → `--dangerously-skip-permissions` (pane) / `--permission-mode bypassPermissions` (headless); Codex `guarded` → `--sandbox workspace-write` plus approval-policy behavior, `unrestricted` → `--dangerously-bypass-approvals-and-sandbox`; the `pi` backend has no guarded mode — an explicitly passed `guarded` emits a one-line warning and runs unrestricted (expected and benign on coordinator hops).
  4. `### Why coordinator dispatch is separate` — carried over from the old doc with `coordinatorSubagentDispatch` naming and a pointer to `skills/_shared/dispatch-contract.md`.
  5. `### Canonical error templates` — all five leaf templates and the three coordinator templates byte-equal from this plan's `## Canonical strings`.
  6. `## Verifying setup` — commands and expected outputs matching the actual helper envelopes:

     ```sh
     pi-flow helper _shared/resolve-model-dispatch --tier modelTiers.capable --agent coder
     ```

     expected shape `{"model": "...", "cli": "...", "provider": "...", "tier": "modelTiers.capable", "executionPolicy": "guarded"}`; and

     ```sh
     pi-flow helper _shared/resolve-coordinator-dispatch --agent plan-refiner
     ```

     expected shape `{"modelChain": ["..."], "cli": "pi", "executionPolicy": "guarded"}`.
  7. `## Migrating from the legacy model-tier config` — one-time, user-performed, no code assistance, no dual-read. Steps: (1) rename the previous per-tier runtime config file in `~/.pi/agent/` to `flow.json` (refer to it as "the legacy model-tier config file" — do NOT write the old hyphenated filename literally; the naming-sweep test forbids it); (2) apply the key mapping table:

     | Legacy key | `flow.json` key |
     |---|---|
     | top-level `capable` / `standard` / `cheap` | `modelTiers.capable` / `.standard` / `.cheap` |
     | `crossProvider` | `crossProviderModelTiers` |
     | `dispatch` | `subagentDispatch` |
     | `coordinatorDispatch` | `coordinatorSubagentDispatch` |
     | (absent) | `executionPolicy` — required, `"guarded"` or `"unrestricted"` |

     (3) add `"executionPolicy": "guarded"` (or `"unrestricted"` for a trusted single-user setup); (4) delete the legacy file once a workflow dispatch succeeds.
  8. `## What is NOT shipped` — pi-flow does not write `~/.pi/agent/flow.json` on install and never overwrites an existing user file; `flow.example.json` is reference-only; the user must create `flow.json` before running any workflow that dispatches agents.
- [ ] **Step 2: Update `docs/helper-runner.md`.** Comment line → `# Validate coordinatorSubagentDispatch and print the coordinator model chain`; the resolve-model-dispatch example → `--tier modelTiers.capable --agent coder`; the validate-review-provenance example → `--allowed-tiers modelTiers.capable`.
- [ ] **Step 3: Update `README.md`.** (a) Shipped-files bullet → `**Flow config example** — flow.example.json as a starting point for the local flow configuration (model tiers, subagent dispatch, coordinator dispatch, execution policy). See [docs/flow-config-setup.md](docs/flow-config-setup.md).` (b) Quick-start example → `pi-flow helper _shared/resolve-model-dispatch --tier modelTiers.capable --agent coder`. (c) Section `## Model Tiers` → `## Flow Config` with body: `Copy flow.example.json to ~/.pi/agent/flow.json to configure which model tier is used for each role, the provider→CLI dispatch map, the coordinator model chain, and the subagent execution policy. See [docs/flow-config-setup.md](docs/flow-config-setup.md) for details.`
- [ ] **Step 4: Cross-check the verification outputs against the real helpers** — run `cd packages/pi-flow-core && python3 skills/_shared/scripts/resolve-model-dispatch.py --tier modelTiers.capable --agent coder --flow-config flow.example.json` and `python3 skills/_shared/scripts/resolve-coordinator-dispatch.py --agent plan-refiner --flow-config flow.example.json`, and confirm the key sets in the doc's expected-output blocks match the actual stdout key sets exactly.
- [ ] **Step 5: Sweep check** — `grep -rn -i "model-tiers" packages/pi-flow-core/docs packages/pi-flow-core/README.md` returns zero matches, and `ls packages/pi-flow-core/docs/model-tier-setup.md` reports "No such file".

**Acceptance criteria:**

- The setup doc exists at `docs/flow-config-setup.md` with copy command, five-section schema, executionPolicy semantics, canonical templates, verification commands, migration guidance, and what-is-NOT-shipped guidance; the old doc is gone.
  Verify: run `grep -n "## First-time setup\|## Schema reference\|## Verifying setup\|## Migrating\|## What is NOT shipped" packages/pi-flow-core/docs/flow-config-setup.md` and confirm all five headings match; run `ls packages/pi-flow-core/docs/model-tier-setup.md 2>&1 | grep -c "No such file"` and confirm `1`.
- The doc's verification outputs match actual helper envelopes (including `executionPolicy`).
  Verify: run `cd packages/pi-flow-core && python3 skills/_shared/scripts/resolve-model-dispatch.py --tier modelTiers.capable --agent coder --flow-config flow.example.json` and confirm its stdout keys (`model`, `cli`, `provider`, `tier`, `executionPolicy`) all appear in the doc's first expected-output block in `docs/flow-config-setup.md`; repeat for `resolve-coordinator-dispatch.py --agent plan-refiner --flow-config flow.example.json` against the second block (`modelChain`, `cli`, `executionPolicy`).
- All eight canonical templates appear byte-equal in the setup doc.
  Verify: run `grep -Fc 'flow.json has no subagentDispatch.<provider> mapping for <tier> model <model> — cannot dispatch <agent>.' packages/pi-flow-core/docs/flow-config-setup.md && grep -Fc 'flow.json coordinatorSubagentDispatch has no usable modelChain — cannot dispatch <agent>.' packages/pi-flow-core/docs/flow-config-setup.md` and confirm both report at least 1.
- README and helper-runner doc present the config as `flow.json` with updated links and examples, and no `model-tiers` string remains in docs or README.
  Verify: run `grep -n "flow-config-setup.md" packages/pi-flow-core/README.md && grep -n "modelTiers.capable" packages/pi-flow-core/README.md packages/pi-flow-core/docs/helper-runner.md` and confirm matches; run `grep -rn -i "model-tiers" packages/pi-flow-core/docs packages/pi-flow-core/README.md` and confirm zero matches.

**Model recommendation:** standard

### Task 10: Final naming-sweep guardrail and stop-string pins

**Files:**
- Modify: `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs`

**Steps:**
- [ ] **Step 1: Add the stop-string pin test.** New test `'refine skill flow-config stop strings are preserved byte-equal'`: read `skillPath('refine-plan')` and assert it includes `refine-plan requires ~/.pi/agent/flow.json — see flow config setup.`; read `skillPath('refine-code')` and assert it includes `refine-code requires ~/.pi/agent/flow.json — see flow config setup.`
- [ ] **Step 2: Add the naming-sweep test.** New test `'legacy flow configuration naming is absent from package source'` — the title deliberately uses flow-safe wording and MUST NOT contain the legacy config-file name or matrix wording, because the test file itself is package source and is scanned by both this test's own walk and the Step 4 acceptance grep. The test recursively walks `PKG_DIR`, skipping only directories named `node_modules` and `__pycache__` — `__tests__`, `tests`, `fixtures`, and `*.test.*` files are package source and are NOT excluded (after Tasks 1–9 they contain no legacy literals: fixtures are renamed `flow-*.json` and every test assertion uses the new naming). For every remaining file: assert its NAME does not match the legacy-name pattern, and its utf8 CONTENT matches neither legacy pattern. Build the patterns without embedding the banned literals in this test file — split-literal construction is the only permitted way for any test to reference the legacy terms, and it keeps both this test's self-scan and the repo-wide grep clean:

  ```js
  // Split literals so this test file itself never contains the banned strings.
  const LEGACY_FILE_NAME = new RegExp('model' + '-tier', 'i');
  const LEGACY_CONTENT = [
    new RegExp('model' + '-tiers', 'i'),
    new RegExp('model' + '[ ._-]' + 'matrix', 'i'),
  ];
  ```

  Use `readdirSync(dir, { withFileTypes: true })` for the walk and collect violations into an array; finish with `assert.deepEqual(violations, [], ...)` so failures list every offending path. The walk scans `guardrail-strings.test.mjs` itself; it passes because the flow-safe title and the split-literal patterns leave no contiguous banned string in the file.
- [ ] **Step 3: Run the guardrail suite** — `cd packages/pi-flow-core && node --test --experimental-strip-types __tests__/guardrail-strings.test.mjs` and confirm exit 0.
- [ ] **Step 4: Run the repo-equivalent of the acceptance sweep manually** — from the repo root run `grep -rli "model-tiers" packages/pi-flow-core | grep -v node_modules` and `grep -rliE "model[ ._-]matrix" packages/pi-flow-core | grep -v node_modules`; confirm BOTH produce empty output. Tests, fixtures, and `__tests__` are deliberately NOT excluded — they are package source, and with Step 2's flow-safe title and split-literal patterns nothing in them matches. Then run the full suite `cd /Users/david/Code/pi-flow && pnpm test` and confirm exit 0.

**Acceptance criteria:**

- The sweep test exists with the flow-safe title, walks package source skipping only `node_modules` and `__pycache__` (no test/fixture exclusions), and passes.
  Verify: run `cd packages/pi-flow-core && node --test --experimental-strip-types __tests__/guardrail-strings.test.mjs` and confirm exit 0; run `grep -n "legacy flow configuration naming is absent from package source" packages/pi-flow-core/__tests__/guardrail-strings.test.mjs | head -1` and confirm the test title appears; open the sweep test in that file and confirm its directory skip list is exactly `node_modules` and `__pycache__`, with no skip for `__tests__`, `tests`, `fixtures`, or `*.test.*` files.
- A case-insensitive search for the legacy config name and for matrix wording across package source — `__tests__`, `tests`, and `fixtures` included — returns no matches.
  Verify: run `grep -rli "model-tiers" packages/pi-flow-core | grep -v node_modules` and `grep -rliE "model[ ._-]matrix" packages/pi-flow-core | grep -v node_modules` and confirm both produce empty output.
- The two refine-skill stop strings are pinned byte-equal.
  Verify: run `grep -Fn 'refine-plan requires ~/.pi/agent/flow.json — see flow config setup.' packages/pi-flow-core/__tests__/guardrail-strings.test.mjs && grep -Fn 'refine-code requires ~/.pi/agent/flow.json — see flow config setup.' packages/pi-flow-core/__tests__/guardrail-strings.test.mjs` and confirm both match.
- The full package test suites pass after the cutover.
  Verify: run `cd /Users/david/Code/pi-flow && pnpm test` and confirm exit code 0 with no failing tests (this covers node:test suites and the Python unittest suites via the workspace `test` script, including `packages/pi-flow-core/package.json`'s `test:node` and `test:helpers`).

**Model recommendation:** standard

## Dependencies

- Task 1 depends on: (none)
- Task 2 depends on: (none)
- Task 3 depends on: (none)
- Task 4 depends on: Task 2 (the contract pins the exact templates the helpers emit)
- Task 5 depends on: Task 4
- Task 6 depends on: Task 4
- Task 7 depends on: Task 1, Task 3, Task 4 (Task 1 supplies `flow.example.json` used by Task 7's fill-helper verification)
- Task 8 depends on: Task 1, Task 3, Task 4 (Task 1 supplies `flow.example.json` used by Task 8's fill-helper verification)
- Task 9 depends on: Task 1, Task 2, Task 4
- Task 10 depends on: Task 5, Task 6, Task 7, Task 8, Task 9

Wave shape: Wave 1 = {1, 2, 3}; Wave 2 = {4}; Wave 3 = {5, 6, 7, 8, 9}; Wave 4 = {10}. Every wave ends with the full suite green: Wave 1 updates every test pinned to helper behavior alongside the helpers; Wave 2 re-points the guardrail template pins in the same task that swaps the contract files; Waves 3–4 change prose plus tests that only constrain prose.

## Risk Assessment

- **Self-hosted execution hazard (operational, highest risk).** This repository IS pi-flow's source, and the executing orchestrator resolves dispatches through an installed pi-flow copy (per the spec's acceptance criteria, installed copies live under `.pi/` and are out of scope). If — contrary to that assumption — the user's `pi-flow` shim resolves into THIS working tree, mid-plan dispatch resolution can break: after Wave 1 the working-tree helpers require `~/.pi/agent/flow.json` and section-qualified tier paths, while the orchestrator's in-context skill instructions still use the old shapes (or vice versa for freshly re-read protocol files like `test-runner-dispatch.md` after Wave 3). Mitigation: before executing this plan, (a) create `~/.pi/agent/flow.json` in the new five-section shape AND keep `~/.pi/agent/model-tiers.json` in place until the branch is merged and the session restarted — the two files coexist harmlessly because old and new helpers each read only their own file; (b) confirm `which pi-flow`/`readlink ~/.pi/agent/bin/pi-flow` points at an installed copy, not this checkout. If a mid-plan dispatch failure surfaces a canonical template anyway, it is recoverable: fix the runtime config or shim and retry the task.
- **Spec tension: migration mention vs. naming sweep.** Requirement 1 permits the setup doc to mention the old filename for the one-time migration, but acceptance criterion 1 demands zero `model-tiers` matches in package source. Resolution (this plan, Task 9): the migration section names every legacy KEY (`crossProvider`, `dispatch`, `coordinatorDispatch` — none of which are banned strings) but refers to the legacy FILE descriptively ("the legacy model-tier config file in `~/.pi/agent/`") without the hyphenated literal. The single known user loses nothing actionable; the mechanical sweep stays strict.
- **Byte-equal template drift across files.** The same eight templates appear in two helpers, the shared contract, the setup doc, and test pins. Mitigation: this plan centralizes them in `## Canonical strings`, every task copies from there, and Task 4/Task 9 verify with `grep -F` recipes; Task 10's suite run is the final cross-check. The em dash (U+2014) is called out explicitly because it is the most common silent-drift character.
- **Helper script filenames intentionally unchanged.** The spec requires renaming flags, docstrings, and wording — not the helper resource IDs. Renaming `resolve-model-dispatch.py`/`resolve-coordinator-dispatch.py` would ripple through every `pi-flow helper _shared/...` call site for zero spec value, so the names stay. The names contain neither `model-tiers` nor matrix wording, so the sweep passes.
- **Transient dangling references between Waves 2 and 3.** After Task 4 deletes the two shared contract files, the twelve dispatch sites still link to them until Wave 3 lands. No test pins those links, the suite stays green, and Wave 3 closes the gap; flagged here so reviewers don't treat it as an oversight.
- **`crossProvider.` prefix collisions in greps.** `crossProviderModelTiers.capable` does NOT contain the substring `crossProvider.` (the char after `crossProvider` is `M`), so the Task 6–8 verification greps using `crossProvider\.` are safe. Similarly `coordinatorSubagentDispatch` does not contain `coordinatorDispatch`.
- **Sweep test self-match.** The Task 10 sweep test is itself package source: its own walk and the spec's acceptance grep both scan it, so it must not contain the banned literals anywhere — including its test title. Handled twice over: the title uses flow-safe wording (`legacy flow configuration naming is absent from package source`), and every banned pattern is built via split-string concatenation (`new RegExp('model' + '-tiers', 'i')`), leaving no contiguous banned string in the file. Test files are NOT excluded from the walk, so the guardrail sweep stays exactly as strict as the spec's package-source criterion.
- **Fixture/test coupling forces one large Wave-1 task (Task 2, 13 files).** Splitting it would leave an intermediate wave with tests pointing at renamed fixtures or helpers emitting strings the tests don't expect. The task is mechanical with exact target content specified per file; `capable` model assigned to absorb the breadth.
- **Pi-backend guarded warning.** With `"executionPolicy": "guarded"` configured, every `cli: "pi"` hop will print pi-mux-subagents' one-line warning. This is accepted by the spec (uniform-injection decision) and documented in the contract and setup doc; it is not a defect.

## Test Command

```bash
pnpm test
```
