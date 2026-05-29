import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { installBlankFooter } from "./blank-footer.ts";
import { installBorderStatus } from "./border-status.ts";
import { installFooter } from "./footer.ts";

/** Where session status metadata is drawn, or `off` to draw none of it. */
export type StatusPlacement = "border" | "footer" | "off";

export interface StatusSettings {
  placement: StatusPlacement;
}

/**
 * Handle returned by a status renderer's install function. The coordinator keeps
 * exactly one of these alive at a time and calls `dispose` before installing a
 * different placement, which is what makes the placements mutually exclusive.
 */
export interface StatusRendererHandle {
  dispose(): void;
}

export type StatusRendererInstaller = (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
) => StatusRendererHandle;

export interface StatusInstallers {
  border: StatusRendererInstaller;
  footer: StatusRendererInstaller;
  /** Suppresses Pi's default footer; paired with `border` so metadata isn't duplicated. */
  blankFooter: StatusRendererInstaller;
}

/**
 * Combine several renderer handles into one. Dispose tears them down in reverse
 * install order, so the border editor and its paired blank footer are removed
 * together on the next placement switch.
 */
function composeHandles(
  handles: readonly StatusRendererHandle[],
): StatusRendererHandle {
  return {
    dispose() {
      for (let i = handles.length - 1; i >= 0; i--) handles[i].dispose();
    },
  };
}

const VALID_PLACEMENTS: readonly StatusPlacement[] = ["border", "footer", "off"];

export const DEFAULT_STATUS_SETTINGS: StatusSettings = { placement: "border" };

export const DEFAULT_STATUS_SETTINGS_PATH = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "status.json",
);
// Resolves to packages/pi-flow-ux/status.json when this module is loaded from
// source. Acts as the packaged baseline that the runtime layers user settings
// on top of.
export const PACKAGE_DEFAULT_STATUS_SETTINGS_PATH = path.join(
  import.meta.dirname,
  "..",
  "..",
  "status.json",
);

const REAL_INSTALLERS: StatusInstallers = {
  border: installBorderStatus,
  footer: installFooter,
  blankFooter: installBlankFooter,
};

function cloneDefaultSettings(): StatusSettings {
  return { ...DEFAULT_STATUS_SETTINGS };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStatusPlacement(value: unknown): value is StatusPlacement {
  return (
    typeof value === "string" &&
    (VALID_PLACEMENTS as readonly string[]).includes(value)
  );
}

export function normalizeStatusSettings(
  value: unknown,
  fallback: StatusSettings = DEFAULT_STATUS_SETTINGS,
): StatusSettings {
  if (!isPlainObject(value)) return { ...fallback };
  return {
    placement: isStatusPlacement(value.placement)
      ? value.placement
      : fallback.placement,
  };
}

export async function loadSavedStatusSettings(
  filePath: string,
  fallback: StatusSettings = DEFAULT_STATUS_SETTINGS,
): Promise<StatusSettings | undefined> {
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
  return normalizeStatusSettings(parsed, fallback);
}

// Loads the packaged baseline shipped alongside the status extension. Returns
// `undefined` only when the package file is missing; malformed packaged JSON
// throws so a broken release surfaces loudly instead of silently degrading to
// code defaults.
export async function loadPackagedDefaultStatusSettings(
  packagePath: string,
): Promise<StatusSettings | undefined> {
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
  return normalizeStatusSettings(parsed, DEFAULT_STATUS_SETTINGS);
}

export async function saveStatusSettings(
  filePath: string,
  settings: StatusSettings,
): Promise<void> {
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

  const normalized = normalizeStatusSettings(settings);
  const next = { ...source, placement: normalized.placement };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Atomic write: stage to a sibling temp file, then rename into place so a
  // crash mid-write cannot leave the config truncated/partially written.
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

function getUsage(): string {
  return [
    "Usage: /status",
    "       /status border",
    "       /status footer",
    "       /status off",
  ].join("\n");
}

function describePlacement(placement: StatusPlacement): string {
  return `Status: placement=${placement} (border|footer|off)`;
}

export class StatusCoordinator {
  private readonly settingsPath: string;
  private readonly packageDefaultPath: string;
  private readonly installers: StatusInstallers;
  private settings: StatusSettings = cloneDefaultSettings();
  private handle: StatusRendererHandle | undefined;
  private pi: ExtensionAPI | undefined;
  private ctx: ExtensionContext | undefined;
  private runtimeRegistered = false;
  private commandRegistered = false;

  constructor(
    settingsPath: string,
    packageDefaultPath: string,
    installers: StatusInstallers = REAL_INSTALLERS,
  ) {
    this.settingsPath = settingsPath;
    this.packageDefaultPath = packageDefaultPath;
    this.installers = installers;
  }

  getPlacement(): StatusPlacement {
    return this.settings.placement;
  }

  ensureRegistered(pi: ExtensionAPI, registerCommand: boolean): void {
    if (!this.runtimeRegistered) {
      this.runtimeRegistered = true;

      pi.on("session_start", async (_event, ctx) => {
        this.pi = pi;
        this.ctx = ctx;
        // Three-tier merge: code default ← packaged baseline ← user override.
        // The packaged baseline is the fallback for normalizing user JSON so a
        // partial user file leaves packaged values intact.
        const packaged = await loadPackagedDefaultStatusSettings(
          this.packageDefaultPath,
        );
        const baseline = packaged ?? cloneDefaultSettings();
        const user = await loadSavedStatusSettings(this.settingsPath, baseline);
        this.settings = user ?? baseline;
        this.installActive();
      });

      pi.on("session_shutdown", () => {
        this.disposeActive();
        this.pi = undefined;
        this.ctx = undefined;
      });
    }

    if (registerCommand && !this.commandRegistered) {
      this.commandRegistered = true;
      pi.registerCommand("status", {
        description:
          "Choose where session status is drawn: border editor, footer, or off.",
        handler: async (args, ctx) => {
          await this.handleCommand(args, ctx);
        },
      });
    }
  }

  // Install the renderer for the current placement, removing any previously
  // installed renderer first. Disposing before installing is what guarantees the
  // placements are mutually exclusive at runtime.
  private installActive(): void {
    this.disposeActive();
    if (!this.pi || !this.ctx) return;
    if (this.settings.placement === "border") {
      // Border draws metadata into the editor border; the blank footer
      // suppresses Pi's default footer so the same metadata isn't duplicated
      // below the editor. Both are torn down together on the next switch.
      this.handle = composeHandles([
        this.installers.border(this.pi, this.ctx),
        this.installers.blankFooter(this.pi, this.ctx),
      ]);
    } else if (this.settings.placement === "footer") {
      this.handle = this.installers.footer(this.pi, this.ctx);
    }
    // "off" installs no renderer and leaves Pi's default footer in place.
  }

  private disposeActive(): void {
    this.handle?.dispose();
    this.handle = undefined;
  }

  private async handleCommand(
    args: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    const trimmed = args.trim();
    if (!trimmed) {
      ctx.ui.notify(describePlacement(this.settings.placement), "info");
      return;
    }

    if (!isStatusPlacement(trimmed)) {
      ctx.ui.notify(getUsage(), "error");
      return;
    }

    this.settings = { placement: trimmed };
    this.installActive();
    await this.persistWithToast(ctx, `Status placement set to ${trimmed}.`);
  }

  private async persistWithToast(
    ctx: ExtensionCommandContext,
    successMessage: string,
  ): Promise<void> {
    try {
      await saveStatusSettings(this.settingsPath, this.settings);
      ctx.ui.notify(successMessage, "info");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(`${successMessage} but could not save: ${reason}`, "error");
    }
  }
}

// Keyed by user `settingsPath` so callers using distinct user settings files
// each get their own coordinator. Rebinding the same `settingsPath` to a
// different `packageDefaultPath` throws — almost always a programming error that
// would otherwise silently mask the second baseline.
const coordinatorsBySettingsPath = new Map<
  string,
  { packageDefaultPath: string; coordinator: StatusCoordinator }
>();

export function getStatusCoordinator(
  settingsPath: string = DEFAULT_STATUS_SETTINGS_PATH,
  packageDefaultPath: string = PACKAGE_DEFAULT_STATUS_SETTINGS_PATH,
): StatusCoordinator {
  const existing = coordinatorsBySettingsPath.get(settingsPath);
  if (existing) {
    if (existing.packageDefaultPath !== packageDefaultPath) {
      throw new Error(
        `getStatusCoordinator: settingsPath=${settingsPath} already bound to packageDefaultPath=${existing.packageDefaultPath}, refusing to rebind to ${packageDefaultPath}`,
      );
    }
    return existing.coordinator;
  }
  const coordinator = new StatusCoordinator(settingsPath, packageDefaultPath);
  coordinatorsBySettingsPath.set(settingsPath, {
    packageDefaultPath,
    coordinator,
  });
  return coordinator;
}

export function resetStatusCoordinatorForTests(): void {
  coordinatorsBySettingsPath.clear();
}
