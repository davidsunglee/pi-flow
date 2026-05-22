---
name: scout
description: "Non-interactive task-scoped codebase reconnaissance. Dispatches the scout subagent to write a structured brief to docs/briefs/, then gates the resulting file on user review and commit."
---

# Scout

This skill orchestrates a fresh-context scout subagent that writes a structured brief to `docs/briefs/`. The brief slots into the existing `Scout brief:` provenance contract that `define-spec`, `generate-plan`, `planner`, and `plan-reviewer` already consume.

## Step 1: Detect input shape and parse --tier

### Input shape detection

Examine the user's slash-command input (excluding any `--tier` argument) and classify it as one of two shapes:

**Idea branch** — after trimming surrounding whitespace and lowercasing the input, the result matches the regex `^IDEA-([0-9a-f]{8})$` case-insensitively (so `IDEA-BBE89373`, `idea-bbe89373`, and `IDEA-bbe89373` all match, resolving to canonical lowercase `bbe89373`). The captured raw id is the 8-char lowercase hex segment.

- Extract `<raw-id>` from the captured group (e.g., `IDEA-bbe89373` → `bbe89373`, `IDEA-BBE89373` → `bbe89373`).
- Set the brief output path to `docs/briefs/IDEA-<raw-id>-brief.md`.
- Call the built-in `idea` tool with `action: "read"`, `id: "<raw-id>"` to fetch the artifact. The tool's `details` payload contains a structured `IdeaArtifact` object (`id`, `title`, `tags`, `status`, `createdAt`, `body`). Use `details.title` as the idea title and `details.body` as the body. If the title is empty, fall back to the first `# ` heading in the body that is outside any fenced code block (skip lines between matching ` ``` ` fences so headings inside examples cannot be selected). If neither source yields a non-empty title, stop with `IDEA-<raw-id> has no usable title — cannot dispatch scout.` Pass the full body through to the prompt as `{IDEA_BODY_OR_FREEFORM_TEXT}`.

**Freeform branch** — any input that does not match the idea regex.

- Derive a kebab-case slug from the seed text (lowercase, spaces and punctuation replaced by hyphens, leading/trailing hyphens removed, max ~40 characters).
- Set the brief output path to `docs/briefs/<YYYY-MM-DD>-<slug>-brief.md` using today's date in UTC (e.g., `2026-05-06`).
- Use the seed text as the task body.

### `--tier` parsing

Scan the slash-command input for an optional `--tier <name>` argument at any position. Recognized values: `cheap`, `standard`, `capable`. Default tier is `standard` when the argument is absent or the input is empty.

If `--tier` is present with a value not in the recognized set, the resolution step will fail with Template (2) when the tier is looked up, so no special handling is needed here.

## Step 2: Resolve model and CLI

Run `pi-flow helper _shared/resolve-model-dispatch --tier <tier> --agent scout` (where `<tier>` is the value parsed in Step 1, defaulting to `standard`). The full resolution procedure is documented in [`skills/_shared/model-tier-resolution.md`](../_shared/model-tier-resolution.md). On any failure the script exits non-zero and prints the appropriate byte-equal canonical failure message; surface that output verbatim and stop. Do **not** silently fall back to `pi` or any other CLI default.

## Step 3: Pre-existing-brief check

Before dispatch, check whether the target brief path already exists on disk.

**If the file does not exist:** proceed directly to Step 4.

**If the file exists:** perform a bounded preamble read (e.g., `head -n 8 <path>`) and extract the `Git SHA: <sha>` line. Compute the current repo HEAD SHA via `git rev-parse HEAD`. If the `Git SHA:` line is missing or malformed, treat the brief as stale and render `<brief-sha>` as `(unreadable)`.

Prompt the user using the variant from the table below:

| Branch | SHA equals HEAD | Prompt |
|--------|-----------------|--------|
| Idea | Yes | `A brief for IDEA-<id> already exists at <path> at the current HEAD SHA. (o)verwrite or (k)eep?` |
| Idea | No (or unreadable) | `A brief for IDEA-<id> already exists at <path> (generated at SHA <brief-sha>; HEAD is now <head-sha>). (o)verwrite or (k)eep?` |
| Freeform | Yes | `A brief already exists at <path> at the current HEAD SHA. (o)verwrite or (k)eep?` |
| Freeform | No (or unreadable) | `A brief already exists at <path> (generated at SHA <brief-sha>; HEAD is now <head-sha>). (o)verwrite or (k)eep?` |

**On `o` / `overwrite`:** dispatch normally (proceed to Step 4). The agent overwrites the file at the same path. The commit gate's `(r) Re-run` semantics still apply on the next gate.

**On `k` / `keep`:**
- **Idea branch:** report the existing path and offer the continuation prompt `Run /define-spec IDEA-<id> next? (y/n)`. Do NOT dispatch the scout agent.
- **Freeform branch:** report the existing path and stop with no continuation offer.

If the user types neither `o` nor `k`, re-prompt once. On a second unrecognized response, stop.

## Step 4: Fill the prompt template

Read `skills/scout/scout-prompt.md` from disk and substitute every placeholder:

| Placeholder | Value |
|-------------|-------|
| `{WORKING_DIR}` | Absolute path of the current working directory |
| `{IDEA_BODY_OR_FREEFORM_TEXT}` | Full idea body on the idea branch; seed text on the freeform branch |
| `{OUTPUT_PATH}` | Absolute path of the target brief file |
| `{GENERATED_AT_ISO}` | Current UTC time in ISO 8601 format (e.g., `2026-05-06T12:34:56Z`) |
| `{GIT_HEAD_SHA}` | Output of `git rev-parse HEAD` (40-character SHA) |
| `{MODEL_PROVIDER_AND_NAME}` | The `<provider>/<model>` string resolved in Step 2 |
| `{SOURCE_PROVENANCE}` | `Source: IDEA-<raw-id>` on the idea branch; empty string on the freeform branch |
| `{TASK_TITLE}` | The idea title resolved in Step 1 (`details.title` from the `idea` tool, with the fenced-code-aware first-`# ` fallback) on the idea branch; a short title derived from the seed text on the freeform branch |

## Step 5: Dispatch via subagent_run_serial

**Baseline-capture for the missing-marker fallback.** Immediately before dispatching, capture the pre-dispatch mtime of `{OUTPUT_PATH}` so Step 6 can validate that any on-disk brief is fresh even if the marker line is missing. Run:

```bash
BRIEF_BASELINE=$(python3 -c "import os, sys; p=sys.argv[1]; print(os.path.getmtime(p) if os.path.exists(p) else 0)" "{OUTPUT_PATH}")
```

Hold `BRIEF_BASELINE` in skill state across the dispatch. A value of `0` indicates the file did not exist before dispatch; any positive value indicates the file's mtime at dispatch time.

Dispatch the scout subagent synchronously. `wait: true` is a top-level orchestration option, not a per-task field:

```
subagent_run_serial {
  tasks: [
    {
      name: "scout",
      agent: "scout",
      task: "<filled scout-prompt.md body>",
      model: "<resolved model from Step 2>",
      cli: "<resolved cli from Step 2>"
    }
  ],
  wait: true
}
```

Do **not** pass a `skills:` parameter. Do **not** inline the brief body into the orchestrator's own context after dispatch — the user reads it directly at the commit gate.

## Step 6: Validate completion

Evaluate `results[0]` from the dispatch in this exact order. The first matching case wins.

**(a) `exitCode != 0`:** surface the failure verbatim, include `transcriptPath` when available, and stop. Do not retry.

**(b)–(c) Marker / path / existence check:** run `pi-flow helper _shared/parse-artifact-handoff --marker BRIEF_ARTIFACT --final-message <path-to-finalMessage> --expected-path <{OUTPUT_PATH}> --check-existence --check-non-empty --freshness-baseline <BRIEF_BASELINE>`. If the script exits non-zero, surface its output verbatim with `transcriptPath` when available and stop. Do not retry. When `used_fallback` is `true` in the script's stdout JSON, log a one-line warning to the user noting that the on-disk file at `{OUTPUT_PATH}` was used as the brief artifact even though the dispatched subagent did not emit a `BRIEF_ARTIFACT:` terminal marker.

**(success):** all three checks pass — proceed to Step 7.

If `subagent_run_serial` is unavailable in the current session, stop with an explicit error message and do **not** fall back to inline reconnaissance. The fresh-context isolation is the load-bearing rationale for this skill; an inline fallback would defeat it.

## Step 7: Commit gate

The orchestrator does **not** read the brief into its own context. Surface to the user verbatim:

```
Brief written to <path>. Review it, then choose:

(c) Commit — commit the brief to git.
(r) Re-run — dispatch scout again with the same input; the agent overwrites the same path.
(x) Stop — leave <path> uncommitted on disk for manual editing and committing later.
```

Wait for the user's reply.

**On `c` / `commit` / `yes`:** invoke the `commit` skill with the exact brief path explicitly so only the brief file is committed. If the `commit` skill fails, report the error verbatim and stop without auto-retry.

**On `r` / `re-run`:** re-run from Step 5 (skip the Step 3 pre-existing-brief check — `r` is an explicit overwrite).

**On `x` / `stop`:** emit `Leaving <path> uncommitted.` and stop.

If the user types none of `c`, `r`, or `x`, re-prompt once. On a second unrecognized response, stop.

## Step 8: Continuation offer

After a successful commit on the **idea branch only**, offer:

```
Run /define-spec IDEA-<id> next? (y/n)
```

On `y`: invoke `/define-spec IDEA-<id>`.
On `n`: stop.

The freeform branch does **not** offer continuation — there is no idea ID to hand off.

## Edge cases

- **Missing `model-tiers.json` or any of the four resolution failures:** emit Template (1)–(4) byte-equal with the supplied parameters and stop. No dispatch occurs.
- **`subagent_run_serial` unavailable in the session:** stop with an explicit error message. No inline reconnaissance fallback.
- **`commit` skill failure:** surface the error verbatim and stop. No auto-retry. The user resolves the underlying issue (e.g., pre-commit hook failure) and commits manually or re-runs `/scout`.
- **Agent dispatch returns a path different from `{OUTPUT_PATH}`:** treat as validation failure. No path normalization is applied.
- **Brief file exists but is empty after dispatch:** treat as validation failure (Step 6 check (c)).
- **Unrecognized response at the pre-existing-brief prompt (`o`/`k`):** re-prompt once. Stop on a second unrecognized response.
- **Unrecognized response at the commit gate (`c`/`r`/`x`):** re-prompt once. Stop on a second unrecognized response.
