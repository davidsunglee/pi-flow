import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  generateIdeaId,
  getTodoDir,
  listIdeas,
  normalizeIdeaId,
  readIdea,
  writeIdea,
  type IdeaArtifact,
} from "./storage.ts";

const IDEA_TOOL_DESCRIPTION =
  "Capture, read, list, and update Flow ideas backed by docs/todos/<8-hex>.md artifacts. Use this for durable user intent. Identifiers are TODO-<8-hex> (legacy compatibility); the user-facing surface calls them ideas.";

const ideaParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("list"),
      Type.Literal("read"),
      Type.Literal("create"),
      Type.Literal("update"),
    ]),
    id: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
    status: Type.Optional(
      Type.Union([Type.Literal("open"), Type.Literal("done")], { default: "open" }),
    ),
  },
  { additionalProperties: false },
);

type IdeaToolParams = {
  action: "list" | "read" | "create" | "update";
  id?: string;
  title?: string;
  body?: string;
  tags?: string[];
  status?: "open" | "done";
};

function textResult(text: string, opts: { isError?: boolean; details?: unknown } = {}): AgentToolResult {
  return {
    content: [{ type: "text", text }],
    ...(opts.isError === undefined ? {} : { isError: opts.isError }),
    ...(opts.details === undefined ? {} : { details: opts.details }),
  };
}

function splitSeed(seed: string): { title: string; body: string } {
  const newline = seed.indexOf("\n");
  if (newline === -1) return { title: seed, body: "" };
  return { title: seed.slice(0, newline), body: seed.slice(newline + 1) };
}

function newArtifact(fields: {
  title: string;
  body?: string;
  tags?: string[];
  status?: "open" | "done";
}): IdeaArtifact {
  return {
    id: generateIdeaId(),
    title: fields.title,
    tags: fields.tags ?? [],
    status: fields.status ?? "open",
    createdAt: new Date().toISOString(),
    body: fields.body ?? "",
  };
}

function extraFields(params: IdeaToolParams, allowed: Array<keyof IdeaToolParams>): string[] {
  return (Object.keys(params) as Array<keyof IdeaToolParams>).filter((key) => !allowed.includes(key));
}

async function executeIdeaTool(
  params: IdeaToolParams,
  ctx: ExtensionContext,
): Promise<AgentToolResult> {
  const dir = await getTodoDir(ctx.cwd);

  if (params.action === "list") {
    const extra = extraFields(params, ["action"]);
    if (extra.length > 0) return textResult(`invalid fields for list: ${extra.join(", ")}`, { isError: true });

    const list = await listIdeas(dir);
    const summary = list.length === 0
      ? "No ideas found."
      : list.map((idea) => `TODO-${idea.id} [${idea.status}] ${idea.title}`).join("\n");
    return textResult(summary, { details: { list } });
  }

  if (params.action === "read") {
    const extra = extraFields(params, ["action", "id"]);
    if (extra.length > 0) return textResult(`invalid fields for read: ${extra.join(", ")}`, { isError: true });
    if (params.id === undefined) return textResult("read requires id", { isError: true });

    const norm = normalizeIdeaId(params.id);
    if (!norm) return textResult(`invalid id: ${params.id}`, { isError: true });
    const artifact = await readIdea(dir, norm);
    if (!artifact) return textResult(`not found: TODO-${norm}`, { isError: true });
    return textResult(JSON.stringify(artifact, null, 2), { details: artifact });
  }

  if (params.action === "create") {
    const extra = extraFields(params, ["action", "title", "body", "tags", "status"]);
    if (extra.length > 0) return textResult(`invalid fields for create: ${extra.join(", ")}`, { isError: true });
    if (params.title === undefined) return textResult("create requires title", { isError: true });

    const artifact = newArtifact({
      title: params.title,
      body: params.body,
      tags: params.tags,
      status: params.status,
    });
    const finalPath = await writeIdea(dir, artifact);
    return textResult(`TODO-${artifact.id}\n${finalPath}`, { details: artifact });
  }

  if (params.action === "update") {
    const extra = extraFields(params, ["action", "id", "title", "body", "tags", "status"]);
    if (extra.length > 0) return textResult(`invalid fields for update: ${extra.join(", ")}`, { isError: true });
    if (params.id === undefined) return textResult("update requires id", { isError: true });

    const norm = normalizeIdeaId(params.id);
    if (!norm) return textResult(`invalid id: ${params.id}`, { isError: true });
    const existing = await readIdea(dir, norm);
    if (!existing) return textResult(`not found: TODO-${norm}`, { isError: true });

    const updated: IdeaArtifact = {
      ...existing,
      ...(params.title === undefined ? {} : { title: params.title }),
      ...(params.body === undefined ? {} : { body: params.body }),
      ...(params.tags === undefined ? {} : { tags: params.tags }),
      ...(params.status === undefined ? {} : { status: params.status }),
    };
    const finalPath = await writeIdea(dir, updated);
    return textResult(`TODO-${updated.id}\n${finalPath}`, { details: updated });
  }

  return textResult(`unknown action: ${(params as { action: string }).action}`, { isError: true });
}

export function registerIdea(pi: ExtensionAPI): void {
  pi.registerCommand("flow:idea", {
    description: "Capture a durable Flow idea in docs/todos/<8-hex>.md.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      let seed = args.trim();
      if (seed.length === 0) {
        if (ctx.hasUI) {
          seed = await ctx.ui.input("Capture idea", "Title (or first line of body)");
        } else {
          ctx.ui.notify(
            "/flow:idea requires a title or body. Usage: /flow:idea <title or prose>",
            "error",
          );
          return;
        }
      }

      const { title, body } = splitSeed(seed);
      const artifact = newArtifact({ title, body });
      const dir = await getTodoDir(ctx.cwd);
      const finalPath = await writeIdea(dir, artifact);
      ctx.ui.notify(`Idea captured. TODO-${artifact.id}: ${artifact.title}\n  → ${finalPath}`, "info");
    },
  });

  pi.registerTool(defineTool({
    name: "idea",
    label: "Idea",
    description: IDEA_TOOL_DESCRIPTION,
    promptSnippet: "idea — capture/read/list/update Flow ideas (TODO-<id> compatible).",
    parameters: ideaParameters,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      return executeIdeaTool(params as IdeaToolParams, ctx);
    },
  }));
}
