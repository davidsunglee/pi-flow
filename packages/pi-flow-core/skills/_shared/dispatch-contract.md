# Dispatch contract

## Why this exists

This file is the single authority for every pi-flow workflow dispatch: the runtime config schema, the task-entry shape, the flow.json → dispatch-parameter mapping, the executionPolicy injection rule, the canonical hard-stop templates, and the coordinator dispatch procedure. Dispatch sites reference this file and supply only site-specific variation (agent name, prompt, role→tier mapping, serial vs parallel, per-site extras). Consolidating here shrinks future contract changes — and an eventual subagent-framework swap — from a twelve-site sweep to one contract plus the two resolution helpers.

## Input: resolved flow config

The dispatch inputs are read from the resolved flow config — explicit `--flow-config` override, else project-local `<working-dir>/.pi/flow.json`, else user/global `~/.pi/agent/flow.json`. See [flow-config-resolution.md](flow-config-resolution.md) for the precedence and selection contract.

Expected JSON shape:

```json
{
  "modelTiers": {
    "frontier": "<non-empty model string>",
    "capable":  "<non-empty model string>",
    "standard": "<non-empty model string>",
    "efficient": "<non-empty model string>"
  },
  "crossProviderModelTiers": {
    "frontier": "<non-empty model string>",
    "capable":  "<non-empty model string>",
    "standard": "<non-empty model string>",
    "efficient": "<non-empty model string>"
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

- `modelTiers` is required when consumed: each tier key (`frontier`, `capable`, `standard`, `efficient`) maps to a non-empty model string.
- The optional `crossProviderModelTiers` object has the same four tier names, each mapping to a non-empty model string.
- The required `subagentDispatch` object maps provider prefixes (e.g., `anthropic`, `openai-codex`) to CLI names (e.g., `claude`, `codex`).
- The `coordinatorSubagentDispatch` object is read only by coordinator dispatch (see `## Coordinator dispatch procedure` below): `modelChain` entries are ordered exact model identifiers, not tier aliases. There is no `cli` key — the coordinator CLI is a system invariant (`pi`).
- `executionPolicy` is required and must be exactly `"guarded"` or `"unrestricted"`. There is no silent default.

## Task-entry shape

Every pi-flow workflow dispatch via `subagent_run_serial` / `subagent_run_parallel` uses task entries shaped:

```
{ name, agent, task, model, cli, executionPolicy }
```

Per-site extras (e.g., fastlane's `thinking: "high"`, define-spec's `systemPrompt`) remain expressible at the call site. `wait` is a top-level orchestration option, not a per-task field.

## flow.json → dispatch-parameter mapping

### Leaf dispatch

Run `pi-flow helper _shared/resolve-model-dispatch --model-tier <tier> --agent <agent>`. The helper resolves the section-qualified tier path to `model`, extracts the provider prefix, looks up `subagentDispatch[<prefix>]` for `cli`, validates `executionPolicy`, and prints `{"model", "cli", "provider", "tier", "executionPolicy"}` — the complete envelope. The site copies `model`, `cli`, and `executionPolicy` into its task entry with no second config read. Sites with a known workspace root pass `--working-dir <dir>` so project-local `.pi/flow.json` is honored; top-level sites may rely on the cwd default (see [flow-config-resolution.md](flow-config-resolution.md)).

### Coordinator dispatch

Run `pi-flow helper _shared/resolve-coordinator-dispatch --agent <agent>`. The helper validates `coordinatorSubagentDispatch` wholesale (no entry-skipping) and prints `{"modelChain", "cli": "pi", "executionPolicy"}`. The caller attempts each `modelChain` entry in order via `subagent_run_serial` with that entry passed verbatim as `model` (no provider-prefix extraction, no `subagentDispatch` lookup), `cli: "pi"`, and the envelope's `executionPolicy`, stopping at the first success.

## executionPolicy injection rule

Every pi-flow workflow dispatch task entry passes the resolved `executionPolicy` explicitly. The rule is uniform and exception-free: it applies to leaf workers, to the `cli: "pi"` coordinator hops, and to worker dispatches issued from inside coordinator prompts. The pi backend has no guarded mode — an explicitly passed `"guarded"` emits a one-line warning and runs unrestricted; that warning is expected and benign, and uniform injection starts working automatically if pi ever gains a guarded mode. No site may omit the parameter or inject it conditionally.

## Primitive operations

1. **Tier-path resolution** — given a section-qualified tier path (`modelTiers.frontier`, `modelTiers.capable`, `modelTiers.standard`, `modelTiers.efficient`, `crossProviderModelTiers.frontier`, `crossProviderModelTiers.capable`, `crossProviderModelTiers.standard`, `crossProviderModelTiers.efficient`), look up the corresponding non-empty model string from the parsed JSON.

2. **Provider-prefix extraction** — given a model string of shape `<provider>/<model-name>`, return the substring before the first `/` (e.g., `anthropic/claude-opus-4` → `anthropic`).

3. **subagentDispatch lookup** — given a provider prefix, look up `subagentDispatch[<prefix>]` and return the resolved CLI string.

## Strict-by-default policy

Every dispatch site MUST stop on any of the failure conditions listed in `## Canonical templates` below. There is no silent fallback to `"pi"` (or any other CLI default) when the dispatch map or a provider entry is absent, and no silent executionPolicy default. Consumers emit the corresponding canonical template byte-equal after parameter substitution and MUST NOT extend, paraphrase, or wrap the templates.

## Canonical templates

**Leaf templates** (emitted by `resolve-model-dispatch.py`; Templates (1) and (5) are shared with `resolve-coordinator-dispatch.py`):

**Template (1) — Missing/unreadable file:**

```
flow.json missing or unreadable; searched <locations> — cannot dispatch <agent>.
```

**Template (2) — Missing/empty selected tier:**

```
flow.json has no usable "<tier>" model — cannot dispatch <agent>.
```

**Template (3) — Missing `subagentDispatch` map:**

```
flow.json has no subagentDispatch map — cannot dispatch <agent>.
```

**Template (4) — Missing/empty `subagentDispatch.<provider>`:**

```
flow.json has no subagentDispatch.<provider> mapping for <tier> model <model> — cannot dispatch <agent>.
```

**Template (5) — Missing/invalid `executionPolicy`:**

```
flow.json has no usable executionPolicy ("guarded" or "unrestricted") — cannot dispatch <agent>.
```

**Coordinator templates** (the first two emitted by `resolve-coordinator-dispatch.py`, which also reuses Templates (1) and (5); the third emitted by the orchestrating procedure, because only the orchestrating session can attempt `subagent_run_serial`):

**Missing `coordinatorSubagentDispatch` section** (absent or not a JSON object):

```
flow.json has no coordinatorSubagentDispatch section — cannot dispatch <agent>.
```

**No usable `modelChain`** (missing, not an array, empty, or containing any non-string or empty entry — rejected wholesale, no entry-skipping):

```
flow.json coordinatorSubagentDispatch has no usable modelChain — cannot dispatch <agent>.
```

**All `modelChain` entries failed at dispatch time** (every entry was attempted and every dispatch failed):

```
coordinator-dispatch: all coordinatorSubagentDispatch.modelChain models failed; last attempt: <model> via pi — <error>
```

Parameters `<agent>`, `<tier>`, `<provider>`, `<model>`, and `<error>` are substituted verbatim by the consumer. `<tier>` is a section-qualified path like `crossProviderModelTiers.efficient` and is substituted as-is — for example, Template (2) becomes `flow.json has no usable "crossProviderModelTiers.efficient" model — cannot dispatch test-runner.` for the test-runner site.

## Coordinator dispatch procedure

A coordinator (`plan-refiner` or `code-refiner`) must run on a `pi` CLI because nested subagent-orchestration tools (`subagent_run_serial` / `subagent_run_parallel`) are exposed only on `pi`; without `pi`, the coordinator cannot dispatch its workers. The Pi requirement is a system invariant, not user configuration: coordinator dispatch hardcodes `cli: "pi"` and there is no `cli` key to configure. Coordinator dispatch is therefore decoupled from the leaf tier→provider→`subagentDispatch[<prefix>]` path — a perfectly valid leaf `subagentDispatch` map (e.g. `anthropic → claude`, `openai-codex → codex`) needs no entry resolving to `pi`. Instead, the coordinator model chain is named explicitly in the `coordinatorSubagentDispatch` section of the resolved flow config. When that section is missing or unusable, a hard stop is the only correct outcome — silently falling back to tier-based coordinator resolution or to an inline review is forbidden, as it conceals a broken dispatch path.

Procedure:

1. Run `pi-flow helper _shared/resolve-coordinator-dispatch --agent <agent>`, where `<agent>` is the coordinator agent name (`plan-refiner` or `code-refiner`). The helper reads the resolved flow config, validates the `coordinatorSubagentDispatch` section wholesale (no entry-skipping), and on success prints `{"modelChain": [...], "cli": "pi", "executionPolicy": ...}` on stdout.
2. If the helper exits non-zero, surface its stderr message verbatim — it is one of the canonical templates in `## Canonical templates` above — and do NOT dispatch. There is no fallback to tier-based coordinator resolution under any failure.
3. On success, attempt the coordinator dispatch for each `modelChain` entry in order via `subagent_run_serial` with that entry passed verbatim as `model` (entries are exact model identifiers, not tier aliases — no provider-prefix extraction and no `subagentDispatch[<prefix>]` lookup occurs), `cli: "pi"`, and the envelope's `executionPolicy`. There is no up-front availability probing. On dispatch failure (model unavailable, transport error, etc.), record the failure and advance to the next entry.
4. Stop iterating when a dispatch succeeds. The successful `(model, "pi")` pair is the outcome of the procedure; the caller uses those exact values for its `subagent_run_serial` task.

If every `modelChain` entry was attempted and every dispatch failed, the caller MUST emit the exhaustion template from `## Canonical templates` byte-equal, substituting `<model>` with the last attempted entry and `<error>` with the underlying dispatch error message.

### Note on worker subagents

Workers dispatched inside the coordinator (e.g., `code-reviewer`, `coder`, `plan-reviewer`, `planner` edit-pass) do NOT need to run on `pi` and do NOT read `coordinatorSubagentDispatch`. The coordinator MUST re-resolve each worker via the leaf path in `## flow.json → dispatch-parameter mapping` above and pass the leaf envelope's `cli` and `executionPolicy` explicitly — there is no silent default to `pi` (or any other CLI) when a dispatch entry is missing. The canonical leaf templates are the only sanctioned outcomes when worker re-resolution fails. The coordinator dispatch procedure governs the coordinator hop only; see the per-coordinator prompt for the worker-dispatch tier assignments.

## Skill-specific fallback chains

The following skill-local fallback chains are explicitly approved. Audits should treat these as intentional, not as stale duplicated general-resolution algorithms.

- **`skills/refine-plan/refine-plan-prompt.md` plan-reviewer pair:** primary `crossProviderModelTiers.capable`, fallback `modelTiers.capable`. This chain is owned by the named file and is not a general-resolution fallback. When the primary dispatch (`crossProviderModelTiers.capable`) fails, the skill falls back to `modelTiers.capable` before hard-stopping.

`skills/refine-code/refine-code-prompt.md` does **not** use a primary/fallback chain. Its `crossProviderModelTiers.capable` (first-pass/final-verification), `modelTiers.standard` (hybrid re-review), and `modelTiers.capable` (remediator) are role-to-tier mappings, not a fallback chain.

## Use from consumers

A consumer references this document, supplies the values of `<agent>` and `<tier>` for its dispatch site, and emits the corresponding template byte-equal on each failure condition. Consumers MUST NOT inline the algorithm or paraphrase the templates. Consumers MAY retain their own role-to-tier mappings, retry/escalation rules, or provenance-validation rules separately.

Current dispatch sites:

- `skills/scout/SKILL.md` Step 2
- `skills/define-spec/SKILL.md` Step 3a
- `skills/generate-plan/SKILL.md` Step 2
- `skills/execute-plan/SKILL.md` Step 6
- `skills/execute-plan/acceptance-criteria-verification.md`
- `skills/_shared/test-runner-dispatch.md`
- `skills/requesting-code-review/SKILL.md` Step 2b
- `skills/fastlane/SKILL.md` Step 4
- `skills/refine-plan/SKILL.md` Step 8
- `skills/refine-code/SKILL.md` Step 4
- `skills/refine-plan/refine-plan-prompt.md`
- `skills/refine-code/refine-code-prompt.md`
