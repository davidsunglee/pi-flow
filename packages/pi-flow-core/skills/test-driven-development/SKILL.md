---
name: test-driven-development
description: Test-driven development with behavior-focused red-green-refactor. Use when implementing features, bug fixes, refactors, behavior changes, or when the user mentions TDD, test-first, or red-green-refactor.
---

# Test-Driven Development

## Core principles

- **Test first.** If you did not watch the test fail for the expected reason, you do not know whether it proves the intended behavior.
- **Test behavior through public interfaces.** Tests should verify what users/callers observe, not private methods, internal call sequences, or implementation shape.
- **Work in vertical tracer bullets.** One behavior → one failing test → minimal code → green → optional refactor. Do not write all tests first and all implementation later.
- **Every behavior change needs a test.** This does not mean every private helper or method needs its own implementation-coupled test.
- **Mock only true boundaries.** Use real internal collaborators. Mock/stub external APIs, payments/email, time/randomness, unavailable services, and sometimes filesystem/database when a controlled real dependency is impractical.

## When to use

Use for new features, bug fixes, refactors, and behavior changes.

Exceptions require human approval or an explicit note: throwaway prototypes, generated code, pure configuration changes, and docs-only changes.

If exploration is needed, keep it throwaway. Before final implementation, discard or revert exploratory production code and restart from a failing test. Do not convert already-written implementation into “tests after.”

## Workflow

1. **Clarify behavior and interface if unclear.** Ask what observable outcome callers/users should see and which behaviors are most important. Prefer existing public APIs and project domain language.
2. **RED:** write one minimal test for one behavior.
3. **Verify RED:** run the targeted test and confirm it fails for the expected reason: feature absent, bug present, or behavior not yet implemented. Fix typos/setup until the failure is meaningful.
4. **GREEN:** write the smallest production change that passes the test. No speculative features, broad refactors, or “while I’m here” work.
5. **Verify GREEN:** run the targeted test and relevant surrounding tests. If they fail, fix production code; do not weaken the test unless RED proved the test was wrong.
6. **REFACTOR:** only while green. Improve names, remove duplication, deepen modules, simplify interfaces, and run tests after each step.
7. Repeat from RED for the next behavior.

## Good tests

A good test:

- Has a clear behavior-oriented name.
- Exercises real code through a public API, UI, CLI, service boundary, or persistence-facing interface.
- Verifies observable outcomes: returned value, emitted event, retrievable state, rendered UI, API response, or user-visible error.
- Is deterministic: controls time/randomness, seeds data explicitly, and avoids uncontrolled network calls.
- Tests one behavior; if the name contains “and,” consider splitting it.

Avoid tests that:

- Target private methods or internal helpers directly.
- Assert internal call counts/order for code you own.
- Mock internal modules/classes just to observe interactions.
- Query behind the public interface when public observation is available.
- Pass immediately when they were supposed to prove new behavior.
- Need huge setup; that often means the interface is hard to use.

## Bug fixes

For a non-trivial bug:

1. Reproduce the bug with the smallest failing test that follows the real failure path.
2. Confirm RED fails with the observed bug, not a synthetic substitute.
3. Fix minimally.
4. Keep the regression test.

Never fix a non-trivial bug without a regression test unless the human partner explicitly permits it.

## Interface/design feedback

If a test is hard to write, treat that as design feedback:

- Prefer a simpler public interface over testing internals.
- Inject external dependencies instead of constructing them deep inside the code.
- Return values or observable results where practical instead of hiding side effects.
- Prefer deep modules: small interface, substantial implementation hidden behind it.

## Stop conditions and recovery

Stop and correct course if:

- Production code was written before a failing test in this task.
- The test passed immediately.
- You cannot explain why RED failed.
- You are adding many tests before any implementation.
- You are rationalizing “too simple,” “manual test is enough,” or “I’ll add tests later.”
- Tests mostly mock internal code.

Recovery: revert or set aside premature implementation, write the intended failing test, verify RED, then implement from the test. Ask before making an exception.

## Completion checklist

Before claiming done:

- [ ] Each behavior change has a test through a public interface.
- [ ] Each new or changed test was observed failing for the expected reason before implementation.
- [ ] Production changes were minimal for the tests.
- [ ] Refactors happened only while green.
- [ ] Relevant targeted and surrounding tests pass with no unexpected errors or warnings.
- [ ] Any skipped TDD exception was explicitly approved or documented.
