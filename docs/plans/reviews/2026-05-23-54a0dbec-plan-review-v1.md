**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Not approved

**Reasoning:** The plan is broadly complete against the publication-preparation spec, but Task 4 can be scheduled before Task 3 while running `pnpm check`, which can fail because the aggregate bin wrapper remains pointed at the old unscoped package name.

### Strengths

- Task 1 thoroughly covers package identity, metadata, scoped workspace dependency keys, aggregate `pi` manifest paths, peer/dev dependency tightening, root privacy preservation, and workspace relinking.
- Tasks 3, 4, and 6 separate runtime references, existing test updates, and documentation updates clearly, with concrete paths and scoped replacement strings.
- Task 5 adds targeted packlist regression tests for all three publishable packages, directly covering the spec’s tarball-trimming requirement.
- Task 8 includes final integration checks for `pnpm check`, pack output, `workspace:*` rewrite behavior, and absence of install-time side-effect scripts.

### Issues

#### Critical (Must Fix)

- **Task 4: Missing dependency on Task 3 before running `pnpm check`**
  - **What:** Task 4 depends only on Task 1, but Task 4 Step 4 runs `pnpm check` after updating aggregate tests to scoped names. Task 3 is the task that updates `packages/pi-flow/bin/pi-flow.mjs` from `require.resolve('pi-flow-core/bin/pi-flow.mjs')` to `require.resolve('@aphotic/pi-flow-core/bin/pi-flow.mjs')`.
  - **Why it matters:** If the executor runs Task 4 after Task 1 but before Task 3, the updated aggregate install/bin tests can exercise the aggregate wrapper while it still resolves the removed unscoped dependency key, causing `pnpm check` to fail even though the intended implementation order would pass.
  - **Recommendation:** Add Task 3 as a dependency of Task 4, or defer Task 4’s `pnpm check` step until after Task 3 has completed.

#### Important (Should Fix)

- **Task 2: LICENSE content acceptance check does not cover all required files**
  - **What:** The criterion says all LICENSE files contain the MIT license text with the correct copyright holder, but its `Verify:` recipe checks only `head -3 packages/pi-flow-core/LICENSE`.
  - **Why it matters:** Execution could leave the root, aggregate, or UX LICENSE content incorrect or non-identical while still passing the listed verification command.
  - **Recommendation:** Replace or supplement the verify command with a check over all four LICENSE files, such as `cmp`/hash comparison plus a grep for `Copyright (c) 2026 David Lee` in each file.

#### Minor (Nice to Have)

- **Task 1: Risk assessment references the wrong step number for `pnpm install`**
  - **What:** The risk assessment says “Task 1 Step 5 explicitly runs `pnpm install`,” but `pnpm install` is Task 1 Step 6.
  - **Why it matters:** This is unlikely to block execution, but it can cause minor confusion when tracing the mitigation.
  - **Recommendation:** Update the risk assessment reference to Task 1 Step 6.

### Recommendations

- Consider adding Task 3 to Task 4’s dependency list before execution so the existing test run has a stable prerequisite order.
