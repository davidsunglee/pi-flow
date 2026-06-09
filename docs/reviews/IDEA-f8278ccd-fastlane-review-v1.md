**Reviewer:** openai-codex/gpt-5.5 via codex

### Outcome

**Verdict:** Not approved

**Reasoning:** The prompt wording has mostly moved to the requested tool-first protocol and the guardrail tests pass, but the implementation does not actually centralize the runtime wording through the new shared snippet as required. That leaves the same duplicated-prompt drift risk the requirement was meant to remove.

### Strengths

- The shared snippet clearly defines both marker and report variants, including the exact `DONE_MESSAGE` behavior, byte-equality requirement, visible marker fallback, and the fact that `subagent_done` is the completion signal (`packages/pi-flow-core/skills/_shared/completion-protocol.md:15`).
- Runtime marker prompts preserve the existing artifact marker names and instruct agents to emit the visible marker immediately before `subagent_done(message=DONE_MESSAGE)`, for example the scout prompt and plan prompt (`packages/pi-flow-core/skills/scout/scout-prompt.md:97`, `packages/pi-flow-core/skills/generate-plan/generate-plan-prompt.md:46`).
- The new guardrail test covers the shared snippet and runtime-dispatched prompt/agent files for required tool-first phrases, `DONE_MESSAGE`, and forbidden final-answer-first wording (`packages/pi-flow-core/skills/_shared/scripts/tests/test_completion_protocol_contract.py:105`).
- Verification passed with `pnpm --dir packages/pi-flow-core check`, including the newly added Python helper tests.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

- **packages/pi-flow-core/skills/_shared/completion-protocol.md:3: Shared wording is not actually centralized into runtime prompts**
  - **What:** The new file is described as the single source of truth, but affected runtime prompts still contain independently edited copies of the completion protocol rather than referencing or interpolating the shared snippet. For example, `scout-prompt.md` and `generate-plan-prompt.md` duplicate marker-variant wording directly (`packages/pi-flow-core/skills/scout/scout-prompt.md:85`, `packages/pi-flow-core/skills/generate-plan/generate-plan-prompt.md:34`).
  - **Why it matters:** This misses the explicit requirement to centralize the completion-protocol wording in one shared source and then reference/interpolate it from affected runtime prompts. Future changes can still drift across prompts, and the current tests only assert phrase presence, not that runtime text is generated from or tied to the shared source.
  - **Recommendation:** Add a real shared-source mechanism, such as a small prompt assembly helper/template include that injects the marker or report variant from `completion-protocol.md`, or another equivalent canonical source used by all affected prompt generation paths. Extend the guardrail so a prompt cannot pass merely by carrying duplicated phrases while no longer using the shared source.

#### Minor (Nice to Have)

- **docs/ideas/c6685399.md:55: Trailing blank line trips diff whitespace check**
  - **What:** `git diff --check` reports a new blank line at EOF.
  - **Why it matters:** It is harmless at runtime, but it creates avoidable whitespace noise and can fail stricter CI configurations.
  - **Recommendation:** Remove the extra trailing blank line.

### Recommendations

- Consider documenting the exact command for the new guardrail test near the shared snippet, since the test is now part of the helper test suite through `scripts/run-helper-tests.ts`.
