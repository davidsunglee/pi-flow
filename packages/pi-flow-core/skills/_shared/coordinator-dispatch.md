# Coordinator dispatch resolution

## Why this exists

A coordinator (`code-refiner` or `plan-refiner`) must run on a `pi` CLI because `subagent_run_serial` is exposed only on `pi`; without `pi`, the coordinator cannot dispatch its workers. If no model tier in the resolution chain resolves to a `pi` CLI, a hard-stop is the only correct outcome — silently falling back to an inline review is forbidden, as it conceals a broken dispatch path. Non-`pi` tiers are skipped silently rather than warned-on because warning on every non-`pi` tier in the chain would be noisy and would obscure the real failure case: that no tier resolves to `pi` at all.

## Procedure

1. Iterate the four model tiers in this fixed order (literal chain: crossProvider.standard, standard, crossProvider.capable, capable): `crossProvider.standard`, `standard`, `crossProvider.capable`, `capable`. No other tiers (no `cheap`, no future additions) participate in this chain.
2. For the tier-path resolution, provider-prefix extraction, and `dispatch[<prefix>]` lookup, follow the primitives in [model-tier-resolution.md](./model-tier-resolution.md). The chain semantics below are coordinator-specific. For each tier, resolve the concrete model string from `~/.pi/agent/model-tiers.json` (e.g., `crossProvider.standard` → `openai-codex/gpt-5.4`); extract the provider prefix as the substring before the first `/` (e.g., `openai-codex`); look up `dispatch[<prefix>]` in the same JSON (e.g., `dispatch["openai-codex"]` → `pi`). If the resolved `cli` is not `pi`, skip this tier silently — emit no warning, attempt no dispatch, advance to the next tier.
3. For each tier whose resolved `cli` is `pi`, attempt the coordinator dispatch via `subagent_run_serial` with that `model` and `cli: "pi"`. On dispatch failure (model unavailable, transport error, etc.), record the failure and advance to the next tier in the chain.
4. Stop iterating when a dispatch succeeds. The successful `(model, cli)` pair is the outcome of the procedure; the caller uses those exact values for its `subagent_run_serial` task.

## Hard-stop conditions

- **No tier resolves to `pi`** — the chain is exhausted with zero tiers attempted (every tier's resolved `cli` was non-`pi` and got silently skipped). The caller MUST surface the error verbatim:
  `coordinator-dispatch: no model tier in [crossProvider.standard, standard, crossProvider.capable, capable] resolves to a pi CLI — coordinator cannot dispatch subagents.`
- **All `pi`-eligible tiers failed** — at least one tier had `cli == "pi"` and was attempted, but every attempted dispatch failed. The caller MUST surface the error verbatim, substituting `<model>` with the model string of the last attempted tier and `<error>` with the underlying dispatch error message:
  `coordinator-dispatch: all pi-eligible tiers failed; last attempt: <model> via pi — <error>`

## Note on worker subagents

Workers dispatched inside the coordinator (e.g., `code-reviewer`, `coder`, `plan-reviewer`, `planner` edit-pass) do NOT need to run on `pi`. The coordinator MUST re-resolve `cli` for each worker dispatch — see the per-coordinator prompt for the worker-dispatch tier assignments. Worker re-resolution follows the strict procedure in [model-tier-resolution.md](./model-tier-resolution.md): there is no silent default to `pi` (or any other CLI) when a dispatch entry is missing. The four canonical failure templates in that document are the only sanctioned outcomes when worker re-resolution fails. This shared procedure governs the coordinator hop only.
