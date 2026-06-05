# Model-Tier Setup

## Why this file exists

`~/.pi/agent/model-tiers.json` is the runtime source of truth read by `pi-flow helper _shared/resolve-model-dispatch` and `pi-flow helper _shared/resolve-coordinator-dispatch`. The `model-tiers.example.json` file shipped in this package is a starting template only — it captures a working personal configuration as an example and is never read at runtime.

## First-time setup

Copy the example file to the expected runtime location:

```sh
cp node_modules/@aphotic/pi-flow-core/model-tiers.example.json ~/.pi/agent/model-tiers.json
```

If you have the package root handy (e.g. from `pi-flow template`), you can also resolve the path dynamically:

```sh
cp $(pi-flow template _shared/model-tier-resolution | sed 's|/skills/_shared/model-tier-resolution.md|/model-tiers.example.json|') ~/.pi/agent/model-tiers.json
```

Edit the copied file to match your actual model subscriptions and CLI setup before running any workflows — including the `coordinatorDispatch.modelChain` list, which must name models you can actually run under `pi`.

## Schema reference

`~/.pi/agent/model-tiers.json` must be valid JSON matching this shape:

```json
{
  "capable":  "<non-empty model string>",
  "standard": "<non-empty model string>",
  "cheap":    "<non-empty model string>",
  "crossProvider": {
    "capable":  "<non-empty model string>",
    "standard": "<non-empty model string>",
    "cheap":    "<non-empty model string>"
  },
  "dispatch": {
    "<provider-prefix>": "<cli-name>",
    "anthropic":         "claude",
    "openai-codex":      "codex"
  },
  "coordinatorDispatch": {
    "modelChain": ["<exact model id>", "..."]
  }
}
```

- Top-level tier keys (`capable`, `standard`, `cheap`) each map to a non-empty model string.
- The optional `crossProvider` object has the same three tier names, each mapping to a non-empty model string.
- The required `dispatch` object maps provider prefixes (e.g., `anthropic`, `openai-codex`) to leaf-worker CLI names (e.g., `claude`, `codex`). It may optionally route a provider to `pi`, but no leaf `dispatch` entry needs to resolve to `pi` for coordinator dispatch.
- The `coordinatorDispatch` object is required for coordinator workflows (`refine-plan`, `refine-code`) and is never read by leaf-only workflows (`scout`, `define-spec`, `generate-plan`, `execute-plan`, `requesting-code-review`, `fastlane`), which do not fail when it is absent. Its single required key `modelChain` is an ordered, non-empty array of exact model identifier strings (not tier aliases); a single-entry chain is valid. Unknown extra keys inside `coordinatorDispatch` are ignored.

### Why coordinator dispatch is separate

Coordinator agents (`plan-refiner`, `code-refiner`) must run under the `pi` CLI because the nested orchestration tools they depend on (`subagent_run_serial`) exist only there. That is a runtime-capability requirement, not a model preference — so it is a system invariant hardcoded by pi-flow, not a key in this file (there is no `cli` key inside `coordinatorDispatch`). The provider-prefix `dispatch` map answers a different question ("which CLI runs this provider's models for leaf workers?") and may legitimately route every provider away from `pi` (e.g. `anthropic → claude`, `openai-codex → codex`). `coordinatorDispatch.modelChain` names the coordinator models explicitly: entries are attempted in order via `subagent_run_serial` with `cli: "pi"`, each passed verbatim as the `model` parameter — no provider-prefix extraction and no `dispatch[<prefix>]` lookup occurs, and there is no up-front availability probing. If the section is missing or unusable, coordinator workflows fail hard with the templates below; there is no fallback to tier-based coordinator resolution. The full procedure lives in `skills/_shared/coordinator-dispatch.md`.

### Canonical error templates

Dispatch sites emit one of these four messages byte-equal when a required field is absent or unreadable:

**Template 1 — Missing/unreadable file:**

```
~/.pi/agent/model-tiers.json missing or unreadable — cannot dispatch <agent>.
```

**Template 2 — Missing/empty selected tier:**

```
model-tiers.json has no usable "<tier>" model — cannot dispatch <agent>.
```

**Template 3 — Missing `dispatch` map:**

```
model-tiers.json has no dispatch map — cannot dispatch <agent>.
```

**Template 4 — Missing/empty `dispatch.<provider>`:**

```
model-tiers.json has no dispatch.<provider> mapping for <tier> model <model> — cannot dispatch <agent>.
```

Parameters `<agent>`, `<tier>`, `<provider>`, and `<model>` are substituted verbatim by the consumer.

### Coordinator dispatch templates

Coordinator dispatch sites (`refine-plan`, `refine-code`) validate `coordinatorDispatch` via `pi-flow helper _shared/resolve-coordinator-dispatch`. The helper reuses Template 1 for a missing/unreadable file and adds two templates of its own; a final runtime-exhaustion template is emitted by the orchestrating procedure rather than the helper (see `skills/_shared/coordinator-dispatch.md`). `<agent>` is the coordinator agent name (`plan-refiner`, `code-refiner`).

**Missing `coordinatorDispatch` section:**

```
model-tiers.json has no coordinatorDispatch section — cannot dispatch <agent>.
```

**No usable `modelChain`** (missing, not an array, empty, or containing any non-string or empty entry):

```
model-tiers.json coordinatorDispatch has no usable modelChain — cannot dispatch <agent>.
```

**All `modelChain` entries failed at dispatch time:**

```
coordinator-dispatch: all coordinatorDispatch.modelChain models failed; last attempt: <model> via pi — <error>
```

## Verifying setup

Run the helper with a known tier and agent name:

```sh
pi-flow helper _shared/resolve-model-dispatch --tier capable --agent coder
```

Expected output shape:

```json
{"model": "...", "cli": "...", "provider": "...", "tier": "capable"}
```

If the file is missing or a required field is absent, the helper emits the corresponding canonical error template and exits non-zero.

Verify the coordinator section the same way:

```sh
pi-flow helper _shared/resolve-coordinator-dispatch --agent plan-refiner
```

Expected output shape:

```json
{"modelChain": ["..."], "cli": "pi"}
```

If `coordinatorDispatch` is missing or has no usable `modelChain`, the helper emits the corresponding canonical template and exits non-zero.

## What is NOT shipped

`pi-flow` does not write to `~/.pi/agent/model-tiers.json` on install and never overwrites an existing user file. The example file (`model-tiers.example.json`) is included in the package for reference only and is not read at runtime. You must create `~/.pi/agent/model-tiers.json` yourself before running any workflow that dispatches agents.
