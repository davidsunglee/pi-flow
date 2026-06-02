import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
  humanizeStartupReason,
  applyLogoGradient,
  buildHeaderLines,
  installHeader,
  type SessionStartReason,
} from "./header.ts";

describe("humanizeStartupReason", () => {
  const cases: [SessionStartReason, string][] = [
    ["startup", "fresh start"],
    ["reload", "reloaded"],
    ["new", "new session"],
    ["resume", "resumed session"],
    ["fork", "forked session"],
  ];
  for (const [reason, label] of cases) {
    it(`maps "${reason}" to "${label}"`, () => {
      assert.equal(humanizeStartupReason(reason), label);
    });
  }
  it("returns fallback for unknown token", () => {
    assert.equal(humanizeStartupReason("unknown-token"), "session started");
    assert.equal(humanizeStartupReason(""), "session started");
  });
});

describe("applyLogoGradient", () => {
  it("wraps non-space chars in truecolor escapes", () => {
    const result = applyLogoGradient(["██", "  "]);
    // Non-space chars should have truecolor escapes
    assert.match(result[0]!, /\x1b\[38;2;\d+;\d+;\d+m/);
    // Should also have reset codes
    assert.match(result[0]!, /\x1b\[0m/);
  });

  it("passes space characters through unstyled", () => {
    const result = applyLogoGradient(["██", "  "]);
    // The second line (all spaces) should have no escape sequences
    assert.doesNotMatch(result[1]!, /\x1b\[/);
    assert.equal(result[1], "  ");
  });

  it("handles single-char lines", () => {
    const result = applyLogoGradient(["█"]);
    assert.match(result[0]!, /\x1b\[38;2;\d+;\d+;\d+m/);
  });
});

describe("buildHeaderLines", () => {
  let lines: string[];

  before(() => {
    lines = buildHeaderLines("0.78.0", "startup");
  });

  it("first lines (the logo) contain truecolor escapes", () => {
    // Logo has 4 lines
    const logoLines = lines.slice(0, 4);
    const hasEscape = logoLines.some((l) => /\x1b\[38;2;\d+;\d+;\d+m/.test(l));
    assert.ok(hasEscape, "Expected at least one logo line with truecolor escapes");
  });

  it("contains an empty blank separator line", () => {
    assert.ok(lines.includes(""), "Expected a blank separator line");
  });

  it("contains the version line", () => {
    assert.ok(lines.includes("version 0.78.0"), "Expected 'version 0.78.0' line");
  });

  it("last line equals humanizeStartupReason('startup')", () => {
    assert.equal(lines[lines.length - 1], humanizeStartupReason("startup"));
  });
});

describe("installHeader", () => {
  it("does not call setHeader when hasUI is false", () => {
    let callCount = 0;
    const ctx = {
      hasUI: false,
      ui: {
        setHeader: () => { callCount++; },
      },
    } as any;
    const handle = installHeader(ctx, "startup");
    assert.equal(callCount, 0, "setHeader should not be called when hasUI is false");
    assert.ok(handle, "Should return a handle");
    assert.equal(typeof handle.dispose, "function");
  });

  it("calls setHeader once when hasUI is true", () => {
    let callCount = 0;
    let setHeaderArg: unknown;
    const ctx = {
      hasUI: true,
      ui: {
        setHeader: (arg: unknown) => { callCount++; setHeaderArg = arg; },
      },
    } as any;
    const handle = installHeader(ctx, "startup");
    assert.equal(callCount, 1, "setHeader should be called once when hasUI is true");
    assert.equal(typeof setHeaderArg, "function", "setHeader should be called with a function");
    assert.ok(handle, "Should return a handle");
    assert.equal(typeof handle.dispose, "function");
  });

  it("dispose calls setHeader(undefined)", () => {
    const setHeaderCalls: unknown[] = [];
    const ctx = {
      hasUI: true,
      ui: {
        setHeader: (arg: unknown) => { setHeaderCalls.push(arg); },
      },
    } as any;
    const handle = installHeader(ctx, "startup");
    handle.dispose();
    assert.equal(setHeaderCalls.length, 2);
    assert.equal(setHeaderCalls[1], undefined);
  });
});
