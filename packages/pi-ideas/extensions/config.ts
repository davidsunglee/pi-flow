import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface WorkMenuAction {
  name: string;
  prompt: string;
  description?: string;
  shortcut?: string;
}

export interface IdeasConfig {
  command: string;
  refinePrompt: string;
  toolDescription: string;
  promptSnippet: string;
  actions: WorkMenuAction[];
}

// NOTE: inside a template literal, write the placeholder as `\${idea}` so it is
// not interpreted as JS interpolation. substituteIdea() replaces the literal
// text "${idea}" at runtime.
export const DEFAULT_REFINE_PROMPT = `Refine the idea \${idea}.

Before rewriting or updating the idea, ask the user clarifying questions whose answers would materially change the artifact. Provide a recommendation for each question. Do not rewrite the idea body before the user answers.

Once the user has answered enough, update the idea via the \`idea\` tool's \`update\` action.`;

export const DEFAULT_TOOL_DESCRIPTION = `Capture, read, list, update, append to, and delete ideas backed by docs/ideas/<8-hex>.md artifacts. Identifiers use the format IDEA-<8-hex> (case-insensitive).

Use this tool when the user asks naturally in conversation to capture, refine, or list ideas — even informally phrased requests.

Rule: ask at most one clarifying question, and only when missing information would materially change the artifact. Otherwise, create the idea immediately and report the resulting IDEA-<id>.`;

export const DEFAULT_PROMPT_SNIPPET =
  "idea — six actions: list / read / create / update / append / delete. Identifies artifacts as IDEA-<8-hex>.";

export const BUILTIN_IDEAS_CONFIG: IdeasConfig = {
  command: "ideas",
  refinePrompt: DEFAULT_REFINE_PROMPT,
  toolDescription: DEFAULT_TOOL_DESCRIPTION,
  promptSnippet: DEFAULT_PROMPT_SNIPPET,
  actions: [],
};

export function substituteIdea(template: string, ideaId: string): string {
  // ideaId is the bare 8-hex; expand to the canonical IDEA-<hex> form.
  return template.split("${idea}").join(`IDEA-${ideaId}`);
}

export function shortcutToKeyId(shortcut: string): string {
  // pi-tui matchesKey accepts lowercase "+"-joined KeyIds (e.g. "ctrl+shift+f").
  // The same lowercased string is also the hint-bar display token.
  return shortcut.trim().toLowerCase();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface RawActionEntry {
  name: string;
  prompt?: string;
  description?: string;
  shortcut?: string;
}

export function normalizeRawActions(value: unknown): RawActionEntry[] {
  if (!Array.isArray(value)) return [];
  const out: RawActionEntry[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    if (typeof item.name !== "string" || item.name.length === 0) continue;
    const entry: RawActionEntry = { name: item.name };
    if (typeof item.prompt === "string") entry.prompt = item.prompt;
    if (typeof item.description === "string") entry.description = item.description;
    if (typeof item.shortcut === "string") entry.shortcut = item.shortcut;
    out.push(entry);
  }
  return out;
}

export function mergeActions(base: WorkMenuAction[], incoming: RawActionEntry[]): WorkMenuAction[] {
  const result = base.map((a) => ({ ...a }));
  for (const entry of incoming) {
    if (entry.name.startsWith("-")) {
      const target = entry.name.slice(1);
      const idx = result.findIndex((a) => a.name === target);
      if (idx !== -1) result.splice(idx, 1);
      continue;
    }
    if (entry.prompt === undefined) continue; // prompt required for non-negation entries
    const action: WorkMenuAction = {
      name: entry.name,
      prompt: entry.prompt,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.shortcut === undefined ? {} : { shortcut: entry.shortcut }),
    };
    const idx = result.findIndex((a) => a.name === entry.name);
    if (idx !== -1) result[idx] = action; // replace in place, preserving position
    else result.push(action); // append new
  }
  return result;
}

function readConfigObject(filePath: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined; // missing/unreadable — treat as absent
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined; // malformed — ignore rather than crash extension load
  }
  return isPlainObject(parsed) ? parsed : undefined;
}

function pickString(
  field: keyof IdeasConfig,
  layers: Array<Record<string, unknown> | undefined>,
  fallback: string,
): string {
  let value = fallback;
  for (const layer of layers) {
    const v = layer?.[field as string];
    if (typeof v === "string" && v.length > 0) value = v;
  }
  return value;
}

export interface ResolveIdeasConfigOptions {
  defaultConfigPath?: string;
  homeDir?: string;
  cwd?: string;
}

export function resolveIdeasConfig(opts: ResolveIdeasConfigOptions = {}): IdeasConfig {
  const homeDir = opts.homeDir ?? os.homedir();
  const cwd = opts.cwd ?? process.cwd();

  const packaged = opts.defaultConfigPath ? readConfigObject(opts.defaultConfigPath) : undefined;
  const global = readConfigObject(path.join(homeDir, ".pi", "ideas.json"));
  const project = readConfigObject(path.join(cwd, ".pi", "ideas.json"));
  const layers = [packaged, global, project];

  let actions: WorkMenuAction[] = [...BUILTIN_IDEAS_CONFIG.actions];
  for (const layer of layers) {
    if (layer && "actions" in layer) {
      actions = mergeActions(actions, normalizeRawActions(layer.actions));
    }
  }

  return {
    command: pickString("command", layers, BUILTIN_IDEAS_CONFIG.command),
    refinePrompt: pickString("refinePrompt", layers, BUILTIN_IDEAS_CONFIG.refinePrompt),
    toolDescription: pickString("toolDescription", layers, BUILTIN_IDEAS_CONFIG.toolDescription),
    promptSnippet: pickString("promptSnippet", layers, BUILTIN_IDEAS_CONFIG.promptSnippet),
    actions,
  };
}
