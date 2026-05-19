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
# Run a shared utility helper
pi-flow helper _shared/utils

# Run a shared helper with extra arguments
pi-flow helper _shared/format-output --json
```

### Per-skill helpers

```sh
# define-spec skill
pi-flow helper define-spec/validate-spec spec.md

# execute-plan skill
pi-flow helper execute-plan/dispatch-task task.json

# fastlane skill
pi-flow helper fastlane/build-context context.json

# refine-code skill
pi-flow helper refine-code/lint-output output.txt

# refine-plan skill
pi-flow helper refine-plan/diff-plan before.md after.md
```

### Templates (`template <id>`)

```sh
# Get path to a shared template
pi-flow template _shared/agent-persona

# Get path to a skill-specific template (fastlane example)
pi-flow template fastlane/agent-template

# Use in a shell pipeline
TEMPLATE=$(pi-flow template execute-plan/task-prompt)
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
node node_modules/pi-flow-core/bin/pi-flow.mjs <args>
```

**How skill consumers can detect this:** check whether `command -v pi-flow` resolves
to a path. If it does not (exit non-zero), fall back to the `node node_modules/...`
form. Example:

```sh
if command -v pi-flow >/dev/null 2>&1; then
  pi-flow helper _shared/utils "$@"
else
  node node_modules/pi-flow-core/bin/pi-flow.mjs helper _shared/utils "$@"
fi
```
