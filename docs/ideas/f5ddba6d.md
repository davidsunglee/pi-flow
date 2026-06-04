{
  "id": "f5ddba6d",
  "title": "Tidy full startup header via pi-flow-ux",
  "tags": [
    "ux",
    "startup-header",
    "pi-flow-ux"
  ],
  "status": "closed",
  "created_at": "2026-06-03T22:54:29.188Z"
}

## Context
pi’s full startup header currently displays context, prompts, skills, extensions, themes, and startup help in a visually busy way. When `@aphotic/pi-flow-ux` is installed, we want a calmer replacement that preserves discoverability without large wrapped sections.

`pi-flow-ux` already owns a custom startup header and border-status editor, so this belongs in `packages/pi-flow-ux`. Prompts should be treated as a first-class resource category alongside context, skills, extensions, and themes; if prompts are absent today, that likely means no prompt templates are defined.

API verification against pi 0.78.0:
- `ExtensionContext` exposes UI methods, cwd/session/model data, and `ctx.getSystemPrompt()`, but not the host `resourceLoader` or `settingsManager`.
- `pi.getCommands()` exposes extension commands, prompt templates, and skill commands with `sourceInfo`, but not full extension inventory, context files, or themes.
- `ctx.ui.getAllThemes()`, `ctx.ui.getTheme()`, and `ctx.ui.theme` are public and can help with active/discovered theme display.
- `SettingsManager` is exported and has `getQuietStartup()`.
- `DefaultPackageManager.resolve()` can enumerate configured resource paths without executing extension factories.
- `DefaultResourceLoader.reload()` can produce loaded resources, but it loads/executes extension factories, so it is not a clean/safe inspection path.
- Exact parity with built-in loaded resources likely needs a small upstream pi API such as a readonly resource snapshot on extension context.

## Goal
Provide a tidy, deterministic, responsive startup header with three formats:

- `minimal`: used when core pi `quietStartup` is true; show only logo/version plus a reload/resume/fork message if present.
- `default`: used when `quietStartup` is false; show compact resource summaries by literal category.
- `full`: never shown automatically; shown on demand via `/tui header details`; exhaustive, not capped.

The design should avoid semantic classification of skills/extensions. Literal categories are simpler, faster, less ambiguous, and easier to maintain.

## Scope
Implement/design within `packages/pi-flow-ux`:

- Add about two spaces of left margin to all header/detail lines.
- Add a blank line below the startup header for breathing room.
- Omit the normal `hello`/new-session message.
- For reload/resume/fork, show the session message such as `session reloaded`, using the same theme color family as the cwd status in the border editor.
- Show literal resource categories: `context`, `prompts`, `skills`, `extensions`, `themes`.
- Default mode omits empty categories.
- Full details shows empty categories as `(0)` with `none`.
- Category labels use `mdHeading` (subtle yellow in Nord), not `accent` (cyan/blue in Nord).
- Resource names use `toolOutput` as the brighter in-theme gray.
- Default summary rows are terminal-width-responsive, never wrap, and append `+N` only when multiple items are compressed onto one row.
- Full details is exhaustive: every item appears on its own line. No `+N more`, no `… N more`.
- Full details supports dynamic layouts:
  - wide layout when usable width is about 72+ columns after margin;
  - narrow/phone layout below that.
- Tall full-details output is acceptable; rely on terminal scrollback or an interactive scrollable details component.
- Themes summaries/details should emphasize user/project/package themes and mark the active theme. Avoid flooding with built-ins; include an active built-in only if needed to explain the active theme.

## Acceptance Sketch
Default startup:

```text
  [ pi ]
  v0.78.0

  context     AGENTS.md, .pi/AGENTS.md +1
  skills      define-spec, generate-plan, execute-plan +8
  extensions  pi-flow-ux, pi-ideas +2
  themes      nord*, catppuccin +3
```

Default startup with session message:

```text
  [ pi ]
  v0.78.0
  session reloaded

  context     AGENTS.md, .pi/AGENTS.md +1
  skills      define-spec, generate-plan, execute-plan +8
  extensions  pi-flow-ux, pi-ideas
  themes      nord*, catppuccin +3
```

Minimal startup when `quietStartup` is true:

```text
  [ pi ]
  v0.78.0
```

Minimal startup with session message:

```text
  [ pi ]
  v0.78.0
  session resumed
```

Full details, wide layout:

```text
  pi header details

  context (3)
    AGENTS.md
    .pi/AGENTS.md
    ~/.pi/agent/AGENTS.md

  prompts (0)
    none

  skills (4)
    define-spec
      @aphotic/pi-flow-core
    generate-plan
      @aphotic/pi-flow-core
    execute-plan
      @aphotic/pi-flow-core
    refine-code
      @aphotic/pi-flow-core

  extensions (2)
    pi-flow-ux
      extensions/index.ts
    pi-ideas
      extensions/index.ts

  themes (2)
    nord *active
      @aphotic/pi-flow-ux
    catppuccin
      ~/.pi/agent/themes/catppuccin.json
```

Full details, narrow/phone layout:

```text
  pi header details

  context (3)
    AGENTS.md
    .pi/AGENTS.md
    ~/.pi/agent/AGENTS.md

  prompts (0)
    none

  skills (4)
    define-spec
    generate-plan
    execute-plan
    refine-code

  extensions (2)
    pi-flow-ux
    pi-ideas

  themes (2)
    nord *active
    catppuccin
```

## Open Questions
- Should we add/request an upstream pi API for an exact readonly resource/settings snapshot, or implement a best-effort resolver in `pi-flow-ux` using exported building blocks first?
- If using a best-effort resolver, how should temporary CLI resources and resources contributed by other extensions via `resources_discover` be represented when exact parity is not possible?

Completed via plan: docs/plans/2026-06-03-f5ddba6d.md
