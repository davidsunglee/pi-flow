import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkingIndicator,
  pickWorkingIndicatorFrame,
  gleamText,
  rainbowText,
  STATE_EFFECTS,
  PASTEL_RAINBOW_RGB,
  THINKING_RAINBOW_FRAME_MS,
} from "./effects.ts";

function truecolorRgb(text: string): [number, number, number] {
  const match = /\x1b\[(?:1;)?38;2;(\d+);(\d+);(\d+)m/.exec(text);
  assert.ok(match, `expected a truecolor escape in: ${JSON.stringify(text)}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function truecolorRgbs(text: string): [number, number, number][] {
  return [...text.matchAll(/\x1b\[(?:1;)?38;2;(\d+);(\d+);(\d+)m/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
  ]);
}

describe("STATE_EFFECTS", () => {
  it("active has gleam=false rainbow=false", () => {
    assert.deepEqual(STATE_EFFECTS.active, { gleam: false, rainbow: false });
  });
  it("toolUse has gleam=true rainbow=false", () => {
    assert.deepEqual(STATE_EFFECTS.toolUse, { gleam: true, rainbow: false });
  });
  it("thinking has gleam=false rainbow=true", () => {
    assert.deepEqual(STATE_EFFECTS.thinking, { gleam: false, rainbow: true });
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

describe("thinking glyph uses animated rainbow", () => {
  it("cycles a static dot glyph through the base palette at consistent brightness", () => {
    const first = truecolorRgb(pickWorkingIndicatorFrame("dot", "thinking", 0));
    const second = truecolorRgb(pickWorkingIndicatorFrame(
      "dot",
      "thinking",
      THINKING_RAINBOW_FRAME_MS,
    ));
    const lastForward = truecolorRgb(pickWorkingIndicatorFrame(
      "dot",
      "thinking",
      THINKING_RAINBOW_FRAME_MS * (PASTEL_RAINBOW_RGB.length - 1),
    ));
    const firstAgain = truecolorRgb(pickWorkingIndicatorFrame(
      "dot",
      "thinking",
      THINKING_RAINBOW_FRAME_MS * ((PASTEL_RAINBOW_RGB.length - 1) * 2),
    ));

    assert.deepEqual(first, PASTEL_RAINBOW_RGB[0]);
    assert.deepEqual(second, PASTEL_RAINBOW_RGB[1]);
    assert.deepEqual(lastForward, PASTEL_RAINBOW_RGB[PASTEL_RAINBOW_RGB.length - 1]);
    assert.deepEqual(firstAgain, PASTEL_RAINBOW_RGB[0]);
  });

  it("is rainbow-only: no bold/gleam on any spinner frame", () => {
    const { frames, intervalMs } = buildWorkingIndicator("spinner", "thinking");
    const interval = intervalMs!;
    for (let i = 0; i < frames.length; i++) {
      const frame = pickWorkingIndicatorFrame("spinner", "thinking", interval * i);
      assert.doesNotMatch(frame, /\x1b\[1;38;2;/, `frame ${i} should not gleam: ${frame}`);
    }
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
  it('rainbowText("xhigh", 0) uses one animated color across all letters', () => {
    const result = rainbowText("xhigh", 0);
    const rgbs = truecolorRgbs(result);
    assert.ok(rgbs.length >= 1, "text should include a truecolor escape");
    assert.equal(new Set(rgbs.map((rgb) => rgb.join(","))).size, 1);
  });

  it('rainbowText("xhigh", nowMs) cycles through the base palette at consistent brightness', () => {
    const first = truecolorRgb(rainbowText("xhigh", 0));
    const second = truecolorRgb(rainbowText("xhigh", THINKING_RAINBOW_FRAME_MS));
    const lastForward = truecolorRgb(rainbowText(
      "xhigh",
      THINKING_RAINBOW_FRAME_MS * (PASTEL_RAINBOW_RGB.length - 1),
    ));
    const firstAgain = truecolorRgb(rainbowText(
      "xhigh",
      THINKING_RAINBOW_FRAME_MS * ((PASTEL_RAINBOW_RGB.length - 1) * 2),
    ));

    assert.deepEqual(first, PASTEL_RAINBOW_RGB[0]);
    assert.deepEqual(second, PASTEL_RAINBOW_RGB[1]);
    assert.deepEqual(lastForward, PASTEL_RAINBOW_RGB[PASTEL_RAINBOW_RGB.length - 1]);
    assert.deepEqual(firstAgain, PASTEL_RAINBOW_RGB[0]);
  });

  it('rainbowText("xhigh", 0) is not bold', () => {
    const result = rainbowText("xhigh", 0);
    assert.doesNotMatch(result, /\x1b\[1;38/);
  });
  it('rainbowText("", 5) returns ""', () => {
    assert.equal(rainbowText("", 5), "");
  });
});
