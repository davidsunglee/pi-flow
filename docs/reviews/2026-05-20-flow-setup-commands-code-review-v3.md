**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Approved

**Reasoning:** The extension is production-ready overall: the command surface is cleanly modularized, the storage/setup/router seams are well tested, and `pnpm -r run test` plus `pnpm -r run typecheck` pass. Remaining findings are minor user-facing/documentation nits, not blocking defects.

### Strengths

- Clear extension entry point with feature-specific registration kept in separate modules (`packages/pi-flow-core/extensions/commands.ts:1-11`).
- `/flow:setup` has a strong safety model: realpath-aware scope matching, stale source-info skipping, temporary-load refusal before filesystem mutation, and non-overwriting conflict handling (`packages/pi-flow-core/extensions/setup.ts:58-122`, `packages/pi-flow-core/extensions/setup.ts:140-163`).
- Workflow routing is centralized and table-driven, making exact-input acceptance/rejection easy to audit (`packages/pi-flow-core/extensions/router.ts:31-41`, `packages/pi-flow-core/extensions/router.ts:69-130`).
- Idea persistence preserves the legacy JSON-plus-markdown artifact shape and uses atomic temp-file-plus-rename writes (`packages/pi-flow-core/extensions/storage.ts:37-43`, `packages/pi-flow-core/extensions/storage.ts:127-138`).
- The `/flow:idea` command and `idea` tool share storage and expose only the intended Flow names (`packages/pi-flow-core/extensions/idea.ts:153-193`).
- The setup/dispatch smoke test exercises the real loader, symlink creation, `pi-interactive-subagent` dispatch primitive registration, readable agent frontmatter, exact workflow dispatch, and idempotent re-run behavior (`packages/pi-flow-core/__tests__/setup-dispatch-smoke.test.mjs:153-238`).

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

- **packages/pi-flow-core/extensions/setup.ts:188: Temporary `--target` setup is reported as info instead of warning**
  - **What:** `runSetup` chooses `"error"` for conflicts and `"info"` otherwise, so a temporary package load accepted via `--target user|project` is not surfaced at warning level as specified.
  - **Why it matters:** This does not break setup, but it weakens the advisory signal for users making a durable change from a temporary (`pi -e`) load.
  - **Recommendation:** Change the level selection to return `"warning"` when `scope === "temporary" && explicitTarget !== undefined` and update the smoke/unit assertion that currently expects an info-level created notification for that path.
- **packages/pi-flow-core/README.md:38: `/flow:idea` command docs imply update support**
  - **What:** The command list says `/flow:idea` can “create or update” a TODO artifact, but the implemented slash command only creates new artifacts; update support lives in the LLM-facing `idea` tool.
  - **Why it matters:** Users may try to update existing ideas through the slash command and get unexpected behavior.
  - **Recommendation:** Reword this line to say `/flow:idea` captures/creates an idea, and leave update semantics to the `idea` tool subsection.
- **packages/pi-flow-core/README.md:41: `/flow:plan` docs list spec paths as exact inputs even though the router rejects them**
  - **What:** The README says `/flow:plan` routes a `brief/spec path`, but the exact-input matrix accepts briefs for `generate-plan` and explicitly rejects specs (`packages/pi-flow-core/extensions/router.ts:37`).
  - **Why it matters:** The command still works correctly, but the documentation can mislead users about which artifact-shaped inputs bypass interpretation.
  - **Recommendation:** Update the command summary to “TODO, brief path, or prose request” unless spec paths are intentionally added to the router matrix.

### Recommendations

- Consider adding one small regression assertion for the temporary `--target` notification level so the advisory behavior stays aligned with the spec.

Verification run during review:
- `pnpm -r run test` — passed
- `pnpm -r run typecheck` — passed
