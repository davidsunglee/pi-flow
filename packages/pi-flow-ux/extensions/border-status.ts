/**
 * Border-status editor extension
 *
 * Draws key session metadata into the editor's top and bottom border lines,
 * following pi's `border-status-editor.ts` example pattern (extend CustomEditor,
 * override render(width), rewrite the top/bottom border rows).
 *
 * Layout:
 *   top border:    ───────────────────────────────  ~/path branch ─
 *   bottom border: ─ model thinking ──────────  used/total context% ─
 *
 * Colour routing is kept in lock-step with the footer extension by resolving
 * the same theme tokens the footer's fields resolve to:
 *   - model            → "accent"      (footer modelName: accent / Nord nord8)
 *   - context %        → "accent"      (footer contextUsage: accent / Nord nord8)
 *   - token counts     → "muted"       (de-emphasized, same field as cwd)
 *   - branch           → "success"     (footer branch: success / Nord nord14)
 *   - "/" and ellipsis → "borderMuted" (footer symbols: borderMuted / Nord nord3)
 *   - cwd              → "muted"       (readable but subordinate)
 *   - thinking         → theme.getThinkingBorderColor(level) (matches footer)
 *
 * Because these tokens resolve per-render, theme switches update the border
 * colours automatically with no cached ANSI to invalidate.
 *
 * This extension installs only a custom editor (via setEditorComponent) and
 * never touches the footer, so it coexists with the footer extension until a
 * later decision removes the now-duplicated footer metadata.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { StatusRendererHandle } from "./status/status.ts";

// ─── Colour routing ─────────────────────────────────────────────────────────

/** Semantic border fields routed to theme tokens (thinking is handled separately). */
export type BorderColorField = "model" | "context" | "branch" | "symbol" | "cwd";

/** Colorize callback shared by the formatting helpers and composeBorderLines. */
export type BorderColorize = (field: BorderColorField, text: string) => string;

/**
 * Theme tokens each border field resolves to. These mirror the footer's
 * resolved colours so the two stay visually consistent across themes.
 */
export const BORDER_TOKENS: Record<BorderColorField, ThemeColor> = {
	model: "accent",
	context: "accent",
	branch: "success",
	symbol: "borderMuted",
	cwd: "muted",
};

// ─── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Resolve the thinking-level label, hiding it entirely when reasoning is toggled
 * off. Self-contained so border-status carries no dependency on the footer
 * extension (which is slated for removal).
 */
export function getThinkingLabel(
	thinkingLevel: string | null | undefined,
): string {
	return thinkingLevel && thinkingLevel !== "off" ? thinkingLevel : "";
}

/** Substitute the home-directory prefix with `~`, matching the footer's cwd display. */
export function formatCwd(cwd: string): string {
	const home = process.env.HOME ?? process.env.USERPROFILE;
	if (home && cwd.startsWith(home)) {
		return `~${cwd.slice(home.length)}`;
	}
	return cwd;
}

/** Format token counts compactly, matching the footer exactly. */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Context usage percentage, coloured like the footer's contextUsage field. */
export function formatContextPercent(
	percent: number | null | undefined,
	colorize: BorderColorize,
): string {
	if (percent === null || percent === undefined) {
		return colorize("symbol", "?");
	}
	return colorize("context", `${percent.toFixed(1)}%`);
}

/**
 * Context token window as "used/total". Both counts use the cwd colour to
 * de-emphasize them relative to the percentage, while the slash stays subdued.
 */
export function formatContextTokenWindow(
	tokens: number | null | undefined,
	contextWindow: number,
	colorize: BorderColorize,
): string {
	const used =
		tokens === null || tokens === undefined ? "?" : formatTokens(tokens);
	return (
		colorize("cwd", used) +
		colorize("symbol", "/") +
		colorize("cwd", formatTokens(contextWindow))
	);
}

// ─── Border fitting ─────────────────────────────────────────────────────────

/**
 * Fit left/right status text into a single border line of the given width.
 * Truncates right text first, then left text, ANSI-safely, never breaking the
 * corner dashes. Ported from pi's border-status-editor example.
 */
export function fitBorder(
	left: string,
	right: string,
	width: number,
	border: (text: string) => string,
	fill: (text: string) => string = border,
): string {
	if (width <= 0) return "";
	if (width === 1) return border("─");

	let leftText = left;
	let rightText = right;
	const fixedWidth = 2;
	const minimumGap = 3;

	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap >
			width &&
		visibleWidth(rightText) > 0
	) {
		rightText = truncateToWidth(
			rightText,
			Math.max(0, visibleWidth(rightText) - 1),
			"",
		);
	}
	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap >
			width &&
		visibleWidth(leftText) > 0
	) {
		leftText = truncateToWidth(
			leftText,
			Math.max(0, visibleWidth(leftText) - 1),
			"",
		);
	}

	const gapWidth = Math.max(
		0,
		width - fixedWidth - visibleWidth(leftText) - visibleWidth(rightText),
	);
	return `${border("─")}${leftText}${fill("─".repeat(gapWidth))}${rightText}${border("─")}`;
}

/** Return the last `maxWidth` characters of `text` (plain text, no ANSI). */
function tailTruncate(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) return text;
	return text.slice(text.length - maxWidth);
}

/**
 * Build the upper-right status block (cwd + optional branch), fitting it within
 * `maxWidth`. The cwd is tail-truncated (with a leading ellipsis) so the tail of
 * the path stays visible; the branch is kept intact (all-or-nothing) — callers
 * decide via computeBorderVisibility whether the branch is present at all.
 */
export function fitTopRight(
	cwdStr: string,
	branch: string | undefined,
	maxWidth: number,
	colorize: BorderColorize,
): string {
	const branchPart = branch ? " " + colorize("branch", branch) : "";
	const branchPlainWidth = branch ? visibleWidth(" " + branch) : 0;
	const cwdColored = colorize("cwd", cwdStr);

	if (visibleWidth(cwdColored) + branchPlainWidth <= maxWidth) {
		return cwdColored + branchPart;
	}

	const ellipsis = colorize("symbol", "…");
	const availForCwd = maxWidth - branchPlainWidth - 1; // 1 for the ellipsis
	if (availForCwd >= 1) {
		return ellipsis + colorize("cwd", tailTruncate(cwdStr, availForCwd)) + branchPart;
	}

	// Not even room for the branch plus one cwd char: last-resort ANSI-safe truncate.
	return truncateToWidth(cwdColored + branchPart, Math.max(0, maxWidth), "");
}

// ─── Responsive priority dropper ───────────────────────────────────────────────

/** Per-field width measurements fed to the priority dropper. */
export interface BorderFieldWidths {
	width: number; // terminal width
	modelWidth: number; // bottom-left, highest priority (never dropped)
	thinkingWidth: number; // bottom-left optional; includes leading separator space
	pctWidth: number; // bottom-right, highest priority (never dropped)
	tokenWindowWidth: number; // bottom-right optional; includes leading separator space
	cwdWidth: number; // top-right; truncatable, always present
	branchWidth: number; // top-right optional; includes leading separator space
	ellipsisWidth: number;
	hasThinking: boolean;
	hasBranch: boolean;
	hasTokenWindow: boolean;
}

/** Surviving optional-field visibility after the priority dropper has run. */
export interface BorderVisibility {
	showThinking: boolean;
	showBranch: boolean;
	showTokenWindow: boolean;
}

// Per-line layout overhead, kept in sync with composeBorderLines / fitBorder.
const CORNERS = 2; // leading + trailing corner dash
const GAP = 3; // fitBorder minimumGap between left and right blocks
const BLOCK_PAD = 2; // one leading + one trailing space padding per status block
const MIN_CWD_CHARS = 4; // minimum cwd chars kept visible when preserving branch

/**
 * Pure priority dropper. Model id and context percentage are always kept; the
 * cwd is always present (truncatable). Optional fields drop in a strict global
 * priority order as the terminal narrows — token window first, then branch,
 * then thinking — each sacrificed (lowest priority first) until both border
 * lines fit, regardless of which line the dropped field lives on.
 */
export function computeBorderVisibility(f: BorderFieldWidths): BorderVisibility {
	let showTokenWindow = f.hasTokenWindow;
	let showBranch = f.hasBranch;
	let showThinking = f.hasThinking;

	const bottomFits = (): boolean => {
		const left = f.modelWidth + (showThinking ? f.thinkingWidth : 0);
		const right = f.pctWidth + (showTokenWindow ? f.tokenWindowWidth : 0);
		return CORNERS + BLOCK_PAD + left + BLOCK_PAD + right + GAP <= f.width;
	};

	const topFits = (): boolean => {
		if (!showBranch) return true; // cwd alone can always tail-truncate to fit
		const minCwd = f.ellipsisWidth + MIN_CWD_CHARS;
		return CORNERS + BLOCK_PAD + minCwd + f.branchWidth + GAP <= f.width;
	};

	const allFit = (): boolean => bottomFits() && topFits();

	if (showTokenWindow && !allFit()) showTokenWindow = false;
	if (showBranch && !allFit()) showBranch = false;
	if (showThinking && !allFit()) showThinking = false;

	return { showThinking, showBranch, showTokenWindow };
}

// ─── Border line composition ───────────────────────────────────────────────────

export interface ComposeBorderLinesOptions {
	/**
	 * Base editor lines from super.render(width). The first line is the top
	 * border; the editor bottom border may be followed by autocomplete rows.
	 */
	lines: string[];
	width: number;
	modelId: string;
	/** Thinking level label, or "" when thinking should not be shown. */
	thinkingLabel: string;
	/** Thinking border colour for the current level (theme.getThinkingBorderColor). */
	thinkingColor: (text: string) => string;
	contextPercent: number | null;
	contextTokens: number | null;
	contextWindow: number;
	cwd: string;
	branch: string | undefined;
	colorize: BorderColorize;
	borderColor: (text: string) => string;
}

const ANSI_ESCAPE_RE =
	/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|_[^\x1B]*(?:\x1B\\)|[@-Z\\-_])/g;

function stripAnsiForBorderDetection(text: string): string {
	return text.replace(ANSI_ESCAPE_RE, "");
}

function isEditorBorderLine(line: string, width: number): boolean {
	const plain = stripAnsiForBorderDetection(line);
	const dashCount = [...plain].filter((ch) => ch === "─").length;
	return (
		visibleWidth(line) === width &&
		plain.startsWith("─") &&
		dashCount >= Math.max(1, Math.floor(width / 2))
	);
}

function findEditorBottomBorderIndex(lines: string[], width: number): number {
	for (let i = lines.length - 1; i >= 1; i--) {
		if (isEditorBorderLine(lines[i], width)) return i;
	}
	return lines.length - 1;
}

/**
 * Rewrite the top and bottom border lines with fitted status text. If the base
 * editor appended autocomplete rows after its stock bottom border, remove that
 * interior border and draw the status border below the autocomplete rows so no
 * match row is overwritten. Pure: all theme/context data is supplied by the
 * caller so it is unit-testable without a live editor.
 */
export function composeBorderLines(p: ComposeBorderLinesOptions): string[] {
	if (p.lines.length < 2) return p.lines;

	const { colorize, width } = p;
	const cwdStr = formatCwd(p.cwd);

	// Plain-text widths (independent of any colour markers) for the dropper.
	const modelWidth = visibleWidth(p.modelId);
	const thinkingWidth = p.thinkingLabel
		? visibleWidth(" " + p.thinkingLabel)
		: 0;
	const pctPlain =
		p.contextPercent === null ? "?" : `${p.contextPercent.toFixed(1)}%`;
	const pctWidth = visibleWidth(pctPlain);
	const tokenWindowPlain =
		" " +
		(p.contextTokens === null ? "?" : formatTokens(p.contextTokens)) +
		"/" +
		formatTokens(p.contextWindow);
	const tokenWindowWidth = p.contextWindow > 0 ? visibleWidth(tokenWindowPlain) : 0;
	const cwdWidth = visibleWidth(cwdStr);
	const branchWidth = p.branch ? visibleWidth(" " + p.branch) : 0;

	const flags = computeBorderVisibility({
		width,
		modelWidth,
		thinkingWidth,
		pctWidth,
		tokenWindowWidth,
		cwdWidth,
		branchWidth,
		ellipsisWidth: 1,
		hasThinking: thinkingWidth > 0,
		hasBranch: branchWidth > 0,
		hasTokenWindow: tokenWindowWidth > 0,
	});

	// Bottom-left: model + optional thinking.
	let bottomLeft = colorize("model", p.modelId);
	if (flags.showThinking) {
		bottomLeft += " " + p.thinkingColor(p.thinkingLabel);
	}

	// Bottom-right: optional used/total token window, then the context
	// percentage (kept rightmost). Width accounting is unchanged.
	const percent = formatContextPercent(p.contextPercent, colorize);
	const bottomRight = flags.showTokenWindow
		? formatContextTokenWindow(p.contextTokens, p.contextWindow, colorize) +
			" " +
			percent
		: percent;

	// Top-right: cwd + optional branch, tail-truncated to fit its block budget.
	const topRightBudget = width - CORNERS - GAP - BLOCK_PAD;
	const topRight = fitTopRight(
		cwdStr,
		flags.showBranch ? p.branch : undefined,
		Math.max(0, topRightBudget),
		colorize,
	);

	const bottomLine = fitBorder(
		` ${bottomLeft} `,
		` ${bottomRight} `,
		width,
		p.borderColor,
	);
	const bottomBorderIndex = findEditorBottomBorderIndex(p.lines, width);

	const out = [...p.lines];
	out[0] = fitBorder("", ` ${topRight} `, width, p.borderColor);
	if (bottomBorderIndex < out.length - 1) {
		out.splice(bottomBorderIndex, 1);
		out.push(bottomLine);
	} else {
		out[bottomBorderIndex] = bottomLine;
	}
	return out;
}

// ─── Branch tracking ───────────────────────────────────────────────────────────

type ExecFn = (
	command: string,
	args: string[],
	options?: { cwd?: string },
) => Promise<{ stdout: string } | undefined>;

export interface BranchTracker {
	current(): string | undefined;
	refresh(exec: ExecFn, cwd: string, onChange: () => void): Promise<void>;
}

/**
 * Track the current git branch. `refresh` re-reads the branch and invokes
 * `onChange` only when the value actually changes, so re-renders happen only on
 * real branch switches (matching the footer's onBranchChange semantics).
 */
export function createBranchTracker(): BranchTracker {
	let current: string | undefined;
	return {
		current() {
			return current;
		},
		async refresh(exec, cwd, onChange) {
			let next: string | undefined;
			try {
				const result = await exec("git", ["branch", "--show-current"], { cwd });
				const stdout = result?.stdout?.trim();
				next = stdout && stdout.length > 0 ? stdout : undefined;
			} catch {
				next = undefined;
			}
			if (next !== current) {
				current = next;
				onChange();
			}
		},
	};
}

// ─── Renderer install ──────────────────────────────────────────────────────────

/**
 * Install the border-status editor into the active session and return a handle
 * the status coordinator uses to remove it and to refresh the git branch when
 * the agent settles. The border editor is one of the mutually-exclusive status
 * placements; the coordinator owns the session lifecycle, so this module no
 * longer registers its own session handlers.
 */
export function installBorderStatus(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): StatusRendererHandle {
	let activeTui: TUI | undefined;
	const tracker = createBranchTracker();

	const refreshBranch = () => {
		void tracker.refresh(pi.exec as unknown as ExecFn, ctx.cwd, () =>
			activeTui?.requestRender(),
		);
	};
	refreshBranch();

	class BorderStatusEditor extends CustomEditor {
		constructor(
			tui: TUI,
			theme: EditorTheme,
			keybindings: KeybindingsManager,
		) {
			super(tui, theme, keybindings, { paddingX: 0 });
			activeTui = tui;
		}

		render(width: number): string[] {
			const lines = super.render(width);
			if (lines.length < 2) return lines;

			const theme = ctx.ui.theme;
			const colorize: BorderColorize = (field, text) =>
				theme.fg(BORDER_TOKENS[field], text);

			const modelId = ctx.model?.id ?? "no-model";

			const thinkingLevel = pi.getThinkingLevel() ?? "off";
			const thinkingLabel = ctx.model?.reasoning
				? getThinkingLabel(thinkingLevel)
				: "";
			const thinkingColor = theme.getThinkingBorderColor(thinkingLevel);

			const usage = ctx.getContextUsage();
			const contextWindow =
				usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;

			return composeBorderLines({
				lines,
				width,
				modelId,
				thinkingLabel,
				thinkingColor,
				contextPercent: usage?.percent ?? null,
				contextTokens: usage?.tokens ?? null,
				contextWindow,
				cwd: ctx.cwd,
				branch: tracker.current(),
				colorize,
				borderColor: (text: string) => this.borderColor(text),
			});
		}
	}

	ctx.ui.setEditorComponent(
		(tui, theme, keybindings) =>
			new BorderStatusEditor(tui, theme, keybindings),
	);

	return {
		dispose() {
			activeTui = undefined;
			ctx.ui.setEditorComponent(undefined);
		},
		// Re-read the branch when the agent settles, in case it changed mid-turn.
		onAgentEnd() {
			refreshBranch();
		},
	};
}
