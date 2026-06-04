import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext, ResolvedPaths, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { DefaultPackageManager, SettingsManager, getAgentDir, loadProjectContextFiles } from "@earendil-works/pi-coding-agent";

export const CATEGORY_ORDER = ["context", "prompts", "skills", "extensions", "themes"] as const;
export type ResourceCategory = (typeof CATEGORY_ORDER)[number];

export interface ResourceItem {
  /** Display name (compact rows and full-view item lines). */
  name: string;
  /** Source sub-line for the full view's wide layout (owning package name or abbreviated path). */
  detail?: string;
  /** True only for the active theme item. */
  active?: boolean;
}

export type ResourceSnapshot = Record<ResourceCategory, ResourceItem[]>;

export function emptyResourceSnapshot(): ResourceSnapshot {
  return { context: [], prompts: [], skills: [], extensions: [], themes: [] };
}

// Two-space left margin shared by the startup header and the full details view.
export const HEADER_MARGIN = "  ";

/** Project-relative when under cwd, ~-prefixed when under home, absolute otherwise. */
export function abbreviatePath(p: string, cwd: string, homeDir: string): string {
  if (cwd.length > 0) {
    if (p === cwd) return ".";
    if (p.startsWith(cwd + path.sep)) return p.slice(cwd.length + 1);
  }
  if (homeDir.length > 0) {
    if (p === homeDir) return "~";
    if (p.startsWith(homeDir + path.sep)) return "~" + p.slice(homeDir.length);
  }
  return p;
}

/** Owning package info from the LAST node_modules segment of a path, if any. */
export function packageEntryFromPath(p: string): { packageName: string; shortName: string; relPath: string } | undefined {
  const normalized = p.split(path.sep).join("/");
  const segments = normalized.split("/");
  const idx = segments.lastIndexOf("node_modules");
  if (idx === -1) return undefined;
  const first = segments[idx + 1];
  if (!first) return undefined;
  let packageName: string;
  let rest: string[];
  if (first.startsWith("@")) {
    const second = segments[idx + 2];
    if (!second) return undefined;
    packageName = `${first}/${second}`;
    rest = segments.slice(idx + 3);
  } else {
    packageName = first;
    rest = segments.slice(idx + 2);
  }
  const slash = packageName.indexOf("/");
  const shortName = slash === -1 ? packageName : packageName.slice(slash + 1);
  return { packageName, shortName, relPath: rest.join("/") };
}

const ENTRY_FILE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

/** Short human-recognizable extension entry name. */
export function extensionDisplayName(p: string): string {
  const packaged = packageEntryFromPath(p);
  if (packaged) return packaged.shortName;
  let base = path.basename(p);
  const ext = path.extname(base);
  if (ENTRY_FILE_EXTENSIONS.has(ext)) base = base.slice(0, -ext.length);
  if (base !== "index") return base;
  const parent = path.basename(path.dirname(p));
  if (parent !== "extensions") return parent;
  return path.basename(path.dirname(path.dirname(p)));
}

/** Sub-line text for a skill/prompt/theme source path. */
export function detailForSourcePath(p: string, cwd: string, homeDir: string): string {
  return packageEntryFromPath(p)?.packageName ?? abbreviatePath(p, cwd, homeDir);
}

export interface SnapshotSources {
  cwd: string;
  homeDir: string;
  getCommands(): SlashCommandInfo[];
  getAllThemes(): { name: string; path: string | undefined }[];
  getActiveThemeName(): string | undefined;
  loadContextFiles(): { path: string }[];
  resolveConfiguredPaths(): Promise<ResolvedPaths>;
}

// Plain code-unit comparison: locale-aware sorting would break byte-determinism.
function compareByName(a: ResourceItem, b: ResourceItem): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Best-effort snapshot over the injected sources: every source access is
 * isolated in its own try/catch, so a failing source yields an empty category
 * instead of failing the whole snapshot.
 */
export async function collectResourceSnapshot(sources: SnapshotSources): Promise<ResourceSnapshot> {
  const { cwd, homeDir } = sources;

  let resolved: ResolvedPaths;
  try {
    resolved = await sources.resolveConfiguredPaths();
  } catch {
    resolved = { extensions: [], skills: [], prompts: [], themes: [] };
  }

  let contextFiles: { path: string }[];
  try {
    contextFiles = sources.loadContextFiles();
  } catch {
    contextFiles = [];
  }
  // Host order preserved: global agent-dir file first, then ancestors root→cwd.
  const context: ResourceItem[] = contextFiles.map((file) => ({ name: abbreviatePath(file.path, cwd, homeDir) }));

  let commands: SlashCommandInfo[];
  try {
    commands = sources.getCommands();
  } catch {
    commands = [];
  }
  const skills: ResourceItem[] = commands
    .filter((cmd) => cmd.source === "skill")
    .map((cmd) => ({
      name: cmd.name.startsWith("skill:") ? cmd.name.slice("skill:".length) : cmd.name,
      detail: detailForSourcePath(cmd.sourceInfo.path, cwd, homeDir),
    }))
    .sort(compareByName);
  const prompts: ResourceItem[] = commands
    .filter((cmd) => cmd.source === "prompt")
    .map((cmd) => ({ name: cmd.name, detail: detailForSourcePath(cmd.sourceInfo.path, cwd, homeDir) }))
    .sort(compareByName);

  const extensions: ResourceItem[] = resolved.extensions
    .filter((r) => r.enabled)
    .map((r) => {
      const relPath = packageEntryFromPath(r.path)?.relPath;
      return {
        name: extensionDisplayName(r.path),
        detail: relPath ? relPath : abbreviatePath(r.path, cwd, homeDir),
      };
    })
    .sort((a, b) => compareByName(a, b) || ((a.detail ?? "") < (b.detail ?? "") ? -1 : (a.detail ?? "") > (b.detail ?? "") ? 1 : 0));

  const known = new Set(resolved.themes.filter((r) => r.enabled).map((r) => path.resolve(r.path)));
  let active: string | undefined;
  try {
    active = sources.getActiveThemeName();
  } catch {
    active = undefined;
  }
  let allThemes: { name: string; path: string | undefined }[];
  try {
    allThemes = sources.getAllThemes();
  } catch {
    allThemes = [];
  }
  const themes: ResourceItem[] = allThemes
    .filter((t) => (t.path !== undefined && known.has(path.resolve(t.path))) || t.name === active)
    .map((t) => ({
      name: t.name,
      active: t.name === active,
      detail: t.path ? detailForSourcePath(t.path, cwd, homeDir) : undefined,
    }));
  themes.sort((a, b) => (a.active === b.active ? compareByName(a, b) : a.active ? -1 : 1));

  return { context, prompts, skills, extensions, themes };
}

export interface HeaderResources {
  get(): ResourceSnapshot | undefined;
  subscribe(listener: () => void): () => void;
  refresh(sources: SnapshotSources): Promise<void>;
}

export function createHeaderResources(): HeaderResources {
  let snapshot: ResourceSnapshot | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async refresh(sources) {
      snapshot = await collectResourceSnapshot(sources);
      for (const listener of [...listeners]) {
        try { listener(); } catch { /* best-effort UI work */ }
      }
    },
  };
}

export function createDefaultSnapshotSources(pi: ExtensionAPI, ctx: ExtensionContext): SnapshotSources {
  return {
    cwd: ctx.cwd,
    homeDir: os.homedir(),
    getCommands: () => pi.getCommands(),
    getAllThemes: () => ctx.ui.getAllThemes(),
    getActiveThemeName: () => {
      try {
        return SettingsManager.create(ctx.cwd).getTheme() ?? ctx.ui.theme?.name;
      } catch {
        return ctx.ui.theme?.name;
      }
    },
    loadContextFiles: () => loadProjectContextFiles({ cwd: ctx.cwd, agentDir: getAgentDir() }),
    resolveConfiguredPaths: () =>
      new DefaultPackageManager({
        cwd: ctx.cwd,
        agentDir: getAgentDir(),
        settingsManager: SettingsManager.create(ctx.cwd),
      // "skip" suppresses installs/network for any missing package source.
      }).resolve(async () => "skip"),
  };
}

export function readQuietStartup(cwd: string): boolean {
  try {
    return SettingsManager.create(cwd).getQuietStartup();
  } catch {
    return false;
  }
}
