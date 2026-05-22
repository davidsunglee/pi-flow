import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { registerIdea } from "./idea.ts";
import { formatIdeaArtifact, parseIdeaArtifact, type IdeaArtifact } from "./storage.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

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
  const customCalls: any[] = [];
  const editorTextCalls: string[] = [];
  return {
    cwd,
    hasUI: opts.hasUI ?? true,
    notifyCalls,
    inputCalls,
    customCalls,
    editorTextCalls,
    ui: {
      notify(message: string, level: NotifyLevel) {
        notifyCalls.push({ message, level });
      },
      async input(title: string, placeholder?: string): Promise<string | undefined> {
        inputCalls.push({ title, placeholder });
        if (opts.inputReturnsUndefined) return undefined;
        return opts.inputResult ?? "";
      },
      async custom(factory: any, _options?: any): Promise<any> {
        customCalls.push({ factory, _options });
        return undefined;
      },
      setEditorText(text: string) {
        editorTextCalls.push(text);
      },
    },
  };
}

async function listIdeaFiles(sandbox: string): Promise<string[]> {
  const todoDir = path.join(sandbox, "docs", "ideas");
  try {
    return (await fs.readdir(todoDir)).filter((name) => /^[0-9a-f]{8}\.md$/.test(name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function readOnlyArtifact(sandbox: string): Promise<IdeaArtifact> {
  const files = await listIdeaFiles(sandbox);
  assert.equal(files.length, 1, "expected exactly one idea artifact");
  const raw = await fs.readFile(path.join(sandbox, "docs", "ideas", files[0]), "utf8");
  const parsed = parseIdeaArtifact(raw);
  assert.ok(parsed, "artifact should parse");
  return parsed;
}

async function seedIdea(sandbox: string, artifact: IdeaArtifact): Promise<void> {
  const todoDir = path.join(sandbox, "docs", "ideas");
  await fs.mkdir(todoDir, { recursive: true });
  await fs.writeFile(path.join(todoDir, `${artifact.id}.md`), formatIdeaArtifact(artifact), "utf8");
}

const BASE_CREATED_AT = "2026-05-20T00:00:00.000Z";

function artifact(id: string, title: string, status: "open" | "closed" = "open"): IdeaArtifact {
  return {
    id,
    title,
    tags: [],
    status,
    createdAt: BASE_CREATED_AT,
    body: `Body for ${title}`,
  };
}

test("command happy path writes an idea artifact and reports IDEA id", async () => {
  const sandbox = mkSandbox("pi-flow-idea-command-");
  const { command } = bootExtension();
  const ctx = makeCtx(sandbox);

  await command.options.handler("Add scout dispatch retry\nBackground prose...", ctx);

  const files = await listIdeaFiles(sandbox);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[0-9a-f]{8}\.md$/);

  const raw = await fs.readFile(path.join(sandbox, "docs", "ideas", files[0]), "utf8");
  const parsed = parseIdeaArtifact(raw);
  assert.ok(parsed);
  assert.equal(parsed.title, "Add scout dispatch retry");
  assert.deepEqual(parsed.tags, []);
  assert.equal(parsed.status, "open");
  assert.doesNotThrow(() => new Date(parsed.createdAt).toISOString());
  assert.equal(parsed.body, "Background prose...");

  const notify = ctx.notifyCalls.find((c) => c.level === "info");
  assert.ok(notify, "expected info notification");
  assert.match(notify.message, /IDEA-[0-9a-f]{8}/);
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

  assert.deepEqual(await listIdeaFiles(sandbox), []);
  assert.equal(ctx.inputCalls.length, 1);
});

test("empty interactive prompt result (user cleared field) writes nothing", async () => {
  const sandbox = mkSandbox("pi-flow-idea-empty-prompt-");
  const { command } = bootExtension();
  const ctx = makeCtx(sandbox, { hasUI: true, inputResult: "   " });

  await command.options.handler("", ctx);

  assert.deepEqual(await listIdeaFiles(sandbox), []);
});

test("empty-args without UI rejects with usage message and writes nothing", async () => {
  const sandbox = mkSandbox("pi-flow-idea-no-ui-");
  const { command } = bootExtension();
  const ctx = makeCtx(sandbox, { hasUI: false });

  await command.options.handler("", ctx);

  assert.deepEqual(await listIdeaFiles(sandbox), []);
  const error = ctx.notifyCalls.find((c) => c.level === "error");
  assert.ok(error, "expected error notification");
  assert.match(error.message, /\/flow:idea requires a title or body/);
  assert.match(error.message, /Usage: \/flow:idea <title or prose>/);
});

test("tool list returns seeded ideas", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-list-");
  const { tool } = bootExtension();
  await seedIdea(sandbox, artifact("aaaabbbb", "First idea", "open"));
  await seedIdea(sandbox, artifact("ccccdddd", "Second idea", "closed"));

  const result = await tool.execute("call-list", { action: "list" }, undefined, undefined, makeCtx(sandbox));

  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(
    result.details.list.map((entry: any) => entry.id).sort(),
    ["aaaabbbb"],
  );

  const allResult = await tool.execute("call-list-all", { action: "list", status: "all" }, undefined, undefined, makeCtx(sandbox));
  assert.equal(allResult.isError, undefined);
  assert.deepEqual(
    allResult.details.list.map((entry: any) => entry.id).sort(),
    ["aaaabbbb", "ccccdddd"],
  );
});

test("tool read accepts IDEA-prefixed and bare ids", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-read-");
  const { tool } = bootExtension();
  await seedIdea(sandbox, artifact("abc123ef", "Readable idea"));
  const ctx = makeCtx(sandbox);

  const prefixed = await tool.execute("call-read-1", { action: "read", id: "IDEA-abc123ef" }, undefined, undefined, ctx);
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
  assert.match(result.content[0].text, /IDEA-[0-9a-f]{8}/);
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
    { action: "update", id: "fedcba98", status: "closed" },
    undefined,
    undefined,
    makeCtx(sandbox),
  );

  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /IDEA-fedcba98/);
  const raw = await fs.readFile(path.join(sandbox, "docs", "ideas", "fedcba98.md"), "utf8");
  const parsed = parseIdeaArtifact(raw);
  assert.ok(parsed);
  assert.equal(parsed.status, "closed");
  assert.equal(parsed.title, "Keep title");
  assert.deepEqual(parsed.tags, ["keep"]);
  assert.equal(parsed.body, "Keep body");
});


test("tool list rejects unknown filter fields", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-list-reject-");
  const { tool } = bootExtension();

  const result = await tool.execute("call-list-reject", { action: "list", foo: "bar" } as any, undefined, undefined, makeCtx(sandbox));

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /invalid fields for list: foo/);
});

test("tool list accepts query filter", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-list-query-");
  const { tool } = bootExtension();
  await seedIdea(sandbox, artifact("aaaaaaaa", "Alpha feature idea", "open"));
  await seedIdea(sandbox, artifact("bbbbbbbb", "Beta improvement idea", "open"));
  await seedIdea(sandbox, artifact("cccccccc", "Gamma unique idea", "open"));

  const result = await tool.execute(
    "call-list-query",
    { action: "list", status: "all", query: "unique" },
    undefined,
    undefined,
    makeCtx(sandbox),
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(
    result.details.list.map((entry: any) => entry.id),
    ["cccccccc"],
  );
});

test("tool append appends with blank-line separator", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-append-");
  const { tool } = bootExtension();
  const idea = { ...artifact("12345678", "Append test"), body: "first" };
  await seedIdea(sandbox, idea);

  const result = await tool.execute(
    "call-append",
    { action: "append", id: "12345678", body: "second" },
    undefined,
    undefined,
    makeCtx(sandbox),
  );

  assert.equal(result.isError, undefined);
  const raw = await fs.readFile(path.join(sandbox, "docs", "ideas", "12345678.md"), "utf8");
  const parsed = parseIdeaArtifact(raw);
  assert.ok(parsed);
  assert.equal(parsed.body, "first\n\nsecond");
  assert.equal(result.details.body, "first\n\nsecond");
});

test("tool append on empty body uses no separator", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-append-empty-");
  const { tool } = bootExtension();
  const idea = { ...artifact("abcdef01", "Append empty test"), body: "" };
  await seedIdea(sandbox, idea);

  const result = await tool.execute(
    "call-append-empty",
    { action: "append", id: "abcdef01", body: "only" },
    undefined,
    undefined,
    makeCtx(sandbox),
  );

  assert.equal(result.isError, undefined);
  assert.equal(result.details.body, "only");
});

test("tool delete removes file and returns details", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-delete-");
  const { tool } = bootExtension();
  const idea = artifact("deadbeef", "To be deleted");
  await seedIdea(sandbox, idea);

  const result = await tool.execute(
    "call-delete",
    { action: "delete", id: "deadbeef" },
    undefined,
    undefined,
    makeCtx(sandbox),
  );

  assert.equal(result.isError, undefined);
  assert.equal(result.details.id, "deadbeef");
  assert.equal(existsSync(path.join(sandbox, "docs", "ideas", "deadbeef.md")), false);
});

test("tool delete returns error on missing id", async () => {
  const sandbox = mkSandbox("pi-flow-idea-tool-delete-missing-");
  const { tool } = bootExtension();

  const result = await tool.execute(
    "call-delete-missing",
    { action: "delete", id: "cafebabe" },
    undefined,
    undefined,
    makeCtx(sandbox),
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not found: IDEA-[0-9a-f]{8}/);
});

test("registerIdea does not leak todo command or tool names", () => {
  const { commands, tools } = bootExtension();
  assert.ok(commands.some((c) => c.name === "flow:idea"));
  assert.equal(commands.some((c) => c.name === "todo" || c.name === "flow:todo"), false);
  assert.equal(tools.some((t) => t.name === "todo" || t.name === "flow:todo"), false);
  assert.deepEqual(commands.map((c) => c.name), ["flow:idea", "flow:ideas"]);
  assert.deepEqual(tools.map((t) => t.name), ["idea"]);
});

test("buildRefineIdeaPrompt generates correct template", async () => {
  const { buildRefineIdeaPrompt } = await import("./idea.ts");
  const result = buildRefineIdeaPrompt("abcd1234", "Test idea");

  assert.match(result, /idea IDEA-abcd1234/);
  assert.match(result, /Test idea/);
  assert.match(result, /provide a recommendation for each question/);

  const contextIdx = result.indexOf("## Context");
  const goalIdx = result.indexOf("## Goal");
  const scopeIdx = result.indexOf("## Scope");
  const acceptanceIdx = result.indexOf("## Acceptance Sketch");
  const questionsIdx = result.indexOf("## Open Questions");

  assert.ok(contextIdx > -1);
  assert.ok(goalIdx > -1);
  assert.ok(scopeIdx > -1);
  assert.ok(acceptanceIdx > -1);
  assert.ok(questionsIdx > -1);
  assert.ok(contextIdx < goalIdx && goalIdx < scopeIdx && scopeIdx < acceptanceIdx && acceptanceIdx < questionsIdx);

  assert.match(result, /update the idea via the `idea` tool's `update` action\.$/m);
});

test("filterAndRankIdeas with empty query returns open before closed, chronologically", async () => {
  const { filterAndRankIdeas } = await import("./idea.ts");

  const entries = [
    { id: "aaaabbbb", title: "First", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "ccccdddd", title: "Second", tags: [], status: "open" as const, createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "eeeeffff", title: "Third", tags: [], status: "closed" as const, createdAt: "2025-12-01T00:00:00.000Z" },
  ];

  const result = filterAndRankIdeas(entries, "");

  assert.deepEqual(
    result.map((e) => e.id),
    ["aaaabbbb", "ccccdddd", "eeeeffff"]
  );
});

test("filterAndRankIdeas with query filters by fuzzy match", async () => {
  const { filterAndRankIdeas } = await import("./idea.ts");

  const entries = [
    { id: "aaaabbbb", title: "First", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "ccccdddd", title: "Second", tags: [], status: "open" as const, createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "eeeeffff", title: "UNIQUE", tags: [], status: "closed" as const, createdAt: "2025-12-01T00:00:00.000Z" },
  ];

  const result = filterAndRankIdeas(entries, "unique");

  assert.deepEqual(result.map((e) => e.id), ["eeeeffff"]);
});

test("formatGroupedTextList with mixed entries groups by status", async () => {
  const { formatGroupedTextList } = await import("./idea.ts");

  const entries = [
    { id: "aaaabbbb", title: "First", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "ccccdddd", title: "Second", tags: [], status: "closed" as const, createdAt: "2026-02-01T00:00:00.000Z" },
  ];

  const result = formatGroupedTextList(entries, {});

  assert.match(result, /Open ideas \(1\)/);
  assert.match(result, /Closed ideas \(1\)/);
  assert.match(result, /IDEA-aaaabbbb/);
  assert.match(result, /IDEA-ccccdddd/);
});

test("formatGroupedTextList respects status filter", async () => {
  const { formatGroupedTextList } = await import("./idea.ts");

  const entries = [
    { id: "aaaabbbb", title: "First", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "ccccdddd", title: "Second", tags: [], status: "closed" as const, createdAt: "2026-02-01T00:00:00.000Z" },
  ];

  const result = formatGroupedTextList(entries, { status: "open" });

  assert.match(result, /Open ideas \(1\)/);
  assert.doesNotMatch(result, /Closed ideas/);
});

test("formatGroupedTextList returns 'No ideas.' when empty with no query", async () => {
  const { formatGroupedTextList } = await import("./idea.ts");

  const result = formatGroupedTextList([], {});

  assert.equal(result.trim(), "No ideas.");
});

test("formatGroupedTextList returns 'No matching ideas.' when query matches nothing", async () => {
  const { formatGroupedTextList } = await import("./idea.ts");

  const entries = [
    { id: "aaaabbbb", title: "First", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  const result = formatGroupedTextList(entries, { query: "nomatchxyz" });

  assert.equal(result.trim(), "No matching ideas.");
});

test("formatGroupedTextList shows tags when present", async () => {
  const { formatGroupedTextList } = await import("./idea.ts");

  const entries = [
    { id: "aaaabbbb", title: "First", tags: ["tag1", "tag2"], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  const result = formatGroupedTextList(entries, {});

  assert.match(result, /\[tag1, tag2\]/);
});

test("parseFlowIdeasArgs with empty string returns defaults", async () => {
  const { parseFlowIdeasArgs } = await import("./idea.ts");

  const result = parseFlowIdeasArgs("");

  assert.deepEqual(result, { query: "", status: "all" });
});

test("parseFlowIdeasArgs with query only", async () => {
  const { parseFlowIdeasArgs } = await import("./idea.ts");

  const result = parseFlowIdeasArgs("regression");

  assert.deepEqual(result, { query: "regression", status: "all" });
});

test("parseFlowIdeasArgs with --open flag and query", async () => {
  const { parseFlowIdeasArgs } = await import("./idea.ts");

  const result = parseFlowIdeasArgs("--open regression auth");

  assert.deepEqual(result, { query: "regression auth", status: "open" });
});

test("parseFlowIdeasArgs last flag wins", async () => {
  const { parseFlowIdeasArgs } = await import("./idea.ts");

  const result = parseFlowIdeasArgs("--closed --all foo");

  assert.deepEqual(result, { query: "foo", status: "all" });
});

test("flow:ideas command in non-UI mode prints grouped list", async () => {
  const sandbox = mkSandbox("pi-flow-ideas-cmd-grouped-");
  const { commands } = bootExtension();
  const cmd = commands.find((c) => c.name === "flow:ideas");
  assert.ok(cmd, "flow:ideas command should be registered");

  await seedIdea(sandbox, artifact("11111111", "Open idea one", "open"));
  await seedIdea(sandbox, artifact("22222222", "Open idea two", "open"));
  await seedIdea(sandbox, artifact("33333333", "Closed idea one", "closed"));

  const ctx = makeCtx(sandbox, { hasUI: false });
  await cmd.options.handler("", ctx);

  assert.equal(ctx.notifyCalls.length, 1);
  assert.equal(ctx.notifyCalls[0].level, "info");
  assert.match(ctx.notifyCalls[0].message, /Open ideas/);
  assert.match(ctx.notifyCalls[0].message, /Closed ideas/);
});

test("flow:ideas command respects --open flag", async () => {
  const sandbox = mkSandbox("pi-flow-ideas-cmd-open-");
  const { commands } = bootExtension();
  const cmd = commands.find((c) => c.name === "flow:ideas");
  assert.ok(cmd, "flow:ideas command should be registered");

  await seedIdea(sandbox, artifact("aaaa1111", "Open one", "open"));
  await seedIdea(sandbox, artifact("aaaa2222", "Open two", "open"));
  await seedIdea(sandbox, artifact("aaaa3333", "Closed one", "closed"));

  const ctx = makeCtx(sandbox, { hasUI: false });
  await cmd.options.handler("--open", ctx);

  assert.equal(ctx.notifyCalls.length, 1);
  assert.equal(ctx.notifyCalls[0].level, "info");
  assert.match(ctx.notifyCalls[0].message, /Open ideas/);
  assert.doesNotMatch(ctx.notifyCalls[0].message, /Closed ideas/);
});

test("flow:ideas command filters by positional query", async () => {
  const sandbox = mkSandbox("pi-flow-ideas-cmd-query-");
  const { commands } = bootExtension();
  const cmd = commands.find((c) => c.name === "flow:ideas");
  assert.ok(cmd, "flow:ideas command should be registered");

  await seedIdea(sandbox, artifact("bbbb1111", "Alpha unique title", "open"));
  await seedIdea(sandbox, artifact("bbbb2222", "Beta something else", "open"));
  await seedIdea(sandbox, artifact("bbbb3333", "Gamma other", "open"));

  const ctx = makeCtx(sandbox, { hasUI: false });
  await cmd.options.handler("unique", ctx);

  assert.equal(ctx.notifyCalls.length, 1);
  assert.match(ctx.notifyCalls[0].message, /Alpha unique title/);
  assert.doesNotMatch(ctx.notifyCalls[0].message, /Beta something else/);
  assert.doesNotMatch(ctx.notifyCalls[0].message, /Gamma other/);
});

test("flow:ideas command emits No matching ideas when query has no hits", async () => {
  const sandbox = mkSandbox("pi-flow-ideas-cmd-no-match-");
  const { commands } = bootExtension();
  const cmd = commands.find((c) => c.name === "flow:ideas");
  assert.ok(cmd, "flow:ideas command should be registered");

  await seedIdea(sandbox, artifact("cccc1111", "Some idea", "open"));
  await seedIdea(sandbox, artifact("cccc2222", "Another idea", "open"));

  const ctx = makeCtx(sandbox, { hasUI: false });
  await cmd.options.handler("zzzzzz", ctx);

  assert.equal(ctx.notifyCalls.length, 1);
  assert.equal(ctx.notifyCalls[0].message, "No matching ideas.");
});

test("flow:ideas interactive path invokes ctx.ui.custom", async () => {
  const sandbox = mkSandbox("pi-flow-ideas-interactive-smoke-");
  const { commands } = bootExtension();
  const cmd = commands.find((c) => c.name === "flow:ideas");
  assert.ok(cmd, "flow:ideas command should be registered");

  await seedIdea(sandbox, artifact("11112222", "Sample", "open"));

  const ctx = makeCtx(sandbox, { hasUI: true });
  await cmd.options.handler("", ctx);

  assert.ok(ctx.customCalls.length >= 1, "expected ctx.ui.custom to be invoked");
});

function makeSelectorHost() {
  const dispatched: any[] = [];
  const requested: number[] = [];
  let closed = 0;
  const stubTheme: any = {
    fg: (_color: string, s: string) => s,
    bold: (s: string) => s,
  };
  const stubKeybindings: any = {
    matches: (_data: string, _kb: string) => false,
  };
  const host: any = {
    setActive(_c: any) {},
    requestRender() { requested.push(1); },
    notify(_m: string, _l: string) {},
    close() { closed += 1; },
    dispatch(action: any) { dispatched.push(action); },
    theme: stubTheme,
    keybindings: stubKeybindings,
  };
  return { host, dispatched, requested, get closed() { return closed; } };
}

test("IdeaSelectorComponent render shows header, ids, and hint line", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "Alpha feature", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "22222222", title: "Beta improvement", tags: [], status: "open" as const, createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "33333333", title: "Gamma archived", tags: [], status: "closed" as const, createdAt: "2026-01-03T00:00:00.000Z" },
  ];

  const { host } = makeSelectorHost();
  const selector = new IdeaSelectorComponent(entries, "", host);
  const out = selector.render(80).join("\n");

  assert.match(out, /Ideas \(2 open, 1 closed\)/);
  assert.match(out, /IDEA-11111111/);
  assert.match(out, /IDEA-22222222/);
  assert.match(out, /IDEA-33333333/);
  assert.match(out, /Ctrl\+Shift\+R refine/);
});

test("IdeaSelectorComponent render emits bordered layout with spacing between header, search, list, hint", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "Alpha feature", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "22222222", title: "Beta improvement", tags: [], status: "closed" as const, createdAt: "2026-01-02T00:00:00.000Z" },
  ];

  const { host } = makeSelectorHost();
  const selector = new IdeaSelectorComponent(entries, "", host);
  const width = 120;
  const lines = selector.render(width);

  const border = "─".repeat(width);
  assert.equal(lines[0], border, "first line should be top border");
  assert.equal(lines[1], "", "blank line after top border");
  assert.match(lines[2], /^ Ideas \(1 open, 1 closed\)$/);
  assert.equal(lines[3], "", "blank line after header");
  assert.match(lines[4], /^ Search: /);
  assert.equal(lines[5], "", "blank line after search");

  assert.equal(lines[lines.length - 1], border, "last line should be bottom border");
  assert.equal(lines[lines.length - 2], "", "blank line before bottom border");
  assert.match(lines[lines.length - 3], /Ctrl\+Shift\+R refine/);
  assert.equal(lines[lines.length - 4], "", "blank line before hint");

  // Idea rows are between line 6 and lines.length - 4, with a blank separator just before hint area.
  const middle = lines.slice(6, lines.length - 4);
  const ideaRowText = middle.join("\n");
  assert.match(ideaRowText, /IDEA-11111111/);
  assert.match(ideaRowText, /IDEA-22222222/);
});

test("IdeaSelectorComponent render: selected row IDEA id is accent and NOT bold, unselected uses text token", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "Alpha", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "22222222", title: "Beta", tags: [], status: "open" as const, createdAt: "2026-01-02T00:00:00.000Z" },
  ];

  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    setActive() {},
    requestRender() {},
    notify() {},
    close() {},
    dispatch() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const selector = new IdeaSelectorComponent(entries, "", host);
  const out = selector.render(120).join("\n");

  // Selected row (index 0) IDEA id: accent color only, NO bold wrapper.
  assert.match(
    out,
    /<fg:accent>IDEA-11111111<\/fg:accent>/,
    `selected IDEA id should be accent (no bold), got: ${out}`,
  );
  assert.doesNotMatch(
    out,
    /<fg:accent><b>IDEA-11111111<\/b><\/fg:accent>/,
    `selected IDEA id should not be bold, got: ${out}`,
  );
  assert.doesNotMatch(
    out,
    /<b>IDEA-11111111<\/b>/,
    `selected IDEA id should not be bold (any nesting), got: ${out}`,
  );
  // Unselected row should use `text` (not border, not accent) around its IDEA id.
  assert.match(
    out,
    /<fg:text>IDEA-22222222<\/fg:text>/,
    `unselected IDEA id should use text token, got: ${out}`,
  );
  assert.doesNotMatch(
    out,
    /<fg:accent>IDEA-22222222<\/fg:accent>/,
    `unselected IDEA id should not be accent, got: ${out}`,
  );
  assert.doesNotMatch(
    out,
    /<fg:border>IDEA-22222222<\/fg:border>/,
    `unselected IDEA id should not use border token, got: ${out}`,
  );
  assert.doesNotMatch(
    out,
    /<fg:text><b>IDEA-22222222<\/b><\/fg:text>/,
    `unselected IDEA id should not be bold, got: ${out}`,
  );
});

test("IdeaSelectorComponent render: selected title is accent; unselected open title stays text; unselected closed title stays dim", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "AlphaTitle", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "22222222", title: "BetaTitle", tags: [], status: "open" as const, createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "33333333", title: "GammaTitle", tags: [], status: "closed" as const, createdAt: "2026-01-03T00:00:00.000Z" },
  ];

  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    setActive() {},
    requestRender() {},
    notify() {},
    close() {},
    dispatch() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const selector = new IdeaSelectorComponent(entries, "", host);
  const out = selector.render(120).join("\n");

  // Selected row (index 0) — title should be accent so id+title color together.
  assert.match(
    out,
    /<fg:accent>AlphaTitle<\/fg:accent>/,
    `selected title should be accent, got: ${out}`,
  );
  // Unselected open title remains text.
  assert.match(
    out,
    /<fg:text>BetaTitle<\/fg:text>/,
    `unselected open title should remain text, got: ${out}`,
  );
  assert.doesNotMatch(
    out,
    /<fg:accent>BetaTitle<\/fg:accent>/,
    `unselected open title should not be accent, got: ${out}`,
  );
  // Unselected closed title remains dim.
  assert.match(
    out,
    /<fg:dim>GammaTitle<\/fg:dim>/,
    `unselected closed title should remain dim, got: ${out}`,
  );
  assert.doesNotMatch(
    out,
    /<fg:accent>GammaTitle<\/fg:accent>/,
    `unselected closed title should not be accent, got: ${out}`,
  );
});

test("IdeaSelectorComponent render: top and bottom border use border color", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "Alpha feature", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  const taggingTheme: any = {
    fg: (color: string, s: string) => `<${color}>${s}</${color}>`,
    bold: (s: string) => s,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    setActive() {},
    requestRender() {},
    notify() {},
    close() {},
    dispatch() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const selector = new IdeaSelectorComponent(entries, "", host);
  const lines = selector.render(80);

  const firstBorder = lines[0];
  const lastBorder = lines[lines.length - 1];
  assert.match(firstBorder, /^<border>─+<\/border>$/, `top border should use border, got: ${firstBorder}`);
  assert.match(lastBorder, /^<border>─+<\/border>$/, `bottom border should use border, got: ${lastBorder}`);
});

test("IdeaSelectorComponent render: header 'Ideas (...)' uses border color and stays bold", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "Alpha", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "22222222", title: "Beta", tags: [], status: "closed" as const, createdAt: "2026-01-02T00:00:00.000Z" },
  ];

  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    setActive() {},
    requestRender() {},
    notify() {},
    close() {},
    dispatch() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const selector = new IdeaSelectorComponent(entries, "", host);
  const lines = selector.render(120);
  const headerLine = lines[2];

  assert.match(
    headerLine,
    /<fg:border><b>Ideas \(1 open, 1 closed\)<\/b><\/fg:border>/,
    `header line should be border + bold, got: ${headerLine}`,
  );
});

test("IdeaSelectorComponent render: selected row arrow '→ ' is accent-colored", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "Alpha", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "22222222", title: "Beta", tags: [], status: "open" as const, createdAt: "2026-01-02T00:00:00.000Z" },
  ];

  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    setActive() {},
    requestRender() {},
    notify() {},
    close() {},
    dispatch() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const selector = new IdeaSelectorComponent(entries, "", host);
  const out = selector.render(120).join("\n");

  // Selected row should have an accent-colored arrow prefix.
  assert.match(
    out,
    /<fg:accent>→ <\/fg:accent>/,
    `selected row arrow '→ ' should be accent-colored, got: ${out}`,
  );
});

test("IdeaSelectorComponent render: every line respects the supplied width", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "Alpha feature", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  const { host } = makeSelectorHost();
  const selector = new IdeaSelectorComponent(entries, "", host);
  const width = 110;
  const lines = selector.render(width);
  for (const [i, line] of lines.entries()) {
    const w = visibleWidth(line);
    assert.ok(w <= width, `line ${i} visible width ${w} exceeds ${width}: ${JSON.stringify(line)}`);
  }
});

test("IdeaSelectorComponent render: quick reference does not contain 'Type to search' (search bar still does)", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "Alpha", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  const { host } = makeSelectorHost();
  const selector = new IdeaSelectorComponent(entries, "", host);
  const lines = selector.render(120);

  // Search bar (5th line, index 4) still shows the placeholder.
  assert.match(lines[4], /\(type to search\)/, "search bar should still show '(type to search)' placeholder");

  // The hint is the third-from-last line of the rendered block.
  const hintLine = lines[lines.length - 3];
  assert.doesNotMatch(hintLine, /Type to search/i, `hint should not contain 'Type to search', got: ${hintLine}`);
  assert.match(hintLine, /↑↓ select/, `hint should start with arrow-key selection, got: ${hintLine}`);
});

test("IdeaSelectorComponent render: narrow width wraps a long idea row without losing content", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const longTitle = "A very lengthy idea title that should definitely exceed the narrow terminal width";
  const entries = [
    {
      id: "11111111",
      title: longTitle,
      tags: ["alpha-tag-name", "beta-tag-name"],
      status: "open" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  const { host } = makeSelectorHost();
  const selector = new IdeaSelectorComponent(entries, "", host);
  const width = 40;
  const lines = selector.render(width);
  const joined = lines.join("\n");

  assert.ok(joined.includes(longTitle.split(/\s+/).slice(-1)[0]),
    `last word of long title should still appear (wrapped) in output, got:\n${joined}`);
  assert.ok(joined.includes("alpha-tag-name"), "first tag should still appear");
  assert.ok(joined.includes("beta-tag-name"), "second tag should be present after wrapping");
  assert.ok(joined.includes("(open)"), "status should still appear after wrapping");

  for (const [i, line] of lines.entries()) {
    const w = visibleWidth(line);
    assert.ok(w <= width, `line ${i} visible width ${w} exceeds ${width}: ${JSON.stringify(line)}`);
  }
});

test("IdeaSelectorComponent render: narrow width wraps the quick-reference hint without dropping later commands", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "Alpha", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  const { host } = makeSelectorHost();
  const selector = new IdeaSelectorComponent(entries, "", host);
  const width = 40;
  const lines = selector.render(width);
  const joined = lines.join("\n");

  assert.ok(joined.includes("Ctrl+Shift+S spec"), `hint should still include 'Ctrl+Shift+S spec' after wrapping, got:\n${joined}`);
  assert.ok(joined.includes("Esc close"), `hint should still include 'Esc close' after wrapping, got:\n${joined}`);

  for (const [i, line] of lines.entries()) {
    const w = visibleWidth(line);
    assert.ok(w <= width, `line ${i} visible width ${w} exceeds ${width}: ${JSON.stringify(line)}`);
  }
});

test("IdeaSelectorComponent filters list as the user types, header counts unchanged", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "aaaaaaaa", title: "Alpha feature", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "bbbbbbbb", title: "Beta improvement", tags: [], status: "open" as const, createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "cccccccc", title: "Gamma UNIQUE entry", tags: [], status: "closed" as const, createdAt: "2026-01-03T00:00:00.000Z" },
  ];

  const { host } = makeSelectorHost();
  const selector = new IdeaSelectorComponent(entries, "", host);

  for (const ch of "unique") {
    selector.handleInput!(ch);
  }

  const out = selector.render(80).join("\n");

  assert.match(out, /IDEA-cccccccc/);
  assert.doesNotMatch(out, /IDEA-aaaaaaaa/);
  assert.doesNotMatch(out, /IDEA-bbbbbbbb/);
  assert.match(out, /Ideas \(2 open, 1 closed\)/);
});

test("idea tool registers renderCall and renderResult callbacks", () => {
  const { tools } = bootExtension();
  const definition = tools.find((t) => t.name === "idea") as any;
  assert.ok(definition, "idea tool should be registered");
  assert.equal(typeof definition.renderCall, "function");
  assert.equal(typeof definition.renderResult, "function");
});

function stubMenuHost() {
  const dispatched: any[] = [];
  let backCalls = 0;
  const theme: any = {
    fg: (_color: string, s: string) => s,
    bold: (s: string) => s,
  };
  const keybindings: any = { matches: (_d: string, _k: string) => false };
  const host: any = {
    dispatchAction(name: string) { dispatched.push(name); },
    dispatch(name: string) { dispatched.push(name); },
    confirm() { dispatched.push("confirm"); },
    cancel() { dispatched.push("cancel"); },
    back() { backCalls += 1; },
    theme,
    keybindings,
    requestRender() {},
  };
  return { host, dispatched, get backCalls() { return backCalls; } };
}

function entry(id: string, status: "open" | "closed", title = "Sample"): any {
  return { id, title, tags: [], status, createdAt: "2026-01-01T00:00:00.000Z" };
}

test("_internalsForTest exposes all component constructors and pure helpers", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  assert.equal(typeof _internalsForTest.IdeaSelectorComponent, "function");
  assert.equal(typeof _internalsForTest.IdeaActionMenuComponent, "function");
  assert.equal(typeof _internalsForTest.IdeaWorkSubmenuComponent, "function");
  assert.equal(typeof _internalsForTest.IdeaOtherSubmenuComponent, "function");
  assert.equal(typeof _internalsForTest.IdeaDeleteConfirmComponent, "function");
  assert.equal(typeof _internalsForTest.IdeaDetailOverlayComponent, "function");
  assert.equal(typeof _internalsForTest.buildRefineIdeaPrompt, "function");
  assert.equal(typeof _internalsForTest.filterAndRankIdeas, "function");
  assert.equal(typeof _internalsForTest.formatGroupedTextList, "function");
  assert.equal(typeof _internalsForTest.parseFlowIdeasArgs, "function");
});

test("IdeaActionMenuComponent shows close (not reopen) for open ideas in correct order", async () => {
  const { IdeaActionMenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaActionMenuComponent(entry("aaaabbbb", "open"), host);
  const out = c.render(80).join("\n");

  assert.match(out, /\bview\b/);
  assert.match(out, /\brefine\b/);
  assert.ok(out.includes("work ▶"), "missing 'work ▶'");
  assert.match(out, /\bclose\b/);
  assert.ok(out.includes("other ▶"), "missing 'other ▶'");
  assert.doesNotMatch(out, /\breopen\b/);

  const viewIdx = out.indexOf("view");
  const refineIdx = out.indexOf("refine");
  const workIdx = out.indexOf("work ▶");
  const closeIdx = out.indexOf("close");
  const otherIdx = out.indexOf("other ▶");
  assert.ok(viewIdx < refineIdx && refineIdx < workIdx && workIdx < closeIdx && closeIdx < otherIdx, "menu items out of order");
});

function taggingMenuHost() {
  const dispatched: any[] = [];
  let backCalls = 0;
  const theme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const keybindings: any = { matches: () => false };
  const host: any = {
    dispatchAction(name: string) { dispatched.push(name); },
    dispatch(name: string) { dispatched.push(name); },
    confirm() { dispatched.push("confirm"); },
    cancel() { dispatched.push("cancel"); },
    back() { backCalls += 1; },
    theme,
    keybindings,
    requestRender() {},
  };
  return { host, dispatched, get backCalls() { return backCalls; } };
}

test("IdeaActionMenuComponent renders left-aligned title 'Actions for IDEA-...' using border token + bold", async () => {
  const { IdeaActionMenuComponent } = await import("./idea.ts");
  const { host } = taggingMenuHost();
  const c = new IdeaActionMenuComponent(entry("aaaabbbb", "open", "My idea title"), host);
  const lines = c.render(120);

  // line 0 = top border, line 1 = blank, line 2 = title
  const titleLine = lines[2];
  assert.match(titleLine, /^ <fg:border><b>Actions for IDEA-aaaabbbb "My idea title"<\/b><\/fg:border>$/, `expected left-aligned border+bold title with one leading space, got: ${JSON.stringify(titleLine)}`);
});

test("IdeaActionMenuComponent uses border token for top and bottom borders", async () => {
  const { IdeaActionMenuComponent } = await import("./idea.ts");
  const { host } = taggingMenuHost();
  const c = new IdeaActionMenuComponent(entry("aaaabbbb", "open"), host);
  const lines = c.render(80);

  assert.match(lines[0], /^<fg:border>─+<\/fg:border>$/, `top border should use border token, got: ${lines[0]}`);
  assert.match(lines[lines.length - 1], /^<fg:border>─+<\/fg:border>$/, `bottom border should use border token, got: ${lines[lines.length - 1]}`);
});

test("IdeaActionMenuComponent has blank-line spacing between border/title/list/hint/border", async () => {
  const { IdeaActionMenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaActionMenuComponent(entry("aaaabbbb", "open"), host);
  const lines = c.render(120);

  assert.equal(lines[1], "", "blank line after top border");
  assert.equal(lines[3], "", "blank line after title");
  assert.equal(lines[lines.length - 2], "", "blank line before bottom border");
  // The line preceding the bottom-border blank is the quick reference; the one before that is a blank between list and hint.
  const hintIdx = lines.length - 3;
  assert.match(lines[hintIdx], /Enter to confirm/, `expected quick reference 'Enter to confirm' on line before final blank, got: ${lines[hintIdx]}`);
  assert.match(lines[hintIdx], /Esc back/, `expected 'Esc back' in quick reference, got: ${lines[hintIdx]}`);
  assert.equal(lines[hintIdx - 1], "", "blank line between list and quick reference");
});

test("IdeaActionMenuComponent renders descriptions for each action", async () => {
  const { IdeaActionMenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaActionMenuComponent(entry("aaaabbbb", "open"), host);
  const out = c.render(120).join("\n");

  assert.ok(out.includes("View idea"), `expected 'View idea' description, got:\n${out}`);
  assert.ok(out.includes("Refine idea into a light spec"), `expected refine description, got:\n${out}`);
  assert.ok(out.includes("Browse workflow actions"), `expected work description, got:\n${out}`);
  assert.ok(out.includes("Close idea"), `expected close description, got:\n${out}`);
  assert.ok(out.includes("Browse other actions"), `expected other description, got:\n${out}`);
});

test("IdeaActionMenuComponent: selected row description is accent, unselected descriptions are dim", async () => {
  const { IdeaActionMenuComponent } = await import("./idea.ts");
  const { host } = taggingMenuHost();
  // Selected row defaults to index 0 = "view"; "refine" is unselected.
  const c = new IdeaActionMenuComponent(entry("aaaabbbb", "open"), host);
  const out = c.render(140).join("\n");

  // Selected row's description should be wrapped (with rest of row) in accent.
  assert.match(out, /<fg:accent>[^<]*View idea[^<]*<\/fg:accent>/, `selected row 'View idea' should be inside accent, got:\n${out}`);
  // Unselected row's description should be wrapped in dim.
  assert.match(out, /<fg:dim>[^<]*Refine idea into a light spec[^<]*<\/fg:dim>/, `unselected 'Refine ...' should be inside dim, got:\n${out}`);
});

test("IdeaActionMenuComponent shows reopen (not close) for closed ideas", async () => {
  const { IdeaActionMenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaActionMenuComponent(entry("aaaabbbb", "closed"), host);
  const out = c.render(80).join("\n");

  assert.match(out, /\breopen\b/);
  assert.doesNotMatch(out, /\bclose\b/);
});

test("IdeaWorkSubmenuComponent lists fastlane, scout, spec, plan in order", async () => {
  const { IdeaWorkSubmenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaWorkSubmenuComponent(entry("aaaabbbb", "open"), host);
  const out = c.render(80).join("\n");

  const fIdx = out.indexOf("fastlane");
  const sIdx = out.indexOf("scout");
  const spIdx = out.indexOf("spec");
  const pIdx = out.indexOf("plan");
  assert.ok(fIdx >= 0 && sIdx >= 0 && spIdx >= 0 && pIdx >= 0, "missing one of fastlane/scout/spec/plan");
  assert.ok(fIdx < sIdx && sIdx < spIdx && spIdx < pIdx, "work submenu items out of order");
});

test("IdeaWorkSubmenuComponent renders descriptions for each skill", async () => {
  const { IdeaWorkSubmenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaWorkSubmenuComponent(entry("aaaabbbb", "open"), host);
  const out = c.render(140).join("\n");

  assert.ok(out.includes("Run lightweight workflow for small changes"), `expected fastlane description, got:\n${out}`);
  assert.ok(out.includes("Explore codebase and create a brief for spec and plan"), `expected scout description, got:\n${out}`);
  assert.ok(out.includes("Perform reqs and arch Q&A to produce a detailed spec"), `expected spec description, got:\n${out}`);
  assert.ok(out.includes("Generate parallelizable tasks for execution"), `expected plan description, got:\n${out}`);
});

test("IdeaWorkSubmenuComponent uses border token for top and bottom borders", async () => {
  const { IdeaWorkSubmenuComponent } = await import("./idea.ts");
  const { host } = taggingMenuHost();
  const c = new IdeaWorkSubmenuComponent(entry("aaaabbbb", "open"), host);
  const lines = c.render(80);

  assert.match(lines[0], /^<fg:border>─+<\/fg:border>$/, `top border should use border token, got: ${lines[0]}`);
  assert.match(lines[lines.length - 1], /^<fg:border>─+<\/fg:border>$/, `bottom border should use border token, got: ${lines[lines.length - 1]}`);
});

test("IdeaWorkSubmenuComponent renders left-aligned title 'Workflow actions for IDEA-...: \"<title>\"' with border token + bold", async () => {
  const { IdeaWorkSubmenuComponent } = await import("./idea.ts");
  const { host } = taggingMenuHost();
  const c = new IdeaWorkSubmenuComponent(entry("aaaabbbb", "open", "My idea title"), host);
  const lines = c.render(120);

  // line 0 = top border, line 1 = blank, line 2 = title
  const titleLine = lines[2];
  assert.match(
    titleLine,
    /^ <fg:border><b>Workflow actions for IDEA-aaaabbbb: "My idea title"<\/b><\/fg:border>$/,
    `expected left-aligned border+bold work submenu title with one leading space, got: ${JSON.stringify(titleLine)}`,
  );
});

test("IdeaWorkSubmenuComponent has blank-line spacing matching IdeaActionMenuComponent (border/blank/title/blank/list/blank/hint/blank/border)", async () => {
  const { IdeaWorkSubmenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaWorkSubmenuComponent(entry("aaaabbbb", "open"), host);
  const lines = c.render(120);

  assert.equal(lines[1], "", "blank line after top border");
  assert.equal(lines[3], "", "blank line after title");
  assert.equal(lines[lines.length - 2], "", "blank line before bottom border");
  const hintIdx = lines.length - 3;
  assert.match(lines[hintIdx], /Enter to confirm/, `expected 'Enter to confirm' quick reference on line before final blank, got: ${lines[hintIdx]}`);
  assert.match(lines[hintIdx], /Esc back/, `expected 'Esc back' in quick reference, got: ${lines[hintIdx]}`);
  assert.equal(lines[hintIdx - 1], "", "blank line between list and quick reference");
});

test("IdeaWorkSubmenuComponent: every line respects the supplied width even for long titles", async () => {
  const { IdeaWorkSubmenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const longTitle = "A very lengthy idea title that should definitely exceed the narrow terminal width";
  const c = new IdeaWorkSubmenuComponent(entry("aaaabbbb", "open", longTitle), host);
  const width = 40;
  const lines = c.render(width);
  for (const [i, line] of lines.entries()) {
    const w = visibleWidth(line);
    assert.ok(w <= width, `line ${i} visible width ${w} exceeds ${width}: ${JSON.stringify(line)}`);
  }
});

test("IdeaOtherSubmenuComponent lists copy path, copy text, delete in order", async () => {
  const { IdeaOtherSubmenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaOtherSubmenuComponent(entry("aaaabbbb", "open"), host);
  const out = c.render(80).join("\n");

  const cp = out.indexOf("copy path");
  const ct = out.indexOf("copy text");
  const del = out.indexOf("delete");
  assert.ok(cp >= 0 && ct >= 0 && del >= 0, "missing one of copy path/copy text/delete");
  assert.ok(cp < ct && ct < del, "other submenu items out of order");
});

test("IdeaOtherSubmenuComponent renders descriptions for each action", async () => {
  const { IdeaOtherSubmenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaOtherSubmenuComponent(entry("aaaabbbb", "open"), host);
  const out = c.render(140).join("\n");

  assert.ok(out.includes("Copy absolute path to clipboard"), `expected copy path description, got:\n${out}`);
  assert.ok(out.includes("Copy title and body to clipboard"), `expected copy text description, got:\n${out}`);
  assert.ok(out.includes("Delete idea"), `expected delete description, got:\n${out}`);
});

test("IdeaOtherSubmenuComponent uses border token for top and bottom borders", async () => {
  const { IdeaOtherSubmenuComponent } = await import("./idea.ts");
  const { host } = taggingMenuHost();
  const c = new IdeaOtherSubmenuComponent(entry("aaaabbbb", "open"), host);
  const lines = c.render(80);

  assert.match(lines[0], /^<fg:border>─+<\/fg:border>$/, `top border should use border token, got: ${lines[0]}`);
  assert.match(lines[lines.length - 1], /^<fg:border>─+<\/fg:border>$/, `bottom border should use border token, got: ${lines[lines.length - 1]}`);
});

test("IdeaOtherSubmenuComponent renders left-aligned title 'Other actions for IDEA-...: \"<title>\"' with border token + bold", async () => {
  const { IdeaOtherSubmenuComponent } = await import("./idea.ts");
  const { host } = taggingMenuHost();
  const c = new IdeaOtherSubmenuComponent(entry("aaaabbbb", "open", "My idea title"), host);
  const lines = c.render(120);

  const titleLine = lines[2];
  assert.match(
    titleLine,
    /^ <fg:border><b>Other actions for IDEA-aaaabbbb: "My idea title"<\/b><\/fg:border>$/,
    `expected left-aligned border+bold other submenu title with one leading space, got: ${JSON.stringify(titleLine)}`,
  );
});

test("IdeaOtherSubmenuComponent has blank-line spacing matching IdeaActionMenuComponent", async () => {
  const { IdeaOtherSubmenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaOtherSubmenuComponent(entry("aaaabbbb", "open"), host);
  const lines = c.render(120);

  assert.equal(lines[1], "", "blank line after top border");
  assert.equal(lines[3], "", "blank line after title");
  assert.equal(lines[lines.length - 2], "", "blank line before bottom border");
  const hintIdx = lines.length - 3;
  assert.match(lines[hintIdx], /Enter to confirm/, `expected 'Enter to confirm' quick reference on line before final blank, got: ${lines[hintIdx]}`);
  assert.match(lines[hintIdx], /Esc back/, `expected 'Esc back' in quick reference, got: ${lines[hintIdx]}`);
  assert.equal(lines[hintIdx - 1], "", "blank line between list and quick reference");
});

test("IdeaOtherSubmenuComponent: every line respects the supplied width even for long titles", async () => {
  const { IdeaOtherSubmenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const longTitle = "A very lengthy idea title that should definitely exceed the narrow terminal width";
  const c = new IdeaOtherSubmenuComponent(entry("aaaabbbb", "open", longTitle), host);
  const width = 40;
  const lines = c.render(width);
  for (const [i, line] of lines.entries()) {
    const w = visibleWidth(line);
    assert.ok(w <= width, `line ${i} visible width ${w} exceeds ${width}: ${JSON.stringify(line)}`);
  }
});

test("IdeaDeleteConfirmComponent renders exact prompt text", async () => {
  const { IdeaDeleteConfirmComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaDeleteConfirmComponent(entry("aaaabbbb", "open"), host);
  const out = c.render(120).join("\n");

  assert.ok(
    out.includes("Delete idea IDEA-aaaabbbb? This cannot be undone."),
    `expected literal prompt substring, got:\n${out}`,
  );
});

test("idea tool description contains all five canonical section headers and promptSnippet references IDEA-", () => {
  const { tools } = bootExtension();
  const definition = tools.find((t) => t.name === "idea") as any;
  assert.ok(definition, "idea tool should be registered");
  const desc: string = definition.description;
  const snippet: string = definition.promptSnippet ?? "";
  assert.ok(desc.includes("## Context"), "description missing ## Context");
  assert.ok(desc.includes("## Goal"), "description missing ## Goal");
  assert.ok(desc.includes("## Scope"), "description missing ## Scope");
  assert.ok(desc.includes("## Acceptance Sketch"), "description missing ## Acceptance Sketch");
  assert.ok(desc.includes("## Open Questions"), "description missing ## Open Questions");
  assert.ok(snippet.includes("IDEA-"), "promptSnippet missing IDEA-");
  assert.ok(
    ["list", "read", "create", "update", "append", "delete"].some((a) => snippet.includes(a)),
    "promptSnippet missing action name",
  );
});

function makeOverlayHost() {
  let activeBinding = "";
  const result = {
    closed: 0,
    rendered: 0,
    host: null as any,
    setBinding(b: string) { activeBinding = b; },
  };
  const stubTheme: any = {
    fg: (_color: string, s: string) => s,
    bold: (s: string) => s,
  };
  const stubKeybindings: any = {
    matches: (_data: string, kb: string) => kb === activeBinding,
  };
  result.host = {
    close() { result.closed += 1; },
    requestRender() { result.rendered += 1; },
    theme: stubTheme,
    keybindings: stubKeybindings,
  };
  return result;
}

test("IdeaDetailOverlayComponent smoke test — renders top/bottom border, title line with IDEA id, and body", async () => {
  const { initTheme } = await import("@earendil-works/pi-coding-agent");
  initTheme();

  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Test idea",
    tags: ["alpha", "beta"],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "# Heading\n\n## Subheading\n\nsome body text",
  };

  const h = makeOverlayHost();
  const overlay = new IdeaDetailOverlayComponent(idea, h.host);
  const lines = overlay.render(80);
  const out = lines.join("\n");

  // Body text contains both heading strings somewhere
  assert.ok(out.includes("Heading"), "rendered output should include 'Heading'");
  assert.ok(out.includes("Subheading"), "rendered output should include 'Subheading'");
  // IDEA-<id> appears somewhere in the rendered output
  assert.ok(out.includes("IDEA-aabb1122"), "rendered output should include IDEA-aabb1122");
});

test("IdeaDetailOverlayComponent uses border token for top and bottom borders", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;
  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Test idea",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body line",
  };

  const overlay = new _internalsForTest.IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 5 });
  const lines = overlay.render(80);

  // Top/bottom border must use border token; corner glyphs are allowed.
  assert.match(lines[0], /^<fg:border>[┌─].*[┐─]<\/fg:border>$/, `top border should use border token, got: ${lines[0]}`);
  assert.match(lines[lines.length - 1], /^<fg:border>[└─].*[┘─]<\/fg:border>$/, `bottom border should use border token, got: ${lines[lines.length - 1]}`);
});

test("IdeaDetailOverlayComponent: connected box border has corner glyphs in border token", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;
  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Box",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body",
  };

  const overlay = new IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 3 });
  const width = 40;
  const lines = overlay.render(width);

  // Top row: ┌ at left and ┐ at right, all under border token, dashes between.
  assert.match(
    lines[0],
    /^<fg:border>┌─+┐<\/fg:border>$/,
    `top row should be border-token ┌──┐, got: ${JSON.stringify(lines[0])}`,
  );
  // Bottom row: └ at left and ┘ at right, all under border token.
  assert.match(
    lines[lines.length - 1],
    /^<fg:border>└─+┘<\/fg:border>$/,
    `bottom row should be border-token └──┘, got: ${JSON.stringify(lines[lines.length - 1])}`,
  );
  // Middle rows still bounded by border-token │ on both sides.
  for (let i = 1; i < lines.length - 1; i++) {
    assert.match(
      lines[i],
      /^<fg:border>│<\/fg:border>/,
      `middle line ${i} should start with border │, got: ${JSON.stringify(lines[i])}`,
    );
    assert.match(
      lines[i],
      /<fg:border>│<\/fg:border>$/,
      `middle line ${i} should end with border │, got: ${JSON.stringify(lines[i])}`,
    );
  }
});

test("IdeaDetailOverlayComponent title line: IDEA-<id> and title use border+bold; status uses success for open", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;
  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Test idea",
    tags: ["alpha", "beta"],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body",
  };

  const overlay = new IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 3 });
  const lines = overlay.render(500);
  // Layout: [0]=border, [1]=blank, [2]=title-line (no wrap at width=500)
  const titleLine = lines[2];

  assert.match(
    titleLine,
    /<fg:border><b>IDEA-aabb1122 "Test idea"<\/b><\/fg:border>/,
    `expected border+bold IDEA-<id> and title, got: ${titleLine}`,
  );
  assert.match(
    titleLine,
    /<fg:success>open<\/fg:success>/,
    `expected success-colored 'open' status, got: ${titleLine}`,
  );
  // Tags must NOT appear on the title line — they belong on a separate row.
  assert.doesNotMatch(
    titleLine,
    /alpha/,
    `tags should not be on the title line, got: ${titleLine}`,
  );
  assert.doesNotMatch(
    titleLine,
    /\[/,
    `tags brackets should not be on the title line, got: ${titleLine}`,
  );
});

test("IdeaDetailOverlayComponent tags line: muted, no brackets, leading space after left border", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;
  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Test idea",
    tags: ["alpha", "beta"],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body",
  };

  const overlay = new IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 3 });
  const lines = overlay.render(500);
  // Layout: [0]=top border, [1]=blank, [2]=title-line, [3]=tags-line
  const tagsLine = lines[3];

  // Tags appear on their own line, muted, no surrounding [ ].
  assert.match(
    tagsLine,
    /<fg:muted>alpha, beta<\/fg:muted>/,
    `tags should be muted 'alpha, beta' on the tags line, got: ${JSON.stringify(tagsLine)}`,
  );
  assert.doesNotMatch(
    tagsLine,
    /\[/,
    `tags line should not include '['; got: ${JSON.stringify(tagsLine)}`,
  );
  assert.doesNotMatch(
    tagsLine,
    /\]/,
    `tags line should not include ']'; got: ${JSON.stringify(tagsLine)}`,
  );
  // After the left border, the tags must start after at least one visible space.
  assert.match(
    tagsLine,
    /^<fg:border>│<\/fg:border> +<fg:muted>alpha, beta<\/fg:muted>/,
    `tags line should start with border │ then ≥1 space then muted tags, got: ${JSON.stringify(tagsLine)}`,
  );
});

test("IdeaDetailOverlayComponent tags line: 'no tags' muted on its own line when tags empty", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;
  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Untagged",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body",
  };

  const overlay = new IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 3 });
  const lines = overlay.render(500);
  const titleLine = lines[2];
  const tagsLine = lines[3];

  // The 'no tags' label must NOT appear on the title line.
  assert.doesNotMatch(
    titleLine,
    /no tags/,
    `'no tags' should not appear on the title line, got: ${JSON.stringify(titleLine)}`,
  );
  // The 'no tags' label should appear muted on the tags line, after the left border + ≥1 space.
  assert.match(
    tagsLine,
    /^<fg:border>│<\/fg:border> +<fg:muted>no tags<\/fg:muted>/,
    `tags line should show muted 'no tags' after border + leading space, got: ${JSON.stringify(tagsLine)}`,
  );
});

test("IdeaDetailOverlayComponent title line: closed status uses dim color", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;
  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Closed idea",
    tags: [],
    status: "closed",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body",
  };

  const overlay = new IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 3 });
  const titleLine = overlay.render(500)[2];

  assert.match(
    titleLine,
    /<fg:dim>closed<\/fg:dim>/,
    `expected dim 'closed' status, got: ${titleLine}`,
  );
  assert.doesNotMatch(
    titleLine,
    /<fg:success>closed<\/fg:success>/,
    `closed status should not use success, got: ${titleLine}`,
  );
});

test("IdeaDetailOverlayComponent footer: includes Esc back, ↑↓, ←→ and line counter, omits Enter", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;
  const stubTheme: any = {
    fg: (_color: string, s: string) => s,
    bold: (s: string) => s,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: stubTheme,
    keybindings: stubKeybindings,
  };

  const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n\n");
  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Footer test",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body,
  };

  const overlay = new IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 5 });
  const lines = overlay.render(120);
  // Footer is lines[length - 3] (border, blank, footer, blank, border or border, footer, border etc.)
  // Actually: [..., body lines, blank, footer, blank, border]
  const footer = lines[lines.length - 3];

  assert.match(footer, /Esc back/i, `footer should include 'Esc back', got: ${footer}`);
  assert.match(footer, /↑↓/, `footer should include ↑↓ arrows, got: ${footer}`);
  assert.match(footer, /←→/, `footer should include ←→ arrows, got: ${footer}`);
  assert.match(footer, /\b\d+\b.*\b\d+\b/, `footer should include a line counter, got: ${footer}`);

  // Should not include 'Enter' as a command anywhere in the overlay.
  const joined = lines.join("\n");
  assert.doesNotMatch(joined, /\bEnter\b/i, `detail overlay should not include 'Enter' command, got: ${joined}`);
});

test("IdeaDetailOverlayComponent Enter does not dispatch or close the overlay", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Enter test",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body",
  };

  const h = makeOverlayHost();
  const overlay = new IdeaDetailOverlayComponent(idea, h.host, { maxVisibleLines: 3 });

  // tui.select.confirm is the Enter binding. Send a "\r" with that binding active.
  h.setBinding("tui.select.confirm");
  overlay.handleInput!("\r");

  assert.equal(h.closed, 0, "Enter must NOT close the detail overlay");
});

test("IdeaDetailOverlayComponent scroll test — line counter advances on down and pageDown", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const body = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n\n");
  const idea: IdeaArtifact = {
    id: "ccdd3344",
    title: "Scroll test",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body,
  };

  const h = makeOverlayHost();
  const overlay = new IdeaDetailOverlayComponent(idea, h.host, { maxVisibleLines: 5 });

  // Footer line lives at index length - 3 (border, blank, footer, blank, border) — wait, actually
  // layout: [..., body lines, blank, footer, blank, border] => footer at length-3.
  const lines0 = overlay.render(80);
  const footerIdx = lines0.length - 3;
  const footer0 = lines0[footerIdx];
  assert.match(footer0, /\b0-4\b|Lines 0-4/, `initial footer should show line range starting at 0, got: ${footer0}`);

  h.setBinding("tui.select.down");
  overlay.handleInput!("\x1b[B");

  const lines1 = overlay.render(80);
  const footer1 = lines1[lines1.length - 3];
  assert.match(footer1, /\b1-5\b|Lines 1-5/, `footer after one down should show 1-5, got: ${footer1}`);

  h.setBinding("tui.select.pageDown");
  overlay.handleInput!("\x1b[B");

  const lines2 = overlay.render(80);
  const footer2 = lines2[lines2.length - 3];
  assert.match(footer2, /\b6-10\b|Lines 6-10/, `footer after pageDown should show 6-10, got: ${footer2}`);
});

test("IdeaDetailOverlayComponent: rapid Down past bottom keeps rendered line count stable, bottom border anchored, width respected", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n\n");
  const idea: IdeaArtifact = {
    id: "ccdd3344",
    title: "Shrink test",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body,
  };

  const h = makeOverlayHost();
  const overlay = new IdeaDetailOverlayComponent(idea, h.host, { maxVisibleLines: 5 });
  const width = 80;

  const initial = overlay.render(width);
  const initialLineCount = initial.length;
  const initialBorder = initial[initial.length - 1];

  h.setBinding("tui.select.down");
  let lastLines = initial;
  for (let i = 0; i < 100; i++) {
    overlay.handleInput!("\x1b[B");
    lastLines = overlay.render(width);
    assert.equal(
      lastLines.length,
      initialLineCount,
      `iteration ${i}: rendered line count changed from ${initialLineCount} to ${lastLines.length}`,
    );
    assert.equal(
      lastLines[lastLines.length - 1],
      initialBorder,
      `iteration ${i}: bottom border drifted (was ${initialBorder}, now ${lastLines[lastLines.length - 1]})`,
    );
    for (const [idx, line] of lastLines.entries()) {
      assert.ok(
        visibleWidth(line) <= width,
        `iteration ${i} line ${idx}: visible width ${visibleWidth(line)} exceeds ${width}: ${JSON.stringify(line)}`,
      );
    }
  }
});

test("IdeaDetailOverlayComponent: production getMaxRows path budgets full overlay rows including wrapped title/footer", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  // Narrow width forces title and footer-counter wrapping; long body ensures
  // the counter reaches large numbers that affect footer width.
  const longTitle = "This is a very long idea title that will absolutely wrap across multiple visual rows at a narrow terminal width";
  const body = Array.from({ length: 200 }, (_, i) => `line number ${i} content for scroll testing`).join("\n\n");
  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: longTitle,
    tags: ["alpha-tag", "beta-tag"],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body,
  };

  const rows = 40;
  const width = 30;
  const budget = Math.floor(rows * 0.8); // 32

  const h = makeOverlayHost();
  h.host.getMaxRows = () => rows;

  // Use production-style construction (no maxVisibleLines override).
  const overlay = new IdeaDetailOverlayComponent(idea, h.host);
  const initial = overlay.render(width);

  // Total rendered rows must fit overlay max-height budget.
  assert.ok(
    initial.length <= budget,
    `initial render length ${initial.length} exceeds overlay budget ${budget}`,
  );
  // Bottom border must be the final line and visible (matches border pattern).
  assert.match(
    initial[initial.length - 1],
    /─/,
    `last line should be a border, got: ${JSON.stringify(initial[initial.length - 1])}`,
  );
  // Width safety on initial render.
  for (const [i, line] of initial.entries()) {
    assert.ok(
      visibleWidth(line) <= width,
      `initial line ${i} visible width ${visibleWidth(line)} exceeds ${width}: ${JSON.stringify(line)}`,
    );
  }

  // Repeated Down at/near bottom must not change rendered line count or push
  // bottom border out of the budget.
  const initialLineCount = initial.length;
  const initialBottom = initial[initial.length - 1];

  h.setBinding("tui.select.down");
  for (let i = 0; i < 300; i++) {
    overlay.handleInput!("\x1b[B");
    const r = overlay.render(width);
    assert.equal(
      r.length,
      initialLineCount,
      `iter ${i}: rendered line count drifted from ${initialLineCount} to ${r.length}`,
    );
    assert.ok(
      r.length <= budget,
      `iter ${i}: rendered length ${r.length} exceeds budget ${budget}`,
    );
    assert.equal(
      r[r.length - 1],
      initialBottom,
      `iter ${i}: bottom border drifted (was ${initialBottom}, now ${r[r.length - 1]})`,
    );
    for (const [k, line] of r.entries()) {
      assert.ok(
        visibleWidth(line) <= width,
        `iter ${i} line ${k}: visible width ${visibleWidth(line)} exceeds ${width}: ${JSON.stringify(line)}`,
      );
    }
  }
});

test("IdeaDetailOverlayComponent: Up after hitting bottom still scrolls up normally", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n\n");
  const idea: IdeaArtifact = {
    id: "ccdd3344",
    title: "Up test",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body,
  };

  const h = makeOverlayHost();
  const overlay = new IdeaDetailOverlayComponent(idea, h.host, { maxVisibleLines: 5 });

  // Initial render populates the markdown cache and lastViewHeight, so the
  // down handler can clamp correctly.
  overlay.render(80);

  // Scroll all the way down
  h.setBinding("tui.select.down");
  for (let i = 0; i < 200; i++) overlay.handleInput!("\x1b[B");
  const atBottom = overlay.render(80);
  const bottomFooter = atBottom[atBottom.length - 3];
  const bottomMatch = bottomFooter.match(/(\d+)-(\d+)/);
  assert.ok(bottomMatch, `bottom footer should expose a numeric range, got: ${bottomFooter}`);
  const bottomStart = Number(bottomMatch[1]);

  // Now press Up once
  h.setBinding("tui.select.up");
  overlay.handleInput!("\x1b[A");
  const oneUp = overlay.render(80);
  const oneUpFooter = oneUp[oneUp.length - 3];
  const oneUpMatch = oneUpFooter.match(/(\d+)-(\d+)/);
  assert.ok(oneUpMatch, `up-once footer should expose a numeric range, got: ${oneUpFooter}`);
  const oneUpStart = Number(oneUpMatch[1]);

  assert.equal(
    oneUpStart,
    bottomStart - 1,
    `Up should decrement start by 1 from bottom (was ${bottomStart}, now ${oneUpStart})`,
  );
});

test("IdeaDetailOverlayComponent: production getMaxRows path hard-caps total rows even when wrapped chrome alone exceeds budget", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  // Extremely narrow width forces title to wrap into many rows.
  // At width 15, the title text easily wraps to 20+ rows.
  const longTitle = "This is a very long idea title that absolutely will wrap across many many many many rows at narrow width " +
    "with additional padding so wrapped chrome alone would consume more than the overlay budget of thirty two rows total.";
  const body = Array.from({ length: 200 }, (_, i) => `body line ${i}`).join("\n\n");
  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: longTitle,
    tags: ["alpha-tag", "beta-tag", "gamma-tag"],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body,
  };

  const rows = 40;
  const width = 15;
  const budget = Math.floor(rows * 0.8); // 32

  const h = makeOverlayHost();
  h.host.getMaxRows = () => rows;

  const overlay = new IdeaDetailOverlayComponent(idea, h.host);
  const initial = overlay.render(width);

  assert.ok(
    initial.length <= budget,
    `initial render length ${initial.length} exceeds overlay budget ${budget}`,
  );
  assert.match(
    initial[initial.length - 1],
    /─/,
    `last line should be a border, got: ${JSON.stringify(initial[initial.length - 1])}`,
  );
  for (const [i, line] of initial.entries()) {
    assert.ok(
      visibleWidth(line) <= width,
      `initial line ${i} visible width ${visibleWidth(line)} exceeds ${width}: ${JSON.stringify(line)}`,
    );
  }

  const initialLineCount = initial.length;
  const initialBottom = initial[initial.length - 1];

  h.setBinding("tui.select.down");
  for (let i = 0; i < 200; i++) {
    overlay.handleInput!("\x1b[B");
    const r = overlay.render(width);
    assert.ok(
      r.length <= budget,
      `iter ${i}: rendered length ${r.length} exceeds budget ${budget}`,
    );
    assert.equal(
      r.length,
      initialLineCount,
      `iter ${i}: rendered line count drifted from ${initialLineCount} to ${r.length}`,
    );
    assert.equal(
      r[r.length - 1],
      initialBottom,
      `iter ${i}: bottom border drifted (was ${initialBottom}, now ${r[r.length - 1]})`,
    );
    for (const [k, line] of r.entries()) {
      assert.ok(
        visibleWidth(line) <= width,
        `iter ${i} line ${k}: visible width ${visibleWidth(line)} exceeds ${width}: ${JSON.stringify(line)}`,
      );
    }
  }
});

test("IdeaDetailOverlayComponent: short body production path is compact and does not pad to full 80% budget", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Short",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "one line",
  };

  const rows = 40;
  const width = 80;
  const budget = Math.floor(rows * 0.8); // 32

  const h = makeOverlayHost();
  h.host.getMaxRows = () => rows;

  const overlay = new IdeaDetailOverlayComponent(idea, h.host);
  const lines = overlay.render(width);

  assert.ok(
    lines.length < budget,
    `short-body render length ${lines.length} should be clearly less than full budget ${budget}, got lines:\n${lines.join("\n")}`,
  );
  // Compact: should be small (chrome + 1 body line). Allow some headroom but well under budget.
  assert.ok(
    lines.length <= 12,
    `short-body render length ${lines.length} should be small (~chrome + 1 body line), got lines:\n${lines.join("\n")}`,
  );
  assert.match(
    lines[lines.length - 1],
    /─/,
    `last line should be a border, got: ${JSON.stringify(lines[lines.length - 1])}`,
  );
  // Footer should still be present (search for "Esc back").
  const joined = lines.join("\n");
  assert.match(joined, /Esc back/, `footer should still be present, got:\n${joined}`);
});

test("IdeaDetailOverlayComponent: tiny production height budgets never exceed floor(rows * 0.8)", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Short title",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "first body line\n\nsecond body line",
  };

  const width = 80;

  for (const rows of [5, 6, 7, 8, 9, 10]) {
    const budget = Math.floor(rows * 0.8);
    const h = makeOverlayHost();
    h.host.getMaxRows = () => rows;
    const overlay = new IdeaDetailOverlayComponent(idea, h.host);
    const lines = overlay.render(width);

    assert.ok(
      lines.length <= budget,
      `rows=${rows} budget=${budget} rendered=${lines.length} — must fit budget, got lines:\n${lines.join("\n")}`,
    );
    for (const [i, line] of lines.entries()) {
      assert.ok(
        visibleWidth(line) <= width,
        `rows=${rows} line ${i}: visible width ${visibleWidth(line)} exceeds ${width}: ${JSON.stringify(line)}`,
      );
    }
    if (budget >= 1) {
      assert.match(
        lines[lines.length - 1],
        /─/,
        `rows=${rows} budget=${budget}: bottom border must be final line when any border can fit, got: ${JSON.stringify(lines[lines.length - 1])}`,
      );
    }
    if (budget >= 2) {
      assert.match(
        lines[0],
        /─/,
        `rows=${rows} budget=${budget}: top border should also be present when budget >= 2, got first line: ${JSON.stringify(lines[0])}`,
      );
    }
  }
});

test("IdeaDetailOverlayComponent: budget 0 renders nothing; budget 1 renders just the bottom border", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Title",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body",
  };

  const width = 80;

  // budget 0: floor(0 * 0.8) = 0
  {
    const h = makeOverlayHost();
    h.host.getMaxRows = () => 0;
    const overlay = new IdeaDetailOverlayComponent(idea, h.host);
    const lines = overlay.render(width);
    assert.equal(lines.length, 0, `budget 0: expected zero lines, got: ${JSON.stringify(lines)}`);
  }

  // budget 1: floor(2 * 0.8) = 1
  {
    const h = makeOverlayHost();
    h.host.getMaxRows = () => 2;
    const overlay = new IdeaDetailOverlayComponent(idea, h.host);
    const lines = overlay.render(width);
    assert.equal(lines.length, 1, `budget 1: expected exactly one line, got: ${JSON.stringify(lines)}`);
    assert.match(lines[0], /─/, `budget 1: the single line should be a border, got: ${JSON.stringify(lines[0])}`);
  }
});

test("IdeaDetailOverlayComponent: rendering wide then narrow re-wraps body to new width", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  // Body line longer than the narrow width so it must wrap when rendered narrow.
  // If markdown lines are cached at the first (wide) width and reused, the
  // narrow render returns rows that exceed the new width.
  const longBodyLine = "this is a single body line that is much longer than the narrow width and must wrap when the overlay is resized";
  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Title",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: longBodyLine,
  };

  const h = makeOverlayHost();
  const overlay = new IdeaDetailOverlayComponent(idea, h.host, { maxVisibleLines: 10 });

  // First render wide so cachedMarkdownLines (if any) is built for width 120.
  overlay.render(120);

  // Then render narrow. Every line must respect the new narrow width.
  const narrow = 20;
  const narrowLines = overlay.render(narrow);
  for (const [i, line] of narrowLines.entries()) {
    assert.ok(
      visibleWidth(line) <= narrow,
      `after wide-then-narrow render: line ${i} visible width ${visibleWidth(line)} exceeds ${narrow}: ${JSON.stringify(line)}`,
    );
  }
});

test("IdeaSelectorComponent render: header, search bar, and quick reference each begin with exactly one leading space", async () => {
  const { IdeaSelectorComponent } = await import("./idea.ts");

  const entries = [
    { id: "11111111", title: "Alpha", tags: [], status: "open" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "22222222", title: "Beta", tags: [], status: "closed" as const, createdAt: "2026-01-02T00:00:00.000Z" },
  ];

  const { host } = makeSelectorHost();
  const selector = new IdeaSelectorComponent(entries, "", host);
  const width = 120;
  const lines = selector.render(width);

  const header = lines[2];
  assert.match(header, /^ [^ ]/, `header should start with exactly one leading space, got: ${JSON.stringify(header)}`);
  assert.match(header, /^ Ideas \(1 open, 1 closed\)$/, `header should be ' Ideas (...)', got: ${JSON.stringify(header)}`);

  const search = lines[4];
  assert.match(search, /^ [^ ]/, `search bar should start with exactly one leading space, got: ${JSON.stringify(search)}`);
  assert.match(search, /^ Search: /, `search bar should start with ' Search: ', got: ${JSON.stringify(search)}`);

  const hint = lines[lines.length - 3];
  assert.match(hint, /^ [^ ]/, `quick reference should start with exactly one leading space, got: ${JSON.stringify(hint)}`);
  assert.match(hint, /^ ↑↓ select/, `quick reference should start with ' ↑↓ select', got: ${JSON.stringify(hint)}`);

  for (const [i, line] of lines.entries()) {
    assert.ok(
      visibleWidth(line) <= width,
      `line ${i} visible width ${visibleWidth(line)} exceeds ${width}: ${JSON.stringify(line)}`,
    );
  }
});

test("IdeaActionMenuComponent: title and quick reference each begin with exactly one leading space", async () => {
  const { IdeaActionMenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaActionMenuComponent(entry("aaaabbbb", "open", "My title"), host);
  const lines = c.render(120);

  const titleLine = lines[2];
  assert.match(titleLine, /^ [^ ]/, `title should start with exactly one leading space, got: ${JSON.stringify(titleLine)}`);
  assert.match(titleLine, /^ Actions for IDEA-aaaabbbb/, `title should begin with ' Actions for IDEA-...', got: ${JSON.stringify(titleLine)}`);

  const hint = lines[lines.length - 3];
  assert.match(hint, /^ [^ ]/, `quick reference should start with exactly one leading space, got: ${JSON.stringify(hint)}`);
  assert.match(hint, /^ Enter to confirm/, `quick reference should begin with ' Enter to confirm', got: ${JSON.stringify(hint)}`);
});

test("IdeaWorkSubmenuComponent: title and quick reference each begin with exactly one leading space", async () => {
  const { IdeaWorkSubmenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaWorkSubmenuComponent(entry("aaaabbbb", "open", "My title"), host);
  const lines = c.render(120);

  const titleLine = lines[2];
  assert.match(titleLine, /^ [^ ]/, `title should start with exactly one leading space, got: ${JSON.stringify(titleLine)}`);
  assert.match(titleLine, /^ Workflow actions for IDEA-aaaabbbb/, `title should begin with ' Workflow actions for IDEA-...', got: ${JSON.stringify(titleLine)}`);

  const hint = lines[lines.length - 3];
  assert.match(hint, /^ [^ ]/, `quick reference should start with exactly one leading space, got: ${JSON.stringify(hint)}`);
  assert.match(hint, /^ Enter to confirm/, `quick reference should begin with ' Enter to confirm', got: ${JSON.stringify(hint)}`);
});

test("IdeaOtherSubmenuComponent: title and quick reference each begin with exactly one leading space", async () => {
  const { IdeaOtherSubmenuComponent } = await import("./idea.ts");
  const { host } = stubMenuHost();
  const c = new IdeaOtherSubmenuComponent(entry("aaaabbbb", "open", "My title"), host);
  const lines = c.render(120);

  const titleLine = lines[2];
  assert.match(titleLine, /^ [^ ]/, `title should start with exactly one leading space, got: ${JSON.stringify(titleLine)}`);
  assert.match(titleLine, /^ Other actions for IDEA-aaaabbbb/, `title should begin with ' Other actions for IDEA-...', got: ${JSON.stringify(titleLine)}`);

  const hint = lines[lines.length - 3];
  assert.match(hint, /^ [^ ]/, `quick reference should start with exactly one leading space, got: ${JSON.stringify(hint)}`);
  assert.match(hint, /^ Enter to confirm/, `quick reference should begin with ' Enter to confirm', got: ${JSON.stringify(hint)}`);
});

test("IdeaDetailOverlayComponent: middle rows have left and right border-token vertical borders where width allows", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Test",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body line",
  };

  const overlay = new IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 3 });
  const width = 80;
  const lines = overlay.render(width);

  // Top and bottom borders use border token; corner glyphs allowed.
  assert.match(lines[0], /^<fg:border>[┌─].*[┐─]<\/fg:border>$/, `top border should be border-token horizontal with optional corners, got: ${JSON.stringify(lines[0])}`);
  assert.match(lines[lines.length - 1], /^<fg:border>[└─].*[┘─]<\/fg:border>$/, `bottom border should be border-token horizontal with optional corners, got: ${JSON.stringify(lines[lines.length - 1])}`);

  // Middle rows (between top and bottom borders) start and end with border-token │.
  // Width safety with real ANSI escapes is covered by the existing stub-theme tests.
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i];
    assert.match(
      line,
      /^<fg:border>│<\/fg:border>/,
      `middle line ${i} should start with border │, got: ${JSON.stringify(line)}`,
    );
    assert.match(
      line,
      /<fg:border>│<\/fg:border>$/,
      `middle line ${i} should end with border │, got: ${JSON.stringify(line)}`,
    );
  }
});

test("IdeaDetailOverlayComponent: title interior content begins with one visible space after the left border", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Test idea",
    tags: ["alpha"],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body",
  };

  const overlay = new IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 3 });
  const titleLine = overlay.render(120)[2];

  // Expect: <fg:border>│</fg:border> <fg:border><b>IDEA-...</b></fg:border>...<fg:border>│</fg:border>
  assert.match(
    titleLine,
    /^<fg:border>│<\/fg:border> <fg:border><b>IDEA-aabb1122/,
    `title interior should begin with one leading space after the left border, then styled IDEA-..., got: ${JSON.stringify(titleLine)}`,
  );
});

test("IdeaDetailOverlayComponent: footer interior content begins with one visible space after the left border", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const taggingTheme: any = {
    fg: (color: string, s: string) => `<fg:${color}>${s}</fg:${color}>`,
    bold: (s: string) => `<b>${s}</b>`,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: taggingTheme,
    keybindings: stubKeybindings,
  };

  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Footer test",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body: "body",
  };

  const overlay = new IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 3 });
  const lines = overlay.render(160);
  const footerLine = lines[lines.length - 3];

  // Expect: <fg:border>│</fg:border> <fg:dim>Esc back ...</fg:dim>... <fg:border>│</fg:border>
  assert.match(
    footerLine,
    /^<fg:border>│<\/fg:border> <fg:dim>Esc back/,
    `footer interior should begin with one leading space after the left border, then styled 'Esc back', got: ${JSON.stringify(footerLine)}`,
  );
});

test("IdeaDetailOverlayComponent footer: commands on left, lowercase counter right-justified, no bullet before counter, no Enter", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;
  const stubTheme: any = {
    fg: (_color: string, s: string) => s,
    bold: (s: string) => s,
  };
  const stubKeybindings: any = { matches: () => false };
  const host: any = {
    close() {},
    requestRender() {},
    theme: stubTheme,
    keybindings: stubKeybindings,
  };

  const body = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n\n");
  const idea: IdeaArtifact = {
    id: "aabb1122",
    title: "Footer order test",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body,
  };

  const width = 160;
  const overlay = new IdeaDetailOverlayComponent(idea, host, { maxVisibleLines: 5 });
  const lines = overlay.render(width);
  const footer = lines[lines.length - 3];

  // Commands on the LEFT side.
  assert.match(
    footer,
    /^│ Esc back • ↑↓ scroll • ←→ page/,
    `footer should begin with '│ Esc back • ↑↓ scroll • ←→ page', got: ${JSON.stringify(footer)}`,
  );
  // Lowercase line counter present.
  assert.match(
    footer,
    /lines \d+-\d+ of \d+/,
    `footer should contain lowercase 'lines X-Y of Z', got: ${JSON.stringify(footer)}`,
  );
  // NO bullet separator immediately before the counter.
  assert.doesNotMatch(
    footer,
    /page • lines/,
    `footer should not have '• ' immediately before 'lines' counter, got: ${JSON.stringify(footer)}`,
  );
  // Counter sits to the right of commands: at least one space between '←→ page' and 'lines'.
  assert.match(
    footer,
    /←→ page +lines/,
    `counter should follow commands with at least one space (right-justified), got: ${JSON.stringify(footer)}`,
  );
  // Counter is followed by at least one visible space before the right border │.
  assert.match(
    footer,
    /lines \d+-\d+ of \d+ +│$/,
    `counter should have ≥1 space before the right border │, got: ${JSON.stringify(footer)}`,
  );
  assert.doesNotMatch(footer, /\bLines\b/, `footer should use lowercase 'lines', not 'Lines', got: ${JSON.stringify(footer)}`);
  assert.doesNotMatch(footer, /\bEnter\b/i, `footer should not include Enter, got: ${JSON.stringify(footer)}`);
});

test("IdeaDetailOverlayComponent footer: lowercase line counter remains correct after down and pageDown", async () => {
  const { _internalsForTest } = await import("./idea.ts");
  const { IdeaDetailOverlayComponent } = _internalsForTest;

  const body = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n\n");
  const idea: IdeaArtifact = {
    id: "ccdd3344",
    title: "Counter test",
    tags: [],
    status: "open",
    createdAt: "2026-05-01T00:00:00.000Z",
    body,
  };

  const h = makeOverlayHost();
  const overlay = new IdeaDetailOverlayComponent(idea, h.host, { maxVisibleLines: 5 });

  const lines0 = overlay.render(160);
  const footer0 = lines0[lines0.length - 3];
  assert.match(footer0, /lines 0-4 of \d+/, `initial footer should show 'lines 0-4 of N', got: ${footer0}`);

  h.setBinding("tui.select.down");
  overlay.handleInput!("\x1b[B");
  const lines1 = overlay.render(160);
  const footer1 = lines1[lines1.length - 3];
  assert.match(footer1, /lines 1-5 of \d+/, `after down, footer should show 'lines 1-5 of N', got: ${footer1}`);

  h.setBinding("tui.select.pageDown");
  overlay.handleInput!("\x1b[B");
  const lines2 = overlay.render(160);
  const footer2 = lines2[lines2.length - 3];
  assert.match(footer2, /lines 6-10 of \d+/, `after pageDown, footer should show 'lines 6-10 of N', got: ${footer2}`);
});
