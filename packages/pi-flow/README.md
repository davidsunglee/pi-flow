# pi-flow

Aggregate install package for pi-flow workflow resources.

## What this is

`pi-flow` is the primary install path for the pi-flow skill suite. Users install this single package (`npm:pi-flow` or a git-pinned equivalent) and get all workflow resources forwarded through `node_modules/pi-flow-core/`. No skill source lives directly in this package — it exists purely to declare the dependency and expose the forwarding manifest.

## What it currently includes

- **Workflow skills** — 15 non-browser workflow skills (scout, execute-plan, define-spec, etc.) via `pi-flow-core`
- **Bundled agent definitions** (passive, not auto-installed) via `pi-flow-core`
- **Helper runner** (`pi-flow helper <id>`, `pi-flow template <id>`) via `pi-flow-core/bin`
- **Model-tier example** (`model-tiers.example.json`) via `pi-flow-core`

## What it does NOT yet include

The following are intentionally deferred to follow-up specs:

- `/flow:*` commands (no command surface implemented)
- `/flow:setup` command
- Idea/TODO command surface
- UX resources: footer, working indicator, nord theme

## Required companion

This package declares `pi-interactive-subagent` as a peer dependency (range `"*"` for now). Install it alongside `pi-flow`:

```
pi-interactive-subagent  (peer, range "*")
```

## Install pointer

Reference `pi-flow` in your Pi `settings.json` or install it via `pi -e`:

```jsonc
// settings.json (Pi loader format — exact key depends on your Pi version)
{
  "packages": ["pi-flow"]
}
```

Or install from a git-pinned source:

```sh
pi -e pi-flow
```

After install, Pi discovers skills via the `pi.skills` glob in this package's `package.json`:

```
node_modules/pi-flow-core/skills/*/SKILL.md
```
