import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { fuzzyMatch } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import path from "node:path";

import {
  appendIdeaBody,
  deleteIdea,
  generateIdeaId,
  getIdeaDir,
  listIdeas,
  normalizeIdeaId,
  readIdea,
  writeIdea,
  type IdeaArtifact,
  type IdeaListEntry,
} from "./storage.ts";

const IDEA_TOOL_DESCRIPTION =
  "Capture, read, list, and update Flow ideas backed by docs/ideas/<8-hex>.md artifacts. Use this for durable user intent. Identifiers are IDEA-<8-hex> (case-insensitive); the user-facing surface calls them ideas.";

const ideaParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("list"),
      Type.Literal("read"),
      Type.Literal("create"),
      Type.Literal("update"),
      Type.Literal("append"),
      Type.Literal("delete"),
    ]),
    id: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
    status: Type.Optional(
      Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")], { default: "open" }),
    ),
    query: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

type IdeaToolParams = {
  action: "list" | "read" | "create" | "update" | "append" | "delete";
  id?: string;
  title?: string;
  body?: string;
  tags?: string[];
  status?: "open" | "closed" | "all";
  query?: string;
};

function textResult(text: string, opts: { isError?: boolean; details?: unknown } = {}): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text }],
    details: opts.details,
    ...(opts.isError === undefined ? {} : { isError: opts.isError }),
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
  status?: "open" | "closed";
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
): Promise<AgentToolResult<unknown>> {
  const dir = await getIdeaDir(ctx.cwd);

  if (params.action === "list") {
    const extra = extraFields(params, ["action", "status", "query"]);
    if (extra.length > 0) return textResult(`invalid fields for list: ${extra.join(", ")}`, { isError: true });

    const list = await listIdeas(dir, { status: params.status ?? "open", query: params.query });
    const summary = list.length === 0
      ? "No ideas found."
      : list.map((idea) => `IDEA-${idea.id} [${idea.status}] ${idea.title}`).join("\n");
    return textResult(summary, { details: { list } });
  }

  if (params.action === "read") {
    const extra = extraFields(params, ["action", "id"]);
    if (extra.length > 0) return textResult(`invalid fields for read: ${extra.join(", ")}`, { isError: true });
    if (params.id === undefined) return textResult("read requires id", { isError: true });

    const norm = normalizeIdeaId(params.id);
    if (!norm) return textResult(`invalid id: ${params.id}`, { isError: true });
    const artifact = await readIdea(dir, norm);
    if (!artifact) return textResult(`not found: IDEA-${norm}`, { isError: true });
    return textResult(JSON.stringify(artifact, null, 2), { details: artifact });
  }

  if (params.action === "create") {
    const extra = extraFields(params, ["action", "title", "body", "tags", "status"]);
    if (extra.length > 0) return textResult(`invalid fields for create: ${extra.join(", ")}`, { isError: true });
    if (params.title === undefined) return textResult("create requires title", { isError: true });
    if (params.status === "all") return textResult('invalid status for create: all (use "open" or "closed")', { isError: true });

    const artifact = newArtifact({
      title: params.title,
      body: params.body,
      tags: params.tags,
      status: params.status,
    });
    const finalPath = await writeIdea(dir, artifact);
    return textResult(`IDEA-${artifact.id}\n${finalPath}`, { details: artifact });
  }

  if (params.action === "update") {
    const extra = extraFields(params, ["action", "id", "title", "body", "tags", "status"]);
    if (extra.length > 0) return textResult(`invalid fields for update: ${extra.join(", ")}`, { isError: true });
    if (params.id === undefined) return textResult("update requires id", { isError: true });
    if (params.status === "all") return textResult('invalid status for update: all (use "open" or "closed")', { isError: true });

    const norm = normalizeIdeaId(params.id);
    if (!norm) return textResult(`invalid id: ${params.id}`, { isError: true });
    const existing = await readIdea(dir, norm);
    if (!existing) return textResult(`not found: IDEA-${norm}`, { isError: true });

    const updated: IdeaArtifact = {
      ...existing,
      ...(params.title === undefined ? {} : { title: params.title }),
      ...(params.body === undefined ? {} : { body: params.body }),
      ...(params.tags === undefined ? {} : { tags: params.tags }),
      ...(params.status === undefined ? {} : { status: params.status }),
    };
    const finalPath = await writeIdea(dir, updated);
    return textResult(`IDEA-${updated.id}\n${finalPath}`, { details: updated });
  }

  if (params.action === "append") {
    const extra = extraFields(params, ["action", "id", "body"]);
    if (extra.length > 0) return textResult(`invalid fields for append: ${extra.join(", ")}`, { isError: true });
    if (params.id === undefined) return textResult("append requires id", { isError: true });
    if (params.body === undefined) return textResult("append requires body", { isError: true });

    const norm = normalizeIdeaId(params.id);
    if (!norm) return textResult(`invalid id: ${params.id}`, { isError: true });
    const updated = await appendIdeaBody(dir, norm, params.body);
    if (!updated) return textResult(`not found: IDEA-${norm}`, { isError: true });
    return textResult(`IDEA-${updated.id}
${path.join(dir, `${updated.id}.md`)}`, { details: updated });
  }

  if (params.action === "delete") {
    const extra = extraFields(params, ["action", "id"]);
    if (extra.length > 0) return textResult(`invalid fields for delete: ${extra.join(", ")}`, { isError: true });
    if (params.id === undefined) return textResult("delete requires id", { isError: true });

    const norm = normalizeIdeaId(params.id);
    if (!norm) return textResult(`invalid id: ${params.id}`, { isError: true });
    const deleted = await deleteIdea(dir, norm);
    if (!deleted) return textResult(`not found: IDEA-${norm}`, { isError: true });
    return textResult(`Deleted IDEA-${deleted.id}`, { details: deleted });
  }

  return textResult(`unknown action: ${(params as { action: string }).action}`, { isError: true });
}

export function buildRefineIdeaPrompt(id: string, title: string): string {
  return `Refine the idea IDEA-${id} ("${title}").

Before rewriting or updating the idea, ask the user clarifying questions whose answers would materially change the artifact. (provide a recommendation for each question) Do not rewrite the idea body before the user answers.

Once the user has answered enough to draft the structured description, write it into the idea body using exactly these section headers in this order:

## Context
## Goal
## Scope
## Acceptance Sketch
## Open Questions

Then update the idea via the \`idea\` tool's \`update\` action.`;
}

export function filterAndRankIdeas(entries: IdeaListEntry[], query: string): IdeaListEntry[] {
  const tokens = query.trim().length === 0 ? [] : query.toLowerCase().split(/\s+/);

  let filtered = entries;

  if (tokens.length > 0) {
    filtered = entries.filter((entry) => {
      const corpus = `IDEA-${entry.id} ${entry.id} ${entry.title} ${entry.tags.join(" ")} ${entry.status}`.toLowerCase();
      return tokens.every((token) => {
        const match = fuzzyMatch(token, corpus);
        return match.matches;
      });
    });
  }

  const sorted = filtered.sort((a, b) => {
    const statusOrder = (status: "open" | "closed") => status === "open" ? 0 : 1;
    const aStatus = statusOrder(a.status);
    const bStatus = statusOrder(b.status);

    if (aStatus !== bStatus) {
      return aStatus - bStatus;
    }

    if (tokens.length === 0) {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      if (aTime !== bTime) return aTime - bTime;
    } else {
      const aScore = tokens.reduce((sum, token) => {
        const corpus = `IDEA-${a.id} ${a.id} ${a.title} ${a.tags.join(" ")} ${a.status}`.toLowerCase();
        return sum + (fuzzyMatch(token, corpus).score ?? 0);
      }, 0);

      const bScore = tokens.reduce((sum, token) => {
        const corpus = `IDEA-${b.id} ${b.id} ${b.title} ${b.tags.join(" ")} ${b.status}`.toLowerCase();
        return sum + (fuzzyMatch(token, corpus).score ?? 0);
      }, 0);

      if (aScore !== bScore) return aScore - bScore;
    }

    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return aTime - bTime;
  });

  return sorted;
}

export function formatGroupedTextList(
  entries: IdeaListEntry[],
  opts: { query?: string; status?: "open" | "closed" | "all" } = {},
): string {
  let filtered = entries;

  if (opts.status === "open" || opts.status === "closed") {
    filtered = filtered.filter((e) => e.status === opts.status);
  }

  if (opts.query && opts.query.length > 0) {
    const q = opts.query.toLowerCase();
    filtered = filtered.filter((e) => {
      const haystack = [`IDEA-${e.id}`, e.id, e.title, ...e.tags].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }

  if (filtered.length === 0) {
    return opts.query ? "No matching ideas." : "No ideas.";
  }

  const openIdeas = filtered.filter((e) => e.status === "open");
  const closedIdeas = filtered.filter((e) => e.status === "closed");

  const lines: string[] = [];

  if (openIdeas.length > 0) {
    lines.push(`Open ideas (${openIdeas.length})`);
    for (const idea of openIdeas) {
      lines.push(`  IDEA-${idea.id} ${idea.title}`);
      if (idea.tags.length > 0) {
        lines.push(`  [${idea.tags.join(", ")}]`);
      }
    }
  }

  if (closedIdeas.length > 0) {
    lines.push(`Closed ideas (${closedIdeas.length})`);
    for (const idea of closedIdeas) {
      lines.push(`  IDEA-${idea.id} ${idea.title}`);
      if (idea.tags.length > 0) {
        lines.push(`  [${idea.tags.join(", ")}]`);
      }
      lines.push(`  (closed)`);
    }
  }

  return lines.join("\n");
}

export function parseFlowIdeasArgs(args: string): { query: string; status: "open" | "closed" | "all" } {
  const tokens = args.trim().split(/\s+/).filter((t) => t.length > 0);
  let status: "open" | "closed" | "all" = "all";
  const remaining: string[] = [];

  for (const token of tokens) {
    if (token === "--open") {
      status = "open";
    } else if (token === "--closed") {
      status = "closed";
    } else if (token === "--all") {
      status = "all";
    } else {
      remaining.push(token);
    }
  }

  const query = remaining.join(" ");
  return { query, status };
}

export function registerIdea(pi: ExtensionAPI): void {
  pi.registerCommand("flow:idea", {
    description: "Capture a durable Flow idea in docs/ideas/<8-hex>.md.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      let seed = args.trim();
      if (seed.length === 0) {
        if (ctx.hasUI) {
          const prompted = await ctx.ui.input("Capture idea", "Title (or first line of body)");
          if (prompted === undefined || prompted.trim().length === 0) {
            ctx.ui.notify("/flow:idea cancelled — no idea captured.", "info");
            return;
          }
          seed = prompted.trim();
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
      const dir = await getIdeaDir(ctx.cwd);
      const finalPath = await writeIdea(dir, artifact);
      ctx.ui.notify(`Idea captured. IDEA-${artifact.id}: ${artifact.title}\n  → ${finalPath}`, "info");
    },
  });

  pi.registerTool(defineTool({
    name: "idea",
    label: "Idea",
    description: IDEA_TOOL_DESCRIPTION,
    promptSnippet: "idea — capture/read/list/update Flow ideas (IDEA-<8hex> canonical id).",
    parameters: ideaParameters,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      return executeIdeaTool(params as IdeaToolParams, ctx);
    },
  }));
}
