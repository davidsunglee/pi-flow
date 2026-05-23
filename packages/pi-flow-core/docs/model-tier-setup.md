# Model-Tier Setup

## Why this file exists

`~/.pi/agent/model-tiers.json` is the runtime source of truth read by `pi-flow helper _shared/resolve-model-dispatch`. The `model-tiers.example.json` file shipped in this package is a starting template only — it captures a working personal configuration as an example and is never read at runtime.

## First-time setup

Copy the example file to the expected runtime location:

```sh
cp node_modules/@aphotic/pi-flow-core/model-tiers.example.json ~/.pi/agent/model-tiers.json
```

If you have the package root handy (e.g. from `pi-flow template`), you can also resolve the path dynamically:

```sh
cp $(pi-flow template _shared/model-tier-resolution | sed 's|/skills/_shared/model-tier-resolution.md|/model-tiers.example.json|') ~/.pi/agent/model-tiers.json
```

Edit the copied file to match your actual model subscriptions and CLI setup before running any workflows.

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
    "openai-codex":      "pi"
  }
}
```

- Top-level tier keys (`capable`, `standard`, `cheap`) each map to a non-empty model string.
- The optional `crossProvider` object has the same three tier names, each mapping to a non-empty model string.
- The required `dispatch` object maps provider prefixes (e.g., `anthropic`, `openai-codex`) to CLI names (e.g., `claude`, `pi`).

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

## What is NOT shipped

`pi-flow` does not write to `~/.pi/agent/model-tiers.json` on install and never overwrites an existing user file. The example file (`model-tiers.example.json`) is included in the package for reference only and is not read at runtime. You must create `~/.pi/agent/model-tiers.json` yourself before running any workflow that dispatches agents.
