/**
 * Custom Footer Extension
 *
 * Replaces the default pi footer with one where each field's color is independently
 * configurable via THEME_COLORS, with graceful fallback to theme token defaults.
 *
 * Layout:
 *   Line 1: ~/path branch                                 session-name
 *   Line 2: provider model thinking    context% used/window
 *   Line 3: extension statuses (optional)
 *
 * Context usage escalation is preserved:
 *   >90%  → "error" token
 *   >70%  → "warning" token
 *   ≤70%  → DEFAULT_TOKENS.contextUsage token (or THEME_COLORS override)
 *
 * ── Colour configuration ──────────────────────────────────────────────────────
 *
 * Add entries to THEME_COLORS to override defaults for specific themes.
 * Each value supports three formats:
 *   • Named ANSI color string: "red", "brightCyan", "magenta", etc. (16 standard)
 *   • Hex color string:        "#ff8800" (truecolor; auto-downconverted in 256-color terminals)
 *   • ANSI 256 number:         208 (used as-is regardless of terminal mode)
 *
 * Fields with no override in THEME_COLORS fall back to the theme's own token
 * (DEFAULT_TOKENS), so colors adapt automatically when the user switches themes.
 *
 * The modelProvider prefix uses the configurable "provider" field, which falls back to the
 * theme's "dim" token by default and is overridden to nord3 (#4c566a) in the Nord theme block.
 * The thinking level always matches the thinking border bar colors from the theme.
 *
 * Example:
 *   const THEME_COLORS: Record<string, Partial<FooterColors>> = {
 *     dracula: { modelName: "magenta", branch: "brightCyan" },
 *     nord: { provider: "#4c566a", modelName: "#88c0d0" },
 *   };
 */

import {
  type ExtensionAPI,
  type ExtensionContext,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { StatusRendererHandle } from "./status/status.ts";

// ─── Colour type and user-configurable map ────────────────────────────────────

export type FooterColors = {
  provider: string | number;
  modelName: string | number;
  tokens: string | number;
  contextUsage: string | number;
  contextWindow: string | number;
  branch: string | number;
  pwd: string | number;
  sessionName: string | number;
  statuses: string | number;
  symbols: string | number;
};

/** Colorize callback used by both render() and the extracted formatting helpers. */
export type Colorize = (field: keyof FooterColors, text: string) => string;

/** Width measurements for every hideable field, passed to the priority dropper. */
export interface FieldWidths {
  width: number; // terminal width
  pwdStrWidth: number;
  branchWidth: number;
  sessionNameWidth: number;
  ellipsisWidth: number;
  modelNameWidth: number;
  thinkingWidth: number;
  providerWidth: number;
  contextPercentWidth: number;
  contextDenomWidth: number;
  // Flags for which fields are initially present (non-zero width)
  hasBranch: boolean;
  hasSessionName: boolean;
  hasThinking: boolean;
  hasProvider: boolean;
}

/** Surviving visibility flags after the priority dropper has run. */
export interface VisibilityFlags {
  showBranch: boolean;
  showSessionName: boolean;
  showThinking: boolean;
  showProvider: boolean;
  showContextDenom: boolean;
}

const MIN_PADDING = 2;
const MIN_PWD_CHARS_WITH_BRANCH = 4;

/**
 * Pure priority dropper — given field widths and terminal width,
 * returns the set of visibility flags after the lowest-priority fields
 * have been dropped to fit within `width`.
 */
export function computeVisibility(f: FieldWidths): VisibilityFlags {
  let showProvider = f.hasProvider;
  let showContextDenom = true;
  let showSessionName = f.hasSessionName;
  let showBranch = f.hasBranch;
  let showThinking = f.hasThinking;

  function row1CanFit(): boolean {
    const rightWidth =
      showSessionName && f.sessionNameWidth > 0
        ? MIN_PADDING + f.sessionNameWidth
        : 0;
    const maxLeftWidth = f.width - rightWidth;
    if (maxLeftWidth <= 0) return false;
    const fullLeftWidth = f.pwdStrWidth + (showBranch ? f.branchWidth : 0);
    if (fullLeftWidth <= maxLeftWidth) return true;
    if (showBranch) {
      const minLeftKeepingBranch =
        f.ellipsisWidth + MIN_PWD_CHARS_WITH_BRANCH + f.branchWidth;
      return maxLeftWidth >= minLeftKeepingBranch;
    }
    return maxLeftWidth >= 1;
  }

  function row2Needed(): number {
    let left = f.modelNameWidth;
    if (showThinking) left += f.thinkingWidth;
    if (showProvider) left += f.providerWidth;
    const rightParts: number[] = [f.contextPercentWidth];
    if (showContextDenom) rightParts.push(f.contextDenomWidth);
    const right =
      rightParts.reduce((a, b) => a + b, 0) +
      METRIC_SEP_WIDTH * Math.max(0, rightParts.length - 1);
    return left + MIN_PADDING + right;
  }

  function bothFit(): boolean {
    return row1CanFit() && row2Needed() <= f.width;
  }

  if (!bothFit() && showProvider) showProvider = false;
  if (!bothFit() && showContextDenom) showContextDenom = false;
  if (!bothFit() && showSessionName) showSessionName = false;
  if (!bothFit() && showBranch) showBranch = false;
  if (!bothFit() && showThinking) showThinking = false;

  return {
    showProvider,
    showContextDenom,
    showSessionName,
    showBranch,
    showThinking,
  };
}

export const THEME_COLORS: Record<string, Partial<FooterColors>> = {
  // Add entries here to override defaults for specific themes, e.g.:
  // "dracula": { modelName: "magenta", cost: "#ffb86c" },
  nord: {
    provider: "#4c566a", // nord3 — slightly lighter than the dim token (nord2) so the prefix is readable but still subordinate to modelName
    modelName: "#88c0d0", // nord8 — accent blue
    tokens: "#81a1c1", // nord9 — subtle/muted blue
    contextUsage: "#88c0d0", // nord8 — slightly brighter blue than tokens
    contextWindow: "#d8dee9", // nord4 — silver/bright gray
    branch: "#a3be8c", // nord14 — green
    pwd: "#d08770", // nord12 — orange
    sessionName: "#ebcb8b", // nord13 — yellow/gold (takes over the old cost accent)
    statuses: "#4c566a", // nord3 — muted
    symbols: "#4c566a", // nord3 — muted
  }
};

// ─── Default theme-token fallbacks ───────────────────────────────────────────

export const DEFAULT_TOKENS: Record<keyof FooterColors, ThemeColor> = {
  provider: "dim",
  modelName: "accent",
  tokens: "border",
  contextUsage: "accent",
  contextWindow: "dim",
  branch: "success",
  pwd: "error",
  sessionName: "warning",
  statuses: "dim",
  symbols: "borderMuted",
};

// ─── Colour helpers ───────────────────────────────────────────────────────────

const ANSI_NAMED: Record<string, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  grey: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97,
};

const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
const GRAY_VALUES = Array.from({ length: 24 }, (_, i) => 8 + i * 10);

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbTo256(r: number, g: number, b: number): number {
  // Weighted Euclidean distance — matches pi's own hex→256 algorithm.
  let bestIdx = 0;
  let bestDist = Infinity;

  // 6×6×6 colour cube: indices 16–231
  for (let ri = 0; ri < 6; ri++) {
    for (let gi = 0; gi < 6; gi++) {
      for (let bi = 0; bi < 6; bi++) {
        const dr = r - CUBE_VALUES[ri];
        const dg = g - CUBE_VALUES[gi];
        const db = b - CUBE_VALUES[bi];
        const dist = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = 16 + ri * 36 + gi * 6 + bi;
        }
      }
    }
  }

  // 24-step grayscale ramp: indices 232–255
  for (let i = 0; i < 24; i++) {
    const v = GRAY_VALUES[i];
    const dr = r - v;
    const dg = g - v;
    const db = b - v;
    const dist = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = 232 + i;
    }
  }

  return bestIdx;
}

function colorToAnsi(
  value: string | number,
  mode: "truecolor" | "256color",
): string {
  if (typeof value === "number") {
    // ANSI 256 index — used as-is
    return `\x1b[38;5;${value}m`;
  }

  if (value.startsWith("#")) {
    const { r, g, b } = hexToRgb(value);
    if (mode === "truecolor") {
      return `\x1b[38;2;${r};${g};${b}m`;
    } else {
      return `\x1b[38;5;${rgbTo256(r, g, b)}m`;
    }
  }

  const code = ANSI_NAMED[value];
  if (code !== undefined) {
    return `\x1b[${code}m`;
  }

  throw new Error(
    `[custom-footer] Unknown color "${value}". ` +
      `Use a named ANSI color (e.g. "red", "brightCyan"), a hex value (e.g. "#ff8800"), ` +
      `or an ANSI 256 number (e.g. 208).`,
  );
}

function applyColor(
  value: string | number,
  text: string,
  mode: "truecolor" | "256color",
): string {
  const ansi = colorToAnsi(value, mode);
  return `${ansi}${text}\x1b[39m`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format token counts compactly, matching the default footer exactly. */
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

/** Strip control characters for safe single-line display. */
function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

/** Filter out blank extension statuses so they don't create dead footer lines. */
export function sanitizeStatusTexts(texts: Iterable<string>): string[] {
  return Array.from(texts, sanitizeStatusText).filter(
    (text) => text.length > 0,
  );
}

/** Hide the thinking field entirely when reasoning is toggled off. */
export function getThinkingLabel(
  thinkingLevel: string | null | undefined,
): string {
  return thinkingLevel && thinkingLevel !== "off" ? thinkingLevel : "";
}

/** Only show the provider prefix when it adds distinguishing information. */
export function getProviderPrefix(
  provider: string | undefined,
  availableProviderCount: number,
): string {
  return provider && availableProviderCount > 1 ? `${provider} ` : "";
}

/**
 * Context token-window segment, rendered separately from the percentage as
 * "used/window". The token counts use the `tokens` color (the same blue formerly
 * used for the removed input/output token metrics), while the slash remains muted.
 */
export function formatContextTokenWindow(
  contextTokens: number | null | undefined,
  contextWindow: number,
  colorize: Colorize,
): string {
  const used =
    contextTokens === null || contextTokens === undefined
      ? "?"
      : formatTokens(contextTokens);
  return (
    colorize("tokens", used) +
    colorize("symbols", "/") +
    colorize("tokens", formatTokens(contextWindow))
  );
}

/** Separator width (" ") used between adjacent row-2 metrics. */
export const METRIC_SEP_WIDTH = 1;

/**
 * Join row-2 metrics with a single literal space. Empty/blank entries are skipped so a missing metric cannot produce doubled spaces, leading spaces, trailing spaces, or dead separators.
 */
export function joinMetrics(
  metrics: readonly string[],
  _colorize: Colorize,
): string {
  const present = metrics.filter((m) => m.length > 0);
  if (present.length === 0) return "";
  const sep = " ";
  return present.join(sep);
}

// ─── Row 1 helpers ───────────────────────────────────────────────────────────

/**
 * Truncate the cwd portion of row 1 to fit within `maxWidth`,
 * preserving the tail of the path.
 *
 * Visibility policy:
 * - This helper never decides whether branch is shown.
 * - If `branch` is provided, Task 4 has already decided branch stays visible
 *   and has already verified that branch-preserving truncation can fit.
 * - If branch must be hidden, Task 4 flips `showBranch` to false before
 *   calling this helper.
 *
 * Constraints:
 * - Do not let this helper silently drop branch.
 * - Do not partially truncate branch or its single-space separator.
 * - Branch remains all-or-nothing; only cwd is truncated here.
 */
function truncatePwdTail(
  pwdStr: string,
  branch: string | undefined,
  maxWidth: number,
  colorize: (field: keyof FooterColors, text: string) => string,
): string {
  const fullPwd = colorize("pwd", pwdStr);
  if (!branch) {
    if (visibleWidth(fullPwd) <= maxWidth) return fullPwd;

    const ellipsis = colorize("symbols", "...");
    const ellipsisWidth = visibleWidth(ellipsis);
    const availableForPwd = maxWidth - ellipsisWidth;

    if (availableForPwd >= 1) {
      return ellipsis + colorize("pwd", tailTruncate(pwdStr, availableForPwd));
    }

    return truncateToWidth(fullPwd, maxWidth, "");
  }

  const branchSuffix = " " + colorize("branch", branch);
  const fullLeft = fullPwd + branchSuffix;
  if (visibleWidth(fullLeft) <= maxWidth) return fullLeft;

  const ellipsis = colorize("symbols", "...");
  const ellipsisWidth = visibleWidth(ellipsis);
  const branchSuffixWidth = visibleWidth(branchSuffix);

  // Task 4's row1CanFitWithCurrentFlags() guarantees this branch-preserving
  // path is only used when at least 4 cwd chars can remain visible.
  const availableForPwd = maxWidth - branchSuffixWidth - ellipsisWidth;
  const truncatedPwd = tailTruncate(pwdStr, availableForPwd);

  return ellipsis + colorize("pwd", truncatedPwd) + branchSuffix;
}

/**
 * Return the last `maxWidth` visible characters of `text`.
 * Pure character-level tail slice — no ANSI codes expected in input.
 */
function tailTruncate(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.slice(text.length - maxWidth);
}

// ─── Renderer install ──────────────────────────────────────────────────────────

/**
 * Install the custom footer renderer into the active session and return a handle
 * the status coordinator uses to remove it again. The footer is one of the
 * mutually-exclusive status placements; the coordinator decides when it is
 * installed, so this module no longer registers its own session lifecycle
 * handlers.
 */
export function installFooter(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): StatusRendererHandle {
  ctx.ui.setFooter((tui, theme, footerData) => {
      // Re-render whenever the git branch changes.
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,

        // Colors are computed fresh in every render() call via `colorize()`,
        // so there is no cached content to invalidate on theme switch.
        invalidate() {},

        render(width: number): string[] {
          // ── Per-render color resolution ─────────────────────────────────────
          // Read theme.name and colorMode fresh each render so theme switches
          // are picked up automatically without needing to cache anything.
          const overrides = THEME_COLORS[theme.name ?? ""] ?? {};
          const colorMode = theme.getColorMode();

          function colorize(field: keyof FooterColors, text: string): string {
            const override = overrides[field];
            if (override !== undefined) {
              return applyColor(override, text, colorMode);
            }
            return theme.fg(DEFAULT_TOKENS[field], text);
          }

          // ── Row 1: project identity (left) and session identity (right) ──

          // Build cwd with ~ substitution
          let pwdStr = ctx.cwd;
          const home = process.env.HOME ?? process.env.USERPROFILE;
          if (home && pwdStr.startsWith(home)) {
            pwdStr = `~${pwdStr.slice(home.length)}`;
          }

          const branch = footerData.getGitBranch();
          const sessionName = pi.getSessionName();

          // ── Row 2 left: execution mode (provider, model, thinking) ──────

          const modelName = ctx.model?.id ?? "no-model";

          // Append thinking level only when reasoning is actually enabled.
          let thinkingStr = "";
          if (ctx.model?.reasoning) {
            const thinkingLevel = pi.getThinkingLevel() ?? "off";
            const thinkingLabel = getThinkingLabel(thinkingLevel);
            if (thinkingLabel) {
              thinkingStr =
                " " +
                theme.getThinkingBorderColor(thinkingLevel)(thinkingLabel);
            }
          }

          // Only show the provider prefix when the user has more than one
          // provider available — matches the baseline single-provider behavior.
          // Provider is part of the normal wide-layout execution-mode cluster
          // and further disappears under narrow-width pressure via Task 4's
          // priority logic.
          const providerPrefixLabel = getProviderPrefix(
            ctx.model?.provider,
            footerData.getAvailableProviderCount(),
          );
          const providerPrefix = providerPrefixLabel
            ? colorize("provider", providerPrefixLabel)
            : "";

          // ── Row 2 data extraction ─────────────────────────────────────────

          // Context usage
          const contextUsage = ctx.getContextUsage();
          const contextWindow =
            contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const contextPercentValue = contextUsage?.percent ?? 0;
          const contextPercent =
            contextUsage?.percent === null || contextUsage?.percent === undefined
              ? "?"
              : contextPercentValue.toFixed(1);
          const contextTokens = contextUsage?.tokens;

          // ── Pre-compute per-field widths for the global priority dropper ──

          // Row 1 field measurements
          const pwdStrWidth = visibleWidth(colorize("pwd", pwdStr));
          const branchWidth = branch
            ? visibleWidth(" " + colorize("branch", branch))
            : 0;
          const sessionNameWidth = sessionName
            ? visibleWidth(colorize("sessionName", sessionName))
            : 0;

          // Row 1 truncation thresholds
          const ellipsisWidth = visibleWidth(colorize("symbols", "..."));

          // Row 2 field measurements
          const modelNameWidth = visibleWidth(colorize("modelName", modelName));
          const thinkingWidth = thinkingStr ? visibleWidth(thinkingStr) : 0;
          const providerWidth = providerPrefix
            ? visibleWidth(providerPrefix)
            : 0;

          // Context percent string (always shown — highest priority)
          let contextPercentStr: string;
          if (contextPercent === "?") {
            contextPercentStr = colorize("symbols", "?");
          } else {
            const pctColor =
              contextPercentValue > 90
                ? "error"
                : contextPercentValue > 70
                  ? "warning"
                  : undefined;
            contextPercentStr = pctColor
              ? theme.fg(pctColor, contextPercent) + theme.fg(pctColor, "%")
              : colorize("contextUsage", contextPercent) +
                colorize("contextUsage", "%");
          }
          const contextPercentWidth = visibleWidth(contextPercentStr);
          const contextDenomStr = formatContextTokenWindow(
            contextTokens,
            contextWindow,
            colorize,
          );
          const contextDenomWidth = visibleWidth(contextDenomStr);

          // ── Global visibility flags (shared across both rows) ─────────────
          // Delegate to the pure priority dropper so tests can exercise the
          // same logic directly. cwd is always present (may be truncated);
          // priorities #1-#2 (context usage %, model name) are never hidden.
          const flags = computeVisibility({
            width,
            pwdStrWidth,
            branchWidth,
            sessionNameWidth,
            ellipsisWidth,
            modelNameWidth,
            thinkingWidth,
            providerWidth,
            contextPercentWidth,
            contextDenomWidth,
            hasBranch: !!branch,
            hasSessionName: !!sessionName,
            hasThinking: !!thinkingStr,
            hasProvider: !!providerPrefix,
          });

          const {
            showProvider,
            showContextDenom,
            showSessionName,
            showBranch,
            showThinking,
          } = flags;

          // ── Compose row 1 using surviving visibility flags ────────────────

          let r1Left =
            showBranch && branch
              ? colorize("pwd", pwdStr) + " " + colorize("branch", branch)
              : colorize("pwd", pwdStr);

          const r1Right =
            showSessionName && sessionName
              ? colorize("sessionName", sessionName)
              : "";

          const r1RightW = visibleWidth(r1Right);
          const r1TargetLeftWidth =
            r1RightW > 0 ? width - MIN_PADDING - r1RightW : width;

          // If the current row-1 flags fit only via cwd truncation, apply that now.
          if (
            r1TargetLeftWidth > 0 &&
            visibleWidth(r1Left) > r1TargetLeftWidth
          ) {
            r1Left = truncatePwdTail(
              pwdStr,
              showBranch && branch ? branch : undefined,
              r1TargetLeftWidth,
              colorize,
            );
          }

          let line1: string;
          const r1LeftWidth = visibleWidth(r1Left);
          const r1RightWidth = visibleWidth(r1Right);

          if (
            r1RightWidth > 0 &&
            r1LeftWidth + MIN_PADDING + r1RightWidth <= width
          ) {
            const padding = " ".repeat(width - r1LeftWidth - r1RightWidth);
            line1 = r1Left + padding + r1Right;
          } else {
            line1 = r1Left;
          }

          // ── Compose row 2 using surviving visibility flags ────────────────

          let row2LeftFinal = "";
          if (showProvider) row2LeftFinal += providerPrefix;
          row2LeftFinal += colorize("modelName", modelName);
          if (showThinking && thinkingStr) row2LeftFinal += thinkingStr;

          const metricsFinal: string[] = [];
          // Invariant: contextPercentStr is never empty — it falls back to a
          // colorized "?" when usage is unknown — so joinMetrics() will not drop
          // it as an empty entry.
          metricsFinal.push(contextPercentStr);
          if (showContextDenom) metricsFinal.push(contextDenomStr);

          const row2RightFinal = joinMetrics(metricsFinal, colorize);
          const row2LeftFinalWidth = visibleWidth(row2LeftFinal);
          const row2RightFinalWidth = visibleWidth(row2RightFinal);

          let statsLine: string;
          if (row2LeftFinalWidth + MIN_PADDING + row2RightFinalWidth <= width) {
            const padding = " ".repeat(
              width - row2LeftFinalWidth - row2RightFinalWidth,
            );
            statsLine = row2LeftFinal + padding + row2RightFinal;
          } else {
            // Last resort: truncate left to fit right side
            const availForLeft = width - MIN_PADDING - row2RightFinalWidth;
            if (availForLeft > 0) {
              const tLeft = truncateToWidth(row2LeftFinal, availForLeft, "");
              const tLeftW = visibleWidth(tLeft);
              const padding = " ".repeat(
                Math.max(0, width - tLeftW - row2RightFinalWidth),
              );
              statsLine = tLeft + padding + row2RightFinal;
            } else {
              statsLine = truncateToWidth(row2RightFinal, width);
            }
          }

          const lines = [line1, statsLine];

          // ── Line 3 (optional): extension statuses ───────────────────────────
          const extensionStatuses = footerData.getExtensionStatuses();
          const sortedStatuses = sanitizeStatusTexts(
            Array.from(extensionStatuses.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, text]) => text),
          );
          if (sortedStatuses.length > 0) {
            const statusLine = sortedStatuses.join(" ");
            lines.push(truncateToWidth(statusLine, width));
          }

          return lines;
        },
      };
  });

  return {
    dispose() {
      ctx.ui.setFooter(undefined);
    },
  };
}
