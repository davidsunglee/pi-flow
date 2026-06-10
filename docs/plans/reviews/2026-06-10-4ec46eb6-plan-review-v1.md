**Reviewer:** openai-codex/gpt-5.5 via codex

### Outcome

**Verdict:** Approved

**Reasoning:** The plan covers the requested config, routing, parser, consumer-field, documentation, fixture, and test surfaces; dependency ordering is sufficient for the tasks whose verification requires the new config. No Critical or Important structural blockers were found.

### Strengths

- Task 1 clearly separates provider-preferred `modelTiers` from `crossProviderModelTiers` and specifies the exact fixed `frontier` model values.
- Task 2 covers the resolver flag cutover, old-flag rejection, provider-preferred frontier resolution, cross-provider frontier resolution, and the `efficient` rename path.
- Task 3 keeps the parser label, JSON key, accepted value set, fixtures, and error-kind rename in one task, which avoids a partial parser contract cutover.
- Task 5 correctly limits the frontier re-route to `define-spec`'s `spec-designer` and `generate-plan`'s initial `planner`, matching the non-goals.
- Task 11 provides a final integration gate with forbidden-token scans, full tests, and typecheck, while excluding historical spec/idea records and the known unrelated `cheap` comment.

### Issues

#### Critical (Must Fix)

_None._

#### Important (Should Fix)

_None._

#### Minor (Nice to Have)

- **Task 1: First config verify does not explicitly print cross-provider `efficient`**
  - **What:** The acceptance criterion requires both `modelTiers.efficient` and `crossProviderModelTiers.efficient` to be present in `.pi/flow.json` and `flow.example.json`, but its first `Verify:` command prints only `modelTiers.efficient`; it still checks both `frontier` paths and absence of `cheap`.
  - **Why it matters:** The task steps and the later no-`cheap` grep make the intended edit clear, so this is unlikely to block execution, but a more precise recipe would catch a missing `crossProviderModelTiers.efficient` key immediately.
  - **Recommendation:** Add `json.load(open(p))['crossProviderModelTiers']['efficient']` to the printed/asserted values for each config file.

### Recommendations

_None._
