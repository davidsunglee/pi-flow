import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type WorkingState = "active" | "toolUse" | "thinking";

export interface WorkingSnapshot {
  visible: boolean;
  state: WorkingState;
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
  private registeredPi: ExtensionAPI | undefined;
  private uiCtx: ExtensionContext | undefined;

  getSnapshot(): WorkingSnapshot {
    return { visible: this.activeTurn, state: this.resolveState() };
  }

  subscribe(listener: (snapshot: WorkingSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  ensureRegistered(pi: ExtensionAPI): void {
    if (this.registeredPi !== pi) {
      if (this.registeredPi !== undefined) {
        this.listeners.clear();
        this.activeTurn = false;
        this.thinking = false;
        this.inflightToolCalls.clear();
      }
      this.registeredPi = pi;
      this.runtimeRegistered = false;
    }

    if (!this.runtimeRegistered) {
      this.runtimeRegistered = true;

      pi.on("session_start", (_event, ctx) => {
        this.uiCtx = ctx;
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
}

let workingCoordinator: WorkingCoordinator | undefined;

export function getWorkingCoordinator(): WorkingCoordinator {
  if (!workingCoordinator) workingCoordinator = new WorkingCoordinator();
  return workingCoordinator;
}

export function resetWorkingCoordinatorForTests(): void { workingCoordinator = undefined; }
