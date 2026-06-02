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
  isIndicatorShape,
  isLogoVariant,
  loadPackagedDefaultTuiSettings,
  loadSavedTuiSettings,
  normalizeTuiSettings,
  saveTuiSettings,
  getTuiSettingsStore,
  resetTuiSettingsStoreForTests,
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

test("isIndicatorShape accepts the four shapes and rejects others", () => {
  for (const s of ["dot", "pulse", "spinner", "wave"]) assert.ok(isIndicatorShape(s));
  assert.equal(isIndicatorShape("blink"), false);
  assert.equal(isIndicatorShape(7), false);
  assert.equal(isIndicatorShape(undefined), false);
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

test("saveTuiSettings throws when existing JSON is malformed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-"));
  try {
    const p = path.join(dir, "tui.json");
    await writeFile(p, "{ not json", "utf8");
    await assert.rejects(() => saveTuiSettings(p, DEFAULT_TUI_SETTINGS));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PACKAGE_DEFAULT_TUI_SETTINGS_PATH resolves to the packaged tui.json and includes header.logo", async () => {
  assert.ok(PACKAGE_DEFAULT_TUI_SETTINGS_PATH.endsWith(path.join("pi-flow-ux", "tui.json")));
  const packaged = await loadPackagedDefaultTuiSettings(PACKAGE_DEFAULT_TUI_SETTINGS_PATH);
  assert.equal(packaged?.header.logo, "bracket");
});

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

test("/tui working indicator=dot still persists and toasts", async () => {
  resetTuiSettingsStoreForTests();
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-"));
  try {
    const userPath = path.join(dir, "tui.json");
    const store = getTuiSettingsStore(userPath, PACKAGE_DEFAULT_TUI_SETTINGS_PATH);
    const { pi, emit, commands } = makePi();
    store.ensureRegistered(pi as any, { registerCommand: true });
    await emit("session_start", { reason: "startup" });
    const { ctx, notices } = makeCmdCtx();
    await commands.get("tui").handler("working indicator=dot", ctx);
    assert.equal(store.get().working.indicator, "dot");
    assert.ok(notices.some((n) => n.level === "info" && /working\.indicator=dot/.test(n.msg)));
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
