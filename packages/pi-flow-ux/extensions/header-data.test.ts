import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import type { ResolvedPaths, SlashCommandInfo } from "@earendil-works/pi-coding-agent";

import {
  CATEGORY_ORDER,
  HEADER_MARGIN,
  abbreviatePath,
  collectResourceSnapshot,
  createHeaderResources,
  detailForSourcePath,
  emptyResourceSnapshot,
  extensionDisplayName,
  packageEntryFromPath,
  type SnapshotSources,
} from "./header-data.ts";

const sep = path.sep;
const j = (...parts: string[]) => parts.join(sep);

test("CATEGORY_ORDER lists the five categories in display order", () => {
  assert.deepEqual([...CATEGORY_ORDER], ["context", "prompts", "skills", "extensions", "themes"]);
});

test("emptyResourceSnapshot has an empty array per category", () => {
  const snapshot = emptyResourceSnapshot();
  for (const category of CATEGORY_ORDER) assert.deepEqual(snapshot[category], []);
});

test("HEADER_MARGIN is two spaces", () => {
  assert.equal(HEADER_MARGIN, "  ");
});

test("abbreviatePath makes paths under cwd project-relative", () => {
  assert.equal(abbreviatePath(j("", "repo", "src", "a.ts"), j("", "repo"), j("", "home", "u")), j("src", "a.ts"));
});

test("abbreviatePath maps the exact cwd to '.'", () => {
  assert.equal(abbreviatePath(j("", "repo"), j("", "repo"), j("", "home", "u")), ".");
});

test("abbreviatePath tilde-abbreviates paths under home", () => {
  assert.equal(
    abbreviatePath(j("", "home", "u", ".pi", "agent", "tui.json"), j("", "repo"), j("", "home", "u")),
    `~${sep}${j(".pi", "agent", "tui.json")}`,
  );
});

test("abbreviatePath maps the exact home dir to '~'", () => {
  assert.equal(abbreviatePath(j("", "home", "u"), j("", "repo"), j("", "home", "u")), "~");
});

test("abbreviatePath leaves unrelated absolute paths unchanged", () => {
  assert.equal(abbreviatePath(j("", "opt", "x"), j("", "repo"), j("", "home", "u")), j("", "opt", "x"));
});

test("abbreviatePath does not treat empty cwd or home as a universal prefix", () => {
  assert.equal(abbreviatePath(j("", "opt", "x"), "", ""), j("", "opt", "x"));
});

test("abbreviatePath does not match a sibling sharing the cwd as a string prefix", () => {
  assert.equal(abbreviatePath(j("", "repo-other", "a.ts"), j("", "repo"), j("", "home", "u")), j("", "repo-other", "a.ts"));
});

test("packageEntryFromPath parses a scoped node_modules entry", () => {
  assert.deepEqual(packageEntryFromPath("/x/node_modules/@aphotic/pi-flow-ux/extensions/index.ts"), {
    packageName: "@aphotic/pi-flow-ux",
    shortName: "pi-flow-ux",
    relPath: "extensions/index.ts",
  });
});

test("packageEntryFromPath parses an unscoped node_modules entry", () => {
  assert.deepEqual(packageEntryFromPath("/x/node_modules/leftpad/lib/main.js"), {
    packageName: "leftpad",
    shortName: "leftpad",
    relPath: "lib/main.js",
  });
});

test("packageEntryFromPath uses the LAST node_modules segment", () => {
  assert.deepEqual(packageEntryFromPath("/x/node_modules/outer/node_modules/@s/inner/a.ts"), {
    packageName: "@s/inner",
    shortName: "inner",
    relPath: "a.ts",
  });
});

test("packageEntryFromPath yields an empty relPath when the path is the package dir", () => {
  assert.deepEqual(packageEntryFromPath("/x/node_modules/@aphotic/pi-flow-ux"), {
    packageName: "@aphotic/pi-flow-ux",
    shortName: "pi-flow-ux",
    relPath: "",
  });
});

test("packageEntryFromPath returns undefined without a node_modules segment", () => {
  assert.equal(packageEntryFromPath("/repo/packages/pi-flow-ux/extensions/index.ts"), undefined);
});

test("packageEntryFromPath returns undefined when nothing follows node_modules", () => {
  assert.equal(packageEntryFromPath("/x/node_modules"), undefined);
  assert.equal(packageEntryFromPath("/x/node_modules/"), undefined);
});

test("extensionDisplayName uses the package short name for node_modules entries", () => {
  assert.equal(extensionDisplayName("/x/node_modules/@aphotic/pi-ideas/extensions/index.ts"), "pi-ideas");
});

test("extensionDisplayName strips the extension of a plain entry file", () => {
  assert.equal(extensionDisplayName(j("", "home", "u", ".pi", "agent", "extensions", "foo.ts")), "foo");
});

test("extensionDisplayName names index entries after the package dir above extensions/", () => {
  assert.equal(extensionDisplayName(j("", "repo", "packages", "pi-flow-ux", "extensions", "index.ts")), "pi-flow-ux");
});

test("extensionDisplayName names index entries after their parent dir", () => {
  assert.equal(extensionDisplayName(j("", "repo", "widgets", "index.ts")), "widgets");
});

test("extensionDisplayName uses the basename for a bare directory path", () => {
  assert.equal(extensionDisplayName(j("", "repo", "tools", "my-ext")), "my-ext");
});

test("detailForSourcePath prefers the full package name for packaged sources", () => {
  assert.equal(
    detailForSourcePath("/x/node_modules/@aphotic/pi-flow-core/skills/define-spec/SKILL.md", j("", "repo"), j("", "home", "u")),
    "@aphotic/pi-flow-core",
  );
});

test("detailForSourcePath abbreviates non-packaged source paths", () => {
  assert.equal(
    detailForSourcePath(j("", "home", "u", ".pi", "agent", "skills", "x", "SKILL.md"), j("", "repo"), j("", "home", "u")),
    `~${sep}${j(".pi", "agent", "skills", "x", "SKILL.md")}`,
  );
});

// --- collectResourceSnapshot -------------------------------------------------

const EMPTY_RESOLVED: ResolvedPaths = { extensions: [], skills: [], prompts: [], themes: [] };

function resolvedResource(p: string, enabled = true): ResolvedPaths["extensions"][number] {
  return { path: p, enabled, metadata: { source: p, scope: "user", origin: "package" } };
}

function command(name: string, source: SlashCommandInfo["source"], sourcePath: string): SlashCommandInfo {
  return { name, source, sourceInfo: { path: sourcePath, source: sourcePath, scope: "user", origin: "package" } };
}

function stubSources(overrides: Partial<SnapshotSources> = {}): SnapshotSources {
  return {
    cwd: "/repo",
    homeDir: "/home/u",
    getCommands: () => [],
    getAllThemes: () => [],
    getActiveThemeName: () => undefined,
    loadContextFiles: () => [],
    resolveConfiguredPaths: async () => EMPTY_RESOLVED,
    ...overrides,
  };
}

test("collectResourceSnapshot maps skill and prompt commands and ignores extension commands", async () => {
  const snapshot = await collectResourceSnapshot(stubSources({
    getCommands: () => [
      command("skill:define-spec", "skill", "/x/node_modules/@aphotic/pi-flow-core/skills/define-spec/SKILL.md"),
      command("skill:brainstorm", "skill", "/home/u/.pi/agent/skills/brainstorm/SKILL.md"),
      command("review", "prompt", "/repo/.pi/prompts/review.md"),
      command("tui", "extension", "/x/node_modules/@aphotic/pi-flow-ux/extensions/index.ts"),
    ],
  }));
  assert.deepEqual(snapshot.skills, [
    { name: "brainstorm", detail: "~/.pi/agent/skills/brainstorm/SKILL.md" },
    { name: "define-spec", detail: "@aphotic/pi-flow-core" },
  ]);
  assert.deepEqual(snapshot.prompts, [{ name: "review", detail: ".pi/prompts/review.md" }]);
});

test("collectResourceSnapshot sorts skill names code-unit ascending", async () => {
  const snapshot = await collectResourceSnapshot(stubSources({
    getCommands: () => [
      command("skill:zeta", "skill", "/repo/skills/zeta/SKILL.md"),
      command("skill:Beta", "skill", "/repo/skills/Beta/SKILL.md"),
      command("skill:alpha", "skill", "/repo/skills/alpha/SKILL.md"),
    ],
  }));
  // Code-unit order puts uppercase before lowercase (locale-independent).
  assert.deepEqual(snapshot.skills.map((i) => i.name), ["Beta", "alpha", "zeta"]);
});

test("collectResourceSnapshot maps enabled extensions with package/path details", async () => {
  const snapshot = await collectResourceSnapshot(stubSources({
    resolveConfiguredPaths: async () => ({
      ...EMPTY_RESOLVED,
      extensions: [
        resolvedResource("/x/node_modules/@aphotic/pi-disabled/extensions/index.ts", false),
        resolvedResource("/x/node_modules/@aphotic/pi-flow-ux/extensions/index.ts"),
        resolvedResource("/home/u/.pi/agent/extensions/foo.ts"),
      ],
    }),
  }));
  assert.deepEqual(snapshot.extensions, [
    { name: "foo", detail: "~/.pi/agent/extensions/foo.ts" },
    { name: "pi-flow-ux", detail: "extensions/index.ts" },
  ]);
});

const THEME_RESOLVED: ResolvedPaths = {
  ...EMPTY_RESOLVED,
  themes: [
    resolvedResource("/x/themes/nord.json"),
    resolvedResource("/x/themes/catppuccin.json"),
    resolvedResource("/x/themes/disabled.json", false),
  ],
};
const ALL_THEMES = [
  { name: "dark", path: "/pi/dist/themes/dark.json" },
  { name: "nord", path: "/x/themes/nord.json" },
  { name: "catppuccin", path: "/x/themes/catppuccin.json" },
];

test("collectResourceSnapshot keeps known themes plus the active one, active first", async () => {
  const snapshot = await collectResourceSnapshot(stubSources({
    resolveConfiguredPaths: async () => THEME_RESOLVED,
    getAllThemes: () => ALL_THEMES,
    getActiveThemeName: () => "nord",
  }));
  assert.deepEqual(snapshot.themes, [
    { name: "nord", active: true, detail: "/x/themes/nord.json" },
    { name: "catppuccin", active: false, detail: "/x/themes/catppuccin.json" },
  ]);
});

test("collectResourceSnapshot includes an unknown active theme, listed first", async () => {
  const snapshot = await collectResourceSnapshot(stubSources({
    resolveConfiguredPaths: async () => THEME_RESOLVED,
    getAllThemes: () => ALL_THEMES,
    getActiveThemeName: () => "dark",
  }));
  assert.deepEqual(snapshot.themes.map((i) => i.name), ["dark", "catppuccin", "nord"]);
  assert.deepEqual(snapshot.themes[0], { name: "dark", active: true, detail: "/pi/dist/themes/dark.json" });
});

test("collectResourceSnapshot preserves context file order and abbreviates names", async () => {
  const snapshot = await collectResourceSnapshot(stubSources({
    loadContextFiles: () => [
      { path: "/home/u/.pi/agent/AGENTS.md" },
      { path: "/repo/AGENTS.md" },
      { path: "/repo/packages/a/AGENTS.md" },
    ],
  }));
  assert.deepEqual(snapshot.context, [
    { name: "~/.pi/agent/AGENTS.md" },
    { name: "AGENTS.md" },
    { name: "packages/a/AGENTS.md" },
  ]);
});

test("collectResourceSnapshot degrades failing sources to empty categories", async () => {
  const snapshot = await collectResourceSnapshot(stubSources({
    getCommands: () => { throw new Error("boom"); },
    resolveConfiguredPaths: async () => { throw new Error("nope"); },
    loadContextFiles: () => [{ path: "/repo/AGENTS.md" }],
    getAllThemes: () => [{ name: "nord", path: "/x/themes/nord.json" }],
    getActiveThemeName: () => "nord",
  }));
  assert.deepEqual(snapshot.skills, []);
  assert.deepEqual(snapshot.prompts, []);
  assert.deepEqual(snapshot.extensions, []);
  assert.deepEqual(snapshot.context, [{ name: "AGENTS.md" }]);
  // resolveConfiguredPaths failed, so only the active theme survives the known-set check.
  assert.deepEqual(snapshot.themes, [{ name: "nord", active: true, detail: "/x/themes/nord.json" }]);
});

test("collectResourceSnapshot survives every source failing", async () => {
  const snapshot = await collectResourceSnapshot(stubSources({
    getCommands: () => { throw new Error("a"); },
    getAllThemes: () => { throw new Error("b"); },
    getActiveThemeName: () => { throw new Error("c"); },
    loadContextFiles: () => { throw new Error("d"); },
    resolveConfiguredPaths: async () => { throw new Error("e"); },
  }));
  assert.deepEqual(snapshot, emptyResourceSnapshot());
});

// --- HeaderResources holder --------------------------------------------------

test("createHeaderResources holds undefined until refresh resolves, then notifies", async () => {
  const holder = createHeaderResources();
  assert.equal(holder.get(), undefined);
  let fired = 0;
  holder.subscribe(() => { fired++; });
  await holder.refresh(stubSources({ loadContextFiles: () => [{ path: "/repo/AGENTS.md" }] }));
  assert.equal(fired, 1);
  assert.deepEqual(holder.get()?.context, [{ name: "AGENTS.md" }]);
});

test("createHeaderResources does not notify unsubscribed listeners", async () => {
  const holder = createHeaderResources();
  let fired = 0;
  const unsubscribe = holder.subscribe(() => { fired++; });
  unsubscribe();
  await holder.refresh(stubSources());
  assert.equal(fired, 0);
});

test("createHeaderResources isolates a throwing listener", async () => {
  const holder = createHeaderResources();
  let fired = 0;
  holder.subscribe(() => { throw new Error("listener boom"); });
  holder.subscribe(() => { fired++; });
  await holder.refresh(stubSources());
  assert.equal(fired, 1);
});
