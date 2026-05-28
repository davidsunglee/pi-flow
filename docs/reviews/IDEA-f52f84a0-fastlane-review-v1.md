**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Approved

**Reasoning:** The implementation meets the lifecycle requirements: border placement composes the border renderer with a blank footer, footer/off restore the expected footer behavior, and the behavior is covered by focused regression tests. I found no blocking or notable production-readiness issues.

### Strengths

- `packages/pi-flow-ux/extensions/blank-footer.ts:20-29` implements the requested small blank-footer renderer directly, rendering no lines and restoring the default footer with `setFooter(undefined)` on dispose.
- `packages/pi-flow-ux/extensions/status/status.ts:52-60` cleanly composes renderer handles while preserving `onAgentEnd` fan-out, so the existing border branch-refresh behavior is retained.
- `packages/pi-flow-ux/extensions/status/status.ts:280-294` keeps placement behavior mutually exclusive: border installs both border and blank-footer handles, footer installs only the custom footer, and off installs no renderer.
- `packages/pi-flow-ux/extensions/status/status.test.ts:254-276` and `packages/pi-flow-ux/extensions/status/status.test.ts:333-379` cover startup, blank rendering, border→footer, border→off, off→border, and shutdown restoration paths.
- `packages/pi-flow-ux/README.md:58-79` documents that border placement suppresses the built-in footer and that footer/off restore normal footer behavior.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

_None._

### Recommendations

- Verification run: `pnpm --filter @aphotic/pi-flow-ux run test:node` passed (136 tests).
