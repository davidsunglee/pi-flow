import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { registerIdea } from "./idea.ts";
import { formatIdeaArtifact, parseIdeaArtifact, type IdeaArtifact } from "./storage.ts";

type NotifyLevel = "info" | "warning" | "error";
type NotifyCall = { message: string; level: NotifyLevel };

type RegisteredCommand = {
  name: string;
  options: { handler: (args: string, ctx: any) => Promise<void>; description?: string };
};

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: undefined, ctx: any) => Promise<any>;
};

function mkSandbox(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function bootExtension() {
  const commands: RegisteredCommand[] = [];
  const tools: RegisteredTool[] = [];
  const pi = {
    registerCommand(name: string, options: RegisteredCommand["options"]) {
      commands.push({ name, options });
    },
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
  };

  registerIdea(pi as any);

  const command = commands.find((c) => c.name === "flow:idea");
  assert.ok(command, "flow:idea command should be registered");
  const tool = tools.find((t) => t.name === "idea");
  assert.ok(tool, "idea tool should be registered");

  return { commands, tools, command, tool };
}

function makeCtx(
  cwd: string,
  opts: { hasUI?: boolean; inputResult?: string | undefined; inputReturnsUndefined?: boolean } = {},
) {
  const notifyCalls: NotifyCall[] = [];
  const inputCalls: Array<{ title: string; placeholder?: string }> = [];
  return {
    cwd,
    hasUI: opts.hasUI ?? true,
    notifyCalls,
    inputCalls,
    ui: {
      notify(message: string, level: NotifyLevel) {
        notifyCalls.push({ message, level });
      },
      async input(title: string, placeholder?: string): Promise<string | undefined> {
        inputCalls.push({ title, placeholder });
        if (opts.inputReturnsUndefined) return undefined;
        return opts.inputResult ?? "";
      },
    },
  };
}

async function listTodoFiles(sandbox: string): Promise<string[]> {
  const todoDir = path.join(sandbox, "docs", "todos");
  try {
    return (await fs.readdir(todoDir)).filter((name) => /^[0-9a-f]{8}\.md$/.test(name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function readOnlyArtifact(sandbox: string): Promise<IdeaArtifact> {
  const files = await listTodoFiles(sandbox);
  assert.equal(files.length, 1, "expected exactly one idea artifact");
  const raw = await fs.readFile(path.join(sandbox, "docs", "todos", files[0]), "utf8");
  const parsed = parseIdeaArtifact(raw);
  assert.ok(parsed, "artifact should parse");
  return parsed;
}

async function seedIdea(sandbox: string, artifact: IdeaArtifact): Promise<void> {
  const todoDir = path.join(sandbox, "docs", "todos");
  await fs.mkdir(todoDir, { recursive: true });
  await fs.writeFile(path.join(todoDir, `${artifact.id}.md`), formatIdeaArtifact(artifact), "utf8");
}

const BASE_CREATED_AT = "2026-05-20T00:00:00.000Z";

function artifact(id: string, title: string, status: "open" | "done" = "open"): IdeaArtifact {
  return {
    id,
    title,
    tags: [],
    status,
    createdAt: BASE_CREATED_AT,
    body: `Body for ${title}`,
  };
}

test("command happy path writes an idea artifact and reports TODO id", async () => {
  const sandbox = mkSandbox("pi-flow-idea-command-");
  const { command } = bootExtension();
  const ctx = makeCtx(sandbox);

  await command.options.handler("Add scout dispatch retry\nBackground prose...", ctx);

  const files = await listTodoFiles(sandbox);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[0-9a-f]{8}\.md$/);

  const raw = await fs.readFile(path.join(sandbox, "docs", "todos", files[0]), "utf8");
  const parsed = parseIdeaArtifact(raw);
  assert.ok(parsed);
  assert.equal(parsed.title, "Add scout dispatch retry");
  assert.deepEqual(parsed.tags, []);
  assert.equal(parsed.status, "open");
  assert.doesNotThrow(() => new Date(parsed.createdAt).toISOString());
  assert.equal(parsed.body, "Background prose...");

  const notify = ctx.notifyCalls.find((c) => c.level === "info");
  assert.ok(notify, "expected info notification");
  assert.match(notify.message, /TODO-[0-9a-f]{8}/);
  assert.match(notify.message, /Add scout dispatch retry/);
});

test("empty-args interactive prompt captures prompted title", async () => {
  const sandbox = mkSandbox("pi-flow-idea-prompt-");
  const { command } = bootExtension();
  const ctx = makeCtx(sandbox, { hasUI: true, inputResult: "Title from prompt" });

  await command.options.handler("   ", ctx);

  assert.deepEqual(ctx.inputCalls, [
    { title: "Capture idea", placeholder: "Title (or first line of body)" },
  ]);
  const parsed = await readOnlyArtifact(sandbox);
  assert.equal(parsed.title, "Title from prompt");
});

test("cancelled interactive prompt (undefined result) writes nothing and notifies user", async () => {
  const sandbox = mkSandbox("pi-flow-idea-cancel-");
  const { command } = bootExtension();
  const ctx = makeCtx(sandbox, { hasUI: true, inputReturnsUndefined: true });

  await command.options.handler("", ctx);

  assert.deepEqual(await listTodoFiles(sandbox), []);
  assert.equal(ctx.inputCalls.length, 1);
});

test("empty interactive prompt result (user cleared field) writes nothing", async () => {
  const sandbox = mkSandbox("pi-flow-idea-empty-prompt-");
  const { command } = bootExtension();
  const ctx = makeCtx(sandbox, { hasUI: true, inputResult: "   " });

  await command.options.handler("", ctx);

  assert.deepEqual(await listTodoFiles(sandbox), []);
});

test("empty-args without UI rejects with usage message and writes nothing", async () => {
  const sandbox = mkSandbox("pi-flow-idea-no-ui-");
  const { command } = bootExtension();
  const ctx = makeCtx(sandbox, { hasUI: false });

  await command.options.handler("", ctx);

  assert.deepEqual(await listTodoFiles(sandbox), []);
  const error = ctx.notifyCalls.find((c) => c.level === "error");
  assert.ok(error, "expected error notification");
  assert.match(error.message, /\/flow:idea requires a title or body/);
  assert.match(error.message, /Usage: \/flow:idea <title or prose>/);
});

test("tool list returns seeded ideas", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-list-");
  const { tool } = bootExtension();
  await seedIdea(sandbox, artifact("aaaabbbb", "First idea"));
  await seedIdea(sandbox, artifact("ccccdddd", "Second idea", "done"));

  const result = await tool.execute("call-list", { action: "list" }, undefined, undefined, makeCtx(sandbox));

  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /First idea/);
  assert.match(result.content[0].text, /Second idea/);
  assert.deepEqual(
    result.details.list.map((entry: any) => entry.id).sort(),
    ["aaaabbbb", "ccccdddd"],
  );
});

test("tool read accepts TODO-prefixed and bare ids", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-read-");
  const { tool } = bootExtension();
  await seedIdea(sandbox, artifact("abc123ef", "Readable idea"));
  const ctx = makeCtx(sandbox);

  const prefixed = await tool.execute("call-read-1", { action: "read", id: "TODO-abc123ef" }, undefined, undefined, ctx);
  const bare = await tool.execute("call-read-2", { action: "read", id: "abc123ef" }, undefined, undefined, ctx);

  assert.equal(prefixed.isError, undefined);
  assert.equal(bare.isError, undefined);
  assert.equal(JSON.parse(prefixed.content[0].text).title, "Readable idea");
  assert.equal(JSON.parse(bare.content[0].text).title, "Readable idea");
});

test("tool create writes a new idea artifact", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-create-");
  const { tool } = bootExtension();

  const result = await tool.execute(
    "call-create",
    { action: "create", title: "From tool", tags: ["a", "b"] },
    undefined,
    undefined,
    makeCtx(sandbox),
  );

  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /TODO-[0-9a-f]{8}/);
  const parsed = await readOnlyArtifact(sandbox);
  assert.equal(parsed.title, "From tool");
  assert.deepEqual(parsed.tags, ["a", "b"]);
  assert.equal(parsed.status, "open");
  assert.equal(parsed.body, "");
});

test("tool update accepts bare id and preserves omitted fields", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-update-");
  const { tool } = bootExtension();
  await seedIdea(sandbox, {
    ...artifact("fedcba98", "Keep title"),
    tags: ["keep"],
    body: "Keep body",
  });

  const result = await tool.execute(
    "call-update",
    { action: "update", id: "fedcba98", status: "done" },
    undefined,
    undefined,
    makeCtx(sandbox),
  );

  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /TODO-fedcba98/);
  const raw = await fs.readFile(path.join(sandbox, "docs", "todos", "fedcba98.md"), "utf8");
  const parsed = parseIdeaArtifact(raw);
  assert.ok(parsed);
  assert.equal(parsed.status, "done");
  assert.equal(parsed.title, "Keep title");
  assert.deepEqual(parsed.tags, ["keep"]);
  assert.equal(parsed.body, "Keep body");
});

test("registerIdea does not leak todo command or tool names", () => {
  const { commands, tools } = bootExtension();
  assert.ok(commands.some((c) => c.name === "flow:idea"));
  assert.equal(commands.some((c) => c.name === "todo" || c.name === "flow:todo"), false);
  assert.equal(tools.some((t) => t.name === "todo" || t.name === "flow:todo"), false);
  assert.deepEqual(commands.map((c) => c.name), ["flow:idea"]);
  assert.deepEqual(tools.map((t) => t.name), ["idea"]);
});
