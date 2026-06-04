import type { ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type LogoVariant, DEFAULT_LOGO_VARIANT, type TuiSettingsStore, type HeaderDetails } from "./settings.ts";
import { HEADER_MARGIN, CATEGORY_ORDER, type ResourceSnapshot, type HeaderResources } from "./header-data.ts";
import { BORDER_TOKENS } from "./editor.ts";

export type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";

const SESSION_MESSAGES: Partial<Record<SessionStartReason, string>> = {
  reload: "session reloaded",
  resume: "session resumed",
  fork: "session forked",
};

/** Session message for reload/resume/fork; undefined for startup/new/unknown (no line). */
export function getSessionMessage(reason: string): string | undefined {
  return SESSION_MESSAGES[reason as SessionStartReason];
}

export type HeaderLevel = "none" | "compact";

/** quietStartup=false forces "none" (the host prints its own listing); quietStartup=true uses the configured level. */
export function resolveHeaderLevel(quietStartup: boolean, configured: HeaderDetails): HeaderLevel {
  return quietStartup ? configured : "none";
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

export type HeaderColorize = (token: ThemeColor, text: string) => string;

// Items column starts after the longest label ("extensions", 10 cols) plus a 2-col gap.
export const COMPACT_LABEL_COL = 12;

/** Largest k (0..n) such that the first k names + " +N" suffix fit `available` columns. */
export function fitCompactItems(names: string[], available: number): number {
  for (let k = names.length; k >= 0; k--) {
    const candidate =
      names.slice(0, k).join(", ") +
      (k < names.length ? (k > 0 ? " " : "") + "+" + (names.length - k) : "");
    if (candidate.length <= available) return k;
  }
  return 0;
}

export function buildCompactRow(label: string, names: string[], width: number, colorize: HeaderColorize): string {
  const available = width - HEADER_MARGIN.length - COMPACT_LABEL_COL;
  const shown = fitCompactItems(names, Math.max(0, available));
  let row =
    HEADER_MARGIN +
    colorize("mdHeading", label) +
    " ".repeat(COMPACT_LABEL_COL - label.length) +
    colorize("toolOutput", names.slice(0, shown).join(", "));
  if (shown < names.length) {
    row += (shown > 0 ? " " : "") + colorize("muted", "+" + (names.length - shown));
  }
  if (visibleWidth(row) > width) {
    return truncateToWidth(row, Math.max(0, width), "");
  }
  return row;
}

export interface HeaderContentInput {
  version: string;
  reason: string;
  logo: LogoVariant;
  level: HeaderLevel;
  resources: ResourceSnapshot | undefined;
  width: number;
  colorize: HeaderColorize;
}

export function buildHeaderLines(input: HeaderContentInput): string[] {
  const { version, reason, logo, level, resources, width, colorize } = input;
  const lines: string[] = [];

  const art = LOGO_VARIANTS[logo] ?? LOGO_VARIANTS[DEFAULT_LOGO_VARIANT];
  for (const line of applyLogoGradient(art)) {
    lines.push(HEADER_MARGIN + line);
  }

  lines.push(HEADER_MARGIN + "v" + version);

  const sessionMessage = getSessionMessage(reason);
  if (sessionMessage !== undefined) {
    lines.push(HEADER_MARGIN + colorize(BORDER_TOKENS.cwd, sessionMessage));
  }

  if (level === "compact" && resources !== undefined) {
    const categoryRows: string[] = [];
    for (const category of CATEGORY_ORDER) {
      const items = resources[category];
      if (items.length === 0) continue;
      const names = category === "themes"
        ? items.map((item) => item.name + (item.active ? "*" : ""))
        : items.map((item) => item.name);
      categoryRows.push(buildCompactRow(category, names, width, colorize));
    }
    if (categoryRows.length > 0) {
      lines.push("");
      lines.push(...categoryRows);
    }
  }

  lines.push("");

  // Final guard: no non-empty line may exceed the render width.
  return lines.map((line) =>
    line !== "" && visibleWidth(line) > width
      ? truncateToWidth(line, Math.max(0, width), "")
      : line,
  );
}

export interface HeaderHandle { dispose(): void; }

export function installHeader(
  ctx: ExtensionContext,
  reason: string,
  store: TuiSettingsStore,
  resources: HeaderResources,
  quietStartup: boolean,
): HeaderHandle {
  if (!ctx.hasUI) return { dispose() {} };
  let unsubscribers: Array<() => void> = [];
  ctx.ui.setHeader((tui: TUI) => {
    for (const unsub of unsubscribers) unsub();
    unsubscribers = [];
    unsubscribers.push(store.subscribe(() => tui.requestRender()));
    unsubscribers.push(resources.subscribe(() => tui.requestRender()));
    return {
      render: (width: number) => buildHeaderLines({
        version: VERSION,
        reason,
        logo: store.get().header.logo,
        level: resolveHeaderLevel(quietStartup, store.get().header.details),
        resources: resources.get(),
        width,
        colorize: (token, text) => ctx.ui.theme.fg(token, text),
      }),
      invalidate() {},
      dispose() {
        for (const unsub of unsubscribers) unsub();
        unsubscribers = [];
      },
    };
  });
  // Both this handle's dispose() and the component's own dispose() (invoked by
  // the TUI on setHeader swap-out) share the `unsubscribers` closure; whichever
  // fires first cleans up and clears it, so the other is a harmless no-op.
  return {
    dispose() {
      for (const unsub of unsubscribers) unsub();
      unsubscribers = [];
      ctx.ui.setHeader(undefined);
    },
  };
}
