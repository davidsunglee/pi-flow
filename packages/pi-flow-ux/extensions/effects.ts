import type { IndicatorShape } from "./settings.ts";
import type { WorkingState } from "./working.ts";

export const PASTEL_RAINBOW_RGB: [number, number, number][] = [
  [255, 179, 186],
  [255, 223, 186],
  [255, 255, 186],
  [186, 255, 201],
  [186, 225, 255],
  [218, 186, 255],
];

const RESET = "\x1b[0m";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PULSE_FRAMES = ["·", "•", "●", "•"];
const DOT_FRAMES = ["●"];
const WAVE_FRAMES = ["∼", "≈", "≋", "≈"];

const SPINNER_INTERVAL_MS = 160;
const PULSE_INTERVAL_MS = 240;
const WAVE_INTERVAL_MS = 240;

export const DEFAULT_INDICATOR_INTERVAL_MS = 120;

export const DEFAULT_WORKING_RGB: [number, number, number] = [129, 161, 193];
const GLEAM_FRAME_MS = 120;

export interface IndicatorFrames { frames: string[]; intervalMs?: number; }

function brighten(rgb: [number, number, number], factor: number): [number, number, number] {
  return rgb.map((c) => Math.round(c + (255 - c) * factor)) as [number, number, number];
}

function color(rgb: [number, number, number], bold = false): string {
  return `\x1b[${bold ? "1;" : ""}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function colorizeGleam(text: string, rgb: [number, number, number], shinePos: number): string {
  return (
    [...text]
      .map((char, index) => {
        const dist = Math.abs(index - shinePos);
        let factor = 0;
        if (dist === 0) factor = 0.45;
        else if (dist === 1) factor = 0.2;
        return `${color(brighten(rgb, factor), dist <= 1)}${char}`;
      })
      .join("") + RESET
  );
}

function colorizeRainbow(text: string, shinePos: number, gleam: boolean): string {
  return (
    [...text]
      .map((char, index) => {
        const base = PASTEL_RAINBOW_RGB[index % PASTEL_RAINBOW_RGB.length]!;
        const dist = Math.abs(index - shinePos);
        const factor = gleam && dist === 0 ? 0.7 : gleam && dist === 1 ? 0.35 : 0;
        return `${color(brighten(base, factor), gleam && dist <= 1)}${char}`;
      })
      .join("") + RESET
  );
}

function getIndicatorGlyphs(shape: IndicatorShape): { glyphs: string[]; intervalMs?: number } {
  switch (shape) {
    case "dot":
      return { glyphs: DOT_FRAMES };
    case "pulse":
      return { glyphs: PULSE_FRAMES, intervalMs: PULSE_INTERVAL_MS };
    case "spinner":
      return { glyphs: SPINNER_FRAMES, intervalMs: SPINNER_INTERVAL_MS };
    case "wave":
      return { glyphs: WAVE_FRAMES, intervalMs: WAVE_INTERVAL_MS };
  }
}

// Per-state activity-slot treatment. These are now fixed constants, independent of any active theme:
//   active   → plain accent (no gleam, no rainbow)
//   toolUse  → gleam
//   thinking → gleam + rainbow
export const STATE_EFFECTS: Record<WorkingState, { gleam: boolean; rainbow: boolean }> = {
  active: { gleam: false, rainbow: false },
  toolUse: { gleam: true, rainbow: false },
  thinking: { gleam: true, rainbow: true },
};

function styleIndicatorFrame(glyph: string, index: number, total: number, state: WorkingState): string {
  const { gleam, rainbow } = STATE_EFFECTS[state];
  if (rainbow) {
    const base = PASTEL_RAINBOW_RGB[index % PASTEL_RAINBOW_RGB.length]!;
    const mid = Math.floor(total / 2);
    const factor = gleam && Math.abs(index - mid) <= 1 ? (index === mid ? 0.4 : 0.2) : 0;
    return `${color(brighten(base, factor), gleam && Math.abs(index - mid) <= 1)}${glyph}${RESET}`;
  }
  const base = DEFAULT_WORKING_RGB;
  if (!gleam) return `${color(base)}${glyph}${RESET}`;
  const mid = Math.floor(total / 2);
  const dist = Math.abs(index - mid);
  const factor = dist === 0 ? 0.45 : dist === 1 ? 0.2 : 0;
  return `${color(brighten(base, factor), dist <= 1)}${glyph}${RESET}`;
}

export function buildWorkingIndicator(indicator: IndicatorShape, state: WorkingState): IndicatorFrames {
  const { glyphs, intervalMs } = getIndicatorGlyphs(indicator);
  return {
    frames: glyphs.map((g, i) => styleIndicatorFrame(g, i, glyphs.length, state)),
    ...(intervalMs !== undefined ? { intervalMs } : {}),
  };
}

export function pickWorkingIndicatorFrame(indicator: IndicatorShape, state: WorkingState, nowMs: number): string {
  const { frames, intervalMs } = buildWorkingIndicator(indicator, state);
  if (frames.length === 0) return "";
  const interval = intervalMs ?? DEFAULT_INDICATOR_INTERVAL_MS;
  const index = Math.floor(Math.max(0, nowMs) / interval) % frames.length;
  return frames[index]!;
}

// Gleam the model name while any activity is visible (no rainbow on the model).
export function gleamText(text: string, nowMs: number): string {
  if (text.length === 0) return text;
  const shinePos = Math.floor(Math.max(0, nowMs) / GLEAM_FRAME_MS) % text.length;
  return colorizeGleam(text, DEFAULT_WORKING_RGB, shinePos);
}

// Rainbow the thinking-level text only while thinking (no gleam on the thinking text).
export function rainbowText(text: string, nowMs: number): string {
  if (text.length === 0) return text;
  const shinePos = Math.floor(Math.max(0, nowMs) / GLEAM_FRAME_MS) % text.length;
  return colorizeRainbow(text, shinePos, false);
}
