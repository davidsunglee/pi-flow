import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  generateIdeaId,
  normalizeIdeaId,
  formatIdeaArtifact,
  parseIdeaArtifact,
  readIdea,
  writeIdea,
  listIdeas,
  appendIdeaBody,
  deleteIdea,
  getIdeaDir,
  type IdeaArtifact,
  type IdeaListEntry,
} from "./storage.ts";

function makeTmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "pi-storage-test-"));
}

function removeTmpDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

const SAMPLE: IdeaArtifact = {
  id: "cfcb8ede",
  title: "Extract current pi-config workflow",
  tags: ["pi-flow", "extraction"],
  status: "closed",
  createdAt: "2026-05-18T00:00:00.000Z",
  body: "## Goal\n\nExtract the workflow.",
};

test("formatIdeaArtifact produces parseable JSON metadata followed by body", () => {
  const raw = formatIdeaArtifact(SAMPLE);
  assert.ok(raw.startsWith("{"), "should start with JSON object");
  assert.ok(raw.includes(SAMPLE.title));
  assert.ok(raw.includes(SAMPLE.body));
});

test("formatIdeaArtifact → parseIdeaArtifact round-trips an artifact", () => {
  const raw = formatIdeaArtifact(SAMPLE);
  const parsed = parseIdeaArtifact(raw);
  assert.ok(parsed !== undefined);
  assert.equal(parsed!.id, SAMPLE.id);
  assert.equal(parsed!.title, SAMPLE.title);
  assert.deepEqual(parsed!.tags, SAMPLE.tags);
  assert.equal(parsed!.status, SAMPLE.status);
  assert.equal(parsed!.createdAt, SAMPLE.createdAt);
  assert.equal(parsed!.body, SAMPLE.body);
});

test("parseIdeaArtifact handles body containing literal closing brace }", () => {
  const withBrace: IdeaArtifact = {
    ...SAMPLE,
    body: 'See inline JSON: {"key": "value"} and also standalone } brace.',
  };
  const raw = formatIdeaArtifact(withBrace);
  const parsed = parseIdeaArtifact(raw);
  assert.ok(parsed !== undefined, "should parse successfully");
  assert.equal(parsed!.body, withBrace.body, "body with literal } should round-trip");
});

test("parseIdeaArtifact returns undefined for malformed input", () => {
  assert.equal(parseIdeaArtifact("not json at all"), undefined);
  assert.equal(parseIdeaArtifact(""), undefined);
  assert.equal(parseIdeaArtifact('{"no_id": true}'), undefined);
});

test("normalizeIdeaId returns cfcb8ede for IDEA-cfcb8ede", () => {
  assert.equal(normalizeIdeaId("IDEA-cfcb8ede"), "cfcb8ede");
});

test("normalizeIdeaId returns cfcb8ede for cfcb8ede", () => {
  assert.equal(normalizeIdeaId("cfcb8ede"), "cfcb8ede");
});

test("normalizeIdeaId returns cfcb8ede for IDEA-CFCB8EDE (case insensitive)", () => {
  assert.equal(normalizeIdeaId("IDEA-CFCB8EDE"), "cfcb8ede");
});

test("normalizeIdeaId returns undefined for legacy artifact prefix", () => {
  assert.equal(normalizeIdeaId(`TO${"DO"}-cfcb8ede`), undefined);
});

test("normalizeIdeaId returns undefined for garbage", () => {
  assert.equal(normalizeIdeaId("garbage"), undefined);
});

test("normalizeIdeaId returns undefined for short hex", () => {
  assert.equal(normalizeIdeaId("abc123"), undefined);
});

test("generateIdeaId returns 8 hex chars", () => {
  const id = generateIdeaId();
  assert.match(id, /^[0-9a-f]{8}$/, "should be 8 lowercase hex chars");
});

test("generateIdeaId produces different values on successive calls", () => {
  const ids = new Set(Array.from({ length: 10 }, () => generateIdeaId()));
  assert.ok(ids.size > 1, "should produce unique IDs");
});

test("writeIdea followed by readIdea round-trips in a tmp directory", async () => {
  const dir = makeTmpDir();
  try {
    const written = await writeIdea(dir, SAMPLE);
    assert.ok(written.endsWith(`${SAMPLE.id}.md`), "written path should end with id.md");

    const read = await readIdea(dir, SAMPLE.id);
    assert.ok(read !== undefined);
    assert.deepEqual(read, SAMPLE);
  } finally {
    removeTmpDir(dir);
  }
});

test("writeIdea is atomic — no temp files survive a successful write", async () => {
  const dir = makeTmpDir();
  try {
    await writeIdea(dir, SAMPLE);
    const files = await readdir(dir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(tmpFiles, [], "no temp files should remain after a successful write");
  } finally {
    removeTmpDir(dir);
  }
});

test("readIdea returns undefined for an unknown id", async () => {
  const dir = makeTmpDir();
  try {
    const result = await readIdea(dir, "00000000");
    assert.equal(result, undefined);
  } finally {
    removeTmpDir(dir);
  }
});

test("readIdea accepts IDEA-prefixed id", async () => {
  const dir = makeTmpDir();
  try {
    await writeIdea(dir, SAMPLE);
    const read = await readIdea(dir, `IDEA-${SAMPLE.id}`);
    assert.ok(read !== undefined);
    assert.equal(read!.id, SAMPLE.id);
  } finally {
    removeTmpDir(dir);
  }
});

test("listIdeas returns parseable entries and silently skips malformed files", async () => {
  const dir = makeTmpDir();
  try {
    const a: IdeaArtifact = { ...SAMPLE, id: "aaaabbbb" };
    const b: IdeaArtifact = { ...SAMPLE, id: "ccccdddd", status: "open" };
    await writeIdea(dir, a);
    await writeIdea(dir, b);
    // Write a malformed file that matches the naming pattern
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "eeeeffff.md"), "not valid content", "utf8");

    const list = await listIdeas(dir);
    assert.equal(list.length, 2, "should return 2 parseable entries and skip malformed");
    const ids = list.map((e) => e.id).sort();
    assert.deepEqual(ids, ["aaaabbbb", "ccccdddd"]);
    const bEntry = list.find((e) => e.id === "ccccdddd");
    assert.equal(bEntry?.status, "open");
  } finally {
    removeTmpDir(dir);
  }
});

test("listIdeas returns empty array for empty directory", async () => {
  const dir = makeTmpDir();
  try {
    const list = await listIdeas(dir);
    assert.deepEqual(list, []);
  } finally {
    removeTmpDir(dir);
  }
});

test("listIdeas ignores files that don't match the id pattern", async () => {
  const dir = makeTmpDir();
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "README.md"), "# ignore me", "utf8");
    await writeFile(path.join(dir, "cfcb8ede-extra.md"), "also ignore", "utf8");
    const list = await listIdeas(dir);
    assert.deepEqual(list, []);
  } finally {
    removeTmpDir(dir);
  }
});

test("getIdeaDir returns <cwd>/docs/ideas in a sandbox not inside a git repo", async () => {
  const dir = makeTmpDir();
  try {
    const result = await getIdeaDir(dir);
    assert.equal(result, path.join(dir, "docs", "ideas"));
  } finally {
    removeTmpDir(dir);
  }
});

test("parseIdeaArtifact normalizes legacy status 'done' to 'closed'", async () => {
  const dir = makeTmpDir();
  try {
    const { writeFile, readFile } = await import("node:fs/promises");
    const raw = `{\n  "id": "ab12cd34",\n  "title": "Legacy idea",\n  "tags": [],\n  "status": "done",\n  "created_at": "2026-01-01T00:00:00.000Z"\n}\n\nSome body text\n`;
    await writeFile(path.join(dir, "ab12cd34.md"), raw, "utf8");
    const parsed = await readIdea(dir, "ab12cd34");
    assert.ok(parsed !== undefined, "should parse successfully");
    assert.equal(parsed!.status, "closed", "legacy 'done' should be normalized to 'closed'");

    // After writeIdea, file should contain "closed" not "done"
    await writeIdea(dir, parsed!);
    const reread = await readFile(path.join(dir, "ab12cd34.md"), "utf8");
    assert.ok(reread.includes('"status": "closed"'), "re-serialized file should contain 'closed'");
    assert.ok(!reread.includes('"status": "done"'), "re-serialized file should not contain 'done'");
  } finally {
    removeTmpDir(dir);
  }
});

test("parseIdeaArtifact tolerates unknown JSON fields without failing", async () => {
  const dir = makeTmpDir();
  try {
    const { writeFile } = await import("node:fs/promises");
    const raw = `{\n  "id": "ff001122",\n  "title": "Future idea",\n  "tags": ["future"],\n  "status": "open",\n  "created_at": "2026-02-01T00:00:00.000Z",\n  "priority": "high"\n}\n\nBody here\n`;
    await writeFile(path.join(dir, "ff001122.md"), raw, "utf8");
    const parsed = await readIdea(dir, "ff001122");
    assert.ok(parsed !== undefined, "should parse successfully despite unknown field");
    assert.equal(parsed!.status, "open");
    assert.equal(parsed!.title, "Future idea");
    assert.deepEqual(parsed!.tags, ["future"]);
  } finally {
    removeTmpDir(dir);
  }
});

test("listIdeas returns richer IdeaListEntry shape with tags and createdAt", async () => {
  const dir = makeTmpDir();
  try {
    const a: IdeaArtifact = { ...SAMPLE, id: "11112222", status: "open", title: "alpha idea" };
    const b: IdeaArtifact = { ...SAMPLE, id: "33334444", status: "closed" };
    const c: IdeaArtifact = { ...SAMPLE, id: "55556666", status: "closed" };
    await writeIdea(dir, a);
    await writeIdea(dir, b);
    await writeIdea(dir, c);

    const all = await listIdeas(dir);
    assert.equal(all.length, 3);
    const entry = all.find((e) => e.id === "11112222");
    assert.ok(entry !== undefined);
    assert.ok("tags" in entry!, "entry should have tags field");
    assert.ok("createdAt" in entry!, "entry should have createdAt field");
  } finally {
    removeTmpDir(dir);
  }
});

test("listIdeas filter by status: open returns only open entries", async () => {
  const dir = makeTmpDir();
  try {
    const a: IdeaArtifact = { ...SAMPLE, id: "aaaa0001", status: "open", title: "alpha idea" };
    const b: IdeaArtifact = { ...SAMPLE, id: "aaaa0002", status: "closed" };
    const c: IdeaArtifact = { ...SAMPLE, id: "aaaa0003", status: "closed" };
    await writeIdea(dir, a);
    await writeIdea(dir, b);
    await writeIdea(dir, c);

    const open = await listIdeas(dir, { status: "open" });
    assert.equal(open.length, 1);
    assert.equal(open[0].id, "aaaa0001");
  } finally {
    removeTmpDir(dir);
  }
});

test("listIdeas filter by status: closed returns only closed entries", async () => {
  const dir = makeTmpDir();
  try {
    const a: IdeaArtifact = { ...SAMPLE, id: "bbbb0001", status: "open", title: "alpha idea" };
    const b: IdeaArtifact = { ...SAMPLE, id: "bbbb0002", status: "closed" };
    const c: IdeaArtifact = { ...SAMPLE, id: "bbbb0003", status: "closed" };
    await writeIdea(dir, a);
    await writeIdea(dir, b);
    await writeIdea(dir, c);

    const closed = await listIdeas(dir, { status: "closed" });
    assert.equal(closed.length, 2);
    const ids = closed.map((e) => e.id).sort();
    assert.deepEqual(ids, ["bbbb0002", "bbbb0003"]);
  } finally {
    removeTmpDir(dir);
  }
});

test("listIdeas filter by status: all returns all entries", async () => {
  const dir = makeTmpDir();
  try {
    const a: IdeaArtifact = { ...SAMPLE, id: "cccc0001", status: "open", title: "alpha idea" };
    const b: IdeaArtifact = { ...SAMPLE, id: "cccc0002", status: "closed" };
    const c: IdeaArtifact = { ...SAMPLE, id: "cccc0003", status: "closed" };
    await writeIdea(dir, a);
    await writeIdea(dir, b);
    await writeIdea(dir, c);

    const all = await listIdeas(dir, { status: "all" });
    assert.equal(all.length, 3);
  } finally {
    removeTmpDir(dir);
  }
});

test("listIdeas filter by query returns matching entries", async () => {
  const dir = makeTmpDir();
  try {
    const a: IdeaArtifact = { ...SAMPLE, id: "dddd0001", status: "open", title: "alpha feature" };
    const b: IdeaArtifact = { ...SAMPLE, id: "dddd0002", status: "closed", title: "beta feature" };
    const c: IdeaArtifact = { ...SAMPLE, id: "dddd0003", status: "closed", title: "gamma task" };
    await writeIdea(dir, a);
    await writeIdea(dir, b);
    await writeIdea(dir, c);

    const filtered = await listIdeas(dir, { query: "alpha" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, "dddd0001");
  } finally {
    removeTmpDir(dir);
  }
});

test("appendIdeaBody joins with blank line separator when existing body is non-empty", async () => {
  const dir = makeTmpDir();
  try {
    const a: IdeaArtifact = { ...SAMPLE, id: "ee110001", body: "first paragraph" };
    await writeIdea(dir, a);

    const result = await appendIdeaBody(dir, "ee110001", "second paragraph");
    assert.ok(result !== undefined);
    assert.equal(result!.body, "first paragraph\n\nsecond paragraph");

    const read = await readIdea(dir, "ee110001");
    assert.equal(read!.body, "first paragraph\n\nsecond paragraph");
  } finally {
    removeTmpDir(dir);
  }
});

test("appendIdeaBody with empty body uses no separator", async () => {
  const dir = makeTmpDir();
  try {
    const a: IdeaArtifact = { ...SAMPLE, id: "ee110002", body: "" };
    await writeIdea(dir, a);

    const result = await appendIdeaBody(dir, "ee110002", "only paragraph");
    assert.ok(result !== undefined);
    assert.equal(result!.body, "only paragraph");
  } finally {
    removeTmpDir(dir);
  }
});

test("appendIdeaBody returns undefined for missing id", async () => {
  const dir = makeTmpDir();
  try {
    const result = await appendIdeaBody(dir, "00000000", "x");
    assert.equal(result, undefined);
  } finally {
    removeTmpDir(dir);
  }
});

test("deleteIdea removes the file and returns the deleted record", async () => {
  const dir = makeTmpDir();
  try {
    const a: IdeaArtifact = { ...SAMPLE, id: "ff220001" };
    await writeIdea(dir, a);

    const deleted = await deleteIdea(dir, "ff220001");
    assert.ok(deleted !== undefined);
    assert.equal(deleted!.id, a.id);
    assert.equal(deleted!.title, a.title);
    assert.equal(deleted!.status, a.status);

    // File should be gone
    await assert.rejects(
      () => import("node:fs/promises").then((m) => m.access(path.join(dir, "ff220001.md"))),
      { code: "ENOENT" },
    );
  } finally {
    removeTmpDir(dir);
  }
});

test("deleteIdea returns undefined for missing id", async () => {
  const dir = makeTmpDir();
  try {
    const result = await deleteIdea(dir, "00000000");
    assert.equal(result, undefined);
  } finally {
    removeTmpDir(dir);
  }
});
