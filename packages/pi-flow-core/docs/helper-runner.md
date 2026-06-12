# Helper Runner — `pi-flow`

`pi-flow` is the CLI entry point shipped with `pi-flow-core`. It resolves logical
resource identifiers against the installed package and dispatches to Python helper
scripts or returns markdown template paths.

## Subcommands

| Subcommand | Purpose |
|---|---|
| `helper <id> [args...]` | Run a Python helper script identified by `<id>` |
| `template <id>` | Print the absolute path to a markdown template identified by `<id>` |
| `--help`, `-h` | Print a short usage block and exit 0 |

Any unrecognised subcommand exits with code 2 and a usage hint on stderr.

---

## Resource ID Grammar

```
resource-id  ::= location "/" name
location     ::= segment          ; must not be ".."
name         ::= segment          ; must not be ".."
segment      ::= [^/]+            ; non-empty, no path separators
```

Constraints enforced at runtime:

- The full ID must **not** begin with `/`.
- Neither `location` nor `name` may be the literal string `..`.
- Both `location` and `name` must be non-empty.
- The ID must contain exactly one `/` separator (i.e. exactly two segments).

Invalid IDs cause an immediate exit 2 with a structured JSON error on stderr.

---

## Resolved Path Rules

### `helper` subcommand

| location | Resolved script path |
|---|---|
| `_shared` | `<package-root>/skills/_shared/scripts/<name>.py` |
| any other | `<package-root>/skills/<location>/scripts/<name>.py` |

`<package-root>` is the directory containing the `pi-flow-core` package (the
parent of the `bin/` directory, resolved at runtime via `import.meta.url`).

### `template` subcommand

| location | Resolved markdown path |
|---|---|
| `_shared` | `<package-root>/skills/_shared/<name>.md` |
| any other | `<package-root>/skills/<location>/<name>.md` |

---

## No-Fallback Guarantee

`pi-flow` resolves the resource path using only the rules above. If the computed
path does not exist on disk, the command exits immediately with a structured error.
**There is no fallback path-guessing strategy.** The runner will never search
alternative directories, walk up the file tree, or check `~/.pi` or any other
location. Miss means miss.

---

## Examples

### Shared helpers (`_shared/<name>`)

```sh
# Classify workflow drift between a spec and recommendation
pi-flow helper _shared/classify-workflow-drift --brief-path scout-brief.md

# Clean up __pycache__ directories under a given path
pi-flow helper _shared/cleanup-pycache skills/fastlane/scripts

# Clean up stale test-run artifacts for a specific plan
pi-flow helper _shared/cleanup-test-runs docs/test-runs/<plan-name>

# Detect the test command for a project
pi-flow helper _shared/detect-test-command

# Extract the provenance preamble from a markdown document
pi-flow helper _shared/extract-provenance-preamble --file path/to/doc.md --mode spec

# Fill a markdown template from a JSON values file
pi-flow helper _shared/fill-template --template template.md --placeholders-json values.json --output -

# Report the git workspace status as structured JSON
pi-flow helper _shared/git-workspace-status

# Parse an artifact handoff block out of an agent report
pi-flow helper _shared/parse-artifact-handoff --marker test_run --final-message report.md

# Parse a test-runner artifact into structured form
pi-flow helper _shared/parse-test-runner-artifact --artifact artifact.md

# Reconcile a test-run record against on-disk artifacts
pi-flow helper _shared/reconcile-test-run --artifact artifact.md --mode capture

# Validate coordinatorSubagentDispatch and print the coordinator model chain
pi-flow helper _shared/resolve-coordinator-dispatch --agent plan-refiner

# Resolve the active flow config (project-local or user/global) and print its path/scope
pi-flow helper _shared/resolve-flow-config --working-dir .

# Resolve the dispatch model for a given tier
pi-flow helper _shared/resolve-model-dispatch --model-tier modelTiers.capable --agent coder

# Validate provenance preambles inside a review document
pi-flow helper _shared/validate-review-provenance --review-file review.md --allowed-tiers modelTiers.capable
```

### Per-skill helpers

```sh
# define-spec skill: detect the available mux backend
pi-flow helper define-spec/detect-mux-backend

# execute-plan skill: extract task definitions from a plan
pi-flow helper execute-plan/extract-plan-tasks --plan plan.md

# execute-plan skill: assemble the coder prompt for a task
pi-flow helper execute-plan/assemble-coder-prompt --task-spec task.md --context context.md --working-dir .

# fastlane skill: recommend a workflow for a given spec
pi-flow helper fastlane/recommend-workflow --spec-path spec.md

# refine-code skill: fill the refine-code prompt template
pi-flow helper refine-code/fill-refine-code-prompt --plan-goal goal.md --plan-contents plan.md --base-sha HEAD

# refine-plan skill: parse the refine-plan summary block
pi-flow helper refine-plan/parse-refine-plan-summary --summary summary.md
```

### Templates (`template <id>`)

```sh
# Get path to a shared template
pi-flow template _shared/test-runner-dispatch

# Get path to a skill-specific template (fastlane example)
pi-flow template fastlane/fastlane-coder-prompt

# Use in a shell pipeline
TEMPLATE=$(pi-flow template execute-plan/execute-task-prompt)
cat "$TEMPLATE"
```

---

## stdout / stderr / Exit-Code Contract

### `helper`

| Outcome | stdout | stderr | Exit code |
|---|---|---|---|
| Script ran | (inherits child process stdout) | (inherits child process stderr) | child's exit code (or 1 if null) |
| Missing ID | — | `{"failure":"missing resource id"}` | 2 |
| Invalid ID format | — | `{"failure":"invalid resource id","id":"<id>"}` | 2 |
| Script not found | — | `{"failure":"unknown helper","id":"<id>","searched":"<abs-path>"}` | 2 |

### `template`

| Outcome | stdout | stderr | Exit code |
|---|---|---|---|
| Template found | `<absolute-path>\n` | — | 0 |
| Missing ID | — | `{"failure":"missing resource id"}` | 2 |
| Invalid ID format | — | `{"failure":"invalid resource id","id":"<id>"}` | 2 |
| Template not found | — | `{"failure":"unknown template","id":"<id>","searched":"<abs-path>"}` | 2 |

All JSON error objects are written as a single line terminated with `\n`.

---

## Off-PATH Invocation

When the npm `bin` entry (`pi-flow`) is not on `PATH` — for example inside a skill
script that sources the package from `node_modules` without a global install —
use the fallback form:

```sh
node node_modules/@aphotic/pi-flow-core/bin/pi-flow.mjs <args>
```

**How skill consumers can detect this:** check whether `command -v pi-flow` resolves
to a path. If it does not (exit non-zero), fall back to the `node node_modules/...`
form. Example:

```sh
if command -v pi-flow >/dev/null 2>&1; then
  pi-flow helper _shared/detect-test-command "$@"
else
  node node_modules/@aphotic/pi-flow-core/bin/pi-flow.mjs helper _shared/detect-test-command "$@"
fi
```

---

## Diagnosing version skew

If helpers or templates resolve from a different `pi-flow` install than the one
running the active skills, use `/flow:doctor` to identify the skew and
optionally repoint the managed links. See
[version-alignment.md](version-alignment.md) for the full procedure, including
verifying the active version, pinning vs floating, local-checkout workflows,
and the `--fix`/`--source` target forms.

---

## Bootstrapping the `pi-flow` shim via `/flow:setup`

Pi package installs (especially `pi install git:...`) often do not expose a
package's npm `bin` entry on the shell `PATH` used by Pi tools and subagents.
This shows up as:

```text
/bin/bash: pi-flow: command not found
```

Pi prepends `~/.pi/agent/bin` to PATH, so `/flow:setup` uses that directory as a
stable bootstrap point for a `pi-flow` command shim alongside the bundled-agent
symlinks it already manages.

### Where the shim lives

```text
~/.pi/agent/bin/pi-flow -> <installed pi-flow-core>/bin/pi-flow.mjs
```

The shim target is derived at runtime from the installed package root; nothing is
hard-coded to a particular install path.

### When to run which target

| Command | Behavior |
|---|---|
| `/flow:setup --target user` | Creates or verifies `~/.pi/agent/bin/pi-flow`. This is the command that makes `pi-flow` resolve on PATH. |
| `/flow:setup --target project` | Manages only the per-project `.pi/agents/` agent symlinks. Does **not** create or replace the global shim; if it is missing, the command prints guidance to run `/flow:setup --target user`. If the shim already exists and points elsewhere (another install), it is preserved as-is. |
| `/flow:setup` (no `--target`) | Picks `user` or `project` automatically based on the active package install scope. A `pi -e` (temporary) load refuses durable setup and asks you to pass `--target` explicitly. |

### Shim outcomes

`/flow:setup` reports the shim outcome in a dedicated notify block with the same
`created` / `skipped` / `conflict` vocabulary used for agent symlinks:

| Outcome | Effective target | Meaning |
|---|---|---|
| `created` | user | Symlink created at `~/.pi/agent/bin/pi-flow`. Reload Pi to pick it up. |
| `skipped` | user / project | A symlink already points at this package's `bin/pi-flow.mjs`. Nothing to do. |
| `conflict` | user | A real file, directory, or divergent symlink lives at the target. Setup refuses to overwrite — investigate and remove the entry, then re-run. |
| `absent-project` (info) | project | No global shim exists. Run `/flow:setup --target user` to install it. |
| `preserved-other` (info) | project | The global shim exists but points at a different install. The existing entry is preserved; remove it first, or run `/flow:setup --target user` from the install you want as the source of truth. |

### Resolving a `conflict`

The shim is never overwritten silently. To resolve a reported conflict:

1. Inspect what is currently at `~/.pi/agent/bin/pi-flow`:
   ```sh
   ls -l ~/.pi/agent/bin/pi-flow
   readlink ~/.pi/agent/bin/pi-flow 2>/dev/null
   ```
2. If you no longer need it, delete it: `rm ~/.pi/agent/bin/pi-flow`.
3. Re-run `/flow:setup --target user`.

### Relationship between npm `bin`, the shim, and the `node ...` fallback

- **npm `bin`** — works when the package is installed in a Node environment that
  exposes its `bin` entries (e.g. a local `node_modules/.bin` on PATH or a global
  npm install). Pi package installs do not always do this.
- **`~/.pi/agent/bin/pi-flow` shim** — the durable, install-method-independent way
  to make `pi-flow` resolve on PATH inside Pi tool/subagent contexts. Created on
  demand by `/flow:setup --target user`.
- **`node <package>/bin/pi-flow.mjs`** — the always-available fallback. Use it
  from a skill script that cannot assume the shim has been installed yet (see
  the `command -v pi-flow` example above).

There are no `preinstall`, `install`, `postinstall`, or `setup` npm scripts that
create the shim — installing `pi-flow-core` has no side effects. The shim is only
ever created or updated as the explicit result of running `/flow:setup`.
