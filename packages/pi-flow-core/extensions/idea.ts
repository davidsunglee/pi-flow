import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  defineTool,
  DynamicBorder,
  copyToClipboard,
  getMarkdownTheme,
  keyHint,
  type Theme,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  SelectList,
  Markdown,
  Spacer,
  Text,
  type Component,
  type TUI,
  type SelectListTheme,
  Key,
  matchesKey,
  fuzzyMatch,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
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

const IDEA_TOOL_DESCRIPTION = `Capture, read, list, update, append to, and delete Flow ideas backed by docs/ideas/<8-hex>.md artifacts. Identifiers use the format IDEA-<8-hex> (case-insensitive).

Use this tool when the user asks naturally in conversation to capture, refine, or list ideas — even informally phrased requests.

Each idea body should follow this canonical 5-section shape:

## Context
## Goal
## Scope
## Acceptance Sketch
## Open Questions

Rule: ask at most one clarifying question, and only when missing information would materially change the artifact. Otherwise, create the idea immediately and report the resulting IDEA-<id>.`;

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
    return textResult(summary, { details: { list, __renderAction: "list" } });
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
    return textResult(`IDEA-${artifact.id}\n${finalPath}`, { details: { ...artifact, __renderAction: params.action } });
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
    return textResult(`IDEA-${updated.id}\n${finalPath}`, { details: { ...updated, __renderAction: params.action } });
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
${path.join(dir, `${updated.id}.md`)}`, { details: { ...updated, __renderAction: params.action } });
  }

  if (params.action === "delete") {
    const extra = extraFields(params, ["action", "id"]);
    if (extra.length > 0) return textResult(`invalid fields for delete: ${extra.join(", ")}`, { isError: true });
    if (params.id === undefined) return textResult("delete requires id", { isError: true });

    const norm = normalizeIdeaId(params.id);
    if (!norm) return textResult(`invalid id: ${params.id}`, { isError: true });
    const deleted = await deleteIdea(dir, norm);
    if (!deleted) return textResult(`not found: IDEA-${norm}`, { isError: true });
    return textResult(`Deleted IDEA-${deleted.id}`, { details: { ...deleted, __renderAction: params.action } });
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

export type IdeaSelectorAction =
  | { kind: "open"; idea: IdeaListEntry }
  | { kind: "refine"; idea: IdeaListEntry }
  | { kind: "fastlane"; idea: IdeaListEntry }
  | { kind: "spec"; idea: IdeaListEntry }
  | { kind: "cancel" };

export interface IdeaSelectorHost {
  setActive(component: Component & { invalidate(): void }): void;
  requestRender(): void;
  notify(message: string, level: "info" | "warning" | "error"): void;
  close(): void;
  dispatch(action: IdeaSelectorAction): void;
  theme: Theme;
  keybindings: KeybindingsManager;
}

const IDEA_SELECTOR_HINT =
  "↑↓ select • Enter actions • Ctrl+Shift+R refine • Ctrl+Shift+F fastlane • Ctrl+Shift+S spec • Esc close";

const IDEA_SELECTOR_MAX_ROWS = 12;

export class IdeaSelectorComponent implements Component {
  private entries: IdeaListEntry[];
  private query: string;
  private selectedIndex: number;
  private filtered: IdeaListEntry[];
  private host: IdeaSelectorHost;

  constructor(entries: IdeaListEntry[], initialQuery: string, host: IdeaSelectorHost) {
    this.entries = entries;
    this.query = initialQuery;
    this.host = host;
    this.selectedIndex = 0;
    this.filtered = filterAndRankIdeas(entries, this.query);
  }

  setEntries(next: IdeaListEntry[]): void {
    this.entries = next;
    this.filtered = filterAndRankIdeas(this.entries, this.query);
    const max = Math.max(0, this.filtered.length - 1);
    if (this.selectedIndex > max) this.selectedIndex = max;
    if (this.selectedIndex < 0) this.selectedIndex = 0;
  }

  handleInput(data: string): void {
    const current = this.filtered[this.selectedIndex];

    // Quick-key branches (Ctrl+Shift+R/F/S) fire BEFORE confirm so Enter on a
    // highlighted row falls through to "open" rather than these actions.
    // pi-tui's Key.ctrlShift is typed for lowercase letters but matchesKey
    // lowercases at runtime, so uppercase literals work equivalently.
    if (matchesKey(data, Key.ctrlShift("R" as "r"))) {
      if (current) this.host.dispatch({ kind: "refine", idea: current });
      return;
    }
    if (matchesKey(data, Key.ctrlShift("F" as "f"))) {
      if (current) this.host.dispatch({ kind: "fastlane", idea: current });
      return;
    }
    if (matchesKey(data, Key.ctrlShift("S" as "s"))) {
      if (current) this.host.dispatch({ kind: "spec", idea: current });
      return;
    }

    if (this.host.keybindings.matches(data, "tui.select.cancel")) {
      this.host.close();
      return;
    }

    if (this.host.keybindings.matches(data, "tui.select.confirm")) {
      if (current) this.host.dispatch({ kind: "open", idea: current });
      return;
    }

    if (this.host.keybindings.matches(data, "tui.select.up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.host.requestRender();
      return;
    }
    if (this.host.keybindings.matches(data, "tui.select.down")) {
      this.selectedIndex = Math.min(Math.max(0, this.filtered.length - 1), this.selectedIndex + 1);
      this.host.requestRender();
      return;
    }
    if (this.host.keybindings.matches(data, "tui.select.pageUp")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 10);
      this.host.requestRender();
      return;
    }
    if (this.host.keybindings.matches(data, "tui.select.pageDown")) {
      this.selectedIndex = Math.min(Math.max(0, this.filtered.length - 1), this.selectedIndex + 10);
      this.host.requestRender();
      return;
    }

    let changed = false;
    if (data === "\x7f" || data === "\b") {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        changed = true;
      }
    } else if (data.length === 1 && data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) < 0x7f) {
      this.query += data;
      changed = true;
    }

    if (changed) {
      this.filtered = filterAndRankIdeas(this.entries, this.query);
      const max = Math.max(0, this.filtered.length - 1);
      if (this.selectedIndex > max) this.selectedIndex = max;
      if (this.selectedIndex < 0) this.selectedIndex = 0;
      this.host.requestRender();
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const theme = this.host.theme;
    const openCount = this.entries.filter((e) => e.status === "open").length;
    const closedCount = this.entries.filter((e) => e.status === "closed").length;
    const border = new DynamicBorder((s) => theme.fg("border", s));

    const lines: string[] = [];

    lines.push(...border.render(width));
    lines.push("");

    const headerText = `Ideas (${openCount} open, ${closedCount} closed)`;
    lines.push(theme.fg("border", theme.bold(headerText)));
    lines.push("");

    const searchPrefix = theme.fg("muted", "Search: ");
    const searchValue = this.query.length === 0
      ? theme.fg("dim", "(type to search)")
      : this.query;
    lines.push(`${searchPrefix}${searchValue}`);
    lines.push("");

    if (this.entries.length === 0) {
      lines.push(theme.fg("muted", "  No ideas"));
    } else if (this.filtered.length === 0) {
      lines.push(theme.fg("muted", "  No matching ideas"));
    } else {
      const rowCount = Math.min(this.filtered.length, IDEA_SELECTOR_MAX_ROWS);
      for (let i = 0; i < rowCount; i++) {
        const item = this.filtered[i];
        const isSelected = i === this.selectedIndex;
        const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
        const rawId = `IDEA-${item.id}`;
        const idPart = isSelected
          ? theme.fg("accent", theme.bold(rawId))
          : theme.fg("border", rawId);
        const titleColor = item.status === "closed" ? "dim" : "text";
        const titlePart = theme.fg(titleColor, item.title);
        const tagPart = item.tags.length > 0
          ? ` ${theme.fg("muted", `[${item.tags.join(", ")}]`)}`
          : "";
        const statusPart = item.status === "closed"
          ? ` ${theme.fg("dim", "(closed)")}`
          : ` ${theme.fg("success", "(open)")}`;
        const line = `${prefix}${idPart} ${titlePart}${tagPart}${statusPart}`;
        lines.push(...wrapTextWithAnsi(line, width));
      }
    }

    lines.push("");
    lines.push(...wrapTextWithAnsi(theme.fg("dim", IDEA_SELECTOR_HINT), width));
    lines.push("");
    lines.push(...border.render(width));

    return lines;
  }
}

function inlineSelectListTheme(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: (text) => theme.fg("accent", text),
    selectedText: (text) => theme.fg("accent", text),
    description: (text) => theme.fg("dim", text),
    scrollInfo: (text) => theme.fg("muted", text),
    noMatch: (text) => theme.fg("muted", text),
  };
}

function renderCenteredTitle(text: string, width: number, styled: string): string {
  const visible = visibleWidth(text);
  const pad = Math.max(0, Math.floor((Math.max(width, visible) - visible) / 2));
  return " ".repeat(pad) + styled;
}

export interface IdeaActionMenuHost {
  dispatchAction(name: "view" | "refine" | "work" | "close" | "reopen" | "other"): void;
  back(): void;
  theme: Theme;
  keybindings: KeybindingsManager;
  requestRender(): void;
}

export class IdeaActionMenuComponent implements Component {
  private idea: IdeaListEntry;
  private host: IdeaActionMenuHost;
  private list: SelectList;

  constructor(idea: IdeaListEntry, host: IdeaActionMenuHost) {
    this.idea = idea;
    this.host = host;
    const items = [
      { value: "view", label: "view" },
      { value: "refine", label: "refine" },
      { value: "work", label: "work ▶" },
      idea.status === "open"
        ? { value: "close", label: "close" }
        : { value: "reopen", label: "reopen" },
      { value: "other", label: "other ▶" },
    ];
    this.list = new SelectList(items, items.length, inlineSelectListTheme(host.theme));
    this.list.onSelect = (item) =>
      host.dispatchAction(item.value as "view" | "refine" | "work" | "close" | "reopen" | "other");
    this.list.onCancel = () => host.back();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    const theme = this.host.theme;
    const border = new DynamicBorder((s) => theme.fg("muted", s));
    const titleText = `IDEA-${this.idea.id} "${this.idea.title}"`;
    const styled = theme.fg("accent", theme.bold(titleText));

    const lines: string[] = [];
    lines.push(...border.render(width));
    lines.push(renderCenteredTitle(titleText, width, styled));
    lines.push(...this.list.render(width));
    lines.push(...border.render(width));
    return lines;
  }
}

export interface IdeaWorkSubmenuHost {
  dispatch(skill: "fastlane" | "scout" | "spec" | "plan"): void;
  back(): void;
  theme: Theme;
  keybindings: KeybindingsManager;
  requestRender(): void;
}

export class IdeaWorkSubmenuComponent implements Component {
  private idea: IdeaListEntry;
  private host: IdeaWorkSubmenuHost;
  private list: SelectList;

  constructor(idea: IdeaListEntry, host: IdeaWorkSubmenuHost) {
    this.idea = idea;
    this.host = host;
    const items = [
      { value: "fastlane", label: "fastlane" },
      { value: "scout", label: "scout" },
      { value: "spec", label: "spec" },
      { value: "plan", label: "plan" },
    ];
    this.list = new SelectList(items, items.length, inlineSelectListTheme(host.theme));
    this.list.setSelectedIndex(0);
    this.list.onSelect = (item) =>
      host.dispatch(item.value as "fastlane" | "scout" | "spec" | "plan");
    this.list.onCancel = () => host.back();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    const theme = this.host.theme;
    const border = new DynamicBorder((s) => theme.fg("muted", s));
    const titleText = `IDEA-${this.idea.id} — work`;
    const styled = theme.fg("accent", theme.bold(titleText));

    const lines: string[] = [];
    lines.push(...border.render(width));
    lines.push(renderCenteredTitle(titleText, width, styled));
    lines.push(...this.list.render(width));
    lines.push(...border.render(width));
    return lines;
  }
}

export interface IdeaOtherSubmenuHost {
  dispatch(name: "copy-path" | "copy-text" | "delete"): void;
  back(): void;
  theme: Theme;
  keybindings: KeybindingsManager;
  requestRender(): void;
}

export class IdeaOtherSubmenuComponent implements Component {
  private idea: IdeaListEntry;
  private host: IdeaOtherSubmenuHost;
  private list: SelectList;

  constructor(idea: IdeaListEntry, host: IdeaOtherSubmenuHost) {
    this.idea = idea;
    this.host = host;
    const items = [
      { value: "copy-path", label: "copy path" },
      { value: "copy-text", label: "copy text" },
      { value: "delete", label: "delete" },
    ];
    this.list = new SelectList(items, items.length, inlineSelectListTheme(host.theme));
    this.list.setSelectedIndex(0);
    this.list.onSelect = (item) =>
      host.dispatch(item.value as "copy-path" | "copy-text" | "delete");
    this.list.onCancel = () => host.back();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    const theme = this.host.theme;
    const border = new DynamicBorder((s) => theme.fg("muted", s));
    const titleText = `IDEA-${this.idea.id} — other`;
    const styled = theme.fg("accent", theme.bold(titleText));

    const lines: string[] = [];
    lines.push(...border.render(width));
    lines.push(renderCenteredTitle(titleText, width, styled));
    lines.push(...this.list.render(width));
    lines.push(...border.render(width));
    return lines;
  }
}

export interface IdeaDeleteConfirmHost {
  confirm(): void;
  cancel(): void;
  theme: Theme;
  keybindings: KeybindingsManager;
  requestRender(): void;
}

export class IdeaDeleteConfirmComponent implements Component {
  private idea: IdeaListEntry;
  private host: IdeaDeleteConfirmHost;
  private list: SelectList;

  constructor(idea: IdeaListEntry, host: IdeaDeleteConfirmHost) {
    this.idea = idea;
    this.host = host;
    const items = [
      { value: "no", label: "No" },
      { value: "yes", label: "Yes" },
    ];
    this.list = new SelectList(items, items.length, inlineSelectListTheme(host.theme));
    this.list.setSelectedIndex(0);
    this.list.onSelect = (item) => {
      if (item.value === "yes") host.confirm();
      else host.cancel();
    };
    this.list.onCancel = () => host.cancel();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    const theme = this.host.theme;
    const border = new DynamicBorder((s) => theme.fg("muted", s));
    const titleText = `Delete idea IDEA-${this.idea.id}? This cannot be undone.`;
    const styled = theme.fg("warning", theme.bold(titleText));

    const lines: string[] = [];
    lines.push(...border.render(width));
    lines.push(renderCenteredTitle(titleText, width, styled));
    lines.push(...this.list.render(width));
    lines.push(...border.render(width));
    return lines;
  }
}

class IdeaDetailOverlayComponent implements Component {
  private idea: IdeaArtifact;
  private host: { close(): void; theme: Theme; keybindings: KeybindingsManager; requestRender(): void };
  private scrollOffset: number = 0;
  private lastViewHeight: number = 20;
  private maxVisibleLines: number | undefined;
  private markdown: Markdown;
  private cachedMarkdownLines: string[] | null = null;

  constructor(
    idea: IdeaArtifact,
    host: { close(): void; theme: Theme; keybindings: KeybindingsManager; requestRender(): void },
    opts?: { maxVisibleLines?: number },
  ) {
    this.idea = idea;
    this.host = host;
    this.maxVisibleLines = opts?.maxVisibleLines;
    this.markdown = new Markdown(idea.body, 1, 0, getMarkdownTheme());
  }

  invalidate(): void {
    this.cachedMarkdownLines = null;
    this.markdown.invalidate();
  }

  render(width: number): string[] {
    const theme = this.host.theme;
    const idea = this.idea;

    // Top border with title
    const titlePart = ` ${theme.fg("accent", idea.title)} `;
    const leftBorder = theme.fg("borderMuted", "─".repeat(3));
    const rightBorderCount = Math.max(0, width - 3 - visibleWidth(titlePart) - 3);
    const rightBorder = theme.fg("borderMuted", "─".repeat(rightBorderCount));
    const borderLine = leftBorder + titlePart + rightBorder;

    // Meta line
    const tagStr = idea.tags.length > 0 ? `[${idea.tags.join(", ")}]` : "no tags";
    const metaLine = theme.fg("muted", `IDEA-${idea.id} • ${idea.status} • ${tagStr}`);

    // Render and cache markdown
    if (!this.cachedMarkdownLines) {
      this.cachedMarkdownLines = this.markdown.render(width);
    }
    const allLines = this.cachedMarkdownLines;
    const totalLines = allLines.length;

    // Determine visible height
    const derivedViewHeight = Math.max(1, totalLines);
    const visibleLines = this.maxVisibleLines
      ? Math.min(this.maxVisibleLines, derivedViewHeight)
      : derivedViewHeight;
    this.lastViewHeight = visibleLines;

    // Slice by scroll offset
    const start = Math.min(this.scrollOffset, Math.max(0, totalLines - 1));
    const end = start + visibleLines;
    const bodyLines = allLines.slice(start, end);

    // Scroll position footer
    const endLine = totalLines > 0 ? Math.min(start + visibleLines - 1, totalLines - 1) : 0;
    const footerLine = theme.fg("dim", `Lines ${start}-${endLine} of ${totalLines}`);

    return [borderLine, metaLine, ...bodyLines, footerLine];
  }

  handleInput(data: string): void {
    const kb = this.host.keybindings;
    const totalLines = this.cachedMarkdownLines?.length ?? 0;

    if (kb.matches(data, "tui.select.cancel")) {
      this.host.close();
      return;
    }
    if (kb.matches(data, "tui.select.confirm")) {
      this.host.close();
      return;
    }
    if (kb.matches(data, "tui.select.up")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.host.requestRender();
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      this.scrollOffset = Math.min(Math.max(0, totalLines - 1), this.scrollOffset + 1);
      this.host.requestRender();
      return;
    }
    if (kb.matches(data, "tui.select.pageUp") || matchesKey(data, Key.left)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - this.lastViewHeight);
      this.host.requestRender();
      return;
    }
    if (kb.matches(data, "tui.select.pageDown") || matchesKey(data, Key.right)) {
      this.scrollOffset = Math.min(Math.max(0, totalLines - 1), this.scrollOffset + this.lastViewHeight);
      this.host.requestRender();
      return;
    }
  }
}

export const _internalsForTest = {
  IdeaSelectorComponent,
  IdeaActionMenuComponent,
  IdeaWorkSubmenuComponent,
  IdeaOtherSubmenuComponent,
  IdeaDeleteConfirmComponent,
  IdeaDetailOverlayComponent,
  buildRefineIdeaPrompt,
  filterAndRankIdeas,
  formatGroupedTextList,
  parseFlowIdeasArgs,
};

export function registerIdea(pi: ExtensionAPI): void {
  pi.registerCommand("flow:idea", {
    description: "Capture a durable Flow idea in docs/ideas/<8-hex>.md. First line of arguments → title; remaining lines → body.",
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

  pi.registerCommand("flow:ideas", {
    description:
      "Browse and manage ideas in docs/ideas/. Opens a TUI when interactive; prints a grouped text list otherwise. Accepts an initial query; --open / --closed / --all scope the listing in non-interactive mode.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const { query, status } = parseFlowIdeasArgs(args);
      const dir = await getIdeaDir(ctx.cwd);
      const entries = await listIdeas(dir);

      if (!ctx.hasUI) {
        ctx.ui.notify(formatGroupedTextList(entries, { query, status }), "info");
        return;
      }

      let mutableEntries = entries;

      await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
        let activeComponent: Component & { invalidate(): void };
        let selector: IdeaSelectorComponent;

        const closeAndPrefill = (text: string) => {
          ctx.ui.setEditorText(text);
          done(undefined);
        };

        const refresh = async () => {
          mutableEntries = await listIdeas(dir);
          selector.setEntries(mutableEntries);
          tui.requestRender();
        };

        const setActive = (c: Component & { invalidate(): void }) => {
          activeComponent = c;
          tui.requestRender();
        };

        let openActionMenu: (idea: IdeaListEntry) => void;

        const openWorkSubmenu = (idea: IdeaListEntry) => {
          const work = new IdeaWorkSubmenuComponent(idea, {
            dispatch: (skill) => {
              closeAndPrefill(`/flow:${skill} IDEA-${idea.id}`);
            },
            back: () => openActionMenu(idea),
            theme,
            keybindings,
            requestRender: () => tui.requestRender(),
          });
          setActive(work);
        };

        const openDeleteConfirm = (idea: IdeaListEntry) => {
          const confirmComponent = new IdeaDeleteConfirmComponent(idea, {
            confirm: () => {
              (async () => {
                await deleteIdea(dir, idea.id);
                ctx.ui.notify(`Deleted idea IDEA-${idea.id}`, "info");
                await refresh();
                setActive(selector);
              })();
            },
            cancel: () => openActionMenu(idea),
            theme,
            keybindings,
            requestRender: () => tui.requestRender(),
          });
          setActive(confirmComponent);
        };

        const openOtherSubmenu = (idea: IdeaListEntry) => {
          const other = new IdeaOtherSubmenuComponent(idea, {
            dispatch: (name) => {
              if (name === "copy-path") {
                (async () => {
                  await copyToClipboard(path.join(dir, `${idea.id}.md`));
                  ctx.ui.notify(`Copied path of IDEA-${idea.id}`, "info");
                  openActionMenu(idea);
                })();
              } else if (name === "copy-text") {
                (async () => {
                  const full = await readIdea(dir, idea.id);
                  if (!full) {
                    ctx.ui.notify(`IDEA-${idea.id} no longer exists`, "warning");
                    openActionMenu(idea);
                    return;
                  }
                  const text = full.body.length > 0 ? `# ${full.title}\n\n${full.body}` : `# ${full.title}`;
                  await copyToClipboard(text);
                  ctx.ui.notify(`Copied text of IDEA-${full.id}`, "info");
                  openActionMenu(idea);
                })();
              } else if (name === "delete") {
                openDeleteConfirm(idea);
              }
            },
            back: () => openActionMenu(idea),
            theme,
            keybindings,
            requestRender: () => tui.requestRender(),
          });
          setActive(other);
        };

        const openDetailOverlay = (full: IdeaArtifact) => {
          ctx.ui.custom<void>((_overlayTui, _overlayTheme, overlayKeybindings, overlayDone) => {
            const overlay = new IdeaDetailOverlayComponent(full, {
              close: () => overlayDone(undefined),
              theme,
              keybindings: overlayKeybindings,
              requestRender: () => _overlayTui.requestRender(),
            });
            return {
              render: (w) => overlay.render(w),
              invalidate: () => overlay.invalidate(),
              handleInput: (data) => {
                overlay.handleInput?.(data);
                _overlayTui.requestRender();
              },
            };
          }, {
            overlay: true,
            overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" },
          });
        };

        openActionMenu = (idea: IdeaListEntry) => {
          const menu = new IdeaActionMenuComponent(idea, {
            dispatchAction: (name) => {
              if (name === "view") {
                (async () => {
                  const full = await readIdea(dir, idea.id);
                  if (!full) {
                    ctx.ui.notify(`IDEA-${idea.id} no longer exists`, "warning");
                    return;
                  }
                  openDetailOverlay(full);
                })();
              } else if (name === "refine") {
                closeAndPrefill(buildRefineIdeaPrompt(idea.id, idea.title));
              } else if (name === "work") {
                openWorkSubmenu(idea);
              } else if (name === "close" || name === "reopen") {
                (async () => {
                  const full = await readIdea(dir, idea.id);
                  if (!full) {
                    ctx.ui.notify(`IDEA-${idea.id} no longer exists`, "warning");
                    return;
                  }
                  const nextStatus: "open" | "closed" = name === "close" ? "closed" : "open";
                  await writeIdea(dir, { ...full, status: nextStatus });
                  const verb = name === "close" ? "Closed" : "Reopened";
                  ctx.ui.notify(`${verb} idea IDEA-${idea.id}`, "info");
                  await refresh();
                  const updated = mutableEntries.find((e) => e.id === idea.id);
                  if (updated) openActionMenu(updated);
                  else setActive(selector);
                })();
              } else if (name === "other") {
                openOtherSubmenu(idea);
              }
            },
            back: () => setActive(selector),
            theme,
            keybindings,
            requestRender: () => tui.requestRender(),
          });
          setActive(menu);
        };

        const selectorHost: IdeaSelectorHost = {
          setActive: (c) => setActive(c),
          requestRender: () => tui.requestRender(),
          notify: (m, l) => ctx.ui.notify(m, l),
          close: () => done(undefined),
          dispatch: (action) => {
            if (action.kind === "cancel") {
              done(undefined);
            } else if (action.kind === "open") {
              openActionMenu(action.idea);
            } else if (action.kind === "refine") {
              closeAndPrefill(buildRefineIdeaPrompt(action.idea.id, action.idea.title));
            } else if (action.kind === "fastlane") {
              closeAndPrefill(`/flow:fastlane IDEA-${action.idea.id}`);
            } else if (action.kind === "spec") {
              closeAndPrefill(`/flow:spec IDEA-${action.idea.id}`);
            }
          },
          theme,
          keybindings,
        };

        selector = new IdeaSelectorComponent(mutableEntries, query, selectorHost);
        activeComponent = selector;

        return {
          render: (w) => activeComponent.render(w),
          invalidate: () => activeComponent.invalidate(),
          handleInput: (data) => {
            activeComponent.handleInput?.(data);
            tui.requestRender();
          },
        };
      });
    },
  });

  pi.registerTool(defineTool({
    name: "idea",
    label: "Idea",
    description: IDEA_TOOL_DESCRIPTION,
    promptSnippet:
      "idea — six actions: list / read / create / update / append / delete. Identifies artifacts as IDEA-<8-hex>. Body follows the canonical 5-section shape: ## Context, ## Goal, ## Scope, ## Acceptance Sketch, ## Open Questions.",
    parameters: ideaParameters,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      return executeIdeaTool(params as IdeaToolParams, ctx);
    },
    renderCall: (args, theme) => {
      let text = theme.fg("toolTitle", theme.bold("idea "));
      text += theme.fg("muted", args.action ?? "");
      if (args.id) {
        text += " " + theme.fg("accent", `IDEA-${normalizeIdeaId(args.id) ?? args.id}`);
      }
      if (args.title) {
        text += " " + theme.fg("dim", `"${args.title}"`);
      }
      return new Text(text, 0, 0);
    },
    renderResult: (result, { expanded }, theme, context) => {
      const firstContent = result.content[0];
      const firstText = firstContent?.type === "text" ? firstContent.text : undefined;
      if (context.isError) {
        return new Text(theme.fg("error", firstText ?? "Error"), 0, 0);
      }

      const details = result.details as any;

      if (details?.list && Array.isArray(details.list)) {
        const open: any[] = details.list.filter((e: any) => e.status === "open");
        const closed: any[] = details.list.filter((e: any) => e.status !== "open");
        const lines: string[] = [];
        let truncated = false;

        for (const [group, label] of [[open, "Open"], [closed, "Closed"]] as [any[], string][]) {
          if (group.length === 0) continue;
          lines.push(theme.fg("accent", `${label} ideas (${group.length})`));
          const visible = expanded ? group : group.slice(0, 3);
          for (const item of visible) {
            let line = `IDEA-${item.id} ${item.title}`;
            if (item.tags?.length) line += theme.fg("muted", ` [${item.tags.join(", ")}]`);
            lines.push(line);
          }
          if (!expanded && group.length > 3) {
            lines.push(theme.fg("muted", `  ... ${group.length - 3} more`));
            truncated = true;
          }
        }

        if (!expanded && truncated) {
          lines.push(theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`));
        }

        return new Text(lines.join("\n"), 0, 0);
      }

      if (details?.id && details?.title && details?.status !== undefined) {
        const action = details.__renderAction as string | undefined;
        const verbMap: Record<string, string> = {
          create: "✓ Created",
          update: "✓ Updated",
          append: "✓ Appended to",
          delete: "✓ Deleted",
        };
        const verb = action ? verbMap[action] : undefined;
        const isDim = details.status === "closed";
        const lines: string[] = [];

        let heading = "";
        if (verb) heading += theme.fg("success", verb) + " ";
        heading += theme.fg("accent", `IDEA-${details.id}`);
        heading += " " + theme.fg(isDim ? "dim" : "text", details.title ?? "");
        if (details.tags?.length) {
          heading += " " + theme.fg("muted", `[${details.tags.join(", ")}]`);
        }
        lines.push(heading);

        if (expanded) {
          lines.push(details.status ?? "");
          lines.push(
            details.tags?.length ? details.tags.join(", ") : theme.fg("dim", "(no tags)"),
          );
          lines.push(details.createdAt ?? "");
          if (details.body) lines.push(details.body);
        }

        return new Text(lines.join("\n"), 0, 0);
      }

      return new Text(firstText ?? "", 0, 0);
    },
  }));
}
