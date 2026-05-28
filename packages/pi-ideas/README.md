# @aphotic/pi-ideas

A standalone, configurable idea-capture extension for Pi: an `idea` tool and `/ideas` browser backed by `docs/ideas/<8hex>.md` artifacts, with JSON-configurable work-menu actions, shortcuts, refine prompt, and command name.

## Overview

The `@aphotic/pi-ideas` package provides a complete ideas management system driven by JSON configuration files. You can customize the work-menu actions, keyboard shortcuts, refinement prompts, tool descriptions, and the command name itself—all without modifying code.

## Configuration

Ideas configuration is resolved from three layers, in order of precedence:

1. **Packaged default** — An optional `ideas.json` bundled with your extension package
2. **Global config** — `~/.pi/ideas.json` (applies to all projects)
3. **Project config** — `.pi/ideas.json` in the project root

Configuration layers merge left-to-right, with later layers overriding earlier ones. Scalar fields use last-defined-wins; the `actions` array merges with special rules (see [Action Merge](#action-merge) below).

### Configuration Schema

An `ideas.json` file is a JSON object with these top-level fields:

```json
{
  "command": "ideas",
  "refinePrompt": "...",
  "toolDescription": "...",
  "promptSnippet": "...",
  "actions": [...]
}
```

All fields are optional. If omitted, built-in defaults apply:

- **`command`** (string) — The slash command name (e.g., `/ideas`). Default: `"ideas"`. The command name has no namespace prefix.
- **`refinePrompt`** (string) — The prompt sent to the assistant when the user requests to refine an idea. Supports the `${idea}` placeholder (see [Placeholder Substitution](#placeholder-substitution)). Default: A structure-neutral template requesting clarifying questions.
- **`toolDescription`** (string) — The description text shown in Pi's tool documentation for the `idea` tool. Supports the `${idea}` placeholder. Default: A concise description of the six actions (list/read/create/update/append/delete) and identifier format.
- **`promptSnippet`** (string) — A short snippet summarizing the idea tool for inclusion in prompt context windows. Default: A one-line summary.
- **`actions`** (array) — An array of work-menu actions (see [Work-Menu Actions](#work-menu-actions) below). Default: `[]` (empty array; the work submenu is hidden).

### Work-Menu Actions

Each action is a JSON object with the following fields:

```json
{
  "name": "build",
  "prompt": "/build ${idea}",
  "description": "Trigger a build for this idea",
  "shortcut": "Ctrl+Shift+B"
}
```

- **`name`** (string, required) — The action identifier. Used to identify the action in the menu and as the merge key (see [Action Merge](#action-merge)). The name also serves as the menu label.
- **`prompt`** (string, required for new actions) — The text sent to Pi's input when this action is selected. Supports the `${idea}` placeholder (see [Placeholder Substitution](#placeholder-substitution)).
- **`description`** (string, optional) — A human-readable description shown in the submenu.
- **`shortcut`** (string, optional) — A keyboard shortcut (e.g., `"Ctrl+Shift+B"`) that selects this action directly from the idea selector. Up to the first 3 actions with shortcuts will display in the hint bar; additional shortcuts are still functional but not shown (see [Keyboard Shortcuts](#keyboard-shortcuts) below).

### Placeholder Substitution

The `${idea}` placeholder in `refinePrompt`, `toolDescription`, `promptSnippet`, and action `prompt` fields is replaced at runtime with the full idea identifier in the format `IDEA-<8-hex>` (e.g., `IDEA-8530d048`).

**In JSON files:** Write the placeholder literally as `${idea}`:

```json
{
  "prompt": "/build ${idea}",
  "refinePrompt": "Refine ${idea} now."
}
```

**In shell examples:** If you need to reference the placeholder in a shell command, quote or escape it to prevent variable expansion:

```bash
# Good:
pi /ideas "create '${idea}' in context"

# Also good:
pi /ideas 'create ${idea} in context'
```

### Keyboard Shortcuts

Each action may define an optional `shortcut` for quick access from the idea selector. When an idea is selected in the browser:

- The hint bar displays the first 3 configured shortcuts (in configuration order)
- All configured shortcuts are functional, even if not shown
- Shortcuts are case-insensitive (e.g., `"Ctrl+Shift+B"` becomes `ctrl+shift+b`)
- The built-in `Ctrl+Shift+R` refine shortcut is always available

Example:

```json
{
  "actions": [
    {"name": "build", "prompt": "/build ${idea}", "shortcut": "Ctrl+Shift+B"},
    {"name": "test", "prompt": "/test ${idea}", "shortcut": "Ctrl+Shift+T"},
    {"name": "deploy", "prompt": "/deploy ${idea}", "shortcut": "Ctrl+Shift+D"},
    {"name": "archive", "prompt": "/archive ${idea}", "shortcut": "Ctrl+Shift+A"}
  ]
}
```

The hint bar will show shortcuts for `build`, `test`, and `deploy` (first 3); the `archive` shortcut is still bound but not displayed.

### Action Merge

Actions are merged across configuration layers using Pi-settings merge semantics:

1. Start with the base from the previous layer (or built-in empty array)
2. For each action in the incoming layer:
   - If the action name begins with `-` (e.g., `{"name": "-build"}`), remove the action with that base name
   - If the action has no `prompt` field, skip it (a negation without a prompt is a no-op)
   - If an action with the same `name` already exists, replace it in-place (preserving position)
   - Otherwise, append the action to the end

**Example:**

Global `~/.pi/ideas.json`:
```json
{
  "actions": [
    {"name": "build", "prompt": "/build ${idea}"},
    {"name": "test", "prompt": "/test ${idea}"}
  ]
}
```

Project `.pi/ideas.json`:
```json
{
  "actions": [
    {"name": "-build"},
    {"name": "test", "prompt": "/test-v2 ${idea}", "description": "Run v2 tests"},
    {"name": "deploy", "prompt": "/deploy ${idea}"}
  ]
}
```

**Result:**
1. Start with global: `[build, test]`
2. Negation `{name: "-build"}` removes `build`: `[test]`
3. Replacement `{name: "test", ...}` replaces in-place: `[test(v2)]`
4. Append `{name: "deploy", ...}`: `[test(v2), deploy]`

### No-Actions Behavior

If the resolved configuration has an empty `actions` array, the work submenu is hidden and the `work` item is removed from the action menu. This allows you to use the ideas tool purely for capture and refinement without offering workflow actions.

## Example Configurations

### Minimal Global Config

`~/.pi/ideas.json`:
```json
{
  "command": "ideas",
  "actions": [
    {"name": "read", "prompt": "/read-idea ${idea}", "description": "Read the full idea"}
  ]
}
```

This makes the `/ideas` browser available globally with a single action.

### Project-Specific Workflow

`.pi/ideas.json`:
```json
{
  "command": "project:ideas",
  "actions": [
    {"name": "build", "prompt": "/build ${idea}", "description": "Build and test", "shortcut": "Ctrl+Shift+B"},
    {"name": "ship", "prompt": "/ship ${idea}", "description": "Deploy to production", "shortcut": "Ctrl+Shift+P"}
  ],
  "refinePrompt": "Refine ${idea} into a production-ready task with success criteria."
}
```

This configures a project-specific command `/project:ideas` with two workflow actions.

### Override Global Actions

`.pi/ideas.json` (overriding global):
```json
{
  "actions": [
    {"name": "-build"},
    {"name": "deploy", "prompt": "/deploy ${idea}", "description": "Deploy the idea"}
  ]
}
```

This removes the global `build` action and adds a `deploy` action.

## How It Works

When the ideas extension registers, it:

1. Resolves configuration from the three layers (packaged → global → project)
2. Registers the browser command under the resolved command name (e.g., `/ideas`)
3. Registers the `idea` tool with the resolved description and prompt snippet
4. Uses the resolved actions to populate the work submenu and configure quick-key shortcuts
5. Uses the resolved refine prompt when the user requests to refine an idea

Configuration is read synchronously from the filesystem at extension registration time. Changes to `~/.pi/ideas.json` or `.pi/ideas.json` require restarting Pi to take effect.

## Default Values

If no configuration files are found, these built-in defaults apply:

- **Command:** `ideas` (accessible as `/ideas`)
- **Refine prompt:** A structure-neutral template requesting clarifying questions
- **Tool description:** A concise summary of the six actions
- **Prompt snippet:** A one-line summary for context windows
- **Actions:** Empty array (work submenu hidden)

To restore a default value after overriding it, simply omit the field in your configuration file.
