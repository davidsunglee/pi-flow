## Test-Driven Development

**Test first.** No production behavior change without a failing test that exercises the desired behavior through a public interface. If exploratory production code already exists for this task, revert it or set it aside, write the intended failing test, verify RED, then implement from the test. Document or ask before making an exception.

**Consult the full skill.** For any implementation or bug-fix work in this task, consult the `test-driven-development` skill before writing code. This block is a summary, not a substitute — see the full skill for the workflow, good-test qualities, stop conditions/recovery, and completion checklist.

### Red-Green-Refactor cycle

For every behavior change in this task, work in vertical tracer bullets — one behavior at a time:

1. **RED — write one failing test** for one observable behavior, named after the behavior, exercised through a public interface (API, UI, CLI, service boundary, or persistence-facing interface). Use real internal collaborators.
2. **Verify RED — run the test and watch it fail** for the expected reason (feature absent, bug present, or behavior not yet implemented). If it errors on a typo or setup issue, fix that first; if it passes immediately, the test is wrong — fix it before continuing.
3. **GREEN — write the smallest production change that passes the test.** No speculative features, broad refactors, or "while I'm here" work.
4. **Verify GREEN — run the targeted test and the relevant surrounding tests.** Output should be pristine. If they fail, fix production code; do not weaken the test unless RED proved the test was wrong.
5. **Refactor — only while green.** Improve names, remove duplication, deepen modules. Run tests after each step.

Repeat from RED for the next behavior. Each behavior change needs a test through a public interface — this does not mean every private helper or method needs its own implementation-coupled test.

### Mocking

Mock only true external boundaries: external APIs, payments/email, time/randomness, unavailable services, and sometimes filesystem/database when a controlled real dependency is impractical. Use real internal collaborators. Do not mock internal modules/classes just to observe interactions, and do not assert internal call counts/order for code you own.

### Stop conditions and recovery

Stop and correct course if:

- Production code was written before a failing test in this task.
- The test passed immediately.
- You cannot explain why RED failed.
- You are adding many tests before any implementation.
- Tests mostly mock internal code.
- You are rationalizing "too simple," "manual test is enough," "I'll add tests later," or "tests-after is the same."

**Recovery:** revert or set aside the premature implementation, write the intended failing test, verify RED, then implement from the test. Ask before making an exception.

### When stuck

- "I do not know how to test this" → write the wished-for public API in the test first, then implement to match. If still stuck, report NEEDS_CONTEXT.
- "The test is too complicated" → the design is too complicated. Simplify the public interface.
- "I have to mock everything internal" → the code is too coupled. Use dependency injection at the boundary, not for every internal collaborator.
- "The setup is huge" → extract helpers; if still complex, simplify the design.

### Bug fixes

For a non-trivial bug, reproduce the failure with the smallest test that follows the real failure path through a public interface. Confirm RED reflects the observed bug (not a synthetic substitute), then fix minimally. Keep the regression test. Never fix a non-trivial bug without a regression test unless explicitly permitted.

### Completion checklist (before reporting DONE)

- [ ] Each behavior change has a test through a public interface.
- [ ] You watched each new or changed test fail for the expected reason before implementing.
- [ ] Production changes were minimal for the tests.
- [ ] Refactors happened only while green.
- [ ] Targeted and relevant surrounding tests pass with no unexpected errors or warnings.
- [ ] Mocks are limited to true external boundaries.
- [ ] Any skipped TDD exception was explicitly approved or documented.

If you cannot check every box, you skipped TDD — recover before reporting.
