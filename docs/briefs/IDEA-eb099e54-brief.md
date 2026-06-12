# Scout Brief: Centralize project-aware pi-flow flow config resolution

Source: IDEA-eb099e54
Generated at: 2026-06-12T01:55:40Z
Git SHA: d069c8b190ad79e78ba156708902fc66876fa4c4
Model: anthropic/claude-sonnet-4-6

## Relevant Files

### Python helpers with hardcoded `~/.pi/agent/flow.json` defaults

| File | Scope | Notes |
|---|---|---|
| `packages/pi-flow-core/skills/_shared/scripts/resolve-model-dispatch.py` | shared | `--flow-config` default `~/.pi/agent/flow.json`; Template 1 error hardcodes that path (line 87) |
| `packages/pi-flow-core/skills/_shared/scripts/resolve-coordinator-dispatch.py` | shared | same defaults; same Template 1 (line 69) |
| `packages/pi-flow-core/skills/_shared/scripts/validate-review-provenance.py` | shared | `--flow-config` default (line 68); failure label `"flow.json missing or unreadable"` (not the full path string) |
| `packages/pi-flow-core/skills/refine-plan/scripts/validate-and-parse-plan-review.py` | per-skill | `--flow-config` default (line 147); calls `validate-review-provenance.py` as subprocess |

### Skills that `cat ~/.pi/agent/flow.json` directly

| File | Location | Hardcoded string |
|---|---|---|
| `packages/pi-flow-core/skills/refine-plan/SKILL.md` | Step 5 (line 76) | `cat ~/.pi/agent/flow.json` + stop string `"refine-plan requires ~/.pi/agent/flow.json — see flow config setup."` |
| `packages/pi-flow-core/skills/refine-code/SKILL.md` | Step 2 (line 32) | `cat ~/.pi/agent/flow.json` + stop string `"refine-code requires ~/.pi/agent/flow.json — see flow config setup."` |

### Fill-prompt helpers (already project-aware via caller-passed paths)

| File | Relevant params |
|---|---|
| `packages/pi-flow-core/skills/refine-plan/scripts/fill-refine-plan-prompt.py` | `--flow-config <path>` (line 116), `--working-dir` (line 111); substitutes `{FLOW_CONFIG}` and `{WORKING_DIR}` |
| `packages/pi-flow-core/skills/refine-code/scripts/fill-refine-code-prompt.py` | `--flow-config <path>` (line 94), `--working-dir` (line 99); same substitution pattern |

### Contracts and docs

| File | Notes |
|---|---|
| `packages/pi-flow-core/skills/_shared/dispatch-contract.md` | Section `## Input: ~/.pi/agent/flow.json` (line 7–9); Template (1) hardcodes path (line 88); coordinator procedure hardcodes path (lines 139, 143); lists 12 dispatch call sites (lines 167–180) |
| `packages/pi-flow-core/docs/flow-config-setup.md` | Documents `~/.pi/agent/flow.json` as sole runtime source; all canonical templates hardcoded with that path |
| `packages/pi-flow-core/docs/helper-runner.md` | Runner docs; lists current `_shared/resolve-*` helpers; would need entry for new `resolve-flow-config` helper |
| `packages/pi-flow-core/docs/version-alignment.md` | Package-root alignment only; no flow config content today |
| `packages/pi-flow-core/README.md` | Line 81: "Copy flow.example.json to `~/.pi/agent/flow.json`" |

### Tests with hardcoded path strings

| File | Hardcoded assertion |
|---|---|
| `packages/pi-flow-core/skills/_shared/scripts/tests/test_resolve_model_dispatch.py` | `test_template_1_missing_file` asserts `"~/.pi/agent/flow.json missing or unreadable — cannot dispatch coder.\n"` byte-equal |
| `packages/pi-flow-core/skills/_shared/scripts/tests/test_resolve_coordinator_dispatch.py` | `test_template_1_missing_file` asserts same string for `plan-refiner` |
| `packages/pi-flow-core/__tests__/guardrail-strings.test.mjs` | Three byte-equal assertions: Template 1 in `dispatch-contract.md`, refine-plan stop string in `refine-plan/SKILL.md`, refine-code stop string in `refine-code/SKILL.md` |
| `packages/pi-flow-core/skills/_shared/scripts/tests/test_validate_review_provenance.py` | Uses failure label `"flow.json missing or unreadable"` (not the full path string), so less brittle |

### Extensions (TypeScript)

| File | Notes |
|---|---|
| `packages/pi-flow-core/extensions/doctor.ts` | Exports `buildDiagnosis`, `renderReport`, `DoctorDiagnosis`, etc.; currently reports package root only; no flow config reporting |
| `packages/pi-flow-core/extensions/doctor.test.ts` | Tests all exported doctor functions with sandbox dirs; new flow-config behavior needs coverage here |
| `packages/pi-flow-core/extensions/setup.ts` | Manages agent symlinks and `pi-flow` shim; no flow config read/write |

### Project-local config (already exists)

- `.pi/flow.json` — complete config at repo root (frontier/capable/standard/efficient tiers, crossProvider tiers, subagentDispatch, coordinatorSubagentDispatch, executionPolicy: "unrestricted")

## Key Interfaces and Types

### Python helpers — argparse contract (current)

All four helpers share the same pattern:
```python
parser.add_argument(
    "--flow-config",
    default="~/.pi/agent/flow.json",
    help="Path to flow config JSON file (default: ~/.pi/agent/flow.json)",
)
# ...
path = os.path.expanduser(args.flow_config)
```

After the change, the default logic must become: try project-local `<working-dir>/.pi/flow.json`, then user/global `~/.pi/agent/flow.json`. The `--flow-config` explicit override bypasses both.

### New `resolve-flow-config.py` output contract

The new public helper must output JSON on stdout:
```json
{ "path": "<abs-path>", "scope": "explicit|project|user", "searched": ["<path1>", "..."] }
```
Failure: single canonical error on stderr, exit 1 (for missing/unreadable explicit override or when no config is found after exhausting the fallback chain).

### `DoctorDiagnosis` interface (doctor.ts, line 169)

Currently has `active`, `effective`, `scope`, `homeDir`, `effectiveRoot`, `effectiveScope`, `surfaces`, `hasSkew`, `skewKinds`, `strictDivergence`, `absentCandidates`, `staleDispatcher`. The task adds flow config fields (resolved path, scope, whether a warning applies). The existing pattern is to export all data-carrying types and all rendering functions.

### Template 1 — the changing canonical string

Current (byte-exact in multiple places):
```
~/.pi/agent/flow.json missing or unreadable — cannot dispatch <agent>.
```

Required replacement (task: "name the searched location(s)"):
```
flow.json missing or unreadable; searched <locations> — cannot dispatch <agent>.
```
Where `<locations>` is the actual path(s) searched. Three files must change in lockstep: the Python helpers, `dispatch-contract.md`, `flow-config-setup.md`, and all test assertions.

## Dependency / Call Graph

```
Orchestrator skills (scout, define-spec, generate-plan, execute-plan, etc.)
  └─→ pi-flow helper _shared/resolve-model-dispatch --model-tier <t> --agent <a>
        (no --flow-config passed → defaults to ~/.pi/agent/flow.json today)
        (no --working-dir passed → needed for project-local resolution)

refine-plan/SKILL.md Step 5
  └─→ cat ~/.pi/agent/flow.json        (direct shell invocation, no helper)
  └─→ pi-flow helper _shared/resolve-coordinator-dispatch --agent plan-refiner
        (no --flow-config passed today)
  └─→ pi-flow helper refine-plan/fill-refine-plan-prompt ... --flow-config <path> --working-dir <WORKING_DIR>
        (already threaded; path comes from Step 5 cat output)

refine-code/SKILL.md Step 2
  └─→ cat ~/.pi/agent/flow.json        (direct shell invocation)
  └─→ pi-flow helper _shared/resolve-coordinator-dispatch --agent code-refiner
  └─→ pi-flow helper refine-code/fill-refine-code-prompt ... --flow-config <path> --working-dir <WORKING_DIR>

refine-plan/scripts/validate-and-parse-plan-review.py
  └─→ subprocess: validate-review-provenance.py --flow-config <default>

After this task:
Orchestrator skills → resolve-model-dispatch --working-dir <WORKING_DIR>
  └─→ (internally) resolve-flow-config logic: <working-dir>/.pi/flow.json → ~/.pi/agent/flow.json
refine-plan SKILL.md Step 5 → pi-flow helper _shared/resolve-flow-config --working-dir <WORKING_DIR>
  └─→ uses resolved path in downstream fill-prompt and dispatch calls
```

### Doctor's new dependency path

`buildDiagnosis()` (doctor.ts) needs to stat `<cwd>/.pi/flow.json` and `~/.pi/agent/flow.json` (analogous to how it already reads `<cwd>/.pi/settings.json`). This is a pure filesystem read in TypeScript, no subprocess.

## Patterns and Conventions

### Python helper conventions (all existing helpers follow these)
- argparse with `--agent` required and `--flow-config` optional
- `os.path.expanduser()` for `~` expansion before `open()`
- On any failure: write one line to stderr, `sys.exit(1)`; no trailing traceback visible to callers
- stdout: single-line JSON on success
- Tests use `subprocess.run([sys.executable, SCRIPT] + args, capture_output=True, text=True)`, temp files via `tempfile.NamedTemporaryFile`, and fixture JSON under `tests/fixtures/`

### TypeScript doctor extension conventions
- All logic lives in pure exported functions (`buildDiagnosis`, `classifySurface`, `renderReport`, `repairLink`, etc.) that accept injected paths — no direct `os.homedir()` or `process.cwd()` inside the pure functions
- `registerDoctor()` is the only function that calls `os.homedir()` and `ctx.cwd`, and passes them as arguments
- Tests seed fake directory trees using `mkdtempSync` and pass them as `activeRoot`, `cwd`, `homeDir`
- New flow config reporting must follow the same pure-function pattern to remain testable

### Error-template discipline
- Canonical templates are defined in `dispatch-contract.md` and duplicated byte-equal in `flow-config-setup.md` and the Python scripts
- `guardrail-strings.test.mjs` verifies the templates in the markdown docs
- Python unit tests verify the emitted strings from the scripts
- Both must be updated together — the task explicitly calls for coordinated template/test updates

### Fixture file pattern
- Flow config fixtures live in `skills/_shared/scripts/tests/fixtures/flow-*.json`
- New fixtures needed: `flow-project-local.json` (a minimal project-scope config to test project-scope resolution), tests for `--working-dir` pointing at a directory with `.pi/flow.json`

## Existing Tests and Test Patterns

### Python test suite structure
- `test_resolve_model_dispatch.py` — 15+ test methods; covers all 5 templates, tier variants, policy variants; uses `run([...args])` helper and `run_with_config(data, ...)` helper with temp files
- `test_resolve_coordinator_dispatch.py` — covers valid chain, error templates, policy; also uses the leaf script to confirm independence
- `test_validate_review_provenance.py` — uses fixture review files and temp config files; failure label format (JSON `{"failure": "..."}`) not the raw path string, so template changes don't break these tests directly

### New tests needed (aligned with acceptance sketch)
1. `test_resolve_model_dispatch.py` additions:
   - Project-local `.pi/flow.json` takes precedence over `~/.pi/agent/flow.json`
   - `--working-dir` points at a directory without `.pi/flow.json` → falls back to user/global
   - Explicit `--flow-config` wins over project-local
   - Unreadable explicit `--flow-config` fails hard (no fallback)
   - Updated Template 1 string byte-equal

2. New `test_resolve_flow_config.py` for the public diagnostic helper:
   - Explicit path → scope "explicit"
   - Project-local present → scope "project"
   - User/global only → scope "user"
   - Neither present → canonical missing-config error
   - `searched` field lists the paths tried

3. `doctor.test.ts` additions:
   - `buildDiagnosis` includes flow config fields when `.pi/flow.json` exists in the seeded cwd
   - `renderReport` shows config path/scope line
   - Warning when project-local package is active but resolution fell back to user/global config

4. `guardrail-strings.test.mjs` updates:
   - Template 1 assertion must use new `flow.json missing or unreadable; searched <locations>` form
   - `refine-plan` and `refine-code` stop-string assertions must use updated wording

### TypeScript test infrastructure (doctor.test.ts)
- `seedCore(root, version)` helper creates a fake package directory tree
- `mkSandbox(prefix)` creates a temp dir
- Tests run fully in-process against the exported pure functions; `buildDiagnosis()` is tested by seeding specific directory layouts

## Risk Areas

1. **Template 1 string must change in five places atomically**: `resolve-model-dispatch.py` (the die call), `resolve-coordinator-dispatch.py` (the die call), `dispatch-contract.md` (Template (1) block), `flow-config-setup.md` (Template 1 block), and all test assertions in `test_resolve_model_dispatch.py`, `test_resolve_coordinator_dispatch.py`, and `guardrail-strings.test.mjs`. The task explicitly calls for coordinated updates, but any miss leaves the build failing on the guardrail test.

2. **`refine-plan/SKILL.md` and `refine-code/SKILL.md` stop strings** are also tested byte-equal. These strings embed `~/.pi/agent/flow.json` — they would need to change to "resolved flow config" language. The guardrail test must be updated together.

3. **`fill-refine-plan-prompt.py` and `fill-refine-code-prompt.py` receive `--flow-config <path>`** (a file path, not content) and read the file. After SKILL.md Steps 5/2 switch from `cat ~/.pi/agent/flow.json` to calling `resolve-flow-config`, the skills must pass the resolved path from the helper's JSON output into the fill-prompt calls. That path threading is in prose (SKILL.md) not in code, so a missed update produces a working script but wrong config in the coordinator prompt.

4. **`validate-and-parse-plan-review.py` calls `validate-review-provenance.py` as a subprocess** and does not currently pass `--flow-config` (it uses the default). After the change, it must pass `--working-dir` (or the resolved config path) to the subprocess so both scripts resolve identically.

5. **The `DoctorDiagnosis` interface is exported** and consumed by `renderReport` and `renderFixReport`. Adding flow config fields is an additive interface change, but `doctor.test.ts` tests `buildDiagnosis()` return value directly — tests constructing a diagnosis mock will need updating if they spread-copy the interface.

6. **The 12 dispatch sites** listed in `dispatch-contract.md` all call `pi-flow helper _shared/resolve-model-dispatch` without `--flow-config`. After the change, they get project-local resolution automatically via `--working-dir` (once `WORKING_DIR` is threaded). Sites that already compute `WORKING_DIR` (execute-plan, refine-plan workers, etc.) must pass it explicitly; sites that don't (scout, define-spec, generate-plan at the top level) use process cwd, which in a Pi session is typically the project root. The brief from the task says "default to process cwd" — so no call-site change is strictly required for those top-level sites, but coordinator prompts should thread `WORKING_DIR` explicitly.

7. **Git worktree note**: The task specifies that a worktree root without `.pi/flow.json` falls back to user/global. The `git-workspace-status.py` helper already handles worktree detection, but the new `resolve-flow-config.py` resolver needs to be simple `os.path.join(working_dir, ".pi", "flow.json")` — it should not itself detect worktree roots or walk up; the caller's `WORKING_DIR` is the authoritative workspace root.

## Possible Misses

1. **`refine-plan/refine-plan-prompt.md` line 40 embeds `{FLOW_CONFIG}`** — this placeholder is filled by `fill-refine-plan-prompt.py` from the `--flow-config` file content. The task asks that coordinator prompts say "resolved flow config" rather than hard-coding `~/.pi/agent/flow.json`. If the prompt's surrounding prose also mentions the path (possible but not confirmed from the `head -n 40` view), that text would need updating too. Worth scanning the full prompt file.

2. **`refine-code/refine-code-prompt.md`** — similar embedded `{FLOW_CONFIG}` placeholder and potentially surrounding prose referencing the config path. Same risk.

3. **The `validate-and-parse-plan-review.py` also proxies `--flow-config` to `validate-review-provenance.py`** as a positional pass-through (it constructs the subprocess command). The path used comes from the script's own `--flow-config` arg. If `validate-and-parse-plan-review.py` gains `--working-dir` but doesn't also pass it (or the resolved path) to the `validate-review-provenance.py` subprocess, the two scripts will resolve different configs in a project-local scenario.

4. **`dispatch-contract.md` coordinator procedure (lines 139, 143)** explicitly says "reads `~/.pi/agent/flow.json`" in multiple places beyond just the Template (1) block. These prose references must also be updated to say "resolved flow config" and reference the new `flow-config-resolution.md` contract.

5. **`setup.ts` guidance** — the task says to update `/flow:setup` guidance to tell users where to place project-local vs user/global config. Currently `setup.ts` has no flow config awareness at all. The guidance update is likely in the `runHelperShimSetup` notify messages or a new dedicated section — but the "absent-project" case (line 267) and other notify calls are currently about the shim, not flow config. The guidance addition is probably a new `ui.notify` call or an inline remark, not a modification to existing logic.

6. **`__tests__/guardrail-strings.test.mjs` `test_template_1`** checks `dispatch-contract.md`, not the Python scripts. If the new Template 1 wording includes `<locations>` as a literal placeholder (not substituted), the test simply checks for the template form. But if the template says "searched `<working-dir>/.pi/flow.json`, `~/.pi/agent/flow.json`", the test needs to match that new literal form.

7. **`docs/briefs/` directory does not exist** in the repo (`docs/` contains only `RELEASING.md` and `.DS_Store`). The `docs/briefs/` directory is created by this very file, so no pre-existing conventions constrain the brief format.

## Open Questions / Ambiguities

1. **Template 1 exact new wording**: The task says `"flow.json missing or unreadable; searched <locations> — cannot dispatch <agent>."` — but `<locations>` at runtime is either one path (when an explicit `--flow-config` is rejected) or two paths (project + user/global fallback chain). The exact separator format for multiple paths (comma-separated? newline? quoted?) needs to be defined in `flow-config-resolution.md` before the template and tests are written.

2. **Refine-plan/refine-code SKILL.md stop-string update scope**: The task says to update stop strings but doesn't specify the exact replacement. Given that these are tested byte-equal in `guardrail-strings.test.mjs`, the new wording must be nailed down before edits begin.

3. **Doctor TypeScript surface type for flow config**: Should the flow config resolution appear as a new `SurfaceReport` row (re-using the existing table structure) or as a separate named field in `DoctorDiagnosis`? The latter is more straightforward; the former would fit the existing visual report layout better.

4. **`--working-dir` threading in coordinator prompts**: The `refine-plan-prompt.md` and `refine-code-prompt.md` are filled templates seen by the coordinator subagent. These prompts direct the coordinator to dispatch workers via `resolve-model-dispatch`. The task says "coordinator prompts should thread the same `WORKING_DIR`." Whether this means adding a `{WORKING_DIR}` placeholder to those prompt templates (alongside `{FLOW_CONFIG}`) is not fully clear from the current prompt content — the full prompts need inspection.

5. **`flow-config-resolution.md` trust model for project-local**: The task explicitly says no separate trust gate for `.pi/flow.json`. However, the behavior when a user is in a project that is NOT trusted by Pi (Pi sandbox) is not stated — should the resolver still pick up `.pi/flow.json` in that case? Likely yes (it's just a file read, same as any other config), but worth confirming.
