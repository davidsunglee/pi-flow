**Reviewer:** openai-codex/gpt-5.5 via pi

### Outcome
**Verdict:** Approved
**Reasoning:** The implementation satisfies the requested border/footer/off placement behavior, keeps the compact border slot fixed-width, preserves footer/off working behavior, and includes focused regression coverage. I found no production-blocking issues.

### Strengths
- The border activity slot is integrated into the existing border composition/drop logic rather than bolted on separately, including explicit width accounting for narrow terminals.
- The implementation reuses the working indicator frame generator, preserving configured shapes and gleam/rainbow styling for border mode.
- Border ownership is coordinated through the shared working coordinator so footer/off modes can restore the normal host working surface cleanly.
- Tests cover active/idle border rendering, model-column stability across frames, priority dropping with the reserved slot, border ownership handoff, and message/indicator behavior in border vs footer/off modes.
- Verification run: `pnpm --dir packages/pi-flow-ux test` passed (159 tests).

### Issues by Severity
#### Critical
None.

#### Important
None.

#### Minor
None.

### Recommendations
- Before release, a manual visual smoke test in an actual narrow terminal would be useful to confirm glyph rendering matches the unit-test width assumptions across the target terminal/font combination.
