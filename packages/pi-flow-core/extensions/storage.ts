import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

export interface IdeaArtifact {
  id: string;
  title: string;
  tags: string[];
  status: "open" | "done";
  createdAt: string;
  body: string;
}

export async function getIdeaDir(cwd: string): Promise<string> {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (result.status === 0 && result.stdout) {
    return path.join(result.stdout.trim(), "docs", "ideas");
  }
  return path.join(cwd, "docs", "ideas");
}

export function generateIdeaId(): string {
  return crypto.randomBytes(4).toString("hex");
}

export function normalizeIdeaId(value: string): string | undefined {
  const stripped = value.replace(/^IDEA-/i, "").toLowerCase();
  if (/^[0-9a-f]{8}$/.test(stripped)) return stripped;
  return undefined;
}

export function formatIdeaArtifact(a: IdeaArtifact): string {
  const meta = JSON.stringify(
    { id: a.id, title: a.title, tags: a.tags, status: a.status, created_at: a.createdAt },
    null,
    2,
  );
  return `${meta}\n\n${a.body}\n`;
}

export function parseIdeaArtifact(raw: string): IdeaArtifact | undefined {
  try {
    // Find the start of the JSON object
    const start = raw.indexOf("{");
    if (start === -1) return undefined;

    // Walk the string tracking brace depth, respecting string contexts
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;

    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) return undefined;

    const metaText = raw.slice(start, end + 1);
    const meta = JSON.parse(metaText) as Record<string, unknown>;

    if (
      typeof meta.id !== "string" ||
      typeof meta.title !== "string" ||
      !Array.isArray(meta.tags) ||
      (meta.status !== "open" && meta.status !== "done") ||
      typeof meta.created_at !== "string"
    ) {
      return undefined;
    }

    const remainder = raw.slice(end + 1).replace(/^\n+/, "");
    const body = remainder.endsWith("\n") ? remainder.slice(0, -1) : remainder;

    return {
      id: meta.id,
      title: meta.title,
      tags: meta.tags as string[],
      status: meta.status,
      createdAt: meta.created_at,
      body,
    };
  } catch {
    return undefined;
  }
}

export async function readIdea(dir: string, id: string): Promise<IdeaArtifact | undefined> {
  const normalized = normalizeIdeaId(id);
  if (!normalized) return undefined;
  try {
    const raw = await fs.readFile(path.join(dir, `${normalized}.md`), "utf8");
    return parseIdeaArtifact(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function writeIdea(dir: string, a: IdeaArtifact): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, `${a.id}.md`);
  const tmpPath = `${finalPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmpPath, formatIdeaArtifact(a), "utf8");
    await fs.rename(tmpPath, finalPath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
  return finalPath;
}

export async function listIdeas(dir: string): Promise<Array<{ id: string; title: string; status: string }>> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const results: Array<{ id: string; title: string; status: string }> = [];
  for (const entry of entries) {
    if (!/^[0-9a-f]{8}\.md$/.test(entry)) continue;
    try {
      const raw = await fs.readFile(path.join(dir, entry), "utf8");
      const parsed = parseIdeaArtifact(raw);
      if (parsed) {
        results.push({ id: parsed.id, title: parsed.title, status: parsed.status });
      }
    } catch {
      // silently skip unreadable files
    }
  }
  return results;
}
