## Re-Review Context

This is a follow-up review after remediation. You are NOT reviewing the full diff — only the remediation changes.

### Previous Findings

The following issues were flagged in the prior review pass:

{PREVIOUS_FINDINGS}

### Remediation Diff

The remediation changes since the last review:

```bash
git diff --stat {PREV_HEAD}..{NEW_HEAD}
git diff {PREV_HEAD}..{NEW_HEAD}
```

### Your Job

1. **Verify fixes** — for each finding listed above, confirm the remediation actually addresses it. Check the code, not just the commit message.
2. **Check for regressions** — did any fix break something else within the remediation diff?
3. **Flag new issues** — if you see new problems introduced by the remediation, flag them with the same severity format.
4. **Do NOT re-review** code outside the remediation diff. Code that was already reviewed and not changed is out of scope.

If all previous findings are addressed and no new issues exist, emit `**Verdict:** Approved` in your `### Outcome` section.