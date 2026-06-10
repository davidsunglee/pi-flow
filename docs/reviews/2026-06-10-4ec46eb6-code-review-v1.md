**Reviewer:** openai-codex/gpt-5.5 via codex

### Outcome

**Verdict:** Approved

**Reasoning:** The implementation completes the hard cutover across config, dispatch resolution, parser output, workflow docs, and tests without leaving forbidden model-tier spellings in active pi-flow surfaces. The resolver, parser, full test suite, and TypeScript typecheck all pass.

### Strengths

- The resolver now exposes the canonical `--model-tier` flag and rejects the legacy flag path while preserving section-qualified tier resolution (`packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py:61`).
- Frontier and efficient dispatch coverage was added for provider-preferred and cross-provider paths, including spec-designer, planner, coder, and legacy-flag rejection cases (`packages/pi-flow-core/skills/_shared/scripts/tests/test_resolve_model_dispatch.py:46`).
- The executable plan parser now emits `model_tier`, accepts the four-tier vocabulary, and reports `missing_model_tier` consistently (`packages/pi-flow-core/skills/execute-plan/scripts/extract-plan-tasks.py:73`, `packages/pi-flow-core/skills/execute-plan/scripts/extract-plan-tasks.py:558`).
- The workflow routing changes are localized as intended: `define-spec` routes spec-designer through `modelTiers.frontier`, and `generate-plan` routes the initial planner through `modelTiers.frontier` (`packages/pi-flow-core/skills/define-spec/SKILL.md:48`, `packages/pi-flow-core/skills/generate-plan/SKILL.md:47`).
- Execute-plan's dispatch table and better-model ladder include `efficient -> standard -> capable -> frontier` and suppress escalation at `frontier` (`packages/pi-flow-core/skills/execute-plan/SKILL.md:135`, `packages/pi-flow-core/skills/execute-plan/SKILL.md:299`).

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

_None._

### Recommendations

- Keep the repo-wide forbidden-token grep in CI for this migration class; it is the right guardrail for a hard spelling cutover.
- Consider a follow-up documentation pass for the legacy migration table if users need explicit guidance from the old tier name to `efficient`; the current wording satisfies the no-stale-token gate but is less self-explanatory for migrations from pre-cutover configs.

### Verification

- `grep -rniE "cheap|model_recommendation|coder_tier" packages/ .pi/flow.json --include='*.py' --include='*.md' --include='*.json' --include='*.ts' --include='*.mjs' | grep -v 'docs/specs/' | grep -v 'docs/ideas/' | grep -v 'premium' | grep -v 'pi-flow-ux/extensions/editor.ts'`
- `grep -rn "\-\-tier\b" packages/ | grep -v 'docs/specs/' | grep -v 'docs/ideas/'`
- `python3 packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py --model-tier modelTiers.frontier --agent spec-designer --flow-config packages/pi-flow-core/skills/_shared/scripts/tests/fixtures/flow-complete.json`
- `python3 packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py --model-tier crossProviderModelTiers.frontier --agent coder --flow-config packages/pi-flow-core/skills/_shared/scripts/tests/fixtures/flow-complete.json`
- `pnpm test`
- `pnpm --filter @aphotic/pi-flow-core run typecheck`
