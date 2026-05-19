# Workflow-artifact path allowlist

## Why this exists

Skills that classify whether intervening commits represent expected workflow drift consult this list so the definition stays consistent across consumers. The allowlist captures the directory prefixes whose changes are part of the spec/plan/review pipeline itself — they are by-product churn that does not invalidate upstream reconnaissance like a scout brief. A change anywhere outside the allowlist is treated as real source/config drift and surfaces a checkpoint to the user.

## Allowlist

The allowlist contains exactly these four entries:

- `docs/briefs/`
- `docs/specs/`
- `docs/todos/`
- `docs/plans/`

The `docs/plans/` prefix covers `docs/plans/reviews/` and `docs/plans/done/` because both are under the `docs/plans/` directory boundary.

## Matching rule

A path is "under" a prefix when it begins with that prefix as a directory boundary. Concretely: `docs/specs/foo.md` matches the prefix `docs/specs/` because the prefix ends in `/` and the path begins with that exact substring; `docs/specs-archive/foo.md` does NOT match `docs/specs/` because `docs/specs-archive/` is a different directory at the same level — the trailing `/` in the prefix is load-bearing.

Examples:

- `docs/specs/foo.md` matches the prefix `docs/specs/`
- `docs/specs-archive/foo.md` does NOT match the prefix `docs/specs/`

## Consumers

The following skills/agents reference this allowlist; new consumers MUST add themselves to this list when they adopt it so the allowlist's reach stays visible to readers and to audits.

- `skills/generate-plan/SKILL.md` Step 1b — staleness classifier inside the spec preamble extraction.
- `skills/_shared/scripts/classify-workflow-drift.py` — reads the allowlist to classify intervening commits as workflow-only or mixed changes.

Future consumers add themselves under this bullet list when they begin referencing the allowlist.
