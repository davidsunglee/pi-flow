import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { type LogoVariant, DEFAULT_LOGO_VARIANT, type TuiSettingsStore } from "./settings.ts";

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

// Lettered "pi" wordmarks: bracket, sidebar, rounded, squared.
// applyLogoGradient colors non-space chars by column.
export const LOGO_VARIANTS: Record<LogoVariant, string[]> = {
  bracket: ["[ pi ]"],
  sidebar: ["▌ pi ▐"],
  rounded: ["╭────╮", "│ pi │", "╰────╯"],
  squared: ["┏━━━━┓", "┃ pi ┃", "┗━━━━┛"],
};

export function buildHeaderLines(version: string, reason: string, variant: LogoVariant = DEFAULT_LOGO_VARIANT): string[] {
  const art = LOGO_VARIANTS[variant] ?? LOGO_VARIANTS[DEFAULT_LOGO_VARIANT];
  return [
    ...applyLogoGradient(art),
    `version ${version}`,
    humanizeStartupReason(reason),
  ];
}

export interface HeaderHandle { dispose(): void; }

export function installHeader(ctx: ExtensionContext, reason: string, store: TuiSettingsStore): HeaderHandle {
  if (!ctx.hasUI) return { dispose() {} };
  let unsubscribe: (() => void) | undefined;
  ctx.ui.setHeader((tui: TUI) => {
    unsubscribe?.();
    unsubscribe = store.subscribe(() => tui.requestRender());
    return {
      render: (_width: number) => buildHeaderLines(VERSION, reason, store.get().header.logo),
      invalidate() {},
      dispose() { unsubscribe?.(); unsubscribe = undefined; },
    };
  });
  // Both this handle's dispose() and the component's own dispose() (invoked by
  // the TUI on setHeader swap-out) share the `unsubscribe` closure; whichever
  // fires first cleans up and nulls it, so the other is a harmless no-op.
  return {
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
      ctx.ui.setHeader(undefined);
    },
  };
}
