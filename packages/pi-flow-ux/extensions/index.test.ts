import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resetWorkingCoordinatorForTests } from "./working.ts";
import { resetTuiSettingsStoreForTests } from "./settings.ts";
import indexExtension from "./index.ts";

type EventHandler = (event: any, ctx: any) => void | Promise<void>;

function makePi() {
  const handlers = new Map<string, EventHandler[]>();
  const commands = new Map<string, any>();
  const messages: unknown[] = [];
  const renderers = new Map<string, unknown>();
  const pi = {
    on(event: string, handler: EventHandler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name: string, opts: any) {
      commands.set(name, opts);
    },
    getThinkingLevel() {
      return "off";
    },
    getCommands() {
      return [];
    },
    sendMessage(msg: unknown) {
      messages.push(msg);
    },
    registerMessageRenderer(type: string, renderer: unknown) {
      renderers.set(type, renderer);
    },
  };
  async function emit(event: string, payload: any = {}, ctx: any = {}) {
    for (const handler of handlers.get(event) ?? []) {
      await handler(payload, ctx);
    }
  }
  return { pi, emit, commands, messages, renderers };
}

function makeCtx(cwd?: string) {
  const calls: { method: string; arg: unknown }[] = [];
  const ctx = {
    hasUI: true,
    cwd: cwd ?? "/test/repo",
    model: undefined as any,
    getContextUsage() {
      return undefined;
    },
    ui: {
      getAllThemes() {
        return [];
      },
      setFooter(arg: unknown) {
        calls.push({ method: "setFooter", arg });
      },
      setEditorComponent(arg: unknown) {
        calls.push({ method: "setEditorComponent", arg });
      },
      setHeader(arg: unknown) {
        calls.push({ method: "setHeader", arg });
      },
      setWorkingVisible(arg: unknown) {
        calls.push({ method: "setWorkingVisible", arg });
      },
      setWorkingIndicator(arg: unknown) {
        calls.push({ method: "setWorkingIndicator", arg });
      },
      theme: {
        name: "test",
        getColorMode() {
          return "truecolor";
        },
        fg(_token: string, text: string) {
          return text;
        },
        getThinkingBorderColor() {
          return (text: string) => text;
        },
        getBashModeBorderColor() {
          return (text: string) => text;
        },
      },
    },
  };
  function getCalls(method: string) {
    return calls.filter((c) => c.method === method);
  }
  return { ctx, getCalls };
}

before(() => {
  resetWorkingCoordinatorForTests();
  resetTuiSettingsStoreForTests();
});

after(() => {
  resetWorkingCoordinatorForTests();
  resetTuiSettingsStoreForTests();
});

test("registers /tui command but not /status or /working", () => {
  const { pi, commands } = makePi();
  indexExtension(pi as any);
  assert.ok(commands.has("tui"), "commands should have tui");
  assert.ok(!commands.has("status"), "commands should not have status");
  assert.ok(!commands.has("working"), "commands should not have working");
});

test("session_start suppresses the host working row and installs footer, editor, and header", async () => {
  resetWorkingCoordinatorForTests();
  resetTuiSettingsStoreForTests();
  const { pi, emit } = makePi();
  indexExtension(pi as any);
  const { ctx, getCalls } = makeCtx();

  await emit("session_start", { reason: "startup" }, ctx);

  const workingVisibleCalls = getCalls("setWorkingVisible");
  assert.ok(
    workingVisibleCalls.some((c) => c.arg === false),
    "setWorkingVisible(false) should be called to suppress host working row",
  );

  const footerCalls = getCalls("setFooter");
  assert.ok(footerCalls.length >= 1, "setFooter should be called");
  assert.equal(typeof footerCalls[0]!.arg, "function", "setFooter should receive a function (blank footer factory)");

  const editorCalls = getCalls("setEditorComponent");
  assert.ok(editorCalls.length >= 1, "setEditorComponent should be called");
  assert.equal(typeof editorCalls[0]!.arg, "function", "setEditorComponent should receive a function (border editor factory)");

  const headerCalls = getCalls("setHeader");
  assert.ok(headerCalls.length >= 1, "setHeader should be called");
  assert.equal(typeof headerCalls[0]!.arg, "function", "setHeader should receive a function (header factory)");
});

test("session_shutdown disposes all handles and restores host working row", async () => {
  resetWorkingCoordinatorForTests();
  resetTuiSettingsStoreForTests();
  const { pi, emit } = makePi();
  indexExtension(pi as any);
  const { ctx, getCalls } = makeCtx();

  await emit("session_start", { reason: "startup" }, ctx);
  await emit("session_shutdown", {}, ctx);

  const footerCalls = getCalls("setFooter");
  const lastFooter = footerCalls[footerCalls.length - 1];
  assert.equal(lastFooter?.arg, undefined, "setFooter(undefined) should be called on shutdown");

  const editorCalls = getCalls("setEditorComponent");
  const lastEditor = editorCalls[editorCalls.length - 1];
  assert.equal(lastEditor?.arg, undefined, "setEditorComponent(undefined) should be called on shutdown");

  const headerCalls = getCalls("setHeader");
  const lastHeader = headerCalls[headerCalls.length - 1];
  assert.equal(lastHeader?.arg, undefined, "setHeader(undefined) should be called on shutdown");

  const workingVisibleCalls = getCalls("setWorkingVisible");
  const lastVisible = workingVisibleCalls[workingVisibleCalls.length - 1];
  assert.equal(lastVisible?.arg, true, "setWorkingVisible(true) should be called on shutdown to restore host row");
});

test("registers the /tui command and installs a header on session_start", async () => {
  const { pi, emit, commands } = makePi();
  const { ctx, getCalls } = makeCtx();
  indexExtension(pi as any);
  await emit("session_start", { reason: "startup" }, ctx);
  assert.ok(commands.has("tui"), "tui command should be registered");
  assert.ok(getCalls("setHeader").some((c) => typeof c.arg === "function"), "header should be installed");
});

test("registers the pi-flow-ux:header-details message renderer at factory time", () => {
  resetWorkingCoordinatorForTests();
  resetTuiSettingsStoreForTests();
  const { pi, renderers } = makePi();
  indexExtension(pi as any);
  assert.ok(renderers.has("pi-flow-ux:header-details"), "renderer should be registered for pi-flow-ux:header-details");
  assert.equal(typeof renderers.get("pi-flow-ux:header-details"), "function", "registered renderer should be a function");
});

test("bare /tui header details flows end-to-end into a displayed custom chat message", async () => {
  resetWorkingCoordinatorForTests();
  resetTuiSettingsStoreForTests();
  const { pi, emit, commands, messages } = makePi();
  indexExtension(pi as any);

  // Use a fresh temp dir as cwd so DefaultPackageManager resolution is empty and fast.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-flow-test-"));
  try {
    const { ctx } = makeCtx(tmpDir);

    // Trigger session_start so the /tui command handler has the showHeaderDetails callback wired.
    await emit("session_start", { reason: "startup" }, ctx);

    // Build a command context matching the session ctx shape.
    const cmdCtx = {
      cwd: tmpDir,
      ui: ctx.ui,
    };

    // Invoke the /tui handler with "header details".
    await commands.get("tui").handler("header details", cmdCtx);

    assert.equal(messages.length, 1, "exactly one sendMessage call expected");
    const msg = messages[0] as Record<string, unknown>;
    assert.equal(msg["customType"], "pi-flow-ux:header-details", "customType should be pi-flow-ux:header-details");
    assert.equal(msg["display"], true, "display should be true");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
