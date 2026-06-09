**Reviewer:** openai-codex/gpt-5.5 via codex

### Outcome

**Verdict:** Not approved

**Reasoning:** The prompt wording is largely moved to a tool-first protocol and tests pass, but two Important findings need remediation before shipping: the shared snippet is not actually used as a central source for runtime prompt text, and the committed project settings add an out-of-scope, broken local `pi-mux-subagents` source.

### Strengths

- The shared completion protocol clearly distinguishes marker and report variants, including the `DONE_MESSAGE` contract, byte-equality requirement, visible fallback marker, and `subagent_done` as the completion signal (`packages/pi-flow-core/skills/_shared/completion-protocol.md:15`).
- Runtime marker prompts preserve existing artifact marker names while moving the visible marker immediately before `subagent_done(message=DONE_MESSAGE)`, for example `BRIEF_ARTIFACT` and `PLAN_ARTIFACT` (`packages/pi-flow-core/skills/scout/scout-prompt.md:87`, `packages/pi-flow-core/skills/generate-plan/generate-plan-prompt.md:36`).
- The new guardrail test covers runtime prompt/agent files for required tool-first phrases, `DONE_MESSAGE`, shared-source references, and forbidden final-answer-first wording (`packages/pi-flow-core/skills/_shared/scripts/tests/test_completion_protocol_contract.py:62`).
- Verification passed with `pnpm --dir packages/pi-flow-core check`; `git diff --check 1bc52d19f59bf9f6c25a42c06fdecb6f1b087771..a4b510b0f41f65aec15a66103e46dc0fef781b2d` also reported no whitespace errors.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

- **packages/pi-flow-core/skills/_shared/completion-protocol.md:3: Runtime prompts still duplicate the supposedly central protocol text**
  - **What:** The new file calls itself the single source of truth, but the affected runtime prompts and agent definitions contain hand-edited copies of the protocol text plus a comment reference, rather than being generated from or including the shared snippet. For example, the scout and plan prompts each carry independent copies of the marker-variant wording (`packages/pi-flow-core/skills/scout/scout-prompt.md:87`, `packages/pi-flow-core/skills/generate-plan/generate-plan-prompt.md:36`).
  - **Why it matters:** The requirement explicitly called for centralizing the completion-protocol wording in one shared source so runtime prompts do not drift back toward final-answer-first language. A comment plus phrase-presence tests does not keep the runtime text tied to the canonical snippet; if `completion-protocol.md` changes, these prompts can silently stay stale.
  - **Recommendation:** Route affected runtime prompts through a real shared-source mechanism, such as a prompt assembly helper/template include for marker and report variants, or another canonical source that actually produces the runtime text. Extend the guardrail so it proves runtime prompts are tied to that source, not just carrying selected phrases.

- **.pi/settings.json:18: Committed settings add a broken, out-of-scope local `pi-mux-subagents` source**
  - **What:** The diff adds `npm:@aphotic/pi-mux-subagents` and a local `../../pi-mux-subagents` source to project settings. From `/Users/david/Code/pi-flow`, that local path resolves to `/Users/david/pi-mux-subagents`, while the related project named in the requirement is `/Users/david/Code/pi-mux-subagents`; the checked path does not exist in this workspace.
  - **Why it matters:** This change is outside the stated pi-flow prompt-language scope and can make Pi package loading depend on a developer-local checkout path that is invalid for this repo layout. It also mixes this prompt fix with pi-mux-subagents setup concerns that the requirement explicitly tracks separately.
  - **Recommendation:** Remove the `.pi/settings.json` changes from this diff. If local pi-mux-subagents development setup is needed, keep it uncommitted or handle it in the separate pi-mux-subagents workstream.

#### Minor (Nice to Have)

- **packages/pi-flow-core/agents/spec-designer.md:3: Agent description still frames completion as ending the turn with a marker**
  - **What:** The frontmatter description still says the agent "ends its turn with a `SPEC_ARTIFACT` line and a matching `subagent_done(...)` call" instead of describing the tool-first completion signal used in the body.
  - **Why it matters:** This is not as strong as the previous final-message-first wording, but it leaves a small inconsistent surface in agent metadata that can be shown to dispatchers or maintainers.
  - **Recommendation:** Rephrase the description to say the agent completes via `subagent_done(message=DONE_MESSAGE)` after emitting the visible `SPEC_ARTIFACT` marker.

### Recommendations

- Keep the new guardrail test in the helper suite, but make it validate source coupling once the prompt assembly/include mechanism exists.
