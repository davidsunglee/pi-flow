import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";

export type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";

const STARTUP_REASON_LABELS: Record<SessionStartReason, string> = {
  startup: "fresh start",
  reload: "reloaded",
  new: "new session",
  resume: "resumed session",
  fork: "forked session",
};

export function humanizeStartupReason(reason: string): string {
  return STARTUP_REASON_LABELS[reason as SessionStartReason] ?? "session started";
}

// Hand-rolled pi gradient wordmark — fallback for pi-powerline's header art,
// which is not vendored in this repo. Swap PI_LOGO_ART for the ported art if
// it becomes available; applyLogoGradient is theme-independent regardless.
const PI_LOGO_ART: string[] = [
  "████████",
  " ██  ██ ",
  " ██  ██ ",
  " ██  ██ ",
];

// Gradient stops (R,G,B) interpolated left→right across the logo columns.
const LOGO_GRADIENT_STOPS: [number, number, number][] = [
  [80, 180, 230],   // pi blue
  [129, 161, 193],  // muted blue
  [180, 142, 173],  // soft magenta
];

function lerp(a: number, b: number, t: number): number { return Math.round(a + (b - a) * t); }

function gradientColorAt(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const span = LOGO_GRADIENT_STOPS.length - 1;
  const scaled = clamped * span;
  const i = Math.min(span - 1, Math.floor(scaled));
  const local = scaled - i;
  const a = LOGO_GRADIENT_STOPS[i]!;
  const b = LOGO_GRADIENT_STOPS[i + 1]!;
  return [lerp(a[0], b[0], local), lerp(a[1], b[1], local), lerp(a[2], b[2], local)];
}

export function applyLogoGradient(lines: string[]): string[] {
  const width = Math.max(1, ...lines.map((l) => l.length));
  return lines.map((line) =>
    [...line]
      .map((ch, i) => {
        if (ch === " ") return ch;
        const t = width <= 1 ? 0 : i / (width - 1);
        const [r, g, b] = gradientColorAt(t);
        return `\x1b[38;2;${r};${g};${b}m${ch}\x1b[0m`;
      })
      .join(""),
  );
}

export function buildHeaderLines(version: string, reason: string): string[] {
  return [
    ...applyLogoGradient(PI_LOGO_ART),
    "",
    `version ${version}`,
    humanizeStartupReason(reason),
  ];
}

export interface HeaderHandle { dispose(): void; }

export function installHeader(ctx: ExtensionContext, reason: string): HeaderHandle {
  if (!ctx.hasUI) return { dispose() {} };
  const lines = buildHeaderLines(VERSION, reason);
  ctx.ui.setHeader(() => ({ render: (_width: number) => lines, invalidate() {} }));
  return { dispose() { ctx.ui.setHeader(undefined); } };
}
