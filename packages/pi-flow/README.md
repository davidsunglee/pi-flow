# pi-flow

The aggregate package for pi-flow workflow resources — a single install point that forwards all workflow skills, UX enhancements, and agent definitions through `pi-flow-core` and `pi-flow-ux`.

## What this is

`pi-flow` is the primary install path for the pi-flow skill suite. Users install this single package (`npm:pi-flow` or a git-pinned equivalent) and get all workflow resources forwarded through `node_modules/pi-flow-core/`. No skill source lives directly in this package — it exists purely to declare the dependency and expose the forwarding manifest.

## What it currently includes

- **Workflow skills** — 15 non-browser workflow skills (scout, execute-plan, define-spec, etc.) via `pi-flow-core`
- **Bundled agent definitions** (passive, not auto-installed) via `pi-flow-core`
- **Helper runner** (`pi-flow helper <id>`, `pi-flow template <id>`) via `pi-flow-core/bin`
- **Model-tier example** (`model-tiers.example.json`) via `pi-flow-core`
- **UX enhancements** — footer extension, working indicator/message, Nord theme, and packaged working defaults via `pi-flow-ux`

## What it does NOT yet include

The following are intentionally deferred to follow-up specs:

- `/flow:*` commands (no command surface implemented)
- `/flow:setup` command
- Idea/TODO command surface

## Required companion

This package declares `pi-interactive-subagent` as a peer dependency (range `"*"` for now). Install it alongside `pi-flow`:

```
pi-interactive-subagent  (peer, range "*")
```

## Minimal/headless use

`pi-flow` is opinionated and includes UX enhancements (footer, working indicator, Nord theme) alongside workflow skills. If you prefer workflow skills without UX layers, install `pi-flow-core` directly instead, using one of Pi's supported source forms:

```sh
pi install npm:pi-flow-core
# or, while private/unpublished:
pi install git:github.com/your-org/pi-flow-core@main
pi install /absolute/path/to/pi-flow-core
```

`pi-flow-core` provides all workflow skills and agent definitions without themes, footer renderers, working indicators, or packaged working defaults—suitable for headless environments, script-driven workflows, or minimal CLI setups where UX enhancements are not desired.

## Install pointer

Pi package sources must be one of: `npm:<pkg>`, a git URL (with `git:` prefix or a protocol URL), or a local/absolute path — bare names like `"pi-flow"` are not valid sources.

Reference `pi-flow` in your Pi `settings.json` using a supported source form:

```jsonc
// settings.json
{
  // pick one source form
  "packages": ["npm:pi-flow"]
  // "packages": ["git:github.com/your-org/pi-flow@main"]
  // "packages": ["/absolute/path/to/pi-flow"]
}
```

Or install it explicitly via `pi install`:

```sh
pi install npm:pi-flow
# or, while private/unpublished:
pi install git:github.com/your-org/pi-flow@main
pi install /absolute/path/to/pi-flow
```

To trial it for a single Pi run without writing to settings, use `-e` with a valid source form:

```sh
pi -e npm:pi-flow
pi -e git:github.com/your-org/pi-flow@main
```

After install, Pi discovers skills via the `pi.skills` glob in this package's `package.json`:

```
node_modules/pi-flow-core/skills/*/SKILL.md
```
