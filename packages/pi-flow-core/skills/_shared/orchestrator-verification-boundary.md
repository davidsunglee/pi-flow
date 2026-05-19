# Orchestrator-verification boundary

## Why this exists

Orchestrator skills (`execute-plan`, `refine-code`, `refine-plan`) dispatch substantive-work
subagents (`coder`, `verifier`, `test-runner`, `code-refiner`, `plan-refiner`) and route their
structured protocol output. The substantive judgment — *does the implementation satisfy the
acceptance criteria? does the review approve the change? does the plan cover the spec?* —
lives entirely inside the dispatched subagent. The orchestrator's job is mechanical: assemble
inputs, parse markers, validate provenance, route results.

This file is the single source of truth for that boundary. The three skills above reference
it instead of restating the principle. Skill-specific forbidden-behavior examples and hot-spot
anchoring stay in each `SKILL.md`; the principle itself stays here so revisions propagate
without reword.

## The boundary

After a substantive-work subagent (`coder`, `verifier`, `test-runner`, `code-refiner`,
`plan-refiner`) returns its protocol output, the orchestrator MUST:

- Parse only the structured markers documented for that subagent (`STATUS:`, `VERDICT:`,
  `## Per-Criterion Verdicts`, `FAILING_IDENTIFIERS:`, `## Review File`, etc.) and the
  artifact handoff line where applicable.
- Validate provenance and artifact format using the sanctioned helper scripts under
  `skills/_shared/scripts/` and `skills/<skill>/scripts/` (e.g.,
  `validate-review-provenance.py`, `parse-artifact-handoff.py`, `parse-test-runner-artifact.py`,
  `parse-verifier-report.py`, `parse-refine-code-summary.py`).
- Route the parsed result mechanically to the documented next gate (commit gate, retry loop,
  user-facing menu, completion bookkeeping).

The orchestrator MUST NOT:

- Inspect the subagent's substantive output (review file body, plan content, implementation
  files, diff hunks) to form an independent verdict on the subagent's judgment.
- Override, second-guess, or recompute the subagent's `STATUS:` / `VERDICT:` line.
- Run local checks — grep, Python scripts, assertion scripts, spot checks, ad hoc test
  command invocations, or extra `Read` calls — to decide whether the subagent's verdict is
  "really" correct.
- Synthesize a subagent's artifact (e.g., a `test-runner` artifact written from locally-run
  test output, or a verifier report stitched together from local file inspections).
- Dispatch ad hoc remediation, refinement, or verification subagents outside the documented
  loop for the current skill.
- Edit the artifact under judgment (the plan, the implementation, the review file) on the
  basis of an orchestrator-formed conclusion.

## Sanctioned mechanical surface

The orchestrator's allowed activities are the mechanical-glue work needed to connect
substantive subagents:

- Filling prompt templates via the helper scripts under `skills/_shared/scripts/` and
  `skills/<skill>/scripts/` (e.g., `fill-template.py`, `assemble-coder-prompt.py`,
  `assemble-verifier-prompt.py`, `fill-refine-code-prompt.py`, `fill-refine-plan-prompt.py`).
- Plan parsing via `extract-plan-tasks.py`.
- Model-tier resolution via `resolve-model-dispatch.py` and the procedure in
  `skills/_shared/coordinator-dispatch.md`.
- Verifier-visible file-set assembly using the documented union rule (task scope ∪ worker
  report ∪ orchestrator-observed diff state).
- Diff context generation via `collect-diff-context.py`.
- Protocol-marker parsing via `parse-artifact-handoff.py`, `parse-test-runner-artifact.py`,
  `parse-verifier-report.py`, `parse-refine-code-summary.py`.
- Provenance validation via `validate-review-provenance.py`.
- Completion bookkeeping (moving artifacts, closing todos, checking git status, post-helper
  cache cleanup via `cleanup-test-runs.py` / `cleanup-pycache.py`).

These activities never produce a substantive PASS/FAIL verdict on subagent acceptance
criteria. PASS/FAIL judgments are the dispatched subagent's exclusive role.

## Why this matters

Orchestrator overreach has two failure modes: (1) duplicating the subagent's role with
inferior context (the subagent has the prompt template, the recipes, the instructions; the
orchestrator does not), and (2) polluting the orchestrator's context with substantive
inspection that biases later mechanical routing. The boundary keeps each role isolated, the
verdict authoritative, and the orchestrator's context clean.
