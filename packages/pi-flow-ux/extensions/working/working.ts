import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { DEFAULT_WORKING_COLOR, normalizeHexColor } from "./effects.ts";

export type WorkingState = "active" | "toolUse" | "thinking";
export type WorkingCommandState = "active" | "tool-use" | "thinking";
export type IndicatorShape = "dot" | "pulse" | "spinner";

export interface WorkingStyle {
  color: string;
  gleam: boolean;
  rainbow: boolean;
}

export interface WorkingSettings {
  indicatorShape: IndicatorShape;
  active: WorkingStyle;
  toolUse: WorkingStyle;
  thinking: WorkingStyle;
}

export interface WorkingSnapshot {
  visible: boolean;
  state: WorkingState;
  settings: WorkingSettings;
}

const FOOTER_STATUS_KEY = "working-indicator";
const VALID_COMMAND_STATES: readonly WorkingCommandState[] = ["active", "tool-use", "thinking"];
const VALID_INDICATOR_SHAPES: readonly IndicatorShape[] = ["dot", "pulse", "spinner"];

export const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".pi", "agent", "working.json");
// Resolves to packages/pi-flow-ux/working.json when this module is loaded from
// source. Acts as the packaged baseline that the runtime layers user settings
// on top of.
export const PACKAGE_DEFAULT_SETTINGS_PATH = path.join(import.meta.dirname, "..", "..", "working.json");
export const DEFAULT_WORKING_SETTINGS: WorkingSettings = {
  indicatorShape: "spinner",
  active: { color: DEFAULT_WORKING_COLOR, gleam: false, rainbow: false },
  toolUse: { color: DEFAULT_WORKING_COLOR, gleam: true, rainbow: false },
  thinking: { color: DEFAULT_WORKING_COLOR, gleam: true, rainbow: true },
};
export { DEFAULT_WORKING_COLOR };

function cloneDefaultSettings(): WorkingSettings {
  return structuredClone(DEFAULT_WORKING_SETTINGS);
}

function cloneSettings(settings: WorkingSettings): WorkingSettings {
  return structuredClone(settings);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIndicatorShape(value: unknown): value is IndicatorShape {
  return typeof value === "string" && (VALID_INDICATOR_SHAPES as readonly string[]).includes(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}

function normalizeStyle(value: unknown, fallback: WorkingStyle): WorkingStyle {
  if (!isPlainObject(value)) return { ...fallback };
  return {
    color: isHexColor(value.color) ? normalizeHexColor(value.color) : fallback.color,
    gleam: typeof value.gleam === "boolean" ? value.gleam : fallback.gleam,
    rainbow: typeof value.rainbow === "boolean" ? value.rainbow : fallback.rainbow,
  };
}

export function normalizeWorkingSettings(value: unknown, fallback: WorkingSettings = DEFAULT_WORKING_SETTINGS): WorkingSettings {
  if (!isPlainObject(value)) return cloneSettings(fallback);
  return {
    indicatorShape: isIndicatorShape(value.indicatorShape) ? value.indicatorShape : fallback.indicatorShape,
    active: normalizeStyle(value.active, fallback.active),
    toolUse: normalizeStyle(value.toolUse, fallback.toolUse),
    thinking: normalizeStyle(value.thinking, fallback.thinking),
  };
}

export async function loadSavedWorkingSettings(filePath: string, fallback: WorkingSettings = DEFAULT_WORKING_SETTINGS): Promise<WorkingSettings | undefined> {
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
  return normalizeWorkingSettings(parsed, fallback);
}

// Loads the packaged baseline shipped alongside the working extension. Returns
// `undefined` only when the package file is missing; malformed packaged JSON
// throws so a broken release surfaces loudly instead of silently degrading to
// code defaults.
export async function loadPackagedDefaultSettings(
  packagePath: string,
): Promise<WorkingSettings | undefined> {
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
  return normalizeWorkingSettings(parsed, DEFAULT_WORKING_SETTINGS);
}

export async function saveWorkingSettings(filePath: string, settings: WorkingSettings): Promise<void> {
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

  const normalized = normalizeWorkingSettings(settings);
  const next = {
    ...source,
    indicatorShape: normalized.indicatorShape,
    active: normalized.active,
    toolUse: normalized.toolUse,
    thinking: normalized.thinking,
  };

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
    "Usage: /working",
    "       /working indicator=dot|pulse|spinner",
    "       /working active color=default|#RRGGBB",
    "       /working active gleam=on|off",
    "       /working active rainbow=on|off",
    "       /working tool-use color=default|#RRGGBB",
    "       /working tool-use gleam=on|off",
    "       /working tool-use rainbow=on|off",
    "       /working thinking color=default|#RRGGBB",
    "       /working thinking gleam=on|off",
    "       /working thinking rainbow=on|off",
  ].join("\n");
}

function getCommandState(state: WorkingCommandState): WorkingState {
  return state === "tool-use" ? "toolUse" : state;
}

function getDisplayStateName(state: WorkingState): WorkingCommandState {
  return state === "toolUse" ? "tool-use" : state;
}

function describeSettings(settings: WorkingSettings): string {
  const describe = (state: WorkingState) => {
    const style = settings[state];
    const name = getDisplayStateName(state);
    return `${name}(color=${style.color}, gleam=${style.gleam ? "on" : "off"}, rainbow=${style.rainbow ? "on" : "off"})`;
  };
  return `Working: indicatorShape=${settings.indicatorShape} | ${describe("active")} | ${describe("toolUse")} | ${describe("thinking")}`;
}

function extractToolCallId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

class WorkingCoordinator {
  private readonly settingsPath: string;
  private readonly packageDefaultPath: string;
  private settings: WorkingSettings = cloneDefaultSettings();
  private activeTurn = false;
  private thinking = false;
  // Tracks the set of tool invocations that are currently in flight, keyed by
  // `toolCallId`. A single invocation can surface through multiple event
  // streams (`toolcall_end` from the model as the earliest opener, plus the
  // `tool_execution_*` lifecycle as fallback). Keying by id — rather than
  // using a plain depth counter — lets us collapse those into one in-flight
  // unit so the same invocation is never double-counted.
  private inflightToolCalls = new Set<string>();
  private listeners = new Set<(snapshot: WorkingSnapshot) => void>();
  private runtimeRegistered = false;
  private commandRegistered = false;

  constructor(settingsPath: string, packageDefaultPath: string) {
    this.settingsPath = settingsPath;
    this.packageDefaultPath = packageDefaultPath;
  }

  getSnapshot(): WorkingSnapshot {
    // Return a defensive copy so callers cannot mutate internal state via the
    // returned `settings` reference.
    return {
      visible: this.activeTurn,
      state: this.resolveState(),
      settings: cloneSettings(this.settings),
    };
  }

  subscribe(listener: (snapshot: WorkingSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  ensureRegistered(pi: ExtensionAPI, registerCommand: boolean): void {
    if (!this.runtimeRegistered) {
      this.runtimeRegistered = true;

      pi.on("session_start", async (_event, ctx) => {
        // Clear any stale footer status left behind by previous versions of
        // this extension that surfaced working state via setStatus. Current
        // builds do not write this key, but older installations might still
        // have an entry in their footer cache until they reload.
        ctx.ui.setStatus(FOOTER_STATUS_KEY, undefined);
        // Three-tier merge: code default ← packaged baseline ← user override.
        // Each layer fills in fields the layer above did not specify; the
        // packaged baseline is the fallback for normalizing user JSON so that
        // partial user files leave packaged values intact.
        const packaged = await loadPackagedDefaultSettings(this.packageDefaultPath);
        const baseline = packaged ?? cloneDefaultSettings();
        const user = await loadSavedWorkingSettings(this.settingsPath, baseline);
        this.settings = user ?? baseline;
        this.emit();
      });

      pi.on("turn_start", () => {
        this.activeTurn = true;
        this.thinking = false;
        this.inflightToolCalls.clear();
        this.emit();
      });

      pi.on("message_update", (event) => {
        // Ignore late message updates that arrive after the turn has ended.
        // They would otherwise flip `thinking` on while we're idle and show
        // the working UI outside of an active turn.
        if (!this.activeTurn) return;
        const payload = event as
          | { assistantMessageEvent?: { type?: unknown; toolCall?: { id?: unknown } } }
          | undefined;
        const type = payload?.assistantMessageEvent?.type;
        if (type === "thinking_start") {
          this.thinking = true;
          this.emit();
        } else if (type === "thinking_end") {
          this.thinking = false;
          this.emit();
        } else if (type === "toolcall_end") {
          // `toolcall_end` is the earliest reliable opener for the broadened
          // `toolUse` state: the model has finalized the tool call, but the
          // runtime may not have dispatched `tool_execution_start` yet. We
          // deliberately ignore `toolcall_start` / `toolcall_delta` because
          // partial / streaming call bodies do not yet constitute an
          // in-flight invocation we can key off.
          this.openToolCall(extractToolCallId(payload?.assistantMessageEvent?.toolCall?.id));
        }
      });

      pi.on("tool_execution_start", (event) => {
        if (!this.activeTurn) return;
        // Fallback opener in case `toolcall_end` did not fire first (or we
        // missed it). Keyed by `toolCallId` so it collapses with the
        // `toolcall_end` opener — no double-counting for the same invocation.
        this.openToolCall(extractToolCallId((event as { toolCallId?: unknown } | undefined)?.toolCallId));
      });

      pi.on("tool_execution_update", (event) => {
        if (!this.activeTurn) return;
        // Fallback opener for cases where neither `toolcall_end` nor
        // `tool_execution_start` was observed before the first update.
        this.openToolCall(extractToolCallId((event as { toolCallId?: unknown } | undefined)?.toolCallId));
      });

      pi.on("tool_execution_end", (event) => {
        if (!this.activeTurn) return;
        // Single close signal for the broadened lifecycle. Missing / malformed
        // ids are dropped silently. Removing an id we never tracked (stray
        // end) is a no-op — `Set#delete` returns false and we skip the emit.
        const id = extractToolCallId((event as { toolCallId?: unknown } | undefined)?.toolCallId);
        if (id === undefined) return;
        if (this.inflightToolCalls.delete(id)) {
          this.emit();
        }
      });

      pi.on("turn_end", () => {
        this.activeTurn = false;
        this.thinking = false;
        this.inflightToolCalls.clear();
        this.emit();
      });

      pi.on("session_shutdown", () => {
        this.activeTurn = false;
        this.thinking = false;
        this.inflightToolCalls.clear();
        this.emit();
      });
    }

    if (registerCommand && !this.commandRegistered) {
      this.commandRegistered = true;
      pi.registerCommand("working", {
        description: "Configure the working message and working indicator globally.",
        handler: async (args, ctx) => {
          await this.handleCommand(args, ctx);
        },
      });
    }
  }

  private resolveState(): WorkingState {
    if (this.thinking) return "thinking";
    if (this.activeTurn && this.inflightToolCalls.size > 0) return "toolUse";
    return "active";
  }

  private openToolCall(id: string | undefined): void {
    if (id === undefined) return;
    // `Set#add` always sets, so gate on `has` to avoid re-emitting when the
    // invocation was already tracked via another event stream.
    if (this.inflightToolCalls.has(id)) return;
    this.inflightToolCalls.add(id);
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    // Snapshot the listener set so that mutations during iteration (e.g. a
    // listener unsubscribing itself) cannot skip still-registered listeners.
    // Also isolate each listener in try/catch so one throwing does not
    // prevent later listeners from receiving the update.
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch {
        // Swallow listener failures — they are treated as best-effort UI work
        // and should never interrupt agent event processing.
      }
    }
  }

  private async handleCommand(args: string, ctx: ExtensionContext): Promise<void> {
    const trimmed = args.trim();
    if (!trimmed) {
      ctx.ui.notify(describeSettings(this.settings), "info");
      return;
    }

    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 1 && parts[0]!.startsWith("indicator=")) {
      const shape = parts[0]!.slice("indicator=".length);
      if (!isIndicatorShape(shape)) {
        ctx.ui.notify(getUsage(), "error");
        return;
      }
      this.settings = { ...this.settings, indicatorShape: shape };
      this.emit();
      await this.persistWithToast(ctx, `Working updated: indicatorShape=${shape}`);
      return;
    }

    if (parts.length !== 2) {
      ctx.ui.notify(getUsage(), "error");
      return;
    }

    const [rawState, assignment] = parts as [string, string];
    if (!(VALID_COMMAND_STATES as readonly string[]).includes(rawState)) {
      ctx.ui.notify(getUsage(), "error");
      return;
    }

    const eqIndex = assignment.indexOf("=");
    if (eqIndex <= 0) {
      ctx.ui.notify(getUsage(), "error");
      return;
    }

    const property = assignment.slice(0, eqIndex);
    const rawValue = assignment.slice(eqIndex + 1);
    const state = getCommandState(rawState as WorkingCommandState);
    const style = { ...this.settings[state] };

    if (property === "color") {
      if (rawValue === "default") style.color = DEFAULT_WORKING_COLOR;
      else if (isHexColor(rawValue)) style.color = normalizeHexColor(rawValue);
      else {
        ctx.ui.notify(getUsage(), "error");
        return;
      }
    } else if (property === "gleam" || property === "rainbow") {
      if (rawValue !== "on" && rawValue !== "off") {
        ctx.ui.notify(getUsage(), "error");
        return;
      }
      style[property] = rawValue === "on";
    } else {
      ctx.ui.notify(getUsage(), "error");
      return;
    }

    this.settings = { ...this.settings, [state]: style };
    this.emit();
    await this.persistWithToast(
      ctx,
      `Working updated: ${getDisplayStateName(state)}.${property}=${property === "color" ? style.color : style[property] ? "on" : "off"}`,
    );
  }

  private async persistWithToast(ctx: ExtensionContext, successMessage: string): Promise<void> {
    try {
      await saveWorkingSettings(this.settingsPath, this.settings);
      ctx.ui.notify(successMessage, "info");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(`${successMessage}, but could not save: ${reason}`, "error");
    }
  }
}

// Keyed by user `settingsPath` so callers using distinct user settings files
// each get their own coordinator. Rebinding the same `settingsPath` to a
// different `packageDefaultPath` still throws — that case is almost always a
// programming error (e.g. two host bundles disagreeing on where the packaged
// baseline lives) and would silently mask the second baseline.
const coordinatorsBySettingsPath = new Map<
  string,
  { packageDefaultPath: string; coordinator: WorkingCoordinator }
>();

export function getWorkingCoordinator(
  settingsPath: string = DEFAULT_SETTINGS_PATH,
  packageDefaultPath: string = PACKAGE_DEFAULT_SETTINGS_PATH,
): WorkingCoordinator {
  const existing = coordinatorsBySettingsPath.get(settingsPath);
  if (existing) {
    if (existing.packageDefaultPath !== packageDefaultPath) {
      throw new Error(
        `getWorkingCoordinator: settingsPath=${settingsPath} already bound to packageDefaultPath=${existing.packageDefaultPath}, refusing to rebind to ${packageDefaultPath}`,
      );
    }
    return existing.coordinator;
  }
  const coordinator = new WorkingCoordinator(settingsPath, packageDefaultPath);
  coordinatorsBySettingsPath.set(settingsPath, { packageDefaultPath, coordinator });
  return coordinator;
}

export function resetWorkingCoordinatorForTests(): void {
  coordinatorsBySettingsPath.clear();
}
