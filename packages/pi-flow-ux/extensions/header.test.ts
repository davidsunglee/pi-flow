import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  humanizeStartupReason,
  applyLogoGradient,
  buildHeaderLines,
  installHeader,
  LOGO_VARIANTS,
  type SessionStartReason,
} from "./header.ts";
import type { LogoVariant, TuiSettingsStore, TuiSettings } from "./settings.ts";
import { DEFAULT_TUI_SETTINGS } from "./settings.ts";

function fakeStore(logo: LogoVariant): TuiSettingsStore {
  const settings: TuiSettings = { ...DEFAULT_TUI_SETTINGS, header: { logo } };
  return {
    get: () => settings,
    subscribe: () => () => {},
    ensureRegistered: () => {},
  };
}

describe("humanizeStartupReason", () => {
  const cases: [SessionStartReason, string][] = [
    ["startup", "hello"],
    ["reload", "session reloaded"],
    ["new", "a fresh start"],
    ["resume", "session resumed"],
    ["fork", "session forked"],
  ];
  for (const [reason, label] of cases) {
    it(`maps "${reason}" to "${label}"`, () => {
      assert.equal(humanizeStartupReason(reason), label);
    });
  }
  it("returns fallback for unknown token", () => {
    assert.equal(humanizeStartupReason("unknown-token"), "hello");
    assert.equal(humanizeStartupReason(""), "hello");
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
  it("default variant (bracket) renders the bracket wordmark with gradient", () => {
    const lines = buildHeaderLines("0.78.0", "startup");
    const logoRows = lines.length - 2; // minus version, reason
    assert.equal(logoRows, LOGO_VARIANTS.bracket.length);
    assert.match(lines[0]!, /\x1b\[38;2;\d+;\d+;\d+m/);
  });

  it("renders each variant with the correct row count and gradient", () => {
    for (const variant of Object.keys(LOGO_VARIANTS) as LogoVariant[]) {
      const lines = buildHeaderLines("0.78.0", "startup", variant);
      const expectedLogoRows = LOGO_VARIANTS[variant].length;
      assert.equal(lines.length - 2, expectedLogoRows, `${variant}: wrong total line count`);
      assert.ok(
        lines.slice(0, expectedLogoRows).some((l) => /\x1b\[38;2;\d+;\d+;\d+m/.test(l)),
        `${variant} should have gradient escapes`,
      );
    }
  });

  it("unknown variant falls back to bracket", () => {
    const lines = buildHeaderLines("0.78.0", "startup", "nope" as LogoVariant);
    assert.equal(lines.length - 2, LOGO_VARIANTS.bracket.length);
  });

  it("places the version immediately after the logo", () => {
    const lines = buildHeaderLines("0.78.0", "startup");
    const expectedLogoRows = LOGO_VARIANTS.bracket.length;
    assert.equal(lines[expectedLogoRows], "version 0.78.0");
    assert.equal(lines[expectedLogoRows + 1], humanizeStartupReason("startup"));
  });
});

describe("installHeader", () => {
  it("does not call setHeader when hasUI is false", () => {
    let callCount = 0;
    const ctx = { hasUI: false, ui: { setHeader: () => { callCount++; } } } as any;
    const handle = installHeader(ctx, "startup", fakeStore("bracket"));
    assert.equal(callCount, 0);
    assert.equal(typeof handle.dispose, "function");
  });

  it("calls setHeader once with a factory when hasUI is true", () => {
    let callCount = 0; let arg: unknown;
    const ctx = { hasUI: true, ui: { setHeader: (a: unknown) => { callCount++; arg = a; } } } as any;
    const handle = installHeader(ctx, "startup", fakeStore("rounded"));
    assert.equal(callCount, 1);
    assert.equal(typeof arg, "function");
    assert.equal(typeof handle.dispose, "function");
  });

  it("factory renders the store's variant and subscribes for re-render", () => {
    let factory: any;
    const tui = { requestRender: () => {} } as any;
    const ctx = { hasUI: true, ui: { setHeader: (f: any) => { factory = f; } } } as any;
    installHeader(ctx, "startup", fakeStore("squared"));
    const component = factory(tui, {});
    const out = component.render(80);
    assert.ok(out.slice(0, LOGO_VARIANTS.squared.length).some((l: string) => /\x1b\[38;2;/.test(l)));
  });

  it("dispose calls setHeader(undefined)", () => {
    const calls: unknown[] = [];
    const ctx = { hasUI: true, ui: { setHeader: (a: unknown) => { calls.push(a); } } } as any;
    const handle = installHeader(ctx, "startup", fakeStore("bracket"));
    handle.dispose();
    assert.equal(calls.length, 2);
    assert.equal(calls[1], undefined);
  });

  it("factory calls tui.requestRender when the store emits", () => {
    let storedListener: ((s: TuiSettings) => void) | undefined;
    const store: TuiSettingsStore = {
      get: () => ({ ...DEFAULT_TUI_SETTINGS, header: { logo: "squared" as const } }),
      subscribe: (fn) => { storedListener = fn; return () => {}; },
      ensureRegistered: () => {},
    };
    let renders = 0;
    const tui = { requestRender: () => { renders++; } } as any;
    const ctx = { hasUI: true, ui: { setHeader: (f: any) => f(tui, {}) } } as any;
    installHeader(ctx, "startup", store);
    assert.ok(storedListener, "subscribe should have been called");
    storedListener!({ ...DEFAULT_TUI_SETTINGS, header: { logo: "squared" } });
    assert.equal(renders, 1);
  });
});
