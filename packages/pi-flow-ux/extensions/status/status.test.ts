import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_STATUS_SETTINGS,
  PACKAGE_DEFAULT_STATUS_SETTINGS_PATH,
  getStatusCoordinator,
  loadPackagedDefaultStatusSettings,
  loadSavedStatusSettings,
  normalizeStatusSettings,
  resetStatusCoordinatorForTests,
  saveStatusSettings,
} from "./status.ts";

type EventHandler = (event: any, ctx: any) => void | Promise<void>;

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "pi-status-"));
}

async function withTmpDir(
  fn: (paths: { userPath: string; packagedPath: string; dir: string }) => Promise<void>,
): Promise<void> {
  const dir = await makeTmpDir();
  try {
    resetStatusCoordinatorForTests();
    await fn({
      userPath: path.join(dir, "status.json"),
      packagedPath: path.join(dir, "packaged-status.json"),
      dir,
    });
  } finally {
    resetStatusCoordinatorForTests();
    await rm(dir, { recursive: true, force: true });
  }
}

// ─── Config: normalization and loading ──────────────────────────────────────────

test("normalizeStatusSettings falls back to default placement for invalid input", () => {
  assert.deepEqual(normalizeStatusSettings(undefined), DEFAULT_STATUS_SETTINGS);
  assert.deepEqual(normalizeStatusSettings({ placement: "nonsense" }), DEFAULT_STATUS_SETTINGS);
  assert.deepEqual(normalizeStatusSettings({ placement: "footer" }), { placement: "footer" });
});

test("loadSavedStatusSettings returns undefined when the file does not exist", async () => {
  await withTmpDir(async ({ userPath }) => {
    assert.equal(await loadSavedStatusSettings(userPath), undefined);
  });
});

test("loadSavedStatusSettings reads a valid placement", async () => {
  await withTmpDir(async ({ userPath }) => {
    await writeFile(userPath, JSON.stringify({ placement: "footer" }), "utf8");
    assert.deepEqual(await loadSavedStatusSettings(userPath), { placement: "footer" });
  });
});

test("loadSavedStatusSettings returns undefined when top-level JSON is not an object", async () => {
  await withTmpDir(async ({ userPath }) => {
    await writeFile(userPath, JSON.stringify(["footer"]), "utf8");
    assert.equal(await loadSavedStatusSettings(userPath), undefined);
  });
});

test("loadSavedStatusSettings with an unknown placement falls back to the supplied baseline", async () => {
  await withTmpDir(async ({ userPath }) => {
    await writeFile(userPath, JSON.stringify({ placement: "bogus" }), "utf8");
    assert.deepEqual(
      await loadSavedStatusSettings(userPath, { placement: "footer" }),
      { placement: "footer" },
    );
  });
});

test("loadPackagedDefaultStatusSettings returns undefined when missing and throws when malformed", async () => {
  await withTmpDir(async ({ packagedPath }) => {
    assert.equal(await loadPackagedDefaultStatusSettings(packagedPath), undefined);
    await writeFile(packagedPath, "{ not valid json", "utf8");
    await assert.rejects(() => loadPackagedDefaultStatusSettings(packagedPath));
  });
});

test("PACKAGE_DEFAULT_STATUS_SETTINGS_PATH resolves to the packaged status.json at the package root", () => {
  assert.match(
    PACKAGE_DEFAULT_STATUS_SETTINGS_PATH.replace(/\\/g, "/"),
    /packages\/pi-flow-ux\/status\.json$/,
  );
});

// ─── Config: saving ─────────────────────────────────────────────────────────────

test("saveStatusSettings preserves unrelated top-level keys and writes the placement", async () => {
  await withTmpDir(async ({ userPath }) => {
    await writeFile(userPath, JSON.stringify({ otherExtension: { enabled: true } }), "utf8");
    await saveStatusSettings(userPath, { placement: "footer" });
    const parsed = JSON.parse(await readFile(userPath, "utf8"));
    assert.deepEqual(parsed, { otherExtension: { enabled: true }, placement: "footer" });
  });
});

test("saveStatusSettings throws when the existing JSON is malformed", async () => {
  await withTmpDir(async ({ userPath }) => {
    await writeFile(userPath, "{broken", "utf8");
    await assert.rejects(() => saveStatusSettings(userPath, { placement: "off" }));
  });
});

test("saveStatusSettings does not leak temp files on success", async () => {
  await withTmpDir(async ({ userPath, dir }) => {
    await saveStatusSettings(userPath, { placement: "off" });
    const leftover = (await readdir(dir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftover, [], "atomic write should clean up its temp file");
  });
});

// ─── Coordinator: install harness ───────────────────────────────────────────────

function makeHarness() {
  const handlers = new Map<string, EventHandler[]>();
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
  const notifications: { message: string; type?: string }[] = [];
  // Sentinel distinguishes "never called" from "called with undefined" (disposed).
  const UNSET = Symbol("unset");
  let footerArg: unknown = UNSET;
  let editorArg: unknown = UNSET;

  const ui = {
    setFooter(builder: unknown) {
      footerArg = builder;
    },
    setEditorComponent(factory: unknown) {
      editorArg = factory;
    },
    notify(message: string, type?: string) {
      notifications.push({ message, type });
    },
    theme: {
      name: "test",
      getColorMode() {
        return "truecolor" as const;
      },
      fg(_token: string, text: string) {
        return text;
      },
      getThinkingBorderColor() {
        return (text: string) => text;
      },
    },
  };

  const ctx = {
    cwd: "/repo",
    model: { id: "model", contextWindow: 200000 },
    getContextUsage() {
      return undefined;
    },
    ui,
  };

  const pi = {
    on(event: string, handler: EventHandler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name: string, options: { handler: (args: string, ctx: any) => Promise<void> }) {
      commands.set(name, options);
    },
    async exec() {
      return { stdout: "", stderr: "", code: 0 };
    },
    getThinkingLevel() {
      return "off";
    },
    getSessionName() {
      return "";
    },
  };

  async function emit(event: string, payload: any = {}) {
    for (const handler of handlers.get(event) ?? []) {
      await handler(payload, ctx);
    }
  }

  async function runStatus(args: string) {
    const cmd = commands.get("status");
    assert.ok(cmd, "/status command must be registered");
    await cmd!.handler(args, ctx);
  }

  return {
    pi,
    ctx,
    emit,
    runStatus,
    notifications,
    footerInstalled: () => footerArg !== UNSET && footerArg !== undefined,
    footerDisposed: () => footerArg === undefined,
    editorInstalled: () => editorArg !== UNSET && editorArg !== undefined,
    editorDisposed: () => editorArg === undefined,
  };
}

async function bootSession(
  userPath: string,
  packagedPath: string,
): Promise<ReturnType<typeof makeHarness> & { coordinator: ReturnType<typeof getStatusCoordinator> }> {
  const coordinator = getStatusCoordinator(userPath, packagedPath);
  const harness = makeHarness();
  coordinator.ensureRegistered(harness.pi as any, true);
  await harness.emit("session_start", { reason: "startup" });
  return Object.assign(harness, { coordinator });
}

// ─── Coordinator: three-tier config layering ────────────────────────────────────

test("session_start with no user and no packaged config defaults to border", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    const { coordinator, editorInstalled, footerInstalled } = await bootSession(userPath, packagedPath);
    assert.equal(coordinator.getPlacement(), "border");
    assert.ok(editorInstalled(), "border placement installs the editor");
    assert.ok(!footerInstalled(), "border placement does not install the footer");
  });
});

test("session_start adopts the packaged baseline when there is no user file", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    await writeFile(packagedPath, JSON.stringify({ placement: "footer" }), "utf8");
    const { coordinator, footerInstalled, editorInstalled } = await bootSession(userPath, packagedPath);
    assert.equal(coordinator.getPlacement(), "footer");
    assert.ok(footerInstalled(), "packaged footer baseline installs the footer");
    assert.ok(!editorInstalled(), "footer placement does not install the border editor");
  });
});

test("session_start lets the user file win over the packaged baseline", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    await writeFile(packagedPath, JSON.stringify({ placement: "footer" }), "utf8");
    await writeFile(userPath, JSON.stringify({ placement: "off" }), "utf8");
    const { coordinator, footerInstalled, editorInstalled } = await bootSession(userPath, packagedPath);
    assert.equal(coordinator.getPlacement(), "off");
    assert.ok(!footerInstalled() || footerInstalled() === false, "off installs no footer");
    assert.ok(!editorInstalled(), "off installs no editor");
  });
});

test("malformed user JSON falls back to the packaged baseline", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    await writeFile(packagedPath, JSON.stringify({ placement: "footer" }), "utf8");
    await writeFile(userPath, "{ not valid json", "utf8");
    const { coordinator } = await bootSession(userPath, packagedPath);
    assert.equal(coordinator.getPlacement(), "footer");
  });
});

test("malformed packaged JSON throws loudly during session_start", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    await writeFile(packagedPath, "{ not valid json", "utf8");
    const coordinator = getStatusCoordinator(userPath, packagedPath);
    const harness = makeHarness();
    coordinator.ensureRegistered(harness.pi as any, true);
    await assert.rejects(() => harness.emit("session_start", { reason: "startup" }));
  });
});

// ─── Coordinator: mutual exclusion and switching ────────────────────────────────

test("/status with no args reports the current placement and accepted values", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    const harness = await bootSession(userPath, packagedPath);
    await harness.runStatus("");
    const last = harness.notifications.at(-1);
    assert.ok(last, "/status must notify");
    assert.match(last!.message, /placement=border/);
    assert.match(last!.message, /border\|footer\|off/);
  });
});

test("/status footer switches from border to footer in-session and disposes the editor", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    const harness = await bootSession(userPath, packagedPath);
    assert.ok(harness.editorInstalled(), "starts on the border editor");

    await harness.runStatus("footer");
    assert.equal(harness.coordinator.getPlacement(), "footer");
    assert.ok(harness.editorDisposed(), "switching away from border disposes the editor");
    assert.ok(harness.footerInstalled(), "footer renderer is now installed");
  });
});

test("/status off disposes the active renderer and installs neither", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    const harness = await bootSession(userPath, packagedPath);
    await harness.runStatus("footer");
    assert.ok(harness.footerInstalled());

    await harness.runStatus("off");
    assert.equal(harness.coordinator.getPlacement(), "off");
    assert.ok(harness.footerDisposed(), "off disposes the footer");
    assert.ok(harness.editorDisposed(), "off leaves no editor installed");
  });
});

test("/status border re-installs the editor after off", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    const harness = await bootSession(userPath, packagedPath);
    await harness.runStatus("off");
    await harness.runStatus("border");
    assert.equal(harness.coordinator.getPlacement(), "border");
    assert.ok(harness.editorInstalled(), "border re-installs the editor");
    assert.ok(!harness.footerInstalled(), "footer is not installed under border");
  });
});

test("/status rejects an unknown placement and leaves the current one unchanged", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    const harness = await bootSession(userPath, packagedPath);
    await harness.runStatus("sidebar");
    assert.equal(harness.coordinator.getPlacement(), "border");
    const last = harness.notifications.at(-1);
    assert.equal(last!.type, "error");
  });
});

// ─── Coordinator: persistence ───────────────────────────────────────────────────

test("/status switch persists the placement to the user path and never mutates the packaged file", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    const packagedSource = JSON.stringify({ placement: "border" }, null, 2);
    await writeFile(packagedPath, packagedSource, "utf8");
    const beforeMtime = (await stat(packagedPath)).mtimeMs;

    const harness = await bootSession(userPath, packagedPath);
    await harness.runStatus("footer");

    const userParsed = JSON.parse(await readFile(userPath, "utf8"));
    assert.equal(userParsed.placement, "footer", "user file picks up the mutation");

    assert.equal(await readFile(packagedPath, "utf8"), packagedSource, "packaged file unchanged");
    assert.equal((await stat(packagedPath)).mtimeMs, beforeMtime, "packaged file mtime unchanged");
  });
});

test("a persisted placement is reloaded on the next session", async () => {
  await withTmpDir(async ({ userPath, packagedPath }) => {
    const first = await bootSession(userPath, packagedPath);
    await first.runStatus("footer");

    // Fresh coordinator + session simulates a Pi reload reading the saved file.
    resetStatusCoordinatorForTests();
    const second = await bootSession(userPath, packagedPath);
    assert.equal(second.coordinator.getPlacement(), "footer", "placement survives a reload");
    assert.ok(second.footerInstalled());
  });
});

// ─── Coordinator: registry semantics ────────────────────────────────────────────

test("getStatusCoordinator throws when the same settingsPath rebinds a different packageDefaultPath", async () => {
  await withTmpDir(async ({ userPath, packagedPath, dir }) => {
    getStatusCoordinator(userPath, packagedPath);
    assert.throws(
      () => getStatusCoordinator(userPath, path.join(dir, "other-packaged.json")),
      /refusing to rebind/,
    );
  });
});
