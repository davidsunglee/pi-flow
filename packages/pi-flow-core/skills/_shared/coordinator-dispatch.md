# Coordinator dispatch resolution

## Why this exists

A coordinator (`code-refiner` or `plan-refiner`) must run on a `pi` CLI because `subagent_run_serial` is exposed only on `pi`; without `pi`, the coordinator cannot dispatch its workers. The Pi requirement is a system invariant, not user configuration: coordinator dispatch hardcodes `cli: "pi"` and there is no `cli` key to configure. Coordinator dispatch is therefore decoupled from the leaf-worker tier→provider→`dispatch[<prefix>]` path — a perfectly valid leaf-worker `dispatch` map (e.g. `anthropic → claude`, `openai-codex → codex`) needs no entry resolving to `pi`. Instead, the coordinator model chain is named explicitly in the `coordinatorDispatch` section of `~/.pi/agent/model-tiers.json` (see `docs/model-tier-setup.md` for the schema). When that section is missing or unusable, a hard stop is the only correct outcome — silently falling back to tier-based coordinator resolution or to an inline review is forbidden, as it conceals a broken dispatch path.

## Procedure

1. Run `pi-flow helper _shared/resolve-coordinator-dispatch --agent <agent>`, where `<agent>` is the coordinator agent name (`plan-refiner` or `code-refiner`). The helper reads `~/.pi/agent/model-tiers.json`, validates the `coordinatorDispatch` section wholesale (no entry-skipping), and on success prints `{"modelChain": [...], "cli": "pi"}` on stdout.
2. If the helper exits non-zero, surface its stderr message verbatim — it is one of the canonical templates in `## Hard-stop conditions` below — and do NOT dispatch. There is no fallback to tier-based coordinator resolution under any failure.
3. On success, attempt the coordinator dispatch for each `modelChain` entry in order via `subagent_run_serial` with that entry passed verbatim as `model` (entries are exact model identifiers, not tier aliases — no provider-prefix extraction and no `dispatch[<prefix>]` lookup occurs) and `cli: "pi"`. There is no up-front availability probing. On dispatch failure (model unavailable, transport error, etc.), record the failure and advance to the next entry.
4. Stop iterating when a dispatch succeeds. The successful `(model, "pi")` pair is the outcome of the procedure; the caller uses those exact values for its `subagent_run_serial` task.

## Hard-stop conditions

The first three templates are emitted by the validation helper on stderr (non-zero exit) and MUST be surfaced verbatim by the caller. The fourth is emitted by the orchestrating procedure itself, because only the orchestrating session can attempt `subagent_run_serial`. `<agent>` is substituted with the coordinator agent name (`plan-refiner`, `code-refiner`).

- **File missing/unreadable** (shared canonical Template 1):
  `~/.pi/agent/model-tiers.json missing or unreadable — cannot dispatch <agent>.`
- **Missing `coordinatorDispatch` section** (absent or not a JSON object):
  `model-tiers.json has no coordinatorDispatch section — cannot dispatch <agent>.`
- **No usable `modelChain`** (missing, not an array, empty, or containing any non-string or empty entry — rejected wholesale, no entry-skipping):
  `model-tiers.json coordinatorDispatch has no usable modelChain — cannot dispatch <agent>.`
- **All `modelChain` entries failed at dispatch time** — every entry was attempted and every dispatch failed. The caller MUST surface the error verbatim, substituting `<model>` with the last attempted entry and `<error>` with the underlying dispatch error message:
  `coordinator-dispatch: all coordinatorDispatch.modelChain models failed; last attempt: <model> via pi — <error>`

## Note on worker subagents

Workers dispatched inside the coordinator (e.g., `code-reviewer`, `coder`, `plan-reviewer`, `planner` edit-pass) do NOT need to run on `pi` and do NOT read `coordinatorDispatch`. The coordinator MUST re-resolve `cli` for each worker dispatch — see the per-coordinator prompt for the worker-dispatch tier assignments. Worker re-resolution follows the strict procedure in [model-tier-resolution.md](./model-tier-resolution.md): there is no silent default to `pi` (or any other CLI) when a dispatch entry is missing. The four canonical failure templates in that document are the only sanctioned outcomes when worker re-resolution fails. This shared procedure governs the coordinator hop only.
