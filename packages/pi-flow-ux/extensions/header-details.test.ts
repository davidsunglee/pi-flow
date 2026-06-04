import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { visibleWidth } from "@earendil-works/pi-tui";

import {
  FULL_DETAILS_TITLE,
  HEADER_DETAILS_MESSAGE_TYPE,
  WIDE_LAYOUT_MIN_USABLE_WIDTH,
  buildFullDetailsLines,
  buildFullDetailsPlainText,
  createHeaderDetailsRenderer,
  parseSnapshotDetails,
  showHeaderDetails,
} from "./header-details.ts";
import type { ResourceSnapshot } from "./header-data.ts";

// Identity colorize for structure tests (no ANSI tags).
const id = (_token: string, text: string): string => text;
// Tagging colorize for token tests.
const tag = (token: string, text: string): string => `<${token}:${text}>`;

/** Hand-built snapshot: 3 context, 0 prompts, 2 skills w/ details, 2 extensions w/ details, 2 themes (first active). */
const FIXTURE: ResourceSnapshot = {
  context: [
    { name: "AGENTS.md" },
    { name: "packages/a/AGENTS.md" },
    { name: "~/.pi/agent/AGENTS.md" },
  ],
  prompts: [],
  skills: [
    { name: "brainstorm", detail: "@aphotic/pi-flow-core" },
    { name: "define-spec", detail: "@aphotic/pi-flow-core" },
  ],
  extensions: [
    { name: "pi-flow-ux", detail: "extensions/index.ts" },
    { name: "pi-ideas", detail: "extensions/index.ts" },
  ],
  themes: [
    { name: "nord", active: true, detail: "@aphotic/pi-themes" },
    { name: "catppuccin", active: false, detail: "~/.pi/agent/themes/catppuccin.json" },
  ],
};

// --- Wide layout (width 74, usable 72) ---------------------------------------

test("buildFullDetailsLines wide layout: title and blank after title", () => {
  const lines = buildFullDetailsLines(FIXTURE, 74, id);
  assert.equal(lines[0], "  " + FULL_DETAILS_TITLE);
  assert.equal(lines[1], "");
});

test("buildFullDetailsLines wide layout: all five category headings present", () => {
  const lines = buildFullDetailsLines(FIXTURE, 74, id);
  const text = lines.join("\n");
  for (const cat of ["context", "prompts", "skills", "extensions", "themes"]) {
    assert.ok(text.includes(cat), `expected heading for category: ${cat}`);
  }
});

test("buildFullDetailsLines wide layout: prompts (0) has none placeholder", () => {
  const lines = buildFullDetailsLines(FIXTURE, 74, id);
  const promptsHeadingIdx = lines.findIndex((l) => l.trim().startsWith("prompts (0)"));
  assert.ok(promptsHeadingIdx !== -1, "expected prompts (0) heading");
  assert.equal(lines[promptsHeadingIdx + 1], "    none");
});

test("buildFullDetailsLines wide layout: context (3) count", () => {
  const lines = buildFullDetailsLines(FIXTURE, 74, id);
  assert.ok(lines.some((l) => l.includes("context (3)")), "expected context (3)");
});

test("buildFullDetailsLines wide layout: items at 4-space indent", () => {
  const lines = buildFullDetailsLines(FIXTURE, 74, id);
  // Find a skill item line
  const skillItem = lines.find((l) => l.startsWith("    brainstorm"));
  assert.ok(skillItem, "expected brainstorm item at 4-space indent");
  assert.ok(skillItem!.startsWith("    ") && !skillItem!.startsWith("     "), "exactly 4 spaces");
});

test("buildFullDetailsLines wide layout: sub-lines present at 6-space indent", () => {
  const lines = buildFullDetailsLines(FIXTURE, 74, id);
  // Should find the skill detail sub-lines
  const subLine = lines.find((l) => l.startsWith("      @aphotic/pi-flow-core"));
  assert.ok(subLine, "expected sub-line at 6-space indent in wide layout");
});

test("buildFullDetailsLines wide layout: active theme line reads 'nord *active'", () => {
  const lines = buildFullDetailsLines(FIXTURE, 74, id);
  assert.ok(lines.some((l) => l === "    nord *active"), "expected '    nord *active'");
});

test("buildFullDetailsLines wide layout: one blank line after every category", () => {
  const lines = buildFullDetailsLines(FIXTURE, 74, id);
  // Find each category heading and check the blank after its block
  const categories = ["context", "prompts", "skills", "extensions", "themes"];
  for (let c = 0; c < categories.length; c++) {
    const headingIdx = lines.findIndex((l) => l.replace(/<[^>]+>/g, "").trim().startsWith(categories[c]! + " ("));
    assert.ok(headingIdx !== -1, `heading for ${categories[c]}`);
    // Find the blank line that closes this category block (before next heading or end)
    const nextHeadingIdx = c + 1 < categories.length
      ? lines.findIndex((l, i) => i > headingIdx && l.replace(/<[^>]+>/g, "").trim().startsWith(categories[c + 1]! + " ("))
      : lines.length;
    // The blank separator should appear at the end of the category block
    const blockSlice = lines.slice(headingIdx + 1, nextHeadingIdx);
    assert.ok(blockSlice.includes(""), `expected blank after category ${categories[c]}`);
  }
});

// --- Narrow layout (width 73, usable 71) -------------------------------------

test("buildFullDetailsLines narrow layout: no sub-lines present", () => {
  const lines = buildFullDetailsLines(FIXTURE, 73, id);
  // Sub-lines are at 6-space indent — none should be present
  const subLine = lines.find((l) => l.startsWith("      "));
  assert.equal(subLine, undefined, "expected no sub-lines in narrow layout");
});

test("buildFullDetailsLines narrow layout: item lines still present", () => {
  const lines = buildFullDetailsLines(FIXTURE, 73, id);
  const skillItem = lines.find((l) => l.startsWith("    brainstorm"));
  assert.ok(skillItem, "items should still be present in narrow layout");
});

test("buildFullDetailsLines narrow layout: title and structure identical except for sub-lines", () => {
  const wideLines = buildFullDetailsLines(FIXTURE, 74, id);
  const narrowLines = buildFullDetailsLines(FIXTURE, 73, id);
  // Narrow should have fewer lines (no sub-lines for 4 items with details)
  assert.ok(narrowLines.length < wideLines.length, "narrow should have fewer lines than wide");
  // Title should match
  assert.equal(narrowLines[0], "  " + FULL_DETAILS_TITLE);
});

// --- WIDE_LAYOUT_MIN_USABLE_WIDTH boundary -----------------------------------

test("WIDE_LAYOUT_MIN_USABLE_WIDTH is 72", () => {
  assert.equal(WIDE_LAYOUT_MIN_USABLE_WIDTH, 72);
});

test("sub-lines appear exactly at width 74 (usable 72) and not at 73 (usable 71)", () => {
  const wide = buildFullDetailsLines(FIXTURE, 74, id);
  const narrow = buildFullDetailsLines(FIXTURE, 73, id);
  assert.ok(wide.some((l) => l.startsWith("      ")), "sub-lines at width 74");
  assert.ok(!narrow.some((l) => l.startsWith("      ")), "no sub-lines at width 73");
});

// --- Line-width guard --------------------------------------------------------

test("buildFullDetailsLines at width 20: every line satisfies visibleWidth <= 20", () => {
  const lines = buildFullDetailsLines(FIXTURE, 20, id);
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 20, `line exceeds 20: ${JSON.stringify(line)}`);
  }
});

// --- Determinism -------------------------------------------------------------

test("buildFullDetailsLines: two identical calls produce deepEqual arrays", () => {
  const a = buildFullDetailsLines(FIXTURE, 74, id);
  const b = buildFullDetailsLines(FIXTURE, 74, id);
  assert.deepEqual(a, b);
});

// --- buildFullDetailsPlainText -----------------------------------------------

test("buildFullDetailsPlainText contains sub-line text", () => {
  const text = buildFullDetailsPlainText(FIXTURE);
  assert.ok(text.includes("@aphotic/pi-flow-core"), "expected package detail sub-line text");
});

test("buildFullDetailsPlainText contains no ANSI escape sequences", () => {
  const text = buildFullDetailsPlainText(FIXTURE);
  assert.ok(!/\x1b\[/.test(text), "expected no ANSI escape sequences");
});

test("buildFullDetailsPlainText is identical across two calls", () => {
  assert.equal(buildFullDetailsPlainText(FIXTURE), buildFullDetailsPlainText(FIXTURE));
});

// --- parseSnapshotDetails ----------------------------------------------------

test("parseSnapshotDetails round-trips a structured-clone of a valid snapshot", () => {
  const clone = structuredClone(FIXTURE);
  const result = parseSnapshotDetails(clone);
  assert.ok(result !== undefined, "expected a valid snapshot");
  assert.deepEqual(result, FIXTURE);
});

test("parseSnapshotDetails returns undefined for null", () => {
  assert.equal(parseSnapshotDetails(null), undefined);
});

test("parseSnapshotDetails returns undefined for a string", () => {
  assert.equal(parseSnapshotDetails("not an object"), undefined);
});

test("parseSnapshotDetails returns undefined for an object missing a category array", () => {
  const bad = { context: [], prompts: [], skills: [], extensions: [] }; // missing themes
  assert.equal(parseSnapshotDetails(bad), undefined);
});

test("parseSnapshotDetails strips entries without a string name", () => {
  const input = {
    context: [{ name: "ok" }, { name: 42 }, {}],
    prompts: [],
    skills: [],
    extensions: [],
    themes: [],
  };
  const result = parseSnapshotDetails(input);
  assert.ok(result !== undefined);
  assert.deepEqual(result!.context, [{ name: "ok" }]);
});

// --- Renderer ----------------------------------------------------------------

test("createHeaderDetailsRenderer: valid details → component that renders title", () => {
  const renderer = createHeaderDetailsRenderer();
  const fakeTheme = { fg: (t: string, s: string): string => `<${t}:${s}>` };
  const message = { customType: HEADER_DETAILS_MESSAGE_TYPE, details: FIXTURE };
  const component = renderer(message, {}, fakeTheme as never);
  assert.ok(component !== undefined, "expected a component for valid details");
  const rendered = component!.render(80);
  assert.ok(rendered.some((l) => l.includes("<mdHeading:pi header details>")), "expected title line with mdHeading token");
});

test("createHeaderDetailsRenderer: invalid details → renderer returns undefined", () => {
  const renderer = createHeaderDetailsRenderer();
  const fakeTheme = { fg: (t: string, s: string): string => `<${t}:${s}>` };
  const message = { customType: HEADER_DETAILS_MESSAGE_TYPE, details: null };
  const component = renderer(message, {}, fakeTheme as never);
  assert.equal(component, undefined);
});

// --- showHeaderDetails -------------------------------------------------------

test("showHeaderDetails posts one custom message with correct shape", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hd-test-"));
  try {
    const messages: unknown[] = [];
    const fakePi = {
      getCommands: () => [],
      sendMessage: (msg: unknown) => { messages.push(msg); },
    };
    const fakeCtx = {
      cwd: dir,
      ui: {
        getAllThemes: () => [],
        theme: { name: "x", fg: (_: string, s: string): string => s },
      },
    };

    await showHeaderDetails(fakePi as never, fakeCtx as never);

    assert.equal(messages.length, 1, "expected exactly one sendMessage call");
    const msg = messages[0] as Record<string, unknown>;
    assert.equal(msg["customType"], HEADER_DETAILS_MESSAGE_TYPE);
    assert.equal(msg["display"], true);
    assert.ok(typeof msg["content"] === "string", "content should be a string");
    assert.ok((msg["content"] as string).includes(FULL_DETAILS_TITLE), "content should include title");
    assert.ok(parseSnapshotDetails(msg["details"]) !== undefined, "details should parse to a valid snapshot");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- Tag-colorize smoke test -------------------------------------------------

test("buildFullDetailsLines with tag colorize wraps title in mdHeading token", () => {
  const lines = buildFullDetailsLines(FIXTURE, 80, tag);
  assert.ok(lines[0]!.includes("<mdHeading:pi header details>"), "title wrapped in mdHeading");
});

test("buildFullDetailsLines with tag colorize wraps item names in toolOutput token", () => {
  const lines = buildFullDetailsLines(FIXTURE, 80, tag);
  assert.ok(lines.some((l) => l.includes("<toolOutput:brainstorm>")));
});
