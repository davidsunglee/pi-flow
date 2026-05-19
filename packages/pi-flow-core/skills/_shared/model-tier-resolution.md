# Model-Tier and Dispatch Resolution

## Why this exists

This document is the single source of truth for general worker and reviewer dispatch resolution. The strict-by-default policy means a missing `model-tiers.json`, a missing selected tier, a missing `dispatch` map, or a missing `dispatch.<provider>` entry stops with the corresponding canonical template — there is no silent fallback. Coordinator dispatch is governed by `skills/_shared/coordinator-dispatch.md` and uses these primitives but applies its own four-tier chain semantics.

## Input

The resolution inputs are read from `~/.pi/agent/model-tiers.json`.

Expected JSON shape:

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

## Primitive operations

1. **Tier-path resolution** — given a tier path that may be a top-level key (`capable`, `standard`, `cheap`) or a nested path (`crossProvider.cheap`, `crossProvider.standard`, `crossProvider.capable`), look up the corresponding non-empty model string from the parsed JSON.

2. **Provider-prefix extraction** — given a model string of shape `<provider>/<model-name>`, return the substring before the first `/` (e.g., `anthropic/claude-opus-4` → `anthropic`).

3. **Dispatch lookup** — given a provider prefix, look up `dispatch[<prefix>]` and return the resolved CLI string.

## Strict-by-default policy

Every general worker and reviewer dispatch site MUST stop on any of the four failure conditions listed in the next section. There is no silent fallback to `"pi"` (or any other CLI default) when the dispatch map or a provider entry is absent. Consumers emit the corresponding canonical template byte-equal after parameter substitution. Consumers do not extend, paraphrase, or wrap the templates.

## Failure-message templates

**Template (1) — Missing/unreadable file:**

```
~/.pi/agent/model-tiers.json missing or unreadable — cannot dispatch <agent>.
```

**Template (2) — Missing/empty selected tier:**

```
model-tiers.json has no usable "<tier>" model — cannot dispatch <agent>.
```

**Template (3) — Missing `dispatch` map:**

```
model-tiers.json has no dispatch map — cannot dispatch <agent>.
```

**Template (4) — Missing/empty `dispatch.<provider>`:**

```
model-tiers.json has no dispatch.<provider> mapping for <tier> model <model> — cannot dispatch <agent>.
```

Parameters `<agent>`, `<tier>`, `<provider>`, and `<model>` are substituted verbatim by the consumer. `<tier>` may be a nested path like `crossProvider.cheap` and is substituted as-is — for example, Template (2) becomes `model-tiers.json has no usable "crossProvider.cheap" model — cannot dispatch test-runner.` for the test-runner site.

## Coordinator dispatch

Coordinator agents (`code-refiner`, `plan-refiner`) MUST run on `pi` because they need subagent-orchestration tools (`subagent_run_serial` / `subagent_run_parallel`). The four-tier coordinator chain procedure, the skip-silently-on-non-pi rule, and the two hard-stop messages live in [./coordinator-dispatch.md](./coordinator-dispatch.md). This document supplies the primitive operations the coordinator chain consumes (tier-path resolution, provider-prefix extraction, `dispatch[<prefix>]` lookup) but does not duplicate the chain semantics.

Worker re-resolution inside coordinator prompts uses the strict canonical policy from this document. The coordinator-dispatch file's `## Note on worker subagents` section enforces this.

## Skill-specific fallback chains

The following skill-local fallback chains are explicitly approved. Audits should treat these as intentional, not as stale duplicated general-resolution algorithms.

- **`skills/refine-plan/refine-plan-prompt.md` plan-reviewer pair:** primary `crossProvider.capable`, fallback `capable`. This chain is owned by the named file and is not a general-resolution fallback. When the primary dispatch (`crossProvider.capable`) fails, the skill falls back to `capable` before hard-stopping.

`skills/refine-code/refine-code-prompt.md` does **not** use a primary/fallback chain. Its `crossProvider.capable` (first-pass/final-verification), `standard` (hybrid re-review), and `capable` (remediator) are role-to-tier mappings, not a fallback chain.

## Use from consumers

A consumer references this document, supplies the values of `<agent>` and `<tier>` for its dispatch site, and emits the corresponding template byte-equal on each failure condition. Consumers MUST NOT inline the algorithm or paraphrase the templates. Consumers MAY retain their own role-to-tier mappings, retry/escalation rules, or provenance-validation rules separately.

Current consumers:

- `skills/scout/SKILL.md` Step 2
- `skills/define-spec/SKILL.md` Step 3a
- `skills/generate-plan/SKILL.md` Step 2
- `skills/execute-plan/SKILL.md` Step 6 (including the test-runner subsection and Step 11.2 verifier dispatch)
- `skills/requesting-code-review/SKILL.md` Step 2b
- `skills/refine-code/SKILL.md` Step 6
- `skills/refine-code/refine-code-prompt.md`
- `skills/refine-plan/SKILL.md` Step 9.5
- `skills/refine-plan/refine-plan-prompt.md`
