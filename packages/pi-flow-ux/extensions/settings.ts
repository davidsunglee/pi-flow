import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export type IndicatorShape = "dot" | "pulse" | "spinner" | "wave";
export type LogoVariant = "bracket" | "sidebar" | "rounded" | "squared";
export type HeaderDetails = "none" | "compact";

export interface TuiSettings {
  version: number;
  working: { indicator: IndicatorShape };
  header: { logo: LogoVariant; details: HeaderDetails };
  editor: Record<string, never>;
  footer: Record<string, never>;
}

export const DEFAULT_INDICATOR: IndicatorShape = "wave";
const VALID_INDICATOR_SHAPES: readonly IndicatorShape[] = ["dot", "pulse", "spinner", "wave"];

export const DEFAULT_LOGO_VARIANT: LogoVariant = "bracket";
// Canonical order, used everywhere variants are listed.
export const LOGO_VARIANTS_ORDER: readonly LogoVariant[] = ["bracket", "sidebar", "rounded", "squared"];

export const DEFAULT_HEADER_DETAILS: HeaderDetails = "compact";
// Canonical order, used everywhere details values are listed.
export const HEADER_DETAILS_ORDER: readonly HeaderDetails[] = ["none", "compact"];
export function isHeaderDetails(v: unknown): v is HeaderDetails {
  return typeof v === "string" && (HEADER_DETAILS_ORDER as readonly string[]).includes(v);
}

export const DEFAULT_TUI_SETTINGS: TuiSettings = {
  version: 1,
  working: { indicator: DEFAULT_INDICATOR },
  header: { logo: DEFAULT_LOGO_VARIANT, details: DEFAULT_HEADER_DETAILS },
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
  const details = isHeaderDetails(header.details) ? header.details : fallback.header.details;
  return {
    version: typeof value.version === "number" ? value.version : fallback.version,
    working: { indicator },
    header: { logo, details },
    editor: {},
    footer: {},
  };
}

export async function loadSavedTuiSettings(filePath: string, fallback: TuiSettings = DEFAULT_TUI_SETTINGS): Promise<TuiSettings | undefined> {
  let raw: string;
  // Any read failure (missing file, EACCES/EPERM, etc.) is treated as "no saved
  // settings" so the caller falls back to the packaged/built-in defaults.
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

function getTuiUsage(): string {
  return [
    "Usage: /tui",
    "       /tui working indicator=<dot|pulse|spinner|wave>",
    "       /tui header logo=<bracket|sidebar|rounded|squared>",
    "       /tui header details=<none|compact>",
    "       /tui header details   (print full resource details to chat)",
  ].join("\n");
}
function describeTuiSettings(s: TuiSettings): string {
  return `TUI: working.indicator=${s.working.indicator} header.logo=${s.header.logo} header.details=${s.header.details}`;
}

export interface TuiSettingsStore {
  get(): TuiSettings;
  subscribe(listener: (settings: TuiSettings) => void): () => void;
  ensureRegistered(pi: ExtensionAPI, opts: { registerCommand: boolean; showHeaderDetails?: (ctx: ExtensionCommandContext) => Promise<void> }): void;
}

class TuiSettingsStoreImpl implements TuiSettingsStore {
  private readonly settingsPath: string;
  private readonly packageDefaultPath: string;
  private settings: TuiSettings = cloneTui(DEFAULT_TUI_SETTINGS);
  private listeners = new Set<(settings: TuiSettings) => void>();
  private registeredPi: ExtensionAPI | undefined;
  private runtimeRegistered = false;
  private commandRegistered = false;
  private showHeaderDetails: ((ctx: ExtensionCommandContext) => Promise<void>) | undefined;

  constructor(settingsPath: string, packageDefaultPath: string) {
    this.settingsPath = settingsPath;
    this.packageDefaultPath = packageDefaultPath;
  }

  get(): TuiSettings { return cloneTui(this.settings); }

  subscribe(listener: (settings: TuiSettings) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  ensureRegistered(pi: ExtensionAPI, opts: { registerCommand: boolean; showHeaderDetails?: (ctx: ExtensionCommandContext) => Promise<void> }): void {
    if (this.registeredPi !== pi) {
      if (this.registeredPi !== undefined) {
        this.listeners.clear();
        this.settings = cloneTui(DEFAULT_TUI_SETTINGS);
      }
      this.registeredPi = pi;
      this.runtimeRegistered = false;
      this.commandRegistered = false;
    }
    if (opts.showHeaderDetails) this.showHeaderDetails = opts.showHeaderDetails;
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
        description: "Configure the pi-flow-ux TUI (working indicator, header logo, header details).",
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
    if (parts.length === 2 && parts[0] === "header" && parts[1] === "details") {
      if (this.showHeaderDetails) { await this.showHeaderDetails(ctx); } else { ctx.ui.notify(getTuiUsage(), "error"); }
      return;
    }
    if (parts.length === 2 && parts[0] === "header" && parts[1]!.startsWith("details=")) {
      const value = parts[1]!.slice("details=".length);
      if (!isHeaderDetails(value)) { ctx.ui.notify(getTuiUsage(), "error"); return; }
      this.settings = { ...this.settings, header: { ...this.settings.header, details: value } };
      this.emit();
      await this.persistWithToast(ctx, `TUI updated: header.details=${value}`);
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
