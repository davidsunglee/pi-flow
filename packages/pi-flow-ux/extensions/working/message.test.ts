import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createExtension as createWorkingMessageExtension } from "./message.ts";
import { createExtension as createWorkingIndicatorExtension } from "./indicator.ts";
import { resetWorkingCoordinatorForTests } from "./working.ts";

type EventHandler = (event: any, ctx: any) => void | Promise<void>;
type CommandDef = { description: string; handler: (args: string, ctx: any) => void | Promise<void> };

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-working-message-"));
  try {
    resetWorkingCoordinatorForTests();
    await fn(dir);
  } finally {
    resetWorkingCoordinatorForTests();
    await rm(dir, { recursive: true, force: true });
  }
}

function bootExtensions(settingsPath: string) {
  const handlers = new Map<string, EventHandler[]>();
  let command: CommandDef | undefined;
  const pi = {
    on(event: string, handler: EventHandler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name: string, def: CommandDef) {
      if (name === "working") command = def;
    },
  };

  createWorkingMessageExtension(settingsPath)(pi as any);
  createWorkingIndicatorExtension(settingsPath)(pi as any);

  assert.ok(command, "working command should be registered");
  return {
    command,
    async emit(event: string, payload: any, ctx: any) {
      for (const handler of handlers.get(event) ?? []) {
        await handler(payload, ctx);
      }
    },
  };
}

function makeCtx(hasUI: boolean) {
  const workingMessages: Array<string | undefined> = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const ctx = {
    hasUI,
    ui: {
      setWorkingMessage(message?: string) {
        workingMessages.push(message);
      },
      setWorkingIndicator() {},
      setStatus() {},
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };
  return { ctx, workingMessages, notifications };
}

test("active state publishes a plain colored message without starting animation", async () => {
  await withTmpDir(async (dir) => {
    const { emit } = bootExtensions(path.join(dir, "working.json"));

    let setIntervalCallCount = 0;
    const originalSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      setIntervalCallCount++;
      return originalSetInterval(...args);
    }) as typeof setInterval;

    try {
      const { ctx, workingMessages } = makeCtx(true);
      await emit("turn_start", {}, ctx);

      assert.ok(workingMessages.length >= 1, "message should be published");
      const last = workingMessages.at(-1)!;
      assert.match(last!, /\x1b\[38;2;129;161;193m/);
      assert.doesNotMatch(last!, /\x1b\[1m/);
      assert.equal(setIntervalCallCount, 0, "active plain mode should not animate");
    } finally {
      globalThis.setInterval = originalSetInterval;
    }
  });
});

test("tool execution switches the message into gleam mode", async () => {
  await withTmpDir(async (dir) => {
    const { emit } = bootExtensions(path.join(dir, "working.json"));
    const timerHandles: ReturnType<typeof setInterval>[] = [];
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      const handle = originalSetInterval(...args);
      timerHandles.push(handle);
      return handle;
    }) as typeof setInterval;

    try {
      const { ctx, workingMessages } = makeCtx(true);
      await emit("turn_start", {}, ctx);
      await emit("tool_execution_start", { toolCallId: "call-1" }, ctx);

      const gleamCall = workingMessages.at(-1)!;
      assert.match(gleamCall!, /\x1b\[38;2;129;161;193m/);
      assert.match(gleamCall!, /\x1b\[1;38;2;/);
      assert.equal(timerHandles.length, 1, "gleam mode should animate");
    } finally {
      globalThis.setInterval = originalSetInterval;
      timerHandles.forEach((handle) => originalClearInterval(handle));
    }
  });
});

test("thinking overrides toolUse with rainbow and thinking_end restores toolUse gleam", async () => {
  await withTmpDir(async (dir) => {
    const { emit } = bootExtensions(path.join(dir, "working.json"));
    const timerHandles: ReturnType<typeof setInterval>[] = [];
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      const handle = originalSetInterval(...args);
      timerHandles.push(handle);
      return handle;
    }) as typeof setInterval;

    try {
      const { ctx, workingMessages } = makeCtx(true);
      await emit("turn_start", {}, ctx);
      await emit("tool_execution_start", { toolCallId: "call-1" }, ctx);
      await emit("message_update", { assistantMessageEvent: { type: "thinking_start" } }, ctx);
      await emit("message_update", { assistantMessageEvent: { type: "thinking_end" } }, ctx);

      const rainbowCall = workingMessages.at(-2)!;
      const restoredCall = workingMessages.at(-1)!;
      assert.match(rainbowCall!, /255;179;186|186;225;255|218;186;255/);
      assert.match(restoredCall!, /\x1b\[1;38;2;/);
      assert.match(restoredCall!, /\x1b\[38;2;129;161;193m/);
    } finally {
      globalThis.setInterval = originalSetInterval;
      timerHandles.forEach((handle) => originalClearInterval(handle));
    }
  });
});

test("/working active color updates message styling for the current session", async () => {
  await withTmpDir(async (dir) => {
    const { emit, command } = bootExtensions(path.join(dir, "working.json"));
    const { ctx, workingMessages } = makeCtx(true);

    await command!.handler("active color=#FF0000", ctx);
    await emit("turn_start", {}, ctx);

    const activeCall = workingMessages.at(-1)!;
    assert.match(activeCall!, /\x1b\[38;2;255;0;0m/);
  });
});

test("styled rendering fallback is sticky across later state changes and turns", async () => {
  await withTmpDir(async (dir) => {
    const { emit } = bootExtensions(path.join(dir, "working.json"));
    const styledMessages: string[] = [];
    const workingMessages: Array<string | undefined> = [];
    const ctx = {
      hasUI: true,
      ui: {
        setWorkingMessage(message?: string) {
          if (typeof message === "string" && message.includes("\x1b[")) {
            styledMessages.push(message);
            throw new Error("styled output unsupported");
          }
          workingMessages.push(message);
        },
        setWorkingIndicator() {},
        setStatus() {},
        notify() {},
      },
    };

    await emit("turn_start", {}, ctx);
    await emit("tool_execution_start", { toolCallId: "call-1" }, ctx);
    await emit("turn_end", {}, ctx);
    await emit("turn_start", {}, ctx);

    assert.equal(styledMessages.length, 1, "styled rendering should only be attempted once per runtime");
    assert.equal(workingMessages.filter((message) => typeof message === "string").length, 3, "later renders should fall back to plain text");
    assert.equal(workingMessages.at(-1)?.includes("\x1b["), false);
  });
});

test("turn_end clears the working message", async () => {
  await withTmpDir(async (dir) => {
    const { emit } = bootExtensions(path.join(dir, "working.json"));
    const { ctx, workingMessages } = makeCtx(true);

    await emit("turn_start", {}, ctx);
    await emit("turn_end", {}, ctx);

    assert.equal(workingMessages.at(-1), undefined);
  });
});
