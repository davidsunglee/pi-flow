**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Approved

**Reasoning:** The implementation meets the setup/bootstrap requirements with an explicit, conflict-safe user shim path while preserving project-target non-overwrite behavior and existing bundled-agent setup. Tests cover creation, idempotency, conflicts, and project guidance, and the targeted test run passed.

### Strengths

- `packages/pi-flow-core/extensions/setup.ts:217` cleanly isolates helper-shim behavior in `runHelperShimSetup`, making the shim lifecycle testable independently from bundled-agent symlink setup.
- `packages/pi-flow-core/extensions/setup.ts:229` handles the required missing/skipped/conflict project-vs-user matrix without silently overwriting existing real files, directories, or divergent symlinks.
- `packages/pi-flow-core/extensions/setup.ts:348` preserves the temporary-load refusal path while still allowing explicit `--target` setup, matching the existing durable setup policy.
- `packages/pi-flow-core/extensions/setup.test.ts:323` adds focused regression coverage for user creation, idempotent skip, divergent symlink conflict, real-file conflict, missing project guidance, and project preservation behavior.
- `packages/pi-flow-core/README.md:57` and `packages/pi-flow-core/docs/helper-runner.md:198` document the bootstrap path, conflict handling, target selection, npm `bin` relationship, and direct `node .../bin/pi-flow.mjs` fallback.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

_None._

### Recommendations

- Consider adding a smoke test that invokes the registered `/flow:setup --target user` command end-to-end with a temporary HOME once the extension test harness can safely isolate `os.homedir()`.

Verification run: `pnpm --filter pi-flow-core test -- extensions/setup.test.ts` passed.
