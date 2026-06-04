import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  getSessionMessage,
  resolveHeaderLevel,
  applyLogoGradient,
  buildHeaderLines,
  buildCompactRow,
  fitCompactItems,
  installHeader,
  LOGO_VARIANTS,
  type HeaderColorize,
  type HeaderContentInput,
} from "./header.ts";
import type { LogoVariant, TuiSettingsStore, TuiSettings, HeaderDetails } from "./settings.ts";
import { DEFAULT_TUI_SETTINGS } from "./settings.ts";
import type { HeaderResources, ResourceSnapshot, SnapshotSources } from "./header-data.ts";

function fakeStore(logo: LogoVariant, details: HeaderDetails = "compact"): TuiSettingsStore {
  const settings: TuiSettings = { ...DEFAULT_TUI_SETTINGS, header: { logo, details } };
  return {
    get: () => settings,
    subscribe: () => () => {},
    ensureRegistered: () => {},
  };
}

function fakeResources(snapshot?: ResourceSnapshot): HeaderResources & { notify(): void } {
  let stored = snapshot;
  const listeners = new Set<() => void>();
  return {
    get: () => stored,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async refresh(_sources: SnapshotSources) { /* no-op in tests */ },
    notify() {
      for (const l of [...listeners]) {
        try { l(); } catch { /* ignore */ }
      }
    },
  };
}

const tagColorize: HeaderColorize = (t, s) => `<${t}:${s}>`;

describe("getSessionMessage", () => {
  it("maps 'reload' to 'session reloaded'", () => {
    assert.equal(getSessionMessage("reload"), "session reloaded");
  });
  it("maps 'resume' to 'session resumed'", () => {
    assert.equal(getSessionMessage("resume"), "session resumed");
  });
  it("maps 'fork' to 'session forked'", () => {
    assert.equal(getSessionMessage("fork"), "session forked");
  });
  it("returns undefined for 'startup'", () => {
    assert.equal(getSessionMessage("startup"), undefined);
  });
  it("returns undefined for 'new'", () => {
    assert.equal(getSessionMessage("new"), undefined);
  });
  it("returns undefined for empty string", () => {
    assert.equal(getSessionMessage(""), undefined);
  });
  it("returns undefined for 'unknown'", () => {
    assert.equal(getSessionMessage("unknown"), undefined);
  });
});

describe("resolveHeaderLevel", () => {
  it("(false, 'none') → 'none'", () => assert.equal(resolveHeaderLevel(false, "none"), "none"));
  it("(false, 'compact') → 'none'", () => assert.equal(resolveHeaderLevel(false, "compact"), "none"));
  it("(true, 'none') → 'none'", () => assert.equal(resolveHeaderLevel(true, "none"), "none"));
  it("(true, 'compact') → 'compact'", () => assert.equal(resolveHeaderLevel(true, "compact"), "compact"));
});

describe("applyLogoGradient", () => {
  it("wraps non-space chars in truecolor escapes", () => {
    const result = applyLogoGradient(["██", "  "]);
    assert.match(result[0]!, /\x1b\[38;2;\d+;\d+;\d+m/);
    assert.match(result[0]!, /\x1b\[0m/);
  });

  it("passes space characters through unstyled", () => {
    const result = applyLogoGradient(["██", "  "]);
    assert.doesNotMatch(result[1]!, /\x1b\[/);
    assert.equal(result[1], "  ");
  });
});

describe("buildHeaderLines — none level", () => {
  it("every line starts with two spaces or is empty (startup, width 80)", () => {
    const lines = buildHeaderLines({
      version: "0.78.0", reason: "startup", logo: "bracket",
      level: "none", resources: undefined, width: 80, colorize: tagColorize,
    });
    for (const line of lines) {
      assert.ok(
        line === "" || line.startsWith("  "),
        `line should start with two spaces or be empty: ${JSON.stringify(line)}`,
      );
    }
  });

  it("line after logo is '  v0.78.0'", () => {
    const lines = buildHeaderLines({
      version: "0.78.0", reason: "startup", logo: "bracket",
      level: "none", resources: undefined, width: 80, colorize: tagColorize,
    });
    const logoLen = LOGO_VARIANTS.bracket.length;
    assert.equal(lines[logoLen], "  v0.78.0");
  });

  it("no line contains 'hello' or 'a fresh start'", () => {
    const lines = buildHeaderLines({
      version: "0.78.0", reason: "startup", logo: "bracket",
      level: "none", resources: undefined, width: 80, colorize: tagColorize,
    });
    for (const line of lines) {
      assert.ok(!line.includes("hello"), `line must not contain 'hello': ${JSON.stringify(line)}`);
      assert.ok(!line.includes("a fresh start"), `line must not contain 'a fresh start': ${JSON.stringify(line)}`);
    }
  });

  it("last line is empty string", () => {
    const lines = buildHeaderLines({
      version: "0.78.0", reason: "startup", logo: "bracket",
      level: "none", resources: undefined, width: 80, colorize: tagColorize,
    });
    assert.equal(lines[lines.length - 1], "");
  });

  it("reason 'resume' emits session message line immediately after version", () => {
    const lines = buildHeaderLines({
      version: "0.78.0", reason: "resume", logo: "bracket",
      level: "none", resources: undefined, width: 80, colorize: tagColorize,
    });
    const logoLen = LOGO_VARIANTS.bracket.length;
    assert.equal(lines[logoLen], "  v0.78.0");
    assert.ok(
      lines[logoLen + 1]!.includes("<success:session resumed>"),
      `expected session message line, got: ${lines[logoLen + 1]}`,
    );
  });
});

describe("buildHeaderLines — compact level", () => {
  function makeSnapshot(): ResourceSnapshot {
    return {
      context: [{ name: "CLAUDE.md" }],
      prompts: [],
      skills: [{ name: "define-spec" }],
      extensions: [{ name: "pi-flow-ux" }],
      themes: [{ name: "nord", active: true }, { name: "dark" }],
    };
  }

  it("after version comes empty separator then rows in order (no prompts row)", () => {
    const lines = buildHeaderLines({
      version: "0.78.0", reason: "startup", logo: "bracket",
      level: "compact", resources: makeSnapshot(), width: 80, colorize: tagColorize,
    });
    const logoLen = LOGO_VARIANTS.bracket.length;
    assert.equal(lines[logoLen], "  v0.78.0");
    assert.equal(lines[logoLen + 1], "");
    const rowLines = lines.slice(logoLen + 2, -1);
    assert.equal(rowLines.length, 4);
    assert.ok(rowLines[0]!.includes("<mdHeading:context>"), `context row: ${rowLines[0]}`);
    assert.ok(rowLines[1]!.includes("<mdHeading:skills>"), `skills row: ${rowLines[1]}`);
    assert.ok(rowLines[2]!.includes("<mdHeading:extensions>"), `extensions row: ${rowLines[2]}`);
    assert.ok(rowLines[3]!.includes("<mdHeading:themes>"), `themes row: ${rowLines[3]}`);
  });

  it("labels carry mdHeading tag and item text carries toolOutput tag", () => {
    const lines = buildHeaderLines({
      version: "0.78.0", reason: "startup", logo: "bracket",
      level: "compact", resources: makeSnapshot(), width: 80, colorize: tagColorize,
    });
    const contextRow = lines.find((l) => l.includes("<mdHeading:context>"))!;
    assert.ok(contextRow.includes("<toolOutput:CLAUDE.md>"), `context items: ${contextRow}`);
  });

  it("active theme renders as 'nord*'", () => {
    const lines = buildHeaderLines({
      version: "0.78.0", reason: "startup", logo: "bracket",
      level: "compact", resources: makeSnapshot(), width: 80, colorize: tagColorize,
    });
    const themeRow = lines.find((l) => l.includes("<mdHeading:themes>"))!;
    assert.ok(themeRow.includes("nord*"), `theme row should contain 'nord*': ${themeRow}`);
  });

  it("compact with resources undefined equals none-level output", () => {
    const noneLines = buildHeaderLines({
      version: "0.78.0", reason: "startup", logo: "bracket",
      level: "none", resources: undefined, width: 80, colorize: tagColorize,
    });
    const compactUndefined = buildHeaderLines({
      version: "0.78.0", reason: "startup", logo: "bracket",
      level: "compact", resources: undefined, width: 80, colorize: tagColorize,
    });
    assert.deepEqual(compactUndefined, noneLines);
  });
});

describe("fitCompactItems", () => {
  it("returns n when all names fit", () => {
    assert.equal(fitCompactItems(["alpha", "beta", "gamma"], 100), 3);
  });

  it("returns correct k for partial fit", () => {
    // "alpha +2" = 8 chars; available = 8 → k=1
    assert.equal(fitCompactItems(["alpha", "betabeta", "gammagamma"], 8), 1);
  });

  it("returns 0 when available is 0", () => {
    assert.equal(fitCompactItems(["a", "b"], 0), 0);
  });

  it("returns 0 when available is negative", () => {
    assert.equal(fitCompactItems(["a", "b"], -1), 0);
  });

  it("no +N suffix in assembled row when all fit", () => {
    const row = buildCompactRow("ctx", ["a", "b"], 80, (_, s) => s);
    assert.ok(!row.includes("+"), `should not have suffix: ${row}`);
  });

  it("shows correct +N when items are elided", () => {
    // width 20: available = 20 - 2 - 12 = 6
    // "long1 +2" = 8 > 6; "long1, long2 +1" = 15 > 6; "+3" = 2 <= 6 → k=0
    const row = buildCompactRow("ctx", ["long1", "long2", "long3"], 20, (_, s) => s);
    assert.ok(row.includes("+3"), `expected +3 in row: ${row}`);
    assert.ok(!row.includes("long"), `names should be hidden: ${row}`);
  });
});

describe("never-wrap property", () => {
  function makeSnapshotWithLongNames(): ResourceSnapshot {
    return {
      context: [
        { name: "a-very-long-context-file-name.md" },
        { name: "another-long-context-file-name.md" },
      ],
      prompts: [{ name: "very-long-prompt-name-for-testing" }],
      skills: [
        { name: "very-long-skill-name-here" },
        { name: "another-long-skill-name" },
      ],
      extensions: [
        { name: "very-long-extension-package-name" },
        { name: "another-long-extension-name" },
      ],
      themes: [
        { name: "very-long-theme-name-active", active: true },
        { name: "another-long-theme-name" },
      ],
    };
  }

  for (const width of [4, 10, 14, 20, 30, 45, 60, 80]) {
    it(`width ${width}: no line exceeds render width`, () => {
      const lines = buildHeaderLines({
        version: "0.78.0", reason: "startup", logo: "bracket",
        level: "compact", resources: makeSnapshotWithLongNames(), width, colorize: tagColorize,
      });
      for (const line of lines) {
        const vw = visibleWidth(line);
        assert.ok(vw <= width, `visibleWidth(${JSON.stringify(line)}) = ${vw} exceeds ${width}`);
      }
    });
  }
});

describe("determinism", () => {
  it("two identical buildHeaderLines calls produce deepEqual output", () => {
    const input: HeaderContentInput = {
      version: "0.78.0",
      reason: "reload",
      logo: "rounded",
      level: "compact",
      resources: {
        context: [{ name: "file.md" }],
        prompts: [],
        skills: [{ name: "skill-a" }],
        extensions: [{ name: "ext-a" }],
        themes: [{ name: "nord", active: true }],
      },
      width: 80,
      colorize: tagColorize,
    };
    assert.deepEqual(buildHeaderLines(input), buildHeaderLines(input));
  });
});

describe("installHeader", () => {
  it("does not call setHeader when hasUI is false", () => {
    let callCount = 0;
    const ctx = { hasUI: false, ui: { setHeader: () => { callCount++; } } } as any;
    const handle = installHeader(ctx, "startup", fakeStore("bracket"), fakeResources(), false);
    assert.equal(callCount, 0);
    assert.equal(typeof handle.dispose, "function");
  });

  it("calls setHeader once with a factory when hasUI is true", () => {
    let callCount = 0; let arg: unknown;
    const ctx = { hasUI: true, ui: { setHeader: (a: unknown) => { callCount++; arg = a; } } } as any;
    const handle = installHeader(ctx, "startup", fakeStore("rounded"), fakeResources(), false);
    assert.equal(callCount, 1);
    assert.equal(typeof arg, "function");
    assert.equal(typeof handle.dispose, "function");
  });

  it("factory renders via buildHeaderLines", () => {
    let factory: any;
    const ctx = {
      hasUI: true,
      ui: {
        setHeader: (f: any) => { factory = f; },
        theme: { fg: (_t: string, s: string) => s },
      },
    } as any;
    installHeader(ctx, "startup", fakeStore("squared"), fakeResources(), false);
    const tui = { requestRender: () => {} } as any;
    const component = factory(tui);
    const out = component.render(80);
    assert.ok(
      out.slice(0, LOGO_VARIANTS.squared.length).some((l: string) => /\x1b\[38;2;/.test(l)),
      "render output should include gradient logo",
    );
  });

  it("factory subscribes to resources and tui.requestRender is called on notify", () => {
    let factory: any;
    let renders = 0;
    const tui = { requestRender: () => { renders++; } } as any;
    const resources = fakeResources();
    const ctx = {
      hasUI: true,
      ui: {
        setHeader: (f: any) => { factory = f; },
        theme: { fg: (_t: string, s: string) => s },
      },
    } as any;
    installHeader(ctx, "startup", fakeStore("bracket"), resources, false);
    factory(tui);
    resources.notify();
    assert.equal(renders, 1);
  });

  it("dispose calls setHeader(undefined)", () => {
    const calls: unknown[] = [];
    const ctx = {
      hasUI: true,
      ui: {
        setHeader: (a: unknown) => { calls.push(a); },
        theme: { fg: (_t: string, s: string) => s },
      },
    } as any;
    const handle = installHeader(ctx, "startup", fakeStore("bracket"), fakeResources(), false);
    handle.dispose();
    assert.equal(calls.length, 2);
    assert.equal(calls[1], undefined);
  });

  it("factory calls tui.requestRender when the store emits", () => {
    let storedListener: (() => void) | undefined;
    const store: TuiSettingsStore = {
      get: () => ({ ...DEFAULT_TUI_SETTINGS, header: { logo: "squared" as const, details: "compact" as const } }),
      subscribe: (fn) => { storedListener = fn as any; return () => {}; },
      ensureRegistered: () => {},
    };
    let renders = 0;
    const tui = { requestRender: () => { renders++; } } as any;
    const ctx = {
      hasUI: true,
      ui: {
        setHeader: (f: any) => f(tui),
        theme: { fg: (_t: string, s: string) => s },
      },
    } as any;
    installHeader(ctx, "startup", store, fakeResources(), false);
    assert.ok(storedListener, "store.subscribe should have been called");
    storedListener!();
    assert.equal(renders, 1);
  });
});
