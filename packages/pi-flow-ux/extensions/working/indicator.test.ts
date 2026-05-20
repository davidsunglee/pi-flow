import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createExtension } from "./indicator.ts";
import { resetWorkingCoordinatorForTests } from "./working.ts";

type EventHandler = (event: any, ctx: any) => void | Promise<void>;
type CommandDef = { description: string; handler: (args: string, ctx: any) => void | Promise<void> };

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "pi-working-indicator-"));
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

function bootExtension(settingsPath: string): { emit: (event: string, payload: any, ctx: any) => Promise<void>; command: CommandDef } {
  const handlers = new Map<string, EventHandler[]>();
  let command: CommandDef | undefined;

  const stubPi = {
    on(event: string, handler: EventHandler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name: string, def: CommandDef) {
      if (name === "working") command = def;
    },
  };

  createExtension(settingsPath)(stubPi as any);
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

function makeCtx() {
  const indicatorCalls: Array<unknown> = [];
  const statusCalls: Array<[string, unknown]> = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const ctx = {
    hasUI: true,
    ui: {
      setWorkingIndicator(options: unknown) {
        indicatorCalls.push(options);
      },
      setStatus(key: string, value: unknown) {
        statusCalls.push([key, value]);
      },
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };
  return { ctx, indicatorCalls, statusCalls, notifications };
}

test("session_start loads saved working settings silently and leaves the indicator hidden until a turn begins", async () => {
  await withTmpFile(async (filePath) => {
    await writeFile(
      filePath,
      JSON.stringify({
        indicatorShape: "dot",
        active: { color: "#123456", gleam: false, rainbow: false },
        toolUse: { color: "#123456", gleam: true, rainbow: false },
        thinking: { color: "#123456", gleam: true, rainbow: true },
      }),
      "utf8",
    );

    const { emit } = bootExtension(filePath);

    const { ctx, indicatorCalls, notifications } = makeCtx();
    await emit("session_start", { reason: "startup" }, ctx);

    assert.equal(indicatorCalls.length, 1, "render fires exactly once on startup");
    assert.equal(indicatorCalls[0], undefined, "indicator is reset to host default while idle");
    assert.deepEqual(notifications, [], "no toast on startup load");

    await emit("turn_start", {}, ctx);
    const firstActive = indicatorCalls.at(-1) as any;
    assert.ok(firstActive?.frames, "turn_start shows the custom active indicator");
  });
});

test("indicator hides when a turn ends and re-appears on the next turn_start", async () => {
  await withTmpFile(async (filePath) => {
    const { emit } = bootExtension(filePath);
    const { ctx, indicatorCalls } = makeCtx();

    await emit("session_start", { reason: "startup" }, ctx);
    await emit("turn_start", {}, ctx);
    assert.ok((indicatorCalls.at(-1) as any)?.frames, "indicator is shown while the turn is active");

    await emit("turn_end", {}, ctx);
    assert.equal(indicatorCalls.at(-1), undefined, "indicator is explicitly hidden at turn_end");

    await emit("turn_start", {}, ctx);
    assert.ok((indicatorCalls.at(-1) as any)?.frames, "next turn_start re-applies the indicator");
  });
});

test("tool execution adds gleam styling and thinking overrides it with rainbow styling", async () => {
  await withTmpFile(async (filePath) => {
    const { emit } = bootExtension(filePath);
    const { ctx, indicatorCalls } = makeCtx();

    await emit("session_start", { reason: "startup" }, ctx);
    await emit("turn_start", {}, ctx);
    await emit("tool_execution_start", { toolCallId: "call-1" }, ctx);
    await emit("message_update", { assistantMessageEvent: { type: "thinking_start" } }, ctx);
    await emit("message_update", { assistantMessageEvent: { type: "thinking_end" } }, ctx);

    const toolUseIndicator = indicatorCalls[2] as any;
    const thinkingIndicator = indicatorCalls[3] as any;
    const backToToolUseIndicator = indicatorCalls[4] as any;

    assert.ok(toolUseIndicator?.frames?.some((frame: string) => /\x1b\[1;38;2;/.test(frame)), "toolUse gleam should brighten indicator frames");
    assert.ok(thinkingIndicator?.frames?.some((frame: string) => /255;179;186|186;225;255|218;186;255/.test(frame)), "thinking should apply pastel rainbow colors");
    assert.ok(backToToolUseIndicator?.frames?.some((frame: string) => /\x1b\[1;38;2;/.test(frame)), "thinking_end should restore toolUse styling while tool execution is active");
  });
});

test("/working with no args reports the current config summary with kebab-case command names and does not write", async () => {
  await withTmpFile(async (filePath) => {
    const { command } = bootExtension(filePath);
    const { ctx, notifications } = makeCtx();

    await command.handler("", ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");
    assert.match(notifications[0]!.message, /indicatorShape=spinner/);
    assert.match(notifications[0]!.message, /tool-use\(color=#81A1C1, gleam=on, rainbow=off\)/);
    assert.doesNotMatch(notifications[0]!.message, /toolUse\(/);
    await assert.rejects(() => readFile(filePath, "utf8"));
  });
});

test("/working indicator=dot persists the new indicator shape", async () => {
  await withTmpFile(async (filePath) => {
    const { emit, command } = bootExtension(filePath);
    const { ctx, indicatorCalls, notifications } = makeCtx();
    await emit("session_start", { reason: "startup" }, ctx);
    await emit("turn_start", {}, ctx);

    await command.handler("indicator=dot", ctx);

    const lastCall = indicatorCalls.at(-1) as any;
    assert.ok(lastCall, "indicator is re-applied immediately while a turn is active");
    assert.equal(lastCall.frames.length, 1, "dot indicator uses a single frame");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");
    assert.match(notifications[0]!.message, /indicatorShape=dot/);

    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(parsed.indicatorShape, "dot");
  });
});

test("/working thinking color=default resets that state to the built-in default color", async () => {
  await withTmpFile(async (filePath) => {
    const { command } = bootExtension(filePath);
    const { ctx } = makeCtx();

    await command.handler("thinking color=default", ctx);

    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(parsed.thinking.color, "#81A1C1");
    assert.equal(parsed.thinking.gleam, true);
    assert.equal(parsed.thinking.rainbow, true);
  });
});

test("/working tool-use success toasts use kebab-case state names", async () => {
  await withTmpFile(async (filePath) => {
    const { command } = bootExtension(filePath);
    const { ctx, notifications } = makeCtx();

    await command.handler("tool-use rainbow=on", ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "info");
    assert.match(notifications[0]!.message, /^Working updated: tool-use\.rainbow=on$/);
    assert.doesNotMatch(notifications[0]!.message, /toolUse/);
  });
});

test("command-driven writes preserve unrelated top-level keys already present in the config file", async () => {
  await withTmpFile(async (filePath) => {
    await writeFile(
      filePath,
      JSON.stringify({
        otherExtension: { enabled: true, nested: { value: 42 } },
        indicatorShape: "spinner",
      }),
      "utf8",
    );

    const { command } = bootExtension(filePath);
    const { ctx } = makeCtx();

    await command.handler("indicator=pulse", ctx);

    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(parsed.otherExtension, { enabled: true, nested: { value: 42 } }, "unrelated keys are preserved");
    assert.equal(parsed.indicatorShape, "pulse", "target key is updated");
  });
});

test("/working rejects unsupported command grammar with a usage toast", async () => {
  await withTmpFile(async (filePath) => {
    const { command } = bootExtension(filePath);
    const { ctx, notifications } = makeCtx();

    await command.handler("toolUse rainbow=on", ctx);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, "error");
    assert.match(notifications[0]!.message, /Usage: \/working/);
    await assert.rejects(() => readFile(filePath, "utf8"));
  });
});
