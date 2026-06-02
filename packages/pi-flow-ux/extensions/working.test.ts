import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  getWorkingCoordinator,
  resetWorkingCoordinatorForTests,
} from "./working.ts";

type EventHandler = (event: any, ctx: any) => void | Promise<void>;

function makePi() {
  const handlers = new Map<string, EventHandler[]>();
  const commands = new Map<string, any>();
  const pi = {
    on(event: string, handler: EventHandler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name: string, opts: any) {
      commands.set(name, opts);
    },
  };
  async function emit(event: string, payload: any = {}, ctx: any = {}) {
    for (const handler of handlers.get(event) ?? []) {
      await handler(payload, ctx);
    }
  }
  return { pi, emit, commands };
}

function makeSessionCtx() {
  return {
    hasUI: true,
    ui: {
      setWorkingVisible() {},
      setWorkingIndicator() {},
      setStatus() {},
      notify() {},
    },
  };
}

// ---- Host working-row suppression tests ----

test("session_start suppresses host working row via setWorkingVisible(false) (preferred path)", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const calls: boolean[] = [];
    const ctx = {
      hasUI: true,
      ui: {
        setWorkingVisible(v: boolean) { calls.push(v); },
        setWorkingIndicator() {},
        notify() {},
      },
    };
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);
    await emit("session_start", { reason: "startup" }, ctx);
    assert.deepEqual(calls, [false], "setWorkingVisible must be called once with false");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("session_start falls back to setWorkingIndicator({ frames: [] }) when setWorkingVisible is absent", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const indicatorCalls: any[] = [];
    const ctx = {
      hasUI: true,
      ui: {
        // no setWorkingVisible
        setWorkingIndicator(v: any) { indicatorCalls.push(v); },
        notify() {},
      },
    };
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);
    await emit("session_start", { reason: "startup" }, ctx);
    assert.deepEqual(indicatorCalls, [{ frames: [] }], "fallback must call setWorkingIndicator with { frames: [] }");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

// ---- Coordinator state-tracking tests ----

test("coordinator.emit isolates listener failures so later listeners still run", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const calls: string[] = [];
    coordinator.subscribe(() => {
      calls.push("a");
      throw new Error("first listener explodes");
    });
    coordinator.subscribe(() => {
      calls.push("b");
    });

    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);
    await emit("turn_start", {}, {});

    assert.deepEqual(calls, ["a", "b"], "second listener must receive update even if first throws");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("coordinator tracks nested tool execution depth so toolUse only clears when the outermost call ends", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);

    await emit("turn_start", {}, {});
    await emit("tool_execution_start", { toolCallId: "outer" }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse");

    await emit("tool_execution_start", { toolCallId: "inner" }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse");

    await emit("tool_execution_end", { toolCallId: "inner" }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse", "outer tool call is still running");

    await emit("tool_execution_end", { toolCallId: "outer" }, {});
    assert.equal(coordinator.getSnapshot().state, "active", "state returns to active once depth hits zero");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("tool_execution_update before a start synthesizes the toolUse state exactly once", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);
    let emissions = 0;
    coordinator.subscribe(() => {
      emissions += 1;
    });

    await emit("turn_start", {}, {});
    emissions = 0;

    await emit("tool_execution_update", { toolCallId: "x" }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse");
    assert.equal(emissions, 1, "first update promotes state to toolUse");

    await emit("tool_execution_update", { toolCallId: "x" }, {});
    assert.equal(emissions, 1, "subsequent updates do not re-emit because depth is already 1");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("stray tool_execution_end without a matching start is ignored (depth cannot go negative)", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);

    await emit("turn_start", {}, {});
    await emit("tool_execution_end", { toolCallId: "phantom" }, {});
    assert.equal(coordinator.getSnapshot().state, "active", "stray end leaves state at active");

    await emit("tool_execution_start", { toolCallId: "real" }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse", "real start still promotes to toolUse");

    await emit("tool_execution_end", { toolCallId: "real" }, {});
    assert.equal(coordinator.getSnapshot().state, "active");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("message_update without an assistantMessageEvent is ignored", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);

    await emit("turn_start", {}, {});
    let emissions = 0;
    coordinator.subscribe(() => {
      emissions += 1;
    });

    await emit("message_update", {}, {});
    await emit("message_update", { foo: "bar" }, {});
    await emit("message_update", { assistantMessageEvent: {} }, {});
    await emit("message_update", { assistantMessageEvent: { type: "text_delta" } }, {});

    assert.equal(emissions, 0, "unrecognized message updates should not emit");
    assert.equal(coordinator.getSnapshot().state, "active");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("events arriving after turn_end do not mutate coordinator state", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);

    await emit("turn_start", {}, {});
    await emit("turn_end", {}, {});

    await emit("message_update", { assistantMessageEvent: { type: "thinking_start" } }, {});
    await emit("message_update", { assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "late" } } }, {});
    await emit("tool_execution_start", { toolCallId: "late" }, {});
    await emit("tool_execution_update", { toolCallId: "late" }, {});

    const snapshot = coordinator.getSnapshot();
    assert.equal(snapshot.visible, false, "should remain hidden while idle");
    assert.equal(snapshot.state, "active", "no state transitions should occur between turns");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("message_update toolcall_end promotes toolUse as soon as the model finalizes the call", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);

    await emit("turn_start", {}, {});
    assert.equal(coordinator.getSnapshot().state, "active");

    await emit(
      "message_update",
      { assistantMessageEvent: { type: "toolcall_end", toolCall: { type: "toolCall", id: "t1", name: "bash", arguments: {} } } },
      {},
    );
    assert.equal(coordinator.getSnapshot().state, "toolUse", "toolcall_end is the earliest reliable opener");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("toolcall_end followed by tool_execution_start/end for the same id only resolves once (no double-count)", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);

    await emit("turn_start", {}, {});
    let emissions = 0;
    coordinator.subscribe(() => {
      emissions += 1;
    });

    await emit(
      "message_update",
      { assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "same" } } },
      {},
    );
    assert.equal(coordinator.getSnapshot().state, "toolUse");
    const emissionsAfterOpener = emissions;

    await emit("tool_execution_start", { toolCallId: "same" }, {});
    await emit("tool_execution_update", { toolCallId: "same" }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse", "still in flight");
    assert.equal(
      emissions,
      emissionsAfterOpener,
      "execution_start/update for an already-tracked id must not emit again",
    );

    await emit("tool_execution_end", { toolCallId: "same" }, {});
    assert.equal(coordinator.getSnapshot().state, "active", "single close signal drops the invocation");
    assert.equal(emissions, emissionsAfterOpener + 1, "single emit on final close");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("toolcall_start and toolcall_delta alone do not promote toolUse", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);

    await emit("turn_start", {}, {});
    let emissions = 0;
    coordinator.subscribe(() => {
      emissions += 1;
    });

    await emit("message_update", { assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 } }, {});
    await emit(
      "message_update",
      { assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: '{"cmd"' } },
      {},
    );

    assert.equal(coordinator.getSnapshot().state, "active", "incomplete tool-call events are ignored");
    assert.equal(emissions, 0, "incomplete tool-call events must not re-emit");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("parallel tool calls with distinct ids require every close before returning to active", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);

    await emit("turn_start", {}, {});
    await emit("message_update", { assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "a" } } }, {});
    await emit("message_update", { assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "b" } } }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse");

    await emit("tool_execution_end", { toolCallId: "a" }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse", "b is still in flight");

    await emit("tool_execution_end", { toolCallId: "b" }, {});
    assert.equal(coordinator.getSnapshot().state, "active");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("tool events with missing or malformed ids are ignored", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);

    await emit("turn_start", {}, {});
    let emissions = 0;
    coordinator.subscribe(() => {
      emissions += 1;
    });

    await emit("message_update", { assistantMessageEvent: { type: "toolcall_end" } }, {});
    await emit("message_update", { assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "" } } }, {});
    await emit("message_update", { assistantMessageEvent: { type: "toolcall_end", toolCall: { id: 42 } } }, {});
    await emit("tool_execution_start", {}, {});
    await emit("tool_execution_update", { toolCallId: null }, {});
    await emit("tool_execution_end", {}, {});

    assert.equal(coordinator.getSnapshot().state, "active");
    assert.equal(emissions, 0, "malformed tool events are silently dropped");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("thinking still overrides toolUse when the broadened lifecycle is active", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator();
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any);

    await emit("turn_start", {}, {});
    await emit("message_update", { assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "t1" } } }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse");

    await emit("message_update", { assistantMessageEvent: { type: "thinking_start" } }, {});
    assert.equal(coordinator.getSnapshot().state, "thinking", "thinking has priority over in-flight tool calls");

    await emit("message_update", { assistantMessageEvent: { type: "thinking_end" } }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse", "once thinking ends the invocation is still in flight");

    await emit("tool_execution_end", { toolCallId: "t1" }, {});
    assert.equal(coordinator.getSnapshot().state, "active");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});
