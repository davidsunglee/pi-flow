**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome

**Verdict:** Not approved

**Reasoning:** The plan is generally comprehensive, but Task 9 contains a cross-task interface error that would make the TUI copy-text branch fail to build as written.

### Strengths

- Tasks 1–5 cover the storage migration, expanded tool API, renderers, helper functions, and non-interactive `/flow:ideas` path with clear dependencies and targeted tests.
- Tasks 6–9 preserve the spec’s single-file `idea.ts` constraint while decomposing the TUI work into selector, menus, overlay, and wiring phases.
- The plan explicitly updates downstream skill prose and integration coverage in Task 10, which helps keep the `"closed"` migration consistent beyond the extension code.

### Issues

#### Critical (Must Fix)

- **Task 9: Copy-text branch references a field that does not exist on `IdeaListEntry`**
  - **What:** Step 6 says the `"copy-text"` branch should read the full artifact via `readIdea`, but then compose text using `idea.body`. In this context `idea` is the menu’s `IdeaListEntry`, whose planned shape is `{ id, title, tags, status, createdAt }` and does not include `body`.
  - **Why it matters:** An implementer following the plan literally will either produce TypeScript errors or runtime `undefined` body handling, and the copy-text action will not satisfy the spec’s `# <title>\n\n<body>` behavior.
  - **Recommendation:** Amend Task 9 Step 6 to name the full artifact returned by `readIdea` and compose from that artifact’s `title` and `body`, including the missing-artifact error path.

#### Important (Should Fix)

- **Task 3: Description verification command does not match the planned multiline constant shape**
  - **What:** The first acceptance criterion uses `grep -F "## Context" packages/pi-flow-core/extensions/idea.ts | grep -F "IDEA_TOOL_DESCRIPTION"`. If `IDEA_TOOL_DESCRIPTION` is a normal multiline string, the section-header lines will not also contain the constant name, so this recipe can fail even when the implementation is correct.
  - **Why it matters:** The acceptance check is likely to report a false failure and slow execution/review, although the accompanying unit test does cover the real requirement.
  - **Recommendation:** Change the verify recipe to rely on the unit test and/or separate greps for the constant and each required header.

#### Minor (Nice to Have)

_None._

### Recommendations

- Before execution, tighten Task 9’s copy-text wording so every branch consistently distinguishes `IdeaListEntry` from full `IdeaArtifact` records.
