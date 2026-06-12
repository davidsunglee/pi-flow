# Flow Config Setup

## Why this file exists

The runtime source of truth is the *resolved* flow config, located by pi-flow in precedence order: an explicit `--flow-config` override, then a project-local `<working-dir>/.pi/flow.json`, then the user/global `~/.pi/agent/flow.json`. The resolved config is what `pi-flow helper _shared/resolve-model-dispatch` and `pi-flow helper _shared/resolve-coordinator-dispatch` read. The packaged `flow.example.json` is a starting template only — it captures a working personal configuration as an example and is never read at runtime. See [`../skills/_shared/flow-config-resolution.md`](../skills/_shared/flow-config-resolution.md) for the full resolution algorithm.

## First-time setup

`~/.pi/agent/flow.json` is the user/global location — the fallback used when no project-local config is present. A project may instead carry `<project>/.pi/flow.json` to pin dispatch config to a project-scoped pi-flow install; this file takes precedence over the user/global location for any workflow run from within that project directory.

Copy the example file to whichever location fits your setup:

```sh
# User/global location (fallback for all projects)
cp node_modules/@aphotic/pi-flow-core/flow.example.json ~/.pi/agent/flow.json

# Project-local location (pins dispatch config to this project)
cp node_modules/@aphotic/pi-flow-core/flow.example.json .pi/flow.json
```

If you have the package root handy (e.g. from `pi-flow template`), you can also resolve the path dynamically:

```sh
cp $(pi-flow template _shared/dispatch-contract | sed 's|/skills/_shared/dispatch-contract.md|/flow.example.json|') ~/.pi/agent/flow.json
```

Edit the copied file to match your actual model subscriptions and CLI setup before running any workflows — including the `coordinatorSubagentDispatch.modelChain` list, which must name models you can actually run under `pi`.

## Schema reference

`~/.pi/agent/flow.json` must be valid JSON matching this shape:

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

- `modelTiers` — required when consumed by leaf dispatch; each of the four tier names (`frontier`, `capable`, `standard`, `efficient`) must map to a non-empty model string.
- `crossProviderModelTiers` — optional; same four tier names, each mapping to a non-empty model string for cross-provider model selection.
- `subagentDispatch` — required; maps provider prefixes (e.g. `anthropic`, `openai-codex`) to leaf-worker CLI names (e.g. `claude`, `codex`).
- `coordinatorSubagentDispatch` — read only by coordinator dispatch (`refine-plan`, `refine-code`). Its `modelChain` is an ordered array of exact model identifier strings (not tier aliases); no `cli` key — the coordinator CLI is a system invariant (`pi`).
- `executionPolicy` — required; must be exactly `"guarded"` or `"unrestricted"` with no silent default. pi-flow injects it explicitly on every workflow dispatch.

### executionPolicy backend semantics

The value you set here propagates to each dispatched CLI:

- **Claude** (`cli: "claude"`): `guarded` → `--permission-mode auto`; `unrestricted` → `--dangerously-skip-permissions` (pane) / `--permission-mode bypassPermissions` (headless).
- **Codex** (`cli: "codex"`): `guarded` → `--sandbox workspace-write` plus approval-policy behavior; `unrestricted` → `--dangerously-bypass-approvals-and-sandbox`.
- **pi** (`cli: "pi"`): the `pi` backend has no guarded mode — an explicitly passed `"guarded"` emits a one-line warning and runs unrestricted. This is expected and benign on coordinator hops and does not indicate misconfiguration.

### Why coordinator dispatch is separate

Coordinator agents (`plan-refiner`, `code-refiner`) must run under the `pi` CLI because the nested orchestration tools they depend on (`subagent_run_serial`) exist only there. That is a runtime-capability requirement, not a model preference — so it is a system invariant hardcoded by pi-flow, not a key in this file (there is no `cli` key inside `coordinatorSubagentDispatch`). The `subagentDispatch` map answers a different question ("which CLI runs this provider's models for leaf workers?") and may legitimately route every provider away from `pi`. `coordinatorSubagentDispatch.modelChain` names the coordinator models explicitly: entries are attempted in order via `subagent_run_serial` with `cli: "pi"`, each passed verbatim as the `model` parameter — no provider-prefix extraction and no `subagentDispatch` lookup occurs, and there is no up-front availability probing. The full procedure lives in `skills/_shared/dispatch-contract.md`.

### Canonical error templates

Dispatch sites emit one of these messages byte-equal when a required field is absent or unreadable.

**Leaf templates** (emitted by `resolve-model-dispatch.py`):

**Template 1 — Missing/unreadable file:**

```
flow.json missing or unreadable; searched <locations> — cannot dispatch <agent>.
```

The bare `resolve-flow-config` helper (invoked without an agent context) emits: `flow.json missing or unreadable; searched <locations>.` In both forms, `<locations>` renders the full list of searched paths comma-space separated, with the home directory prefix abbreviated as `~`.

**Template 2 — Missing/empty selected tier:**

```
flow.json has no usable "<tier>" model — cannot dispatch <agent>.
```

**Template 3 — Missing `subagentDispatch` map:**

```
flow.json has no subagentDispatch map — cannot dispatch <agent>.
```

**Template 4 — Missing/empty `subagentDispatch.<provider>`:**

```
flow.json has no subagentDispatch.<provider> mapping for <tier> model <model> — cannot dispatch <agent>.
```

**Template 5 — Missing/invalid `executionPolicy`:**

```
flow.json has no usable executionPolicy ("guarded" or "unrestricted") — cannot dispatch <agent>.
```

**Coordinator templates** (emitted by `resolve-coordinator-dispatch.py` and the orchestrating procedure):

**Missing `coordinatorSubagentDispatch` section:**

```
flow.json has no coordinatorSubagentDispatch section — cannot dispatch <agent>.
```

**No usable `modelChain`:**

```
flow.json coordinatorSubagentDispatch has no usable modelChain — cannot dispatch <agent>.
```

**All `modelChain` entries failed at dispatch time** (emitted by the orchestrating procedure, not the helper):

```
coordinator-dispatch: all coordinatorSubagentDispatch.modelChain models failed; last attempt: <model> via pi — <error>
```

Parameters `<agent>`, `<tier>`, `<provider>`, `<model>`, and `<error>` are substituted verbatim by the consumer.

## Verifying setup

### Checking the active flow config

To see which config is active for the current working directory, run the `resolve-flow-config` helper:

```sh
pi-flow helper _shared/resolve-flow-config --working-dir .
```

Expected output shape:

```json
{"path": "...", "scope": "project|user|explicit", "searched": ["..."]}
```

- `path` — the absolute path of the resolved config file.
- `scope` — `project` (from `<working-dir>/.pi/flow.json`), `user` (from `~/.pi/agent/flow.json`), or `explicit` (from `--flow-config` override).
- `searched` — ordered list of locations checked, for transparency.

### Checking dispatch resolution

Run the leaf helper with a known tier and agent name:

```sh
pi-flow helper _shared/resolve-model-dispatch --model-tier modelTiers.capable --agent coder
```

Expected output shape:

```json
{"model": "...", "cli": "...", "provider": "...", "tier": "modelTiers.capable", "executionPolicy": "guarded"}
```

If the file is missing or a required field is absent, the helper emits the corresponding canonical error template and exits non-zero.

Verify the coordinator section the same way:

```sh
pi-flow helper _shared/resolve-coordinator-dispatch --agent plan-refiner
```

Expected output shape:

```json
{"modelChain": ["..."], "cli": "pi", "executionPolicy": "guarded"}
```

If `coordinatorSubagentDispatch` is missing or has no usable `modelChain`, the helper emits the corresponding canonical template and exits non-zero.

## Migrating from the legacy model-tier config

This is a one-time, user-performed migration — pi-flow provides no code assistance or dual-read. Do it once, then delete the old file.

1. Rename the legacy model-tier config file in `~/.pi/agent/` to `flow.json`.

2. Apply the key mapping table:

   | Legacy key | `flow.json` key |
   |---|---|
   | top-level `capable` / `standard` / `efficient` | `modelTiers.capable` / `.standard` / `.efficient` |
   | `crossProvider` | `crossProviderModelTiers` |
   | `dispatch` | `subagentDispatch` |
   | `coordinatorDispatch` | `coordinatorSubagentDispatch` |
   | (absent) | `executionPolicy` — required, `"guarded"` or `"unrestricted"` |

3. Add `"executionPolicy": "guarded"` at the top level (or `"unrestricted"` for a trusted single-user setup where you want to skip permission prompts).

4. Run a workflow dispatch to confirm it succeeds, then delete the legacy file.

## What is NOT shipped

`pi-flow` does not write `~/.pi/agent/flow.json` on install and never overwrites an existing user file. The example file (`flow.example.json`) is included in the package for reference only and is never read at runtime. You must create `~/.pi/agent/flow.json` yourself before running any workflow that dispatches agents.
