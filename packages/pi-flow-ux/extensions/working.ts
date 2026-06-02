import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export type WorkingState = "active" | "toolUse" | "thinking";
export type IndicatorShape = "dot" | "pulse" | "spinner" | "wave";

export interface TuiSettings {
  version: number;
  working: { indicator: IndicatorShape };
  header: Record<string, never>;
  editor: Record<string, never>;
  footer: Record<string, never>;
}

export interface WorkingSnapshot {
  visible: boolean;
  state: WorkingState;
  settings: TuiSettings;
}

export const DEFAULT_INDICATOR: IndicatorShape = "wave";
const VALID_INDICATOR_SHAPES: readonly IndicatorShape[] = ["dot", "pulse", "spinner", "wave"];

export const DEFAULT_TUI_SETTINGS: TuiSettings = {
  version: 1,
  working: { indicator: DEFAULT_INDICATOR },
  header: {},
  editor: {},
  footer: {},
};

export const DEFAULT_TUI_SETTINGS_PATH = path.join(os.homedir(), ".pi", "agent", "tui.json");
// working.ts now sits at extensions/working.ts (one level under the package
// root), so a single ".." reaches the packaged tui.json — NOT two like the old
// extensions/working/working.ts layout.
export const PACKAGE_DEFAULT_TUI_SETTINGS_PATH = path.join(import.meta.dirname, "..", "tui.json");

function cloneTui(s: TuiSettings): TuiSettings { return structuredClone(s); }
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function isIndicatorShape(v: unknown): v is IndicatorShape {
  return typeof v === "string" && (VALID_INDICATOR_SHAPES as readonly string[]).includes(v);
}
export function normalizeTuiSettings(value: unknown, fallback: TuiSettings = DEFAULT_TUI_SETTINGS): TuiSettings {
  if (!isPlainObject(value)) return cloneTui(fallback);
  const working = isPlainObject(value.working) ? value.working : {};
  const indicator = isIndicatorShape(working.indicator) ? working.indicator : fallback.working.indicator;
  return {
    version: typeof value.version === "number" ? value.version : fallback.version,
    working: { indicator },
    header: {},
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

function getTuiUsage(): string {
  return ["Usage: /tui", "       /tui working indicator=<dot|pulse|spinner|wave>"].join("\n");
}
function describeTuiSettings(s: TuiSettings): string {
  return `TUI: working.indicator=${s.working.indicator}`;
}
function extractToolCallId(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// Suppress / restore Pi's host working ("loader") row. setWorkingVisible is the
// documented mechanism — confirmed in @earendil-works/pi-coding-agent@0.75.3 at
// dist/core/extensions/types.d.ts:82-83 ("Show or hide the built-in interactive
// working loader row during streaming"). The spec's confirmed-API list named
// only setWorkingIndicator, so we guard for setWorkingVisible at runtime and
// fall back to hiding the indicator frames, which the same API supports
// (setWorkingIndicator({ frames: [] }) — "hide the indicator entirely", line 92).
function setHostWorkingRowVisible(ui: ExtensionContext["ui"], visible: boolean): void {
  if (typeof ui.setWorkingVisible === "function") { ui.setWorkingVisible(visible); return; }
  if (typeof ui.setWorkingIndicator === "function") {
    ui.setWorkingIndicator(visible ? undefined : { frames: [] });
  }
}

class WorkingCoordinator {
  private readonly settingsPath: string;
  private readonly packageDefaultPath: string;
  private settings: TuiSettings = cloneTui(DEFAULT_TUI_SETTINGS);
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
  private registeredPi: ExtensionAPI | undefined;
  private uiCtx: ExtensionContext | undefined;

  constructor(settingsPath: string, packageDefaultPath: string) {
    this.settingsPath = settingsPath;
    this.packageDefaultPath = packageDefaultPath;
  }

  getSnapshot(): WorkingSnapshot {
    return { visible: this.activeTurn, state: this.resolveState(), settings: cloneTui(this.settings) };
  }

  subscribe(listener: (snapshot: WorkingSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  ensureRegistered(pi: ExtensionAPI, registerCommand: boolean): void {
    if (this.registeredPi !== pi) {
      if (this.registeredPi !== undefined) {
        this.listeners.clear();
        this.activeTurn = false;
        this.thinking = false;
        this.inflightToolCalls.clear();
      }
      this.registeredPi = pi;
      this.runtimeRegistered = false;
      this.commandRegistered = false;
    }

    if (!this.runtimeRegistered) {
      this.runtimeRegistered = true;

      pi.on("session_start", async (_event, ctx) => {
        this.uiCtx = ctx;
        const packaged = await loadPackagedDefaultTuiSettings(this.packageDefaultPath);
        const baseline = packaged ?? cloneTui(DEFAULT_TUI_SETTINGS);
        const user = await loadSavedTuiSettings(this.settingsPath, baseline);
        this.settings = user ?? baseline;
        // The editor border owns the activity surface, so suppress Pi's host
        // working row entirely while pi-flow-ux is installed.
        if (ctx.hasUI) setHostWorkingRowVisible(ctx.ui, false);
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
        if (this.uiCtx?.hasUI) setHostWorkingRowVisible(this.uiCtx.ui, true);
        this.uiCtx = undefined;
      });
    }

    if (registerCommand && !this.commandRegistered) {
      this.commandRegistered = true;
      pi.registerCommand("tui", {
        description: "Configure the pi-flow-ux TUI (working indicator).",
        handler: async (args, ctx) => { await this.handleCommand(args, ctx); },
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
    ctx.ui.notify(getTuiUsage(), "error");
  }

  private async persistWithToast(ctx: ExtensionCommandContext, msg: string): Promise<void> {
    try { await saveTuiSettings(this.settingsPath, this.settings); ctx.ui.notify(msg, "info"); }
    catch (err) { const r = err instanceof Error ? err.message : String(err); ctx.ui.notify(`${msg} but could not save: ${r}`, "error"); }
  }
}

const coordinatorsBySettingsPath = new Map<string, { packageDefaultPath: string; coordinator: WorkingCoordinator }>();

export function getWorkingCoordinator(
  settingsPath: string = DEFAULT_TUI_SETTINGS_PATH,
  packageDefaultPath: string = PACKAGE_DEFAULT_TUI_SETTINGS_PATH,
): WorkingCoordinator {
  const existing = coordinatorsBySettingsPath.get(settingsPath);
  if (existing) {
    if (existing.packageDefaultPath !== packageDefaultPath) {
      throw new Error(`getWorkingCoordinator: settingsPath=${settingsPath} already bound to packageDefaultPath=${existing.packageDefaultPath}, refusing to rebind to ${packageDefaultPath}`);
    }
    return existing.coordinator;
  }
  const coordinator = new WorkingCoordinator(settingsPath, packageDefaultPath);
  coordinatorsBySettingsPath.set(settingsPath, { packageDefaultPath, coordinator });
  return coordinator;
}

export function resetWorkingCoordinatorForTests(): void { coordinatorsBySettingsPath.clear(); }
