# Task Notes: Final Verification and Runtime Probes (Task 9)

Task: Plan task 9 — final verification + fresh-home/partial-override runtime probes
Plan: `docs/plans/2026-05-19-ux-package.md`
Date: 2026-05-20

---

## Step 1 — Clean install

Command (from `/Users/david/Code/pi-flow`):

```
pnpm install
```

Result:

```
Scope: all 4 workspace projects
Already up to date
Done in 155ms using pnpm v11.1.3
```

Workspace symlinks and lockfile current; exit 0.

---

## Step 2 — Typecheck `pi-flow-ux`

Command:

```
pnpm --filter pi-flow-ux exec tsc --noEmit
```

Result: clean, no diagnostics, exit 0.

Note: per the task prompt, we do not use `pnpm -r exec tsc --noEmit` because
`pi-flow-core` has a `tsconfig.json` whose include glob has no TS inputs.

---

## Step 3 — Full recursive test suite

Command:

```
pnpm -r test
```

Result: exit 0. Per-package totals:

| Package | Node tests | Result |
|---|---|---|
| `pi-flow-ux` | 77 pass / 0 fail | OK |
| `pi-flow-core` | 46 pass / 0 fail | OK |
| `pi-flow` | 13 pass / 0 fail | OK |

`pi-flow-core` additionally runs Python `unittest` suites against its skill
scripts: 239 + 29 + 240 + 5 + 54 + 38 = **605** Python tests, all OK.

---

## Step 4 — Fresh-home runtime probe (packaged defaults)

The Pi runtime constructs `WorkingCoordinator` and, on `session_start`, runs:

```
packaged = loadPackagedDefaultSettings(PACKAGE_DEFAULT_SETTINGS_PATH)
baseline = packaged ?? cloneDefaultSettings()
user     = loadSavedWorkingSettings(settingsPath, baseline)
settings = user ?? baseline
```

The probe at `/tmp/pi-flow-exec/probes/working-defaults-probe.mjs` invokes the
same exported loaders directly against a synthetic temp `$HOME` that has no
`~/.pi/agent/working.json` on disk. This exercises the exact code path the Pi
runtime executes for a fresh-home user.

Command:

```
node --experimental-strip-types /tmp/pi-flow-exec/probes/working-defaults-probe.mjs
```

Probe 1 output (no user file present):

```json
{
  "indicatorShape": "pulse",
  "active":   { "color": "#81A1C1", "gleam": false, "rainbow": false },
  "toolUse":  { "color": "#81A1C1", "gleam": true,  "rainbow": false },
  "thinking": { "color": "#81A1C1", "gleam": true,  "rainbow": true  }
}
```

Matches `packages/pi-flow-ux/working.json` byte-for-byte:
- `indicatorShape: "pulse"` — packaged pulse shape (not the code-default `spinner`)
- Nord blue `#81A1C1` for every state
- `toolUse.gleam = true`, `thinking.gleam = true`, `thinking.rainbow = true` —
  packaged accent rules

Acceptance criterion satisfied.

---

## Step 5 — Partial-user-override runtime probe

Same probe, second case. A partial user file is written:

```
~/.pi/agent/working.json
{ "indicatorShape": "dot" }
```

Probe 2 output:

```json
{
  "indicatorShape": "dot",
  "active":   { "color": "#81A1C1", "gleam": false, "rainbow": false },
  "toolUse":  { "color": "#81A1C1", "gleam": true,  "rainbow": false },
  "thinking": { "color": "#81A1C1", "gleam": true,  "rainbow": true  }
}
```

- `indicatorShape: "dot"` — user value wins.
- All other fields fall through to the packaged baseline — `active`,
  `toolUse`, `thinking` still match `packages/pi-flow-ux/working.json`
  byte-for-byte.

Acceptance criterion satisfied.

---

## Step 6 — Compiled-output verification (skipped)

Task 1's task notes (`docs/task-notes/2026-05-19-ux-package-task-1.md`, V2)
confirm Pi loads `.ts` extensions natively via jiti — no compiled `.js` step
is required. The acceptance criterion explicitly allows skipping this check
when Task 1 confirmed native `.ts` loading.

For completeness, both manifests still ship `.ts` paths (consistent with V2):

```
ux.pi  = {"extensions":["extensions/footer.ts","extensions/working/index.ts"],"themes":["themes"]}
agg.pi = {"skills":["node_modules/pi-flow-core/skills/*/SKILL.md"],
          "extensions":["node_modules/pi-flow-ux/extensions/footer.ts",
                        "node_modules/pi-flow-ux/extensions/working/index.ts"],
          "themes":["node_modules/pi-flow-ux/themes/nord.json"]}
```

No `.ts` entries are inconsistent — both packages are uniformly in native-TS
mode.

---

## Step 7 — Evidence recorded

This file is the verification-evidence record.

Probe script (kept outside the repo, ephemeral):
`/tmp/pi-flow-exec/probes/working-defaults-probe.mjs`
