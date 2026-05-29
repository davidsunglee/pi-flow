import type { WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";
import type { WorkingStyle, IndicatorShape } from "./working.ts";

export const DEFAULT_WORKING_COLOR = "#81A1C1";
const DEFAULT_WORKING_RGB: [number, number, number] = [129, 161, 193];
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

export const MESSAGE_ANIMATION_INTERVAL_MS = 60;

export function normalizeHexColor(value: string): string {
  return value.toUpperCase();
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex);
  const match = /^#([0-9A-F]{6})$/.exec(normalized);
  if (!match) return DEFAULT_WORKING_RGB;
  return [
    Number.parseInt(match[1]!.slice(0, 2), 16),
    Number.parseInt(match[1]!.slice(2, 4), 16),
    Number.parseInt(match[1]!.slice(4, 6), 16),
  ];
}

function brighten(rgb: [number, number, number], factor: number): [number, number, number] {
  return rgb.map((c) => Math.round(c + (255 - c) * factor)) as [number, number, number];
}

function color(rgb: [number, number, number], bold = false): string {
  return `\x1b[${bold ? "1;" : ""}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function colorizePlain(text: string, rgb: [number, number, number]): string {
  return `${color(rgb)}${text}${RESET}`;
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

export function shouldAnimateStyle(style: WorkingStyle): boolean {
  return style.gleam || style.rainbow;
}

export function renderWorkingMessageFrame(text: string, style: WorkingStyle, frame: number): string {
  if (!style.rainbow && !style.gleam) return colorizePlain(text, hexToRgb(style.color));

  const shinePos = text.length === 0 ? 0 : frame % text.length;
  if (style.rainbow) return colorizeRainbow(text, shinePos, style.gleam);
  return colorizeGleam(text, hexToRgb(style.color), shinePos);
}

function getIndicatorGlyphs(shape: IndicatorShape): { glyphs: string[]; intervalMs?: number } {
  switch (shape) {
    case "dot":
      return { glyphs: DOT_FRAMES };
    case "pulse":
      return { glyphs: PULSE_FRAMES, intervalMs: 120 };
    case "spinner":
      return { glyphs: SPINNER_FRAMES, intervalMs: 80 };
    case "wave":
      return { glyphs: WAVE_FRAMES, intervalMs: 120 };
  }
}

function styleIndicatorFrame(
  glyph: string,
  index: number,
  total: number,
  style: WorkingStyle,
): string {
  if (style.rainbow) {
    const base = PASTEL_RAINBOW_RGB[index % PASTEL_RAINBOW_RGB.length]!;
    const mid = Math.floor(total / 2);
    const factor = style.gleam && Math.abs(index - mid) <= 1 ? (index === mid ? 0.4 : 0.2) : 0;
    return `${color(brighten(base, factor), style.gleam && Math.abs(index - mid) <= 1)}${glyph}${RESET}`;
  }

  const base = hexToRgb(style.color);
  if (!style.gleam) return `${color(base)}${glyph}${RESET}`;

  const mid = Math.floor(total / 2);
  const dist = Math.abs(index - mid);
  const factor = dist === 0 ? 0.45 : dist === 1 ? 0.2 : 0;
  return `${color(brighten(base, factor), dist <= 1)}${glyph}${RESET}`;
}

export function buildWorkingIndicator(shape: IndicatorShape, style: WorkingStyle): WorkingIndicatorOptions {
  const { glyphs, intervalMs } = getIndicatorGlyphs(shape);
  return {
    frames: glyphs.map((glyph, index) => styleIndicatorFrame(glyph, index, glyphs.length, style)),
    ...(intervalMs !== undefined ? { intervalMs } : {}),
  };
}
