**Reviewer:** openai-codex/gpt-5.5 via codex

### Outcome

**Verdict:** Approved

**Reasoning:** The implementation matches the requested startup header, resource snapshot, full details, and entrypoint wiring behavior, with targeted coverage included in the package suite. I found no Critical or Important findings.

### Strengths

- The settings model and `/tui` grammar cleanly add `header.details` while preserving legacy saved files through normalization (`packages/pi-flow-ux/extensions/settings.ts:57`, `packages/pi-flow-ux/extensions/settings.ts:240`).
- Resource collection is built around injected public sources, isolates failures by category, avoids `DefaultResourceLoader`, and suppresses installs with `resolve(async () => "skip")` (`packages/pi-flow-ux/extensions/header-data.ts:104`, `packages/pi-flow-ux/extensions/header-data.ts:201`).
- Header rendering is deterministic and width-guarded, with `quietStartup=false` forcing the calm `none` level and compact rows fitting through `visibleWidth`/`truncateToWidth` (`packages/pi-flow-ux/extensions/header.ts:25`, `packages/pi-flow-ux/extensions/header.ts:88`, `packages/pi-flow-ux/extensions/header.ts:115`).
- The on-demand details view persists ANSI-free plain text plus structured snapshot details, and the renderer validates details before custom rendering (`packages/pi-flow-ux/extensions/header-details.ts:46`, `packages/pi-flow-ux/extensions/header-details.ts:50`, `packages/pi-flow-ux/extensions/header-details.ts:83`).
- Entrypoint integration registers the message renderer, wires the settings callback, creates a fresh per-session holder, and starts the non-blocking snapshot refresh before installing the header (`packages/pi-flow-ux/extensions/index.ts:17`, `packages/pi-flow-ux/extensions/index.ts:21`, `packages/pi-flow-ux/extensions/index.ts:35`).
- Verification is strong: `pnpm --filter @aphotic/pi-flow-ux test` passed with 248 tests, and `pnpm run lint` passed with exit code 0.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

_None._

### Recommendations

_None._
