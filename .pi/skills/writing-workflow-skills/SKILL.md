---
name: workflow-skill-writing
description: Use when editing, simplifying, reviewing, or refactoring pi-flow workflow skills under packages/pi-flow-core/skills.
---

# Workflow Skill Writing

Project-local maintainer guidance. Keep this skill in `.pi/skills/`; do not add it to package manifests or exported skill globs.

## Goal

Make workflow skills shorter and clearer without changing agent behavior.

## Before editing

1. Read the full target `SKILL.md`.
2. Identify exact strings that must survive: menus, status codes, failure messages, banners, command templates, and handoff formats.
3. Check tests for guardrail strings before changing wording: `rg "<distinct string>|<skill-name>" packages/pi-flow-core/__tests__`.
4. Note referenced helper files or prompt templates before moving content.

## Simplification rules

- Preserve gates, verification steps, subagent boundaries, and user checkpoints.
- Preserve byte-exact text when tests or downstream parsers may depend on it.
- Use imperative steps. Prefer bullets, tables, and exact output blocks over paragraphs.
- Keep formatting consistent with the surrounding workflow skills.
- Preserve readable spacing; do not remove blank lines just to reduce line count.
- Keep skills pleasant for humans to scan as well as reliable for agents to follow.
- Delete background prose unless it prevents a known failure mode.
- Merge repeated rules; link to shared guidance instead of restating it.
- Move rare branches, long prompts, and examples to adjacent files when `SKILL.md` gets long.
- Keep references one level deep from `SKILL.md`.
- Use `MUST` only for hard safety, parsing, or orchestration boundaries.
- Optimize for correct agent behavior and human readability, not minimum line count.

## Safe rewrite process

1. Shrink the description to triggering conditions, not a workflow summary.
2. Keep the main path easy to scan from top to bottom.
3. Put customization menus and exact emitted text in fenced blocks.
4. Move detailed rationale below the procedure or into a reference file.
5. Re-run relevant tests and inspect the diff for accidental behavior changes.

## Verification

For small wording-only edits, run the targeted guardrail or package test that covers the skill. For structural edits, run:

```bash
pnpm --filter pi-flow-core run test:node
```

Before reporting completion, show the files changed and the verification command/output.
