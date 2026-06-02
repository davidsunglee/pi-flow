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
