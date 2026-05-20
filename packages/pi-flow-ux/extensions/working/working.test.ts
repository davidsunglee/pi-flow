import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_WORKING_COLOR,
  DEFAULT_WORKING_SETTINGS,
  getWorkingCoordinator,
  loadSavedWorkingSettings,
  saveWorkingSettings,
  resetWorkingCoordinatorForTests,
} from "./working.ts";

type EventHandler = (event: any, ctx: any) => void | Promise<void>;

function makePi() {
  const handlers = new Map<string, EventHandler[]>();
  const pi = {
    on(event: string, handler: EventHandler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand() {},
  };
  async function emit(event: string, payload: any = {}, ctx: any = {}) {
    for (const handler of handlers.get(event) ?? []) {
      await handler(payload, ctx);
    }
  }
  return { pi, emit };
}

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "pi-working-shared-"));
}

async function withTmpFile(fn: (filePath: string, dir: string) => Promise<void>): Promise<void> {
  const dir = await makeTmpDir();
  try {
    resetWorkingCoordinatorForTests();
    await fn(path.join(dir, "working.json"), dir);
  } finally {
    resetWorkingCoordinatorForTests();
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadSavedWorkingSettings returns undefined when file does not exist", async () => {
  await withTmpFile(async (filePath) => {
    assert.equal(await loadSavedWorkingSettings(filePath), undefined);
  });
});

test("loadSavedWorkingSettings merges partial valid config with defaults", async () => {
  await withTmpFile(async (filePath) => {
    await writeFile(
      filePath,
      JSON.stringify({
        indicatorShape: "dot",
        active: { color: "#ff00aa" },
      }),
      "utf8",
    );

    assert.deepEqual(await loadSavedWorkingSettings(filePath), {
      ...DEFAULT_WORKING_SETTINGS,
      indicatorShape: "dot",
      active: {
        color: "#FF00AA",
        gleam: false,
        rainbow: false,
      },
    });
  });
});

test("loadSavedWorkingSettings returns undefined when top-level JSON is not an object", async () => {
  await withTmpFile(async (filePath) => {
    await writeFile(filePath, JSON.stringify(["spinner"]), "utf8");
    assert.equal(await loadSavedWorkingSettings(filePath), undefined);
  });
});

test("saveWorkingSettings preserves unrelated top-level keys and writes the new schema", async () => {
  await withTmpFile(async (filePath) => {
    await writeFile(filePath, JSON.stringify({ otherExtension: { enabled: true } }), "utf8");

    await saveWorkingSettings(filePath, {
      ...DEFAULT_WORKING_SETTINGS,
      indicatorShape: "pulse",
      toolUse: {
        color: "#123456",
        gleam: true,
        rainbow: false,
      },
    });

    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(parsed, {
      otherExtension: { enabled: true },
      indicatorShape: "pulse",
      active: {
        color: DEFAULT_WORKING_COLOR,
        gleam: false,
        rainbow: false,
      },
      toolUse: {
        color: "#123456",
        gleam: true,
        rainbow: false,
      },
      thinking: {
        color: DEFAULT_WORKING_COLOR,
        gleam: true,
        rainbow: true,
      },
    });
  });
});

test("saveWorkingSettings throws when JSON is malformed", async () => {
  await withTmpFile(async (filePath) => {
    await writeFile(filePath, "{broken", "utf8");
    await assert.rejects(() => saveWorkingSettings(filePath, DEFAULT_WORKING_SETTINGS));
  });
});

test("saveWorkingSettings does not leak temp files on success", async () => {
  await withTmpFile(async (filePath, dir) => {
    await saveWorkingSettings(filePath, DEFAULT_WORKING_SETTINGS);
    const { readdir } = await import("node:fs/promises");
    const leftover = (await readdir(dir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftover, [], "atomic write should clean up its temp file");
  });
});

test("coordinator.emit isolates listener failures so later listeners still run", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written.json"));
    const calls: string[] = [];
    coordinator.subscribe(() => {
      calls.push("a");
      throw new Error("first listener explodes");
    });
    coordinator.subscribe(() => {
      calls.push("b");
    });

    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);
    await emit("turn_start", {}, {});

    // turn_start triggers an emit() which must dispatch to both listeners.
    assert.deepEqual(calls, ["a", "b"], "second listener must receive update even if first throws");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("coordinator.getSnapshot returns a defensive copy of settings", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-snapshot.json"));
    const snapshot = coordinator.getSnapshot();
    const originalColor = snapshot.settings.active.color;
    snapshot.settings.active.color = "#DEADBE";
    snapshot.settings.indicatorShape = "dot";

    const fresh = coordinator.getSnapshot();
    assert.equal(fresh.settings.active.color, originalColor, "mutating the snapshot must not leak into internal state");
    assert.equal(fresh.settings.indicatorShape, "spinner");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("coordinator tracks nested tool execution depth so toolUse only clears when the outermost call ends", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-nested.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-update.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-stray.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

    await emit("turn_start", {}, {});
    await emit("tool_execution_end", { toolCallId: "phantom" }, {});
    assert.equal(coordinator.getSnapshot().state, "active", "stray end leaves state at active");

    await emit("tool_execution_start", { toolCallId: "real" }, {});
    assert.equal(coordinator.getSnapshot().state, "toolUse", "real start still promotes to toolUse (depth not driven negative)");

    await emit("tool_execution_end", { toolCallId: "real" }, {});
    assert.equal(coordinator.getSnapshot().state, "active");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("message_update without an assistantMessageEvent is ignored", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-noevt.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-late.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-tce.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-dup.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-partial.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

    await emit("turn_start", {}, {});
    let emissions = 0;
    coordinator.subscribe(() => {
      emissions += 1;
    });

    await emit("message_update", { assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 } }, {});
    await emit(
      "message_update",
      { assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "{\"cmd\"" } },
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-parallel.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-bad-id.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

    await emit("turn_start", {}, {});
    let emissions = 0;
    coordinator.subscribe(() => {
      emissions += 1;
    });

    // toolcall_end without a toolCall at all
    await emit("message_update", { assistantMessageEvent: { type: "toolcall_end" } }, {});
    // toolcall_end with an empty id
    await emit("message_update", { assistantMessageEvent: { type: "toolcall_end", toolCall: { id: "" } } }, {});
    // toolcall_end with a non-string id
    await emit("message_update", { assistantMessageEvent: { type: "toolcall_end", toolCall: { id: 42 } } }, {});
    // tool_execution_start with no toolCallId
    await emit("tool_execution_start", {}, {});
    // tool_execution_update with non-string id
    await emit("tool_execution_update", { toolCallId: null }, {});
    // tool_execution_end with no toolCallId (must not crash, must not emit)
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-working-never-written-think-over.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

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
