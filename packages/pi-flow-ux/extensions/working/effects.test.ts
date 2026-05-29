import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkingIndicator,
  pickWorkingIndicatorFrame,
} from "./effects.ts";
import type { WorkingStyle } from "./working.ts";

const plainStyle: WorkingStyle = { color: "#81A1C1", gleam: false, rainbow: false };
const gleamStyle: WorkingStyle = { color: "#81A1C1", gleam: true, rainbow: false };

test("pickWorkingIndicatorFrame returns the single static frame for a one-frame shape", () => {
  const frames = buildWorkingIndicator("dot", plainStyle).frames ?? [];
  assert.equal(pickWorkingIndicatorFrame("dot", plainStyle, 0), frames[0]);
  // A static shape never advances regardless of elapsed time.
  assert.equal(pickWorkingIndicatorFrame("dot", plainStyle, 999999), frames[0]);
});

test("pickWorkingIndicatorFrame advances spinner frames with elapsed time", () => {
  const { frames, intervalMs } = buildWorkingIndicator("spinner", plainStyle);
  const list = frames ?? [];
  const interval = intervalMs ?? 120;
  assert.equal(pickWorkingIndicatorFrame("spinner", plainStyle, 0), list[0]);
  assert.equal(pickWorkingIndicatorFrame("spinner", plainStyle, interval), list[1]);
  // Wraps around the frame list.
  assert.equal(
    pickWorkingIndicatorFrame("spinner", plainStyle, interval * list.length),
    list[0],
  );
});

test("pickWorkingIndicatorFrame preserves gleam styling from the shared frame generator", () => {
  const { frames, intervalMs } = buildWorkingIndicator("spinner", gleamStyle);
  const list = frames ?? [];
  const interval = intervalMs ?? 120;
  // The gleam shine brightens the mid-list frame with a bold truecolor escape,
  // exactly as buildWorkingIndicator produces it. Land on that frame and verify
  // the picker hands back the same styled glyph.
  const mid = Math.floor(list.length / 2);
  const frame = pickWorkingIndicatorFrame("spinner", gleamStyle, interval * mid);
  assert.equal(frame, list[mid]);
  assert.match(frame, /\x1b\[1;38;2;/);
});
