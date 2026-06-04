**Reviewer:** openai-codex/gpt-5.5 via codex

### Outcome

**Verdict:** Approved with concerns

**Reasoning:** The plan covers the requested settings, resolver, rendering, full-details command, and integration work with accurate dependencies and enforceable verify recipes. Approved with concerns waives the Important Task 5 `resources_discover` startup-timing risk because the on-demand full view is correct, the startup compact row is non-blocking best-effort per the spec, and the plan explicitly documents the residual risk instead of hiding it.

### Strengths

- Task 1 cleanly preserves backward compatibility for saved `tui.json` files while extending the `/tui` grammar and tests the new setting behavior in detail.
- Task 2 uses injected `SnapshotSources`, pure helper tests, install-suppressed `DefaultPackageManager.resolve(async () => "skip")`, and explicit no-`DefaultResourceLoader` verification, matching the core constraints.
- Task 3 and Task 4 separate pure rendering from host wiring and include deterministic output, width-guard, color-token, and renderer-fallback tests.
- Task 5 correctly serializes integration after Tasks 1-4 and includes package-level test plus repo lint verification.
- Every acceptance criterion is immediately followed by a concrete `Verify:` line naming the artifact or command and the expected success condition.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

- **Task 5: Startup compact rows may miss late `resources_discover` contributions**
  - **What:** The plan refreshes `HeaderResources` once at `session_start`, while its own Risk Assessment states that host `resources_discover` contributions can be emitted after `session_start`. The mitigation relies on the async `DefaultPackageManager.resolve()` delay being long enough for discovery to complete, but the task steps do not add a deterministic post-discovery refresh or a regression test for startup compact rows containing a discovered skill/prompt.
  - **Why it matters:** The spec requires skills/prompts contributed via `resources_discover` or temporary CLI flags to appear in compact/full output, and it also says startup data should reflect the live session. The full on-demand path is fresh, but the startup compact row could be stale in a timing-sensitive session.
  - **Recommendation:** If the host exposes a reliable post-discovery signal, refresh the holder after that signal. If not, keep the current design but add a targeted integration test or documented implementation note that startup compact rows are best-effort while `/tui header details` is authoritative.

#### Minor (Nice to Have)

_None._

### Recommendations

- Add a brief implementation note near the Task 5 refresh code explaining why the startup snapshot is asynchronous and why the full details command recollects fresh data.
