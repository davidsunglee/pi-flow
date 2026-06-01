import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkingIndicator,
  pickWorkingIndicatorFrame,
  gleamText,
  rainbowText,
  STATE_EFFECTS,
} from "./effects.ts";

describe("STATE_EFFECTS", () => {
  it("active has gleam=false rainbow=false", () => {
    assert.deepEqual(STATE_EFFECTS.active, { gleam: false, rainbow: false });
  });
  it("toolUse has gleam=true rainbow=false", () => {
    assert.deepEqual(STATE_EFFECTS.toolUse, { gleam: true, rainbow: false });
  });
  it("thinking has gleam=true rainbow=true", () => {
    assert.deepEqual(STATE_EFFECTS.thinking, { gleam: true, rainbow: true });
  });
});

describe("pickWorkingIndicatorFrame - dot is static", () => {
  it("dot active at nowMs=0 equals frames[0]", () => {
    const { frames } = buildWorkingIndicator("dot", "active");
    assert.equal(pickWorkingIndicatorFrame("dot", "active", 0), frames[0]);
  });
  it("dot active at nowMs=999999 still equals frames[0]", () => {
    const { frames } = buildWorkingIndicator("dot", "active");
    assert.equal(pickWorkingIndicatorFrame("dot", "active", 999999), frames[0]);
  });
});

describe("pickWorkingIndicatorFrame - spinner advances and wraps", () => {
  it("advances to frames[1] at nowMs=interval", () => {
    const { frames, intervalMs } = buildWorkingIndicator("spinner", "active");
    const interval = intervalMs!;
    assert.equal(pickWorkingIndicatorFrame("spinner", "active", interval), frames[1]);
  });
  it("wraps back to frames[0] at nowMs=interval*frames.length", () => {
    const { frames, intervalMs } = buildWorkingIndicator("spinner", "active");
    const interval = intervalMs!;
    assert.equal(
      pickWorkingIndicatorFrame("spinner", "active", interval * frames.length),
      frames[0],
    );
  });
});

describe("active glyph is plain (no bold)", () => {
  it("matches 38;2; color code", () => {
    const frame = pickWorkingIndicatorFrame("spinner", "active", 0);
    assert.match(frame, /\x1b\[38;2;/);
  });
  it("does not use bold (no 1;38;2;)", () => {
    const frame = pickWorkingIndicatorFrame("spinner", "active", 0);
    assert.doesNotMatch(frame, /\x1b\[1;38;2;/);
  });
});

describe("toolUse glyph gleams at mid frame", () => {
  it("mid frame uses bold truecolor", () => {
    const { frames, intervalMs } = buildWorkingIndicator("spinner", "toolUse");
    const interval = intervalMs!;
    const midFrame = pickWorkingIndicatorFrame(
      "spinner",
      "toolUse",
      interval * Math.floor(frames.length / 2),
    );
    assert.match(midFrame, /\x1b\[1;38;2;/);
  });
});

describe("thinking glyph uses rainbow", () => {
  it("first spinner frame at nowMs=0 contains the first PASTEL_RAINBOW_RGB stop", () => {
    const frame = pickWorkingIndicatorFrame("spinner", "thinking", 0);
    assert.ok(frame.includes("38;2;255;179;186"), `Expected first rainbow stop in: ${frame}`);
  });
});

describe("gleamText", () => {
  it('gleamText("model", 0) contains bold truecolor shine', () => {
    const result = gleamText("model", 0);
    assert.ok(result.length > 0);
    assert.match(result, /\x1b\[1;38;2;/);
  });
  it('gleamText("", 5) returns ""', () => {
    assert.equal(gleamText("", 5), "");
  });
});

describe("rainbowText", () => {
  it('rainbowText("xhigh", 0) uses first PASTEL_RAINBOW_RGB stop for first char', () => {
    const result = rainbowText("xhigh", 0);
    assert.match(result, /\x1b\[38;2;255;179;186m/);
  });
  it('rainbowText("xhigh", 0) is not bold', () => {
    const result = rainbowText("xhigh", 0);
    assert.doesNotMatch(result, /\x1b\[1;38/);
  });
  it('rainbowText("", 5) returns ""', () => {
    assert.equal(rainbowText("", 5), "");
  });
});
