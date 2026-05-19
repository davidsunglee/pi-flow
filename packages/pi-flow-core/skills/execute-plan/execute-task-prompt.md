# Execute Task Prompt

Prompt template dispatched to worker agents for a single plan task. Fill placeholders before sending.

## Task Description

{TASK_SPEC}

## Context

{CONTEXT}

## Working Directory

Operate from: `{WORKING_DIR}`

All paths in this task are relative to that directory unless otherwise stated.

## Code Organization

You reason best about code you can hold in context at once, and your edits are more
reliable when files are focused. Keep this in mind:

- Follow the file structure defined in the plan
- Each file should have one clear responsibility with a well-defined interface
- If a file you're creating is growing beyond the plan's intent, stop and report
  it as DONE_WITH_CONCERNS — don't split files on your own without plan guidance
- If an existing file you're modifying is already large or tangled, work carefully
  and note it as a concern in your report
- In existing codebases, follow established patterns. Improve code you're touching
  the way a good developer would, but don't restructure things outside your task.

## When You're in Over Your Head

It is always OK to stop and say this is too hard. Bad work is worse than no work.
You will not be penalized for escalating.

**STOP and escalate when:**
- The task requires architectural decisions with multiple valid approaches
- You need to understand code beyond what was provided and can't find clarity
- You feel uncertain about whether your approach is correct
- The task involves restructuring existing code in ways the plan didn't anticipate
- You've been reading file after file trying to understand the system without progress

**How to escalate:** Report back with status BLOCKED or NEEDS_CONTEXT. Describe
specifically what you're stuck on, what you've tried, and what kind of help you need.
The orchestrator can provide more context, re-dispatch with a more capable model,
or break the task into smaller pieces.

Do NOT guess. Do NOT produce work you're unsure about and mark it DONE. Escalate.

## Self-Review

Before reporting, review your work with fresh eyes:

**Completeness:**
- Did I fully implement everything in the spec?
- Did I miss any requirements or acceptance criteria?
- Are there edge cases I didn't handle?

**Quality:**
- Is the code clean and maintainable?
- Are names clear and accurate — do they match what things do, not how they work?

**Discipline:**
- Did I avoid overbuilding (YAGNI)?
- Did I only build what was requested?
- Did I follow existing patterns in the codebase?

**Testing:**
- Do tests actually verify behavior (not just mock behavior)?
- Did I follow TDD if required?
- Are tests comprehensive?

If you find issues during self-review, fix them now before reporting.

## Required Skills

If this task involves diagnosing a failing test, regression, or unexpected behavior, you MUST consult the `systematic-debugging` skill before proposing a fix. Find the root cause before changing code.

{TDD_BLOCK}

## Report Format

Your report MUST begin with a `STATUS:` line. The first non-fenced line of your report MUST be exactly `STATUS: <token>` where `<token>` is one of `DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, or `NEEDS_CONTEXT`. Do not prefix `STATUS:` with a Markdown heading marker (`#`–`######`), a bullet (`-`, `*`), bolding (`**`), or any other character. Do not place a summary paragraph, greeting, or any other text before the `STATUS:` line.

The lines that follow `STATUS:` use this exact structure:

```
STATUS: <DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT>

## Completed
What was implemented.

## Tests
What was tested and results.

When TDD was enabled for this task AND you changed production code, include brief RED/GREEN evidence:
- **RED:** the failing test you added or ran first, and the expected failure reason (what error or assertion).
- **GREEN:** what passed after implementation (the specific test(s) now passing, and confirmation the rest of the suite still passes).

Keep each line to one or two sentences. If TDD was disabled, or you only modified docs/config/comments, write "TDD not applicable — <one-line reason>" and skip RED/GREEN.

## Files Changed
- `path/to/file` — what changed

## Self-Review Findings
Any issues found and fixed during self-review, or "None."

## Concerns / Needs / Blocker
(only for DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED)

For DONE_WITH_CONCERNS, list concerns as a freeform bullet list — one concern per line, written as a plain sentence. Do not prefix concerns with type labels.
```

**Status code guidance:**
- `DONE` — all acceptance criteria met, self-review clean
- `DONE_WITH_CONCERNS` — work complete but you have doubts worth surfacing. List concerns as freeform bullets — do not use `Type:` labels. The orchestrator will surface your concerns at a combined wave-level checkpoint before verification; the user decides whether to remediate or continue.
- `NEEDS_CONTEXT` — cannot proceed without specific information that wasn't provided; list exactly what
- `BLOCKED` — cannot complete the task; explain why, what you tried, and what would unblock you

Never silently produce work you're unsure about. Use DONE_WITH_CONCERNS or BLOCKED instead.
