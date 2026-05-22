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
