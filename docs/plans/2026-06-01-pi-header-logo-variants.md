# Pi Header Logo Variants + Config Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single block-art Pi header logo with four selectable lettered `pi` wordmarks (configurable via `/tui header logo=<variant>`), and extract all TUI configuration ownership out of `WorkingCoordinator` into a dedicated `TuiSettingsStore`.

**Architecture:** A new `settings.ts` owns the `TuiSettings` schema, validation, load/save, and the `/tui` command (`TuiSettingsStore`, exposed via a per-path singleton). `WorkingCoordinator` (`working.ts`) slims to pure working-state and drops `settings` from its snapshot. `header.ts` and `editor.ts` read config from the store and subscribe for live re-render; the editor still reads working-state from the coordinator. `index.ts` wires the store first, then the coordinator and UI surfaces.

**Tech Stack:** TypeScript (Node `--experimental-strip-types`), `node:test`, `@earendil-works/pi-coding-agent` + `@earendil-works/pi-tui` extension APIs, pnpm workspace.

**Spec:** `docs/specs/2026-06-01-pi-header-logo-variants.md`

**Canonical variant order — use everywhere (type unions, arrays, usage text, tests): `bracket`, `sidebar`, `rounded`, `squared`. Default: `bracket`.**

**Test commands** (run from `packages/pi-flow-ux/`):
- Single file: `node --experimental-strip-types --test extensions/<name>.test.ts`
- Single test: append `--test-name-pattern="<name>"`
- Whole package: `pnpm --filter @aphotic/pi-flow-ux test`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `extensions/settings.ts` | Config owner: `TuiSettings` schema, `IndicatorShape`/`LogoVariant` types, defaults, normalize/validate, load/save, `TuiSettingsStore` + `/tui` command, singleton | **Create** (most logic moved from `working.ts`) |
| `extensions/settings.test.ts` | Tests for the config owner | **Create** (migrated from `working.test.ts` + new) |
| `extensions/working.ts` | Working-state only: turn/thinking/tool-call tracking, host-row suppression, `WorkingSnapshot = { visible, state }` | **Modify** (remove config) |
| `extensions/working.test.ts` | Working-state tests | **Modify** (remove migrated config tests) |
| `extensions/effects.ts` | Indicator frame generation | **Modify** (import `IndicatorShape` from `settings.ts`) |
| `extensions/header.ts` | Logo art + gradient + header lines | **Modify** (4 variants, store-driven, live re-render) |
| `extensions/header.test.ts` | Header tests | **Modify** (variant-aware) |
| `extensions/editor.ts` | Border status editor + activity slot | **Modify** (indicator from store; signatures take `IndicatorShape`) |
| `extensions/editor.test.ts` | Editor tests | **Modify** (snapshot helper + resolve\* calls) |
| `extensions/index.ts` | Extension entrypoint / wiring | **Modify** (wire store + coordinator + header) |
| `extensions/index.test.ts` | Wiring tests | **Modify** (store reset + header store arg) |
| `tui.json` | Packaged default config | **Modify** (add `header.logo`) |
| `docs/design/pi-header-logo-samples.{md,html}` | Superseded glyph exploration | **Modify/remove** |

**Dependency direction:** `settings.ts` depends on node + extension API only. `working.ts` depends on nothing local. `effects.ts` imports `IndicatorShape` from `settings.ts` and `WorkingState` from `working.ts`. `editor.ts` imports from `settings.ts` (`IndicatorShape`, `TuiSettingsStore`), `working.ts` (`WorkingSnapshot`, `getWorkingCoordinator`), `effects.ts`. `header.ts` imports from `settings.ts`. No cycles.

---

## Task 1: Create `settings.ts` schema, types, and pure functions

Move the config schema and pure helpers out of `working.ts` into a new `settings.ts`, adding `LogoVariant` + `header.logo`. (The `TuiSettingsStore` class and `/tui` command come in Task 2; the slimming of `working.ts` comes in Task 3 — until then `working.ts` keeps its copies so the suite stays green.)

**Files:**
- Create: `packages/pi-flow-ux/extensions/settings.ts`
- Create: `packages/pi-flow-ux/extensions/settings.test.ts`
- Modify: `packages/pi-flow-ux/tui.json`

- [ ] **Step 1: Write `settings.ts` with schema + pure functions**

Create `packages/pi-flow-ux/extensions/settings.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type IndicatorShape = "dot" | "pulse" | "spinner" | "wave";
export type LogoVariant = "bracket" | "sidebar" | "rounded" | "squared";

export interface TuiSettings {
  version: number;
  working: { indicator: IndicatorShape };
  header: { logo: LogoVariant };
  editor: Record<string, never>;
  footer: Record<string, never>;
}

export const DEFAULT_INDICATOR: IndicatorShape = "wave";
const VALID_INDICATOR_SHAPES: readonly IndicatorShape[] = ["dot", "pulse", "spinner", "wave"];

export const DEFAULT_LOGO_VARIANT: LogoVariant = "bracket";
// Canonical order, used everywhere variants are listed.
export const LOGO_VARIANTS_ORDER: readonly LogoVariant[] = ["bracket", "sidebar", "rounded", "squared"];

export const DEFAULT_TUI_SETTINGS: TuiSettings = {
  version: 1,
  working: { indicator: DEFAULT_INDICATOR },
  header: { logo: DEFAULT_LOGO_VARIANT },
  editor: {},
  footer: {},
};

export const DEFAULT_TUI_SETTINGS_PATH = path.join(os.homedir(), ".pi", "agent", "tui.json");
// settings.ts sits at extensions/settings.ts (one level under the package root),
// so a single ".." reaches the packaged tui.json.
export const PACKAGE_DEFAULT_TUI_SETTINGS_PATH = path.join(import.meta.dirname, "..", "tui.json");

function cloneTui(s: TuiSettings): TuiSettings { return structuredClone(s); }
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function isIndicatorShape(v: unknown): v is IndicatorShape {
  return typeof v === "string" && (VALID_INDICATOR_SHAPES as readonly string[]).includes(v);
}
export function isLogoVariant(v: unknown): v is LogoVariant {
  return typeof v === "string" && (LOGO_VARIANTS_ORDER as readonly string[]).includes(v);
}

export function normalizeTuiSettings(value: unknown, fallback: TuiSettings = DEFAULT_TUI_SETTINGS): TuiSettings {
  if (!isPlainObject(value)) return cloneTui(fallback);
  const working = isPlainObject(value.working) ? value.working : {};
  const indicator = isIndicatorShape(working.indicator) ? working.indicator : fallback.working.indicator;
  const header = isPlainObject(value.header) ? value.header : {};
  const logo = isLogoVariant(header.logo) ? header.logo : fallback.header.logo;
  return {
    version: typeof value.version === "number" ? value.version : fallback.version,
    working: { indicator },
    header: { logo },
    editor: {},
    footer: {},
  };
}

export async function loadSavedTuiSettings(filePath: string, fallback: TuiSettings = DEFAULT_TUI_SETTINGS): Promise<TuiSettings | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed)) return undefined;
  return normalizeTuiSettings(parsed, fallback);
}

export async function loadPackagedDefaultTuiSettings(packagePath: string): Promise<TuiSettings | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(packagePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error(`${packagePath}: top-level JSON must be an object`);
  }
  return normalizeTuiSettings(parsed, DEFAULT_TUI_SETTINGS);
}

export async function saveTuiSettings(filePath: string, settings: TuiSettings): Promise<void> {
  let source: Record<string, unknown> = {};
  let raw: string | undefined;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (raw !== undefined) {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      throw new Error(`${filePath}: top-level JSON must be an object`);
    }
    source = { ...parsed };
  }
  const normalized = normalizeTuiSettings(settings);
  const next = {
    ...source,
    version: normalized.version,
    working: normalized.working,
    header: normalized.header,
    editor: normalized.editor,
    footer: normalized.footer,
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
```

- [ ] **Step 2: Add `header.logo` to the packaged default `tui.json`**

Edit `packages/pi-flow-ux/tui.json` — change `"header": {}` to:

```json
{
  "version": 1,
  "working": { "indicator": "wave" },
  "header": { "logo": "bracket" },
  "editor": {},
  "footer": {}
}
```

- [ ] **Step 3: Write `settings.test.ts` (pure functions)**

Create `packages/pi-flow-ux/extensions/settings.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_TUI_SETTINGS,
  DEFAULT_LOGO_VARIANT,
  LOGO_VARIANTS_ORDER,
  PACKAGE_DEFAULT_TUI_SETTINGS_PATH,
  isLogoVariant,
  loadPackagedDefaultTuiSettings,
  loadSavedTuiSettings,
  normalizeTuiSettings,
  saveTuiSettings,
} from "./settings.ts";

test("LOGO_VARIANTS_ORDER is the canonical order with bracket default first", () => {
  assert.deepEqual([...LOGO_VARIANTS_ORDER], ["bracket", "sidebar", "rounded", "squared"]);
  assert.equal(DEFAULT_LOGO_VARIANT, "bracket");
  assert.equal(LOGO_VARIANTS_ORDER[0], DEFAULT_LOGO_VARIANT);
});

test("isLogoVariant accepts the four variants and rejects others", () => {
  for (const v of LOGO_VARIANTS_ORDER) assert.ok(isLogoVariant(v));
  assert.equal(isLogoVariant("circle"), false);
  assert.equal(isLogoVariant(42), false);
  assert.equal(isLogoVariant(undefined), false);
});

test("normalizeTuiSettings defaults header.logo to bracket for invalid input", () => {
  const result = normalizeTuiSettings({ header: { logo: "nonsense" } });
  assert.equal(result.header.logo, "bracket");
});

test("normalizeTuiSettings accepts each valid logo variant", () => {
  for (const v of LOGO_VARIANTS_ORDER) {
    assert.equal(normalizeTuiSettings({ header: { logo: v } }).header.logo, v);
  }
});

test("normalizeTuiSettings defaults working.indicator to wave for invalid input", () => {
  assert.equal(normalizeTuiSettings({ working: { indicator: "bogus" } }).working.indicator, "wave");
});

test("normalizeTuiSettings returns fallback clone for non-object input", () => {
  const result = normalizeTuiSettings(null);
  assert.deepEqual(result, DEFAULT_TUI_SETTINGS);
  assert.notEqual(result, DEFAULT_TUI_SETTINGS);
});

test("loadSavedTuiSettings returns undefined when file does not exist", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-"));
  try {
    assert.equal(await loadSavedTuiSettings(path.join(dir, "missing.json")), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadSavedTuiSettings returns undefined when JSON is malformed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-"));
  try {
    const p = path.join(dir, "tui.json");
    await writeFile(p, "{ not json", "utf8");
    assert.equal(await loadSavedTuiSettings(p), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveTuiSettings writes header.logo and round-trips", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-"));
  try {
    const p = path.join(dir, "tui.json");
    await saveTuiSettings(p, { ...DEFAULT_TUI_SETTINGS, header: { logo: "rounded" } });
    const written = JSON.parse(await readFile(p, "utf8"));
    assert.equal(written.header.logo, "rounded");
    const reloaded = await loadSavedTuiSettings(p);
    assert.equal(reloaded?.header.logo, "rounded");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveTuiSettings preserves unrelated top-level keys", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-"));
  try {
    const p = path.join(dir, "tui.json");
    await writeFile(p, JSON.stringify({ custom: "keep-me", header: {} }), "utf8");
    await saveTuiSettings(p, { ...DEFAULT_TUI_SETTINGS, header: { logo: "squared" } });
    const written = JSON.parse(await readFile(p, "utf8"));
    assert.equal(written.custom, "keep-me");
    assert.equal(written.header.logo, "squared");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PACKAGE_DEFAULT_TUI_SETTINGS_PATH resolves to the packaged tui.json and includes header.logo", async () => {
  assert.ok(PACKAGE_DEFAULT_TUI_SETTINGS_PATH.endsWith(path.join("pi-flow-ux", "tui.json")));
  const packaged = await loadPackagedDefaultTuiSettings(PACKAGE_DEFAULT_TUI_SETTINGS_PATH);
  assert.equal(packaged?.header.logo, "bracket");
});
```

- [ ] **Step 4: Run the new tests — expect PASS**

Run: `cd packages/pi-flow-ux && node --experimental-strip-types --test extensions/settings.test.ts`
Expected: PASS (all tests). The existing suite is untouched and still green at this point (`working.ts` keeps its own copies).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-flow-ux/extensions/settings.ts packages/pi-flow-ux/extensions/settings.test.ts packages/pi-flow-ux/tui.json
git commit -m "feat(ux): add settings.ts config schema with header.logo variants"
```

---

## Task 2: Add `TuiSettingsStore` + `/tui` command to `settings.ts`

Add the runtime store (load on `session_start`, `get`/`subscribe`, and the `/tui` command handling both `working indicator=` and `header logo=`), plus a per-path singleton accessor mirroring `getWorkingCoordinator`.

**Files:**
- Modify: `packages/pi-flow-ux/extensions/settings.ts`
- Modify: `packages/pi-flow-ux/extensions/settings.test.ts`

- [ ] **Step 1: Write failing tests for the store + command**

Append to `packages/pi-flow-ux/extensions/settings.test.ts`:

```ts
import {
  getTuiSettingsStore,
  resetTuiSettingsStoreForTests,
} from "./settings.ts";

function makePi() {
  const handlers = new Map<string, ((event: any, ctx: any) => any)[]>();
  const commands = new Map<string, any>();
  const pi = {
    on(event: string, handler: (event: any, ctx: any) => any) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
  };
  async function emit(event: string, payload: any = {}, ctx: any = {}) {
    for (const h of handlers.get(event) ?? []) await h(payload, ctx);
  }
  return { pi, emit, commands };
}
function makeCmdCtx() {
  const notices: { msg: string; level: string }[] = [];
  return { ctx: { ui: { notify: (msg: string, level: string) => notices.push({ msg, level }) } }, notices };
}

test("store loads packaged + user settings on session_start and emits", async () => {
  resetTuiSettingsStoreForTests();
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-"));
  try {
    const userPath = path.join(dir, "tui.json");
    await writeFile(userPath, JSON.stringify({ ...DEFAULT_TUI_SETTINGS, header: { logo: "rounded" } }), "utf8");
    const store = getTuiSettingsStore(userPath, PACKAGE_DEFAULT_TUI_SETTINGS_PATH);
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.header.logo));
    const { pi, emit } = makePi();
    store.ensureRegistered(pi as any, { registerCommand: true });
    await emit("session_start", { reason: "startup" });
    assert.equal(store.get().header.logo, "rounded");
    assert.ok(seen.includes("rounded"));
  } finally {
    await rm(dir, { recursive: true, force: true });
    resetTuiSettingsStoreForTests();
  }
});

test("/tui header logo=squared persists and toasts", async () => {
  resetTuiSettingsStoreForTests();
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-"));
  try {
    const userPath = path.join(dir, "tui.json");
    const store = getTuiSettingsStore(userPath, PACKAGE_DEFAULT_TUI_SETTINGS_PATH);
    const { pi, emit, commands } = makePi();
    store.ensureRegistered(pi as any, { registerCommand: true });
    await emit("session_start", { reason: "startup" });
    const { ctx, notices } = makeCmdCtx();
    await commands.get("tui").handler("header logo=squared", ctx);
    assert.equal(store.get().header.logo, "squared");
    const written = JSON.parse(await readFile(userPath, "utf8"));
    assert.equal(written.header.logo, "squared");
    assert.ok(notices.some((n) => n.level === "info" && /header\.logo=squared/.test(n.msg)));
  } finally {
    await rm(dir, { recursive: true, force: true });
    resetTuiSettingsStoreForTests();
  }
});

test("/tui header logo=bogus is rejected with usage error and no change", async () => {
  resetTuiSettingsStoreForTests();
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-"));
  try {
    const store = getTuiSettingsStore(path.join(dir, "tui.json"), PACKAGE_DEFAULT_TUI_SETTINGS_PATH);
    const { pi, emit, commands } = makePi();
    store.ensureRegistered(pi as any, { registerCommand: true });
    await emit("session_start", { reason: "startup" });
    const { ctx, notices } = makeCmdCtx();
    await commands.get("tui").handler("header logo=bogus", ctx);
    assert.equal(store.get().header.logo, "bracket");
    assert.ok(notices.some((n) => n.level === "error"));
  } finally {
    await rm(dir, { recursive: true, force: true });
    resetTuiSettingsStoreForTests();
  }
});

test("bare /tui reports current settings including header.logo", async () => {
  resetTuiSettingsStoreForTests();
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-"));
  try {
    const store = getTuiSettingsStore(path.join(dir, "tui.json"), PACKAGE_DEFAULT_TUI_SETTINGS_PATH);
    const { pi, emit, commands } = makePi();
    store.ensureRegistered(pi as any, { registerCommand: true });
    await emit("session_start", { reason: "startup" });
    const { ctx, notices } = makeCmdCtx();
    await commands.get("tui").handler("", ctx);
    assert.ok(notices.some((n) => /header\.logo=bracket/.test(n.msg) && /working\.indicator=/.test(n.msg)));
  } finally {
    await rm(dir, { recursive: true, force: true });
    resetTuiSettingsStoreForTests();
  }
});

test("getTuiSettingsStore throws when a settingsPath is rebound to a different packageDefaultPath", () => {
  resetTuiSettingsStoreForTests();
  getTuiSettingsStore("/tmp/a/tui.json", "/pkg/one/tui.json");
  assert.throws(() => getTuiSettingsStore("/tmp/a/tui.json", "/pkg/two/tui.json"));
  resetTuiSettingsStoreForTests();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/pi-flow-ux && node --experimental-strip-types --test extensions/settings.test.ts`
Expected: FAIL — `getTuiSettingsStore`/`resetTuiSettingsStoreForTests` are not exported yet.

- [ ] **Step 3: Implement the store + command in `settings.ts`**

Append to `packages/pi-flow-ux/extensions/settings.ts`:

```ts
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

function getTuiUsage(): string {
  return [
    "Usage: /tui",
    "       /tui working indicator=<dot|pulse|spinner|wave>",
    "       /tui header logo=<bracket|sidebar|rounded|squared>",
  ].join("\n");
}
function describeTuiSettings(s: TuiSettings): string {
  return `TUI: working.indicator=${s.working.indicator} header.logo=${s.header.logo}`;
}

export interface TuiSettingsStore {
  get(): TuiSettings;
  subscribe(listener: (settings: TuiSettings) => void): () => void;
  ensureRegistered(pi: ExtensionAPI, opts: { registerCommand: boolean }): void;
}

class TuiSettingsStoreImpl implements TuiSettingsStore {
  private readonly settingsPath: string;
  private readonly packageDefaultPath: string;
  private settings: TuiSettings = cloneTui(DEFAULT_TUI_SETTINGS);
  private listeners = new Set<(settings: TuiSettings) => void>();
  private registeredPi: ExtensionAPI | undefined;
  private runtimeRegistered = false;
  private commandRegistered = false;

  constructor(settingsPath: string, packageDefaultPath: string) {
    this.settingsPath = settingsPath;
    this.packageDefaultPath = packageDefaultPath;
  }

  get(): TuiSettings { return cloneTui(this.settings); }

  subscribe(listener: (settings: TuiSettings) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  ensureRegistered(pi: ExtensionAPI, opts: { registerCommand: boolean }): void {
    if (this.registeredPi !== pi) {
      if (this.registeredPi !== undefined) this.listeners.clear();
      this.registeredPi = pi;
      this.runtimeRegistered = false;
      this.commandRegistered = false;
    }
    if (!this.runtimeRegistered) {
      this.runtimeRegistered = true;
      pi.on("session_start", async () => {
        const packaged = await loadPackagedDefaultTuiSettings(this.packageDefaultPath);
        const baseline = packaged ?? cloneTui(DEFAULT_TUI_SETTINGS);
        const user = await loadSavedTuiSettings(this.settingsPath, baseline);
        this.settings = user ?? baseline;
        this.emit();
      });
    }
    if (opts.registerCommand && !this.commandRegistered) {
      this.commandRegistered = true;
      pi.registerCommand("tui", {
        description: "Configure the pi-flow-ux TUI (working indicator, header logo).",
        handler: async (args: string, ctx: ExtensionCommandContext) => { await this.handleCommand(args, ctx); },
      });
    }
  }

  private emit(): void {
    const snapshot = this.get();
    for (const listener of [...this.listeners]) {
      try { listener(snapshot); } catch { /* best-effort UI work */ }
    }
  }

  private async handleCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const trimmed = args.trim();
    if (!trimmed) { ctx.ui.notify(describeTuiSettings(this.settings), "info"); return; }
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 2 && parts[0] === "working" && parts[1]!.startsWith("indicator=")) {
      const shape = parts[1]!.slice("indicator=".length);
      if (!isIndicatorShape(shape)) { ctx.ui.notify(getTuiUsage(), "error"); return; }
      this.settings = { ...this.settings, working: { ...this.settings.working, indicator: shape } };
      this.emit();
      await this.persistWithToast(ctx, `TUI updated: working.indicator=${shape}`);
      return;
    }
    if (parts.length === 2 && parts[0] === "header" && parts[1]!.startsWith("logo=")) {
      const variant = parts[1]!.slice("logo=".length);
      if (!isLogoVariant(variant)) { ctx.ui.notify(getTuiUsage(), "error"); return; }
      this.settings = { ...this.settings, header: { ...this.settings.header, logo: variant } };
      this.emit();
      await this.persistWithToast(ctx, `TUI updated: header.logo=${variant}`);
      return;
    }
    ctx.ui.notify(getTuiUsage(), "error");
  }

  private async persistWithToast(ctx: ExtensionCommandContext, msg: string): Promise<void> {
    try { await saveTuiSettings(this.settingsPath, this.settings); ctx.ui.notify(msg, "info"); }
    catch (err) { const r = err instanceof Error ? err.message : String(err); ctx.ui.notify(`${msg} but could not save: ${r}`, "error"); }
  }
}

const storesBySettingsPath = new Map<string, { packageDefaultPath: string; store: TuiSettingsStoreImpl }>();

export function getTuiSettingsStore(
  settingsPath: string = DEFAULT_TUI_SETTINGS_PATH,
  packageDefaultPath: string = PACKAGE_DEFAULT_TUI_SETTINGS_PATH,
): TuiSettingsStore {
  const existing = storesBySettingsPath.get(settingsPath);
  if (existing) {
    if (existing.packageDefaultPath !== packageDefaultPath) {
      throw new Error(`getTuiSettingsStore: settingsPath=${settingsPath} already bound to packageDefaultPath=${existing.packageDefaultPath}, refusing to rebind to ${packageDefaultPath}`);
    }
    return existing.store;
  }
  const store = new TuiSettingsStoreImpl(settingsPath, packageDefaultPath);
  storesBySettingsPath.set(settingsPath, { packageDefaultPath, store });
  return store;
}

export function resetTuiSettingsStoreForTests(): void { storesBySettingsPath.clear(); }
```

> Move the `import { ExtensionAPI, ExtensionCommandContext }` line to the top of the file with the other imports if your linter requires imports-first; functionally it strips fine either way.

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/pi-flow-ux && node --experimental-strip-types --test extensions/settings.test.ts`
Expected: PASS (all settings tests).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-flow-ux/extensions/settings.ts packages/pi-flow-ux/extensions/settings.test.ts
git commit -m "feat(ux): add TuiSettingsStore and /tui header logo command"
```

---

## Task 3: Slim `working.ts` to working-state only

Remove all config ownership from `working.ts`: drop the settings schema/helpers (now in `settings.ts`), drop the `/tui` command, drop settings loading, and reduce `WorkingSnapshot` to `{ visible, state }`. The coordinator still tracks working state and suppresses the host working row.

**Files:**
- Modify: `packages/pi-flow-ux/extensions/working.ts`
- Modify: `packages/pi-flow-ux/extensions/effects.ts`
- Modify: `packages/pi-flow-ux/extensions/working.test.ts`

- [ ] **Step 1: Replace `working.ts` with the slimmed version**

Rewrite `packages/pi-flow-ux/extensions/working.ts`. Keep `WorkingState`, the coordinator's event-handling internals (`turn_start`, `message_update`, `tool_execution_*`, `turn_end`, `session_shutdown`), the host-working-row suppression, and the per-path singleton — but remove everything settings-related. The new top of the file:

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type WorkingState = "active" | "toolUse" | "thinking";

export interface WorkingSnapshot {
  visible: boolean;
  state: WorkingState;
}
```

Then in the class:
- Delete the `settings` field, `cloneTui`, `normalizeTuiSettings`, `load*`, `saveTuiSettings`, `isIndicatorShape`, `IndicatorShape`, `TuiSettings`, `DEFAULT_*`, `*_PATH`, `getTuiUsage`, `describeTuiSettings`, `handleCommand`, `persistWithToast`, and the `pi.registerCommand("tui", …)` block.
- `getSnapshot()` becomes:

```ts
getSnapshot(): WorkingSnapshot {
  return { visible: this.activeTurn, state: this.resolveState() };
}
```

- The coordinator constructor no longer needs `settingsPath`/`packageDefaultPath`. The `session_start` handler keeps **only** the host-row suppression and state reset:

```ts
pi.on("session_start", (_event, ctx) => {
  this.uiCtx = ctx;
  if (ctx.hasUI) setHostWorkingRowVisible(ctx.ui, false);
  this.emit();
});
```

- Keep `setHostWorkingRowVisible`, `subscribe`, `emit`, `resolveState`, `openToolCall`, and all tool/thinking handlers unchanged.
- The singleton accessor loses its path params:

```ts
let workingCoordinator: WorkingCoordinator | undefined;

export function getWorkingCoordinator(): WorkingCoordinator {
  if (!workingCoordinator) workingCoordinator = new WorkingCoordinator();
  return workingCoordinator;
}

export function resetWorkingCoordinatorForTests(): void { workingCoordinator = undefined; }
```

> The coordinator no longer keys by settings path (it owns no settings). `getWorkingCoordinator()` callers in `editor.ts`/`index.ts` already pass no args, so they are unaffected.

- [ ] **Step 2: Update `effects.ts` import**

Edit `packages/pi-flow-ux/extensions/effects.ts` line 1:

```ts
import type { IndicatorShape } from "./settings.ts";
import type { WorkingState } from "./working.ts";
```

- [ ] **Step 3: Prune migrated tests from `working.test.ts`**

In `packages/pi-flow-ux/extensions/working.test.ts`:
- Update the import block (lines 7–16) to drop the settings symbols, keeping only working-state ones:

```ts
import {
  getWorkingCoordinator,
  resetWorkingCoordinatorForTests,
} from "./working.ts";
```

- Delete the tests now covered by `settings.test.ts` (they reference removed exports): `loadSavedTuiSettings …` (×3), `normalizeTuiSettings …` (×3), `saveTuiSettings …` (×4), `PACKAGE_DEFAULT_TUI_SETTINGS_PATH …`, the `session_start` settings-merge tests (`session_start with no user…`, `…only a packaged baseline…`, `…full user file…`, `partial user settings overlay…`, `malformed user JSON…`, `malformed packaged JSON…`), `coordinator.getSnapshot returns a defensive copy of settings`, the `getWorkingCoordinator … rebound to a different packageDefaultPath` / `… keys coordinators by settingsPath` tests, and the three `/tui grammar …` tests.
- For the host-row suppression tests (`session_start suppresses host working row …`, `… falls back to setWorkingIndicator …`) and the tool/thinking lifecycle tests: keep them, but update any test helper that constructs the coordinator with paths or reads `snapshot.settings`. The `makeSessionCtx()` helper and event-driven assertions stay; just ensure no assertion touches `.settings`.

- [ ] **Step 4: Run working + settings + effects-dependent suites**

Run: `cd packages/pi-flow-ux && node --experimental-strip-types --test extensions/working.test.ts extensions/settings.test.ts`
Expected: PASS. (Editor/header/index will fail to typecheck against the new snapshot until their tasks — that's expected; run them per-file as you go.)

- [ ] **Step 5: Commit**

```bash
git add packages/pi-flow-ux/extensions/working.ts packages/pi-flow-ux/extensions/effects.ts packages/pi-flow-ux/extensions/working.test.ts
git commit -m "refactor(ux): slim WorkingCoordinator to working-state only"
```

---

## Task 4: Update `editor.ts` to read the indicator from the store

The editor is the only consumer of `working.indicator`. With `settings` gone from `WorkingSnapshot`, the editor reads the indicator from the store and subscribes to it for re-renders. The two pure functions take the indicator explicitly.

**Files:**
- Modify: `packages/pi-flow-ux/extensions/editor.ts`
- Modify: `packages/pi-flow-ux/extensions/editor.test.ts`

- [ ] **Step 1: Update the failing tests first (signatures + snapshot helper)**

In `packages/pi-flow-ux/extensions/editor.test.ts`:
- Add to imports: `import type { IndicatorShape } from "./settings.ts";` and `import { getTuiSettingsStore, resetTuiSettingsStoreForTests, PACKAGE_DEFAULT_TUI_SETTINGS_PATH } from "./settings.ts";`
- Replace the `snapshot()` helper (currently building `{ visible, state, settings }`) with:

```ts
function snapshot(overrides: Partial<WorkingSnapshot> = {}): WorkingSnapshot {
  return { visible: true, state: "active", ...overrides };
}
```

- Update `resolveEditorTimerCadence` tests to pass an indicator:

```ts
test("resolveEditorTimerCadence returns undefined when not visible", () => {
  assert.equal(resolveEditorTimerCadence(snapshot({ visible: false }), "wave"), undefined);
});

test("resolveEditorTimerCadence drives a 120ms cadence for a visible static dot indicator", () => {
  const cadence = resolveEditorTimerCadence(snapshot({ visible: true, state: "active" }), "dot");
  assert.equal(cadence, 120);
});

test("resolveEditorTimerCadence mirrors the spinner interval for a visible spinner indicator", () => {
  const cadence = resolveEditorTimerCadence(snapshot({ visible: true, state: "active" }), "spinner");
  assert.equal(cadence, 160);
});
```

- Update `resolveBorderActivity` tests to pass the indicator as the new middle argument:

```ts
test("resolveBorderActivity reports an idle slot when no turn is active", () => {
  const activity = resolveBorderActivity(snapshot({ visible: false }), "spinner", 0);
  assert.equal(activity.active, false);
});

test("resolveBorderActivity renders the spinner frame for the current state and time", () => {
  const snap = snapshot({ visible: true, state: "active" });
  const activity = resolveBorderActivity(snap, "spinner", 0);
  assert.equal(activity.active, true);
  assert.equal(activity.glyph, pickWorkingIndicatorFrame("spinner", "active", 0));
});

test("resolveBorderActivity applies the thinking style (rainbow) when thinking", () => {
  const snap = snapshot({ visible: true, state: "thinking" });
  const activity = resolveBorderActivity(snap, "spinner", 0);
  assert.equal(activity.active, true);
});
```

- For the three `installBorderEditor(pi as any, ctx as any)` calls (lines ~843, ~892, ~966), add a store arg. Before each, build a store:

```ts
const store = getTuiSettingsStore(path.join(agentDir, "tui.json"), PACKAGE_DEFAULT_TUI_SETTINGS_PATH);
const handle = installBorderEditor(pi as any, ctx as any, store as any);
```

  (Reuse the test's existing temp dir for the path; if a test has no temp dir, `getTuiSettingsStore("/tmp/editor-test/tui.json", PACKAGE_DEFAULT_TUI_SETTINGS_PATH)` is fine — the editor reads `store.get()` which returns defaults pre-load.) Call `resetTuiSettingsStoreForTests()` in the same place these tests call `resetWorkingCoordinatorForTests()`.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/pi-flow-ux && node --experimental-strip-types --test extensions/editor.test.ts`
Expected: FAIL — `resolveBorderActivity`/`resolveEditorTimerCadence` still take the old signature; `installBorderEditor` takes 2 args.

- [ ] **Step 3: Update `editor.ts`**

In `packages/pi-flow-ux/extensions/editor.ts`:
- Imports: add `import { type IndicatorShape, type TuiSettingsStore } from "./settings.ts";` and keep `import { getWorkingCoordinator, type WorkingSnapshot } from "./working.ts";`
- `resolveBorderActivity`:

```ts
export function resolveBorderActivity(
  snapshot: WorkingSnapshot,
  indicator: IndicatorShape,
  nowMs: number,
): BorderActivity {
  if (!snapshot.visible) return { active: false, glyph: "" };
  return {
    active: true,
    glyph: pickWorkingIndicatorFrame(indicator, snapshot.state, nowMs),
  };
}
```

- `resolveEditorTimerCadence`:

```ts
export function resolveEditorTimerCadence(snapshot: WorkingSnapshot, indicator: IndicatorShape): number | undefined {
  if (!snapshot.visible) return undefined;
  const { intervalMs } = buildWorkingIndicator(indicator, snapshot.state);
  return intervalMs ?? 120;
}
```

- `installBorderEditor(pi, ctx)` → `installBorderEditor(pi, ctx, store)`:

```ts
export function installBorderEditor(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  store: TuiSettingsStore,
): EditorHandle {
  const working = getWorkingCoordinator();
  // ... existing editor/animationTimer/timerCadence locals ...
```

- In `syncAnimation`, read the indicator from the store:

```ts
function syncAnimation(snapshot: WorkingSnapshot): void {
  editor?.requestRedraw();
  const cadence = resolveEditorTimerCadence(snapshot, store.get().working.indicator);
  if (cadence === undefined) { stopAnimation(); return; }
  if (animationTimer !== undefined && timerCadence === cadence) return;
  stopAnimation();
  timerCadence = cadence;
  animationTimer = setInterval(() => editor?.requestRedraw(), cadence);
}
```

- After `const unsubscribe = working.subscribe(syncAnimation);` also subscribe to the store so an indicator change redraws immediately:

```ts
const unsubscribeWorking = working.subscribe(syncAnimation);
const unsubscribeSettings = store.subscribe(() => syncAnimation(working.getSnapshot()));
```

  (Rename the single `unsubscribe` usage accordingly.)

- In the editor's `render(width)`, replace the `resolveBorderActivity(snapshot, nowMs)` call:

```ts
activity: resolveBorderActivity(snapshot, store.get().working.indicator, nowMs),
```

- In the returned handle's `dispose()`, unsubscribe both:

```ts
return {
  dispose() {
    stopAnimation();
    unsubscribeWorking();
    unsubscribeSettings();
    ctx.ui.setEditorComponent(undefined);
  },
};
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/pi-flow-ux && node --experimental-strip-types --test extensions/editor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-flow-ux/extensions/editor.ts packages/pi-flow-ux/extensions/editor.test.ts
git commit -m "refactor(ux): editor reads working indicator from settings store"
```

---

## Task 5: Render the four logo variants in `header.ts`

Replace the single block-art glyph with the four lettered variants, drive the active variant from the store, and re-render live via `tui.requestRender()`.

**Files:**
- Modify: `packages/pi-flow-ux/extensions/header.ts`
- Modify: `packages/pi-flow-ux/extensions/header.test.ts`

- [ ] **Step 1: Write failing tests**

Rewrite the `buildHeaderLines` and `installHeader` describe blocks in `packages/pi-flow-ux/extensions/header.test.ts`, and add variant coverage. Update imports:

```ts
import {
  humanizeStartupReason,
  applyLogoGradient,
  buildHeaderLines,
  installHeader,
  LOGO_VARIANTS,
  type SessionStartReason,
} from "./header.ts";
import type { LogoVariant, TuiSettingsStore, TuiSettings } from "./settings.ts";
import { DEFAULT_TUI_SETTINGS } from "./settings.ts";

function fakeStore(logo: LogoVariant): TuiSettingsStore {
  const settings: TuiSettings = { ...DEFAULT_TUI_SETTINGS, header: { logo } };
  return {
    get: () => settings,
    subscribe: () => () => {},
    ensureRegistered: () => {},
  };
}
```

Replace the `buildHeaderLines` describe with:

```ts
describe("buildHeaderLines", () => {
  it("default variant (bracket) renders the bracket wordmark with gradient", () => {
    const lines = buildHeaderLines("0.78.0", "startup");
    const logoRows = lines.length - 3; // minus blank, version, reason
    assert.equal(logoRows, LOGO_VARIANTS.bracket.length);
    assert.match(lines[0]!, /\x1b\[38;2;\d+;\d+;\d+m/);
  });

  it("renders each variant with the correct row count and gradient", () => {
    for (const variant of Object.keys(LOGO_VARIANTS) as LogoVariant[]) {
      const lines = buildHeaderLines("0.78.0", "startup", variant);
      const logoRows = lines.slice(0, LOGO_VARIANTS[variant].length);
      assert.equal(logoRows.length, LOGO_VARIANTS[variant].length);
      assert.ok(logoRows.some((l) => /\x1b\[38;2;\d+;\d+;\d+m/.test(l)), `${variant} should have gradient escapes`);
    }
  });

  it("unknown variant falls back to bracket", () => {
    const lines = buildHeaderLines("0.78.0", "startup", "nope" as LogoVariant);
    assert.equal(lines.length - 3, LOGO_VARIANTS.bracket.length);
  });

  it("contains a blank separator, the version line, and the humanized reason", () => {
    const lines = buildHeaderLines("0.78.0", "startup");
    assert.ok(lines.includes(""));
    assert.ok(lines.includes("version 0.78.0"));
    assert.equal(lines[lines.length - 1], humanizeStartupReason("startup"));
  });
});
```

Update the `installHeader` describe to pass a store and assert the no-UI/dispose contract still holds:

```ts
describe("installHeader", () => {
  it("does not call setHeader when hasUI is false", () => {
    let callCount = 0;
    const ctx = { hasUI: false, ui: { setHeader: () => { callCount++; } } } as any;
    const handle = installHeader(ctx, "startup", fakeStore("bracket"));
    assert.equal(callCount, 0);
    assert.equal(typeof handle.dispose, "function");
  });

  it("calls setHeader once with a factory when hasUI is true", () => {
    let callCount = 0; let arg: unknown;
    const ctx = { hasUI: true, ui: { setHeader: (a: unknown) => { callCount++; arg = a; } } } as any;
    const handle = installHeader(ctx, "startup", fakeStore("rounded"));
    assert.equal(callCount, 1);
    assert.equal(typeof arg, "function");
    assert.equal(typeof handle.dispose, "function");
  });

  it("factory renders the store's variant and subscribes for re-render", () => {
    let factory: any;
    let rendered = 0;
    const tui = { requestRender: () => { rendered++; } } as any;
    const ctx = { hasUI: true, ui: { setHeader: (f: any) => { factory = f; } } } as any;
    installHeader(ctx, "startup", fakeStore("squared"));
    const component = factory(tui, {});
    const out = component.render(80);
    // squared is 3 rows; first row carries gradient escapes
    assert.ok(out.slice(0, LOGO_VARIANTS.squared.length).some((l: string) => /\x1b\[38;2;/.test(l)));
  });

  it("dispose calls setHeader(undefined)", () => {
    const calls: unknown[] = [];
    const ctx = { hasUI: true, ui: { setHeader: (a: unknown) => { calls.push(a); } } } as any;
    const handle = installHeader(ctx, "startup", fakeStore("bracket"));
    handle.dispose();
    assert.equal(calls.length, 2);
    assert.equal(calls[1], undefined);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/pi-flow-ux && node --experimental-strip-types --test extensions/header.test.ts`
Expected: FAIL — `LOGO_VARIANTS` not exported; `installHeader` takes 2 args.

- [ ] **Step 3: Implement `header.ts`**

Edit `packages/pi-flow-ux/extensions/header.ts`. Keep `humanizeStartupReason`, `STARTUP_REASON_LABELS`, `LOGO_GRADIENT_STOPS`, `lerp`, `gradientColorAt`, and `applyLogoGradient` unchanged. Replace `PI_LOGO_ART`, `buildHeaderLines`, and `installHeader`:

```ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { type LogoVariant, DEFAULT_LOGO_VARIANT, type TuiSettingsStore } from "./settings.ts";

// Lettered "pi" wordmarks. Declared in canonical order: bracket, sidebar,
// rounded, squared. applyLogoGradient colors non-space chars by column.
export const LOGO_VARIANTS: Record<LogoVariant, string[]> = {
  bracket: ["[ pi ]"],
  sidebar: ["▌ pi ▐"],
  rounded: ["╭────╮", "│ pi │", "╰────╯"],
  squared: ["┏━━━━┓", "┃ pi ┃", "┗━━━━┛"],
};

export function buildHeaderLines(version: string, reason: string, variant: LogoVariant = DEFAULT_LOGO_VARIANT): string[] {
  const art = LOGO_VARIANTS[variant] ?? LOGO_VARIANTS[DEFAULT_LOGO_VARIANT];
  return [
    ...applyLogoGradient(art),
    "",
    `version ${version}`,
    humanizeStartupReason(reason),
  ];
}

export interface HeaderHandle { dispose(): void; }

export function installHeader(ctx: ExtensionContext, reason: string, store: TuiSettingsStore): HeaderHandle {
  if (!ctx.hasUI) return { dispose() {} };
  let unsubscribe: (() => void) | undefined;
  ctx.ui.setHeader((tui: TUI) => {
    unsubscribe?.();
    unsubscribe = store.subscribe(() => tui.requestRender());
    return {
      render: (_width: number) => buildHeaderLines(VERSION, reason, store.get().header.logo),
      invalidate() {},
      dispose() { unsubscribe?.(); unsubscribe = undefined; },
    };
  });
  return {
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
      ctx.ui.setHeader(undefined);
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/pi-flow-ux && node --experimental-strip-types --test extensions/header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-flow-ux/extensions/header.ts packages/pi-flow-ux/extensions/header.test.ts
git commit -m "feat(ux): four configurable pi header logo variants"
```

---

## Task 6: Wire the store, coordinator, and header in `index.ts`

**Files:**
- Modify: `packages/pi-flow-ux/extensions/index.ts`
- Modify: `packages/pi-flow-ux/extensions/index.test.ts`

- [ ] **Step 1: Update failing tests**

In `packages/pi-flow-ux/extensions/index.test.ts`:
- Add `import { resetTuiSettingsStoreForTests } from "./settings.ts";` and call it in the same `before`/`after` hooks that call `resetWorkingCoordinatorForTests()`.
- Add a test that `/tui` is registered and `setHeader` is invoked on `session_start`:

```ts
test("registers the /tui command and installs a header on session_start", async () => {
  resetWorkingCoordinatorForTests();
  resetTuiSettingsStoreForTests();
  const { pi, emit, commands } = makePi();
  const { ctx, calls } = makeCtx();
  indexExtension(pi as any);
  await emit("session_start", { reason: "startup" }, ctx);
  assert.ok(commands.has("tui"), "tui command should be registered");
  assert.ok(calls.some((c) => c.method === "setHeader" && typeof c.arg === "function"), "header should be installed");
  resetWorkingCoordinatorForTests();
  resetTuiSettingsStoreForTests();
});
```

  (If `makeCtx()` does not already return `calls`, extend it to expose the recorded `calls` array shown in the existing file.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/pi-flow-ux && node --experimental-strip-types --test extensions/index.test.ts`
Expected: FAIL — `/tui` not registered by index yet (the store isn't wired), and/or `installHeader` arity mismatch.

- [ ] **Step 3: Update `index.ts`**

Rewrite `packages/pi-flow-ux/extensions/index.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installBorderEditor } from "./editor.ts";
import { installBlankFooter } from "./footer.ts";
import { installHeader, type SessionStartReason } from "./header.ts";
import { getTuiSettingsStore } from "./settings.ts";
import { getWorkingCoordinator } from "./working.ts";

export { DEFAULT_TUI_SETTINGS_PATH, PACKAGE_DEFAULT_TUI_SETTINGS_PATH } from "./settings.ts";

export default function (pi: ExtensionAPI): void {
  // The settings store owns config (tui.json load + the /tui command); register
  // it first so the command exists and settings load on session_start.
  const store = getTuiSettingsStore();
  store.ensureRegistered(pi, { registerCommand: true });

  // The working coordinator owns working-state tracking only.
  getWorkingCoordinator().ensureRegistered(pi, true);

  let handles: { dispose(): void }[] = [];
  const teardown = (): void => {
    for (const h of handles) h.dispose();
    handles = [];
  };

  pi.on("session_start", (event, ctx) => {
    teardown();
    const reason = (event as { reason?: SessionStartReason }).reason ?? "startup";
    handles = [
      installBlankFooter(ctx),
      installBorderEditor(pi, ctx, store),
      installHeader(ctx, reason, store),
    ];
  });

  pi.on("session_shutdown", teardown);
}
```

> Note: `DEFAULT_TUI_SETTINGS_PATH` / `PACKAGE_DEFAULT_TUI_SETTINGS_PATH` now re-export from `settings.ts` (they moved there). External importers of these from the package entry are preserved.

- [ ] **Step 4: Run the whole package suite**

Run: `cd packages/pi-flow-ux && pnpm test`
Expected: PASS across `settings.test.ts`, `working.test.ts`, `header.test.ts`, `editor.test.ts`, `index.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-flow-ux/extensions/index.ts packages/pi-flow-ux/extensions/index.test.ts
git commit -m "refactor(ux): wire TuiSettingsStore and logo-aware header"
```

---

## Task 7: Reconcile design docs + final verification

**Files:**
- Modify/remove: `docs/design/pi-header-logo-samples.md`, `docs/design/pi-header-logo-samples.html`

- [ ] **Step 1: Supersede the old glyph-exploration doc**

The lettered-variant direction replaces the earlier block-art glyph samples. Either delete both files, or replace `docs/design/pi-header-logo-samples.md` with a short note pointing to the chosen design:

```markdown
# Pi header logo samples (superseded)

Superseded 2026-06-01 by lettered "pi" wordmarks. See
`docs/specs/2026-06-01-pi-header-logo-variants.md` for the four shipped variants
(`bracket`, `sidebar`, `rounded`, `squared`) and `extensions/header.ts`
(`LOGO_VARIANTS`).
```

(Remove the stale `.html` preview.)

- [ ] **Step 2: Full monorepo check**

Run (from repo root): `pnpm --filter @aphotic/pi-flow-ux check`
Expected: PASS. Then run the whole workspace if practical: `pnpm test`.
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Build/link the package into a Pi session (per the README install flow) and verify:
- Header shows `[ pi ]` in the gradient by default.
- `/tui` reports `working.indicator=… header.logo=bracket`.
- `/tui header logo=rounded` switches the header live to the 3-row rounded box; value persists in `~/.pi/agent/tui.json`.
- `/tui header logo=bogus` shows the usage error and does not change the header.

- [ ] **Step 4: Commit**

```bash
git add docs/design/pi-header-logo-samples.md
git rm docs/design/pi-header-logo-samples.html
git commit -m "docs: supersede block-art logo samples with lettered variants"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** four variants (Task 5) · canonical order `bracket,sidebar,rounded,squared` (Tasks 1,5) · `bracket` default (Tasks 1,5) · `/tui header logo=` + persistence + validation (Task 2) · live re-render (Task 5 header subscribe, Task 4 editor subscribe) · config extraction into `TuiSettingsStore` (Tasks 1–2) · slimmed `WorkingCoordinator` with no settings/store dep (Task 3) · editor reads indicator from store (Task 4) · migration of existing `tui.json` (Task 1, normalize default) · packaged default updated (Task 1) · preserved public path re-exports (Task 6) · doc housekeeping (Task 7).
- **Type consistency:** `LogoVariant` and `IndicatorShape` defined once in `settings.ts`; `WorkingSnapshot = { visible, state }` defined once in `working.ts`; `resolveBorderActivity(snapshot, indicator, nowMs)` and `resolveEditorTimerCadence(snapshot, indicator)` signatures match their call sites; `installBorderEditor(pi, ctx, store)` and `installHeader(ctx, reason, store)` arities match `index.ts`.
- **Ordering safety:** the header/editor read `store.get()` at render time and subscribe for updates, so the store's async `session_start` load resolving after install is handled (a redraw fires on the load emit); no dependency on handler registration order.
