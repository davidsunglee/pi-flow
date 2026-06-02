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
