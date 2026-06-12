# Flow Config Resolution

This file is the single normative authority for how pi-flow selects the active
`flow.json` for dispatch and provenance helpers. Call sites and docs reference
this file instead of duplicating path logic.

## Precedence

Resolution tries, in order, and selects the first usable config:

1. **Explicit override** — a `--flow-config <path>` argument. The path is
   `~`-expanded and absolute-normalized. If it exists and is readable it is
   selected (scope `explicit`). If it is unreadable, resolution **fails** — it
   never falls back to a lower-precedence location.
2. **Project-local** — `<working-dir>/.pi/flow.json`, when it exists and is
   readable (scope `project`).
3. **User/global** — `~/.pi/agent/flow.json`, when it exists and is readable
   (scope `user`).

If none is usable, resolution fails with the canonical missing-config error.

## Working dir

`working-dir` is the active workflow workspace root. Helpers accept
`--working-dir`, defaulting to the process current working directory. The
resolver **never** walks up parent directories and **never** detects git
worktree roots itself: the caller's working dir (or its cwd default) is
authoritative. A git worktree therefore uses the worktree root; a worktree
without `.pi/flow.json` falls back to user/global unless an explicit override
was supplied.

## Selection semantics

Selection is on **existence + readability only**. The resolver never parses
JSON. JSON validity remains the consumer's concern:

- When a **selected** config later fails to parse, the consumer emits the
  canonical error naming the locations consulted up to and including the
  selected one, and does **not** fall through to a lower-precedence config.
- A project file that **exists but is unreadable** is skipped (resolution falls
  through to user/global) yet still appears in the `searched` list.

Fallback skips happen only at selection time — never after a config has been
selected.

## The `searched` list

`searched` lists, in resolution order, **only the locations actually
consulted** (an explicit-override failure lists just that one path; a
project→user fallback lists both). All entries are absolute, normalized paths.

## `<locations>` rendering

In error text, `<locations>` renders the `searched` list comma-space (`, `)
separated, in resolution order, with a leading home-directory prefix
abbreviated to `~`. (JSON output keeps absolute, unabbreviated paths.)

## Canonical missing-config error

The shared clause is:

```
flow.json missing or unreadable; searched <locations>
```

Per-consumer suffixes:

- **Dispatch/provenance dispatch helpers** append ` — cannot dispatch <agent>.`
  (this is dispatch-contract.md Template 1):
  `flow.json missing or unreadable; searched <locations> — cannot dispatch <agent>.`
- **The bare `resolve-flow-config` helper** appends `.`:
  `flow.json missing or unreadable; searched <locations>.`
- **`validate-review-provenance`** uses the bare clause as its JSON failure
  label (no suffix): `flow.json missing or unreadable; searched <locations>`

All copies of these templates and their test assertions move in lockstep; no
consumer paraphrases them.

## Trust

There is no separate trust gate for project-local `.pi/flow.json`. The resolver
is a plain file read regardless of Pi trust state; package-resolution trust is a
separate concern.
