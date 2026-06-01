import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_TUI_SETTINGS,
  PACKAGE_DEFAULT_TUI_SETTINGS_PATH,
  getWorkingCoordinator,
  loadPackagedDefaultTuiSettings,
  loadSavedTuiSettings,
  saveTuiSettings,
  normalizeTuiSettings,
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

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "pi-tui-shared-"));
}

async function withTmpFile(fn: (filePath: string, dir: string) => Promise<void>): Promise<void> {
  const dir = await makeTmpDir();
  try {
    resetWorkingCoordinatorForTests();
    await fn(path.join(dir, "tui.json"), dir);
  } finally {
    resetWorkingCoordinatorForTests();
    await rm(dir, { recursive: true, force: true });
  }
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

async function withTier(
  fn: (paths: { userPath: string; packagedPath: string; dir: string }) => Promise<void>,
): Promise<void> {
  const dir = await makeTmpDir();
  try {
    resetWorkingCoordinatorForTests();
    await fn({
      userPath: path.join(dir, "user-tui.json"),
      packagedPath: path.join(dir, "packaged-tui.json"),
      dir,
    });
  } finally {
    resetWorkingCoordinatorForTests();
    await rm(dir, { recursive: true, force: true });
  }
}

async function bootSession(userPath: string, packagedPath: string) {
  const coordinator = getWorkingCoordinator(userPath, packagedPath);
  const { pi, emit, commands } = makePi();
  coordinator.ensureRegistered(pi as any, true);
  await emit("session_start", { reason: "startup" }, makeSessionCtx());
  return { coordinator, emit, commands };
}

// ---- loadSavedTuiSettings tests ----

test("loadSavedTuiSettings returns undefined when file does not exist", async () => {
  await withTmpFile(async (filePath) => {
    assert.equal(await loadSavedTuiSettings(filePath), undefined);
  });
});

test("loadSavedTuiSettings returns undefined when top-level JSON is not an object", async () => {
  await withTmpFile(async (filePath) => {
    await writeFile(filePath, JSON.stringify(["wave"]), "utf8");
    assert.equal(await loadSavedTuiSettings(filePath), undefined);
  });
});

test("loadSavedTuiSettings returns undefined when JSON is malformed", async () => {
  await withTmpFile(async (filePath) => {
    await writeFile(filePath, "{ broken json", "utf8");
    assert.equal(await loadSavedTuiSettings(filePath), undefined);
  });
});

// ---- normalizeTuiSettings tests ----

test("normalizeTuiSettings defaults working.indicator to wave for invalid input", () => {
  const result = normalizeTuiSettings({ version: 1, working: { indicator: "bogus" } });
  assert.equal(result.working.indicator, "wave");
});

test("normalizeTuiSettings accepts valid indicator shapes", () => {
  for (const shape of ["dot", "pulse", "spinner", "wave"] as const) {
    const result = normalizeTuiSettings({ version: 1, working: { indicator: shape } });
    assert.equal(result.working.indicator, shape);
  }
});

test("normalizeTuiSettings returns fallback clone for non-object input", () => {
  const result = normalizeTuiSettings(null);
  assert.deepEqual(result, DEFAULT_TUI_SETTINGS);
  // must be a clone, not the same reference
  assert.notEqual(result, DEFAULT_TUI_SETTINGS);
});

// ---- saveTuiSettings tests ----

test("saveTuiSettings to a non-existent path writes the canonical shape", async () => {
  await withTmpFile(async (filePath) => {
    await saveTuiSettings(filePath, { ...DEFAULT_TUI_SETTINGS, working: { indicator: "dot" } });
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(parsed, {
      version: 1,
      working: { indicator: "dot" },
      header: {},
      editor: {},
      footer: {},
    });
  });
});

test("saveTuiSettings preserves unrelated top-level keys from existing file", async () => {
  await withTmpFile(async (filePath) => {
    await writeFile(filePath, JSON.stringify({ otherExtension: { enabled: true } }), "utf8");
    await saveTuiSettings(filePath, { ...DEFAULT_TUI_SETTINGS, working: { indicator: "pulse" } });
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(parsed, {
      otherExtension: { enabled: true },
      version: 1,
      working: { indicator: "pulse" },
      header: {},
      editor: {},
      footer: {},
    });
  });
});

test("saveTuiSettings throws when JSON is malformed", async () => {
  await withTmpFile(async (filePath) => {
    await writeFile(filePath, "{broken", "utf8");
    await assert.rejects(() => saveTuiSettings(filePath, DEFAULT_TUI_SETTINGS));
  });
});

test("saveTuiSettings does not leak temp files on success", async () => {
  await withTmpFile(async (filePath, dir) => {
    await saveTuiSettings(filePath, DEFAULT_TUI_SETTINGS);
    const { readdir } = await import("node:fs/promises");
    const leftover = (await readdir(dir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftover, [], "atomic write should clean up its temp file");
  });
});

// ---- PACKAGE_DEFAULT_TUI_SETTINGS_PATH test ----

test("PACKAGE_DEFAULT_TUI_SETTINGS_PATH resolves to the packaged tui.json at the package root", () => {
  assert.match(PACKAGE_DEFAULT_TUI_SETTINGS_PATH.replace(/\\/g, "/"), /packages\/pi-flow-ux\/tui\.json$/);
});

// ---- Three-tier merge tests ----

const PACKAGED_BASELINE = {
  version: 1,
  working: { indicator: "pulse" },
  header: {},
  editor: {},
  footer: {},
} as const;

test("session_start with no user and no package settings falls back to the code default", async () => {
  await withTier(async ({ userPath, packagedPath }) => {
    const { coordinator } = await bootSession(userPath, packagedPath);
    assert.deepEqual(coordinator.getSnapshot().settings, DEFAULT_TUI_SETTINGS);
  });
});

test("session_start with only a packaged baseline adopts the packaged default", async () => {
  await withTier(async ({ userPath, packagedPath }) => {
    await writeFile(packagedPath, JSON.stringify(PACKAGED_BASELINE), "utf8");
    const { coordinator } = await bootSession(userPath, packagedPath);
    assert.equal(coordinator.getSnapshot().settings.working.indicator, "pulse");
  });
});

test("session_start with a full user file lets the user win over the packaged baseline", async () => {
  await withTier(async ({ userPath, packagedPath }) => {
    await writeFile(packagedPath, JSON.stringify(PACKAGED_BASELINE), "utf8");
    await writeFile(userPath, JSON.stringify({ version: 1, working: { indicator: "spinner" } }), "utf8");
    const { coordinator } = await bootSession(userPath, packagedPath);
    assert.equal(coordinator.getSnapshot().settings.working.indicator, "spinner");
  });
});

test("partial user settings overlay the packaged baseline field-by-field", async () => {
  await withTier(async ({ userPath, packagedPath }) => {
    await writeFile(packagedPath, JSON.stringify(PACKAGED_BASELINE), "utf8");
    // User only overrides indicator; indicator comes from user, packaged has pulse
    await writeFile(userPath, JSON.stringify({ working: { indicator: "dot" } }), "utf8");
    const { coordinator } = await bootSession(userPath, packagedPath);
    assert.equal(coordinator.getSnapshot().settings.working.indicator, "dot");
  });
});

test("malformed user JSON falls back to the packaged baseline", async () => {
  await withTier(async ({ userPath, packagedPath }) => {
    await writeFile(packagedPath, JSON.stringify(PACKAGED_BASELINE), "utf8");
    await writeFile(userPath, "{ not valid json", "utf8");
    const { coordinator } = await bootSession(userPath, packagedPath);
    assert.equal(coordinator.getSnapshot().settings.working.indicator, "pulse");
  });
});

test("malformed packaged JSON throws loudly during session_start", async () => {
  await withTier(async ({ userPath, packagedPath }) => {
    await writeFile(packagedPath, "{ not valid json", "utf8");
    await assert.rejects(() => loadPackagedDefaultTuiSettings(packagedPath));

    resetWorkingCoordinatorForTests();
    const coordinator = getWorkingCoordinator(userPath, packagedPath);
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, true);
    await assert.rejects(() => emit("session_start", { reason: "startup" }, makeSessionCtx()));
  });
});

// ---- Host working-row suppression tests ----

test("session_start suppresses host working row via setWorkingVisible(false) (preferred path)", async () => {
  await withTier(async ({ userPath, packagedPath }) => {
    const calls: boolean[] = [];
    const ctx = {
      hasUI: true,
      ui: {
        setWorkingVisible(v: boolean) { calls.push(v); },
        setWorkingIndicator() {},
        notify() {},
      },
    };
    const coordinator = getWorkingCoordinator(userPath, packagedPath);
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);
    await emit("session_start", { reason: "startup" }, ctx);
    assert.deepEqual(calls, [false], "setWorkingVisible must be called once with false");
  });
});

test("session_start falls back to setWorkingIndicator({ frames: [] }) when setWorkingVisible is absent", async () => {
  await withTier(async ({ userPath, packagedPath }) => {
    const indicatorCalls: any[] = [];
    const ctx = {
      hasUI: true,
      ui: {
        // no setWorkingVisible
        setWorkingIndicator(v: any) { indicatorCalls.push(v); },
        notify() {},
      },
    };
    const coordinator = getWorkingCoordinator(userPath, packagedPath);
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);
    await emit("session_start", { reason: "startup" }, ctx);
    assert.deepEqual(indicatorCalls, [{ frames: [] }], "fallback must call setWorkingIndicator with { frames: [] }");
  });
});

// ---- Coordinator state-tracking tests ----

test("coordinator.emit isolates listener failures so later listeners still run", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written.json"));
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

    assert.deepEqual(calls, ["a", "b"], "second listener must receive update even if first throws");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("coordinator.getSnapshot returns a defensive copy of settings", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-snapshot.json"));
    const snapshot = coordinator.getSnapshot();
    const originalIndicator = snapshot.settings.working.indicator;
    (snapshot.settings.working as any).indicator = "dot";

    const fresh = coordinator.getSnapshot();
    assert.equal(fresh.settings.working.indicator, originalIndicator, "mutating the snapshot must not leak into internal state");
  } finally {
    resetWorkingCoordinatorForTests();
  }
});

test("coordinator tracks nested tool execution depth so toolUse only clears when the outermost call ends", async () => {
  resetWorkingCoordinatorForTests();
  try {
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-nested.json"));
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-update.json"));
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-stray.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-noevt.json"));
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-late.json"));
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-tce.json"));
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-dup.json"));
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-partial.json"));
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-parallel.json"));
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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-bad-id.json"));
    const { pi, emit } = makePi();
    coordinator.ensureRegistered(pi as any, false);

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
    const coordinator = getWorkingCoordinator(path.join(os.tmpdir(), "pi-tui-never-written-think-over.json"));
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

test("getWorkingCoordinator throws when the same settingsPath is rebound to a different packageDefaultPath", async () => {
  await withTier(async ({ userPath, packagedPath, dir }) => {
    getWorkingCoordinator(userPath, packagedPath);
    assert.throws(
      () => getWorkingCoordinator(userPath, path.join(dir, "other-packaged.json")),
      /refusing to rebind/,
    );
  });
});

test("getWorkingCoordinator keys coordinators by settingsPath so different user files load distinct state", async () => {
  await withTier(async ({ userPath, packagedPath, dir }) => {
    const otherUserPath = path.join(dir, "other-user-tui.json");

    await writeFile(userPath, JSON.stringify({ version: 1, working: { indicator: "dot" } }), "utf8");
    await writeFile(otherUserPath, JSON.stringify({ version: 1, working: { indicator: "pulse" } }), "utf8");

    const coordA = getWorkingCoordinator(userPath, packagedPath);
    const coordB = getWorkingCoordinator(otherUserPath, packagedPath);

    assert.notEqual(
      coordA,
      coordB,
      "different settingsPath values must yield different coordinator instances",
    );

    const { pi: piA, emit: emitA } = makePi();
    coordA.ensureRegistered(piA as any, false);
    await emitA("session_start", { reason: "startup" }, makeSessionCtx());

    const { pi: piB, emit: emitB } = makePi();
    coordB.ensureRegistered(piB as any, false);
    await emitB("session_start", { reason: "startup" }, makeSessionCtx());

    assert.equal(
      coordA.getSnapshot().settings.working.indicator,
      "dot",
      "first coordinator must load from its own settingsPath",
    );
    assert.equal(
      coordB.getSnapshot().settings.working.indicator,
      "pulse",
      "second coordinator must load from its own settingsPath, not coordA's",
    );
  });
});

// ---- /tui grammar tests ----

test("/tui grammar: bare /tui reports current settings", async () => {
  await withTmpFile(async (filePath) => {
    const packagedPath = path.join(path.dirname(filePath), "no-packaged.json");
    const coordinator = getWorkingCoordinator(filePath, packagedPath);
    const { pi, emit, commands } = makePi();
    coordinator.ensureRegistered(pi as any, true);
    await emit("session_start", { reason: "startup" }, makeSessionCtx());

    const notifyCalls: { msg: string; level: string }[] = [];
    const cmdCtx = {
      ui: {
        notify(msg: string, level: string) { notifyCalls.push({ msg, level }); },
      },
    };

    await commands.get("tui").handler("", cmdCtx);
    assert.equal(notifyCalls.length, 1);
    assert.equal(notifyCalls[0]!.msg, "TUI: working.indicator=wave");
    assert.equal(notifyCalls[0]!.level, "info");
  });
});

test("/tui grammar: valid 'working indicator=dot' persists and toasts success", async () => {
  await withTmpFile(async (filePath) => {
    const packagedPath = path.join(path.dirname(filePath), "no-packaged.json");
    const coordinator = getWorkingCoordinator(filePath, packagedPath);
    const { pi, emit, commands } = makePi();
    coordinator.ensureRegistered(pi as any, true);
    await emit("session_start", { reason: "startup" }, makeSessionCtx());

    const notifyCalls: { msg: string; level: string }[] = [];
    const cmdCtx = {
      ui: {
        notify(msg: string, level: string) { notifyCalls.push({ msg, level }); },
      },
    };

    await commands.get("tui").handler("working indicator=dot", cmdCtx);

    assert.equal(notifyCalls.length, 1);
    assert.match(notifyCalls[0]!.msg, /working\.indicator=dot/);
    assert.equal(notifyCalls[0]!.level, "info");
    assert.equal(coordinator.getSnapshot().settings.working.indicator, "dot");

    // Assert file contents
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(parsed, {
      version: 1,
      working: { indicator: "dot" },
      header: {},
      editor: {},
      footer: {},
    });
  });
});

test("/tui grammar: invalid shapes produce usage error", async () => {
  await withTmpFile(async (filePath) => {
    const packagedPath = path.join(path.dirname(filePath), "no-packaged.json");
    const coordinator = getWorkingCoordinator(filePath, packagedPath);
    const { pi, emit, commands } = makePi();
    coordinator.ensureRegistered(pi as any, true);
    await emit("session_start", { reason: "startup" }, makeSessionCtx());

    const USAGE_PREFIX = "Usage: /tui";

    for (const badInput of ["working indicator=bogus", "working.indicator=wave", "indicator=wave", "header on"]) {
      const notifyCalls: { msg: string; level: string }[] = [];
      const cmdCtx = {
        ui: {
          notify(msg: string, level: string) { notifyCalls.push({ msg, level }); },
        },
      };
      await commands.get("tui").handler(badInput, cmdCtx);
      assert.equal(notifyCalls.length, 1, `expected 1 notify for '${badInput}'`);
      assert.ok(notifyCalls[0]!.msg.startsWith(USAGE_PREFIX), `usage error for '${badInput}'`);
      assert.equal(notifyCalls[0]!.level, "error", `error level for '${badInput}'`);
      // File must not have been written
      assert.equal(
        await readFile(filePath, "utf8").catch(() => null),
        null,
        `file must not be written for invalid input '${badInput}'`,
      );
    }
  });
});
