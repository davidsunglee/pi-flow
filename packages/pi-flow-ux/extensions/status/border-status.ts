/**
 * Border-status editor extension
 *
 * Draws key session metadata into the editor's top and bottom border lines,
 * following pi's `border-status-editor.ts` example pattern (extend CustomEditor,
 * override render(width), rewrite the top/bottom border rows and frame the
 * interior rows with vertical edges to close the rectangle).
 *
 * Layout (closed rectangle; the cwd alone sits on the top edge):
 *   top edge:    ╭───────────────────────────────────  ~/path ─╮
 *   side rows:   │ …editor content…                            │
 *   bottom edge: ╰─ model thinking ──────  used/total context% ─╯
 *
 * Emphasized fields stay in lock-step with the footer; the lower-priority
 * secondary status fields (thinking label and token counts) are de-emphasized to
 * the muted token:
 *   - model              → "accent"      (footer modelName: accent / Nord nord8)
 *   - context %          → "accent"      (footer contextUsage: accent / Nord nord8)
 *   - cwd                → "success"     (emphasized path / Nord nord14)
 *   - "/" and ellipsis   → "borderMuted" (footer symbols: borderMuted / Nord nord3)
 *   - thinking           → "muted"       (de-emphasized status label, like the token counts)
 *   - contextTokensUsed  → "muted"       (de-emphasized; own field, shares muted)
 *   - contextWindowTotal → "muted"       (de-emphasized; own field, shares muted)
 *
 * The editor border *stroke* (top/bottom dashes, corners, vertical edges) is a
 * separate concern: it follows the active thinking/bash mode via
 * resolveEditorBorderColor so it stays in sync with Pi's editor, while the
 * thinking *status label* above is just a muted semantic status field.
 *
 * Because these tokens resolve per-render, theme switches update the border
 * colours automatically with no cached ANSI to invalidate.
 *
 * This internal status renderer installs only a custom editor (via
 * setEditorComponent) and never touches the footer. The status coordinator
 * pairs it with the blank-footer renderer so the border remains the only
 * visible status surface.
 */

import {
	CustomEditor,
	SettingsManager,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
	buildWorkingIndicator,
	pickWorkingIndicatorFrame,
} from "../working/effects.ts";
import {
	getWorkingCoordinator,
	type WorkingSnapshot,
} from "../working/working.ts";
import type { StatusRendererHandle } from "./status.ts";

// ─── Colour routing ─────────────────────────────────────────────────────────

/**
 * Semantic border status fields. Every field routes through a static theme token
 * via {@link BORDER_TOKENS} (the thinking label is a muted semantic status
 * field). The editor border *stroke* colour is resolved separately by
 * {@link resolveEditorBorderColor} from the active thinking/bash mode.
 */
export type BorderColorField =
	| "model"
	| "context"
	| "symbol"
	| "cwd"
	| "thinking"
	| "contextTokensUsed"
	| "contextWindowTotal";

/** Colorize callback shared by the formatting helpers and composeBorderLines. */
export type BorderColorize = (field: BorderColorField, text: string) => string;

/**
 * Theme tokens for every border status field. The thinking label, used-token,
 * and total-window fields are intentionally de-emphasized to the same `muted`
 * token while remaining distinct semantic keys.
 */
export const BORDER_TOKENS: Record<BorderColorField, ThemeColor> = {
	model: "accent",
	context: "accent",
	symbol: "borderMuted",
	cwd: "success",
	thinking: "muted",
	contextTokensUsed: "muted",
	contextWindowTotal: "muted",
};

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
type TextColorizer = (text: string) => string;

/**
 * Mirror Pi's editor border-colour routing inside the custom border editor.
 * Pi updates only the currently active editor when thinking/bash mode changes;
 * a custom editor installed after that can inherit a stale default-editor
 * border colour. Resolving from the live editor text and thinking level at
 * render time keeps runtime /status switches in sync with the host behaviour.
 */
export function resolveEditorBorderColor(
	editorText: string,
	theme: {
		getThinkingBorderColor(level: ThinkingLevel): TextColorizer;
		getBashModeBorderColor(): TextColorizer;
	},
	thinkingLevel: ThinkingLevel,
): TextColorizer {
	return editorText.trimStart().startsWith("!")
		? theme.getBashModeBorderColor()
		: theme.getThinkingBorderColor(thinkingLevel);
}

function loadAutocompleteMaxVisible(cwd: string): number | undefined {
	try {
		return SettingsManager.create(cwd).getAutocompleteMaxVisible();
	} catch {
		return undefined;
	}
}

function getBorderEditorOptions(cwd: string): {
	paddingX: number;
	autocompleteMaxVisible?: number;
} {
	const autocompleteMaxVisible = loadAutocompleteMaxVisible(cwd);
	return autocompleteMaxVisible === undefined
		? { paddingX: 0 }
		: { paddingX: 0, autocompleteMaxVisible };
}

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
 * Context token window as "used/total". The used count and total window each
 * route through their own muted semantic field to de-emphasize them relative
 * to the percentage, while the slash stays subdued on the symbol field.
 */
export function formatContextTokenWindow(
	tokens: number | null | undefined,
	contextWindow: number,
	colorize: BorderColorize,
): string {
	const used =
		tokens === null || tokens === undefined ? "?" : formatTokens(tokens);
	return (
		colorize("contextTokensUsed", used) +
		colorize("symbol", "/") +
		colorize("contextWindowTotal", formatTokens(contextWindow))
	);
}

// ─── Border fitting ─────────────────────────────────────────────────────────

/**
 * Fit left/right status text into a single border line of the given width.
 * Truncates right text first, then left text, ANSI-safely, never breaking the
 * corner dashes. Ported from pi's border-status-editor example.
 *
 * `shoulders` optionally draws one extra border-coloured dash just inside the
 * matching corner, nudging that status block one column toward the centre. The
 * shoulder is counted in the fixed overhead so the line still spans exactly
 * `width`, and is suppressed at widths too narrow to hold the corners plus
 * shoulders so the tight-width behaviour is unchanged.
 */
export function fitBorder(
	left: string,
	right: string,
	width: number,
	border: (text: string) => string,
	fill: (text: string) => string = border,
	caps: { left: string; right: string } = { left: "─", right: "─" },
	shoulders: { left: boolean; right: boolean } = { left: false, right: false },
): string {
	if (width <= 0) return "";
	if (width === 1) return border(caps.left);

	let leftShoulder = shoulders.left;
	let rightShoulder = shoulders.right;
	// Without room for the corners plus shoulders, drop the shoulders so the
	// line never exceeds `width` at very narrow terminals.
	if (width < 2 + (leftShoulder ? 1 : 0) + (rightShoulder ? 1 : 0)) {
		leftShoulder = false;
		rightShoulder = false;
	}

	let leftText = left;
	let rightText = right;
	const fixedWidth = 2 + (leftShoulder ? 1 : 0) + (rightShoulder ? 1 : 0);
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
	const leftCap = border(caps.left) + (leftShoulder ? border("─") : "");
	const rightCap = (rightShoulder ? border("─") : "") + border(caps.right);
	return `${leftCap}${leftText}${fill("─".repeat(gapWidth))}${rightText}${rightCap}`;
}

/** Return the last `maxWidth` characters of `text` (plain text, no ANSI). */
function tailTruncate(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) return text;
	return text.slice(text.length - maxWidth);
}

/**
 * Build the upper-right status block (cwd only), fitting it within `maxWidth`.
 * The cwd is tail-truncated (with a leading ellipsis) so the tail of the path
 * stays visible. The cwd is always present and never dropped.
 */
export function fitTopRight(
	cwdStr: string,
	maxWidth: number,
	colorize: BorderColorize,
): string {
	const cwdColored = colorize("cwd", cwdStr);

	if (visibleWidth(cwdColored) <= maxWidth) {
		return cwdColored;
	}

	const ellipsis = colorize("symbol", "…");
	const availForCwd = maxWidth - 1; // 1 for the ellipsis
	if (availForCwd >= 1) {
		return ellipsis + colorize("cwd", tailTruncate(cwdStr, availForCwd));
	}

	// Not even room for the ellipsis plus one cwd char: last-resort ANSI-safe truncate.
	return truncateToWidth(cwdColored, Math.max(0, maxWidth), "");
}

// ─── Responsive priority dropper ───────────────────────────────────────────────

/** Per-field width measurements fed to the priority dropper. */
export interface BorderFieldWidths {
	width: number; // terminal width
	modelWidth: number; // bottom-left, highest priority (never dropped)
	thinkingWidth: number; // bottom-left optional; includes leading separator space
	pctWidth: number; // bottom-right, highest priority (never dropped)
	tokenWindowWidth: number; // bottom-right optional; includes leading separator space
	hasThinking: boolean;
	hasTokenWindow: boolean;
	// Fixed-width activity slot reserved before the model name (0 when no slot).
	// Counted in the bottom-left budget so the optional fields drop correctly.
	activitySlotWidth?: number;
}

/** Surviving optional-field visibility after the priority dropper has run. */
export interface BorderVisibility {
	showThinking: boolean;
	showTokenWindow: boolean;
}

// Per-line layout overhead, kept in sync with composeBorderLines / fitBorder.
const CORNERS = 2; // leading + trailing corner dash
const GAP = 3; // fitBorder minimumGap between left and right blocks
const BLOCK_PAD = 2; // one leading + one trailing space padding per status block
// Shoulder dashes drawn just inside the corners to nudge each block one column
// toward the centre. The bottom line carries one inside each corner (bottom-left
// shifts right, bottom-right shifts left); the top line carries one inside the
// right corner only (top-right shifts left; top-left is unchanged).
const SHOULDERS_BOTTOM = 2;
const SHOULDER_TOP = 1;

/**
 * Pure priority dropper. Model id and context percentage are always kept; the
 * cwd on the top edge is always present (tail-truncated, never dropped), so only
 * the two bottom-edge optional fields can drop. They drop in a strict priority
 * order as the terminal narrows — token window first, then thinking — each
 * sacrificed (lowest priority first) until the bottom border line fits.
 */
export function computeBorderVisibility(f: BorderFieldWidths): BorderVisibility {
	let showTokenWindow = f.hasTokenWindow;
	let showThinking = f.hasThinking;

	const bottomFits = (): boolean => {
		const left =
			(f.activitySlotWidth ?? 0) +
			f.modelWidth +
			(showThinking ? f.thinkingWidth : 0);
		const right = f.pctWidth + (showTokenWindow ? f.tokenWindowWidth : 0);
		return (
			CORNERS + SHOULDERS_BOTTOM + BLOCK_PAD + left + BLOCK_PAD + right + GAP <=
			f.width
		);
	};

	if (showTokenWindow && !bottomFits()) showTokenWindow = false;
	if (showThinking && !bottomFits()) showThinking = false;

	return { showThinking, showTokenWindow };
}

// ─── Border line composition ───────────────────────────────────────────────────

/**
 * Compact working-state indicator embedded in the bottom border, just left of
 * the model name. When `active`, `glyph` is a pre-styled single-visible-width
 * frame (the working indicator's own spinner/pulse/wave glyph, already coloured
 * with any gleam/rainbow effects). When idle, the slot is filled with border
 * dashes so the border stays visually continuous and the model column never
 * jitters between idle and active frames.
 */
export interface BorderActivity {
	active: boolean;
	/** Pre-styled, single-visible-width indicator glyph; used only when active. */
	glyph: string;
}

// Visible columns the activity slot adds to the bottom-left block beyond the
// existing block padding: one indicator column plus its trailing separator
// (active), or two border dashes (idle). Both keep the model column stable.
const ACTIVITY_SLOT_WIDTH = 2;

/**
 * Map a working snapshot to the border activity slot. While a turn is active the
 * slot shows the working indicator's own styled frame for the current state
 * (reusing the shared frame generation, so spinner/pulse/wave shape, gleam, and
 * rainbow styling all carry over); otherwise the slot is idle and the border
 * fills it. `nowMs` selects the animation frame from a wall-clock timestamp.
 */
export function resolveBorderActivity(
	snapshot: WorkingSnapshot,
	nowMs: number,
): BorderActivity {
	if (!snapshot.visible) return { active: false, glyph: "" };
	const style = snapshot.settings[snapshot.state];
	return {
		active: true,
		glyph: pickWorkingIndicatorFrame(
			snapshot.settings.indicatorShape,
			style,
			nowMs,
		),
	};
}

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
	contextPercent: number | null;
	contextTokens: number | null;
	contextWindow: number;
	cwd: string;
	colorize: BorderColorize;
	borderColor: (text: string) => string;
	/**
	 * Optional compact working-state slot. When present, a fixed-width activity
	 * slot is reserved before the model name (rendering `glyph` while active and
	 * border fill while idle). When omitted, no slot is reserved.
	 */
	activity?: BorderActivity;
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

	const flags = computeBorderVisibility({
		width,
		modelWidth,
		thinkingWidth,
		pctWidth,
		tokenWindowWidth,
		hasThinking: thinkingWidth > 0,
		hasTokenWindow: tokenWindowWidth > 0,
		activitySlotWidth: p.activity ? ACTIVITY_SLOT_WIDTH : 0,
	});

	// Bottom-left: optional activity slot, then model + optional thinking.
	let bottomLeft = colorize("model", p.modelId);
	if (flags.showThinking) {
		bottomLeft += " " + colorize("thinking", p.thinkingLabel);
	}

	// Compose the bottom-left status text together with its surrounding block
	// padding. The activity slot, when present, occupies a fixed two columns
	// before the model so the model column stays put across idle/active frames:
	//   active: " ⠋ model "   (leading pad, glyph, separator, …, trailing pad)
	//   idle:   "── model "   (two border dashes fill the glyph + separator)
	let bottomLeftBlock: string;
	if (p.activity) {
		bottomLeftBlock =
			p.activity.active && p.activity.glyph
				? ` ${p.activity.glyph} ${bottomLeft} `
				: `${p.borderColor("──")} ${bottomLeft} `;
	} else {
		bottomLeftBlock = ` ${bottomLeft} `;
	}

	// Bottom-right: optional used/total token window, then the context
	// percentage (kept rightmost). Width accounting is unchanged.
	const percent = formatContextPercent(p.contextPercent, colorize);
	const bottomRight = flags.showTokenWindow
		? formatContextTokenWindow(p.contextTokens, p.contextWindow, colorize) +
			" " +
			percent
		: percent;

	// Top-right: cwd only, tail-truncated to fit its block budget.
	const topRightBudget = width - CORNERS - SHOULDER_TOP - GAP - BLOCK_PAD;
	const topRight = fitTopRight(cwdStr, Math.max(0, topRightBudget), colorize);

	// Two columns are reserved for the left/right vertical edges. The caller
	// renders the inner editor at this width, so each interior row — padded to
	// `innerWidth` if shorter, then wrapped in a vertical bar on each side —
	// spans exactly `width`.
	const innerWidth = Math.max(1, width - 2);

	const topLine = fitBorder(
		"",
		` ${topRight} `,
		width,
		p.borderColor,
		p.borderColor,
		{ left: "╭", right: "╮" },
		// Top-right nudges left; the top-left corner stays put.
		{ left: false, right: true },
	);
	const bottomLine = fitBorder(
		bottomLeftBlock,
		` ${bottomRight} `,
		width,
		p.borderColor,
		p.borderColor,
		{ left: "╰", right: "╯" },
		// Bottom-left nudges right, bottom-right nudges left.
		{ left: true, right: true },
	);
	const bottomBorderIndex = findEditorBottomBorderIndex(p.lines, innerWidth);

	const out = [...p.lines];
	out[0] = topLine;
	if (bottomBorderIndex < out.length - 1) {
		out.splice(bottomBorderIndex, 1);
		out.push(bottomLine);
	} else {
		out[bottomBorderIndex] = bottomLine;
	}

	// Frame the interior rows (editor content + any autocomplete rows) with
	// vertical edges so the horizontal borders join into a closed rectangle.
	// Content rows already span `innerWidth`, but shorter rows (e.g. autocomplete
	// matches) do not, so each row is right-padded to `innerWidth` before the
	// bars are added. One bar on each side then restores `width` with the right
	// edge at the rectangle's right side, without overwriting any content (the
	// cursor marker stays inside the row, shifted one column right, and the TUI
	// recomputes its column from this line).
	// At widths < 3 there is no room for both vertical edges plus a content
	// column, so framing would push interior rows past `width` (e.g. `│x│` is 3
	// columns wide). In that case skip the edges and clamp each row to `width`
	// so pi-tui's width validation never sees an over-wide line.
	const verticalEdge = p.borderColor("│");
	const canFrame = width >= 3;
	for (let i = 1; i < out.length - 1; i++) {
		if (canFrame) {
			const pad = Math.max(0, innerWidth - visibleWidth(out[i]));
			out[i] = verticalEdge + out[i] + " ".repeat(pad) + verticalEdge;
		} else if (visibleWidth(out[i]) > width) {
			out[i] = truncateToWidth(out[i], Math.max(0, width), "");
		}
	}
	return out;
}

// ─── Renderer install ──────────────────────────────────────────────────────────

/**
 * Frame cadence for the border activity slot, or `undefined` when the current
 * indicator is static (a single frame) and needs no animation timer. The
 * cadence mirrors the working indicator's own per-shape timing.
 */
function borderActivityCadenceMs(snapshot: WorkingSnapshot): number | undefined {
	const style = snapshot.settings[snapshot.state];
	const { frames, intervalMs } = buildWorkingIndicator(
		snapshot.settings.indicatorShape,
		style,
	);
	if (!frames || frames.length <= 1) return undefined;
	return intervalMs ?? 120;
}

/**
 * Install the border-status editor into the active session and return a handle
 * the status coordinator uses to remove it. The border editor is one of the
 * mutually-exclusive status placements; the coordinator owns the session
 * lifecycle, so this module no longer registers its own session handlers.
 *
 * While installed, the border owns the compact working indicator: it flags the
 * shared working coordinator so the host loader-row indicator/message
 * extensions stand down, consumes the working snapshot to draw the activity
 * slot, and drives a modest animation timer so the slot animates independently
 * of the host's own loader.
 */
export function installBorderStatus(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): StatusRendererHandle {
	const working = getWorkingCoordinator();
	let editor: BorderStatusEditor | undefined;
	let animationTimer: ReturnType<typeof setInterval> | undefined;
	let timerCadence: number | undefined;

	function stopAnimation(): void {
		if (animationTimer !== undefined) {
			clearInterval(animationTimer);
			animationTimer = undefined;
		}
		timerCadence = undefined;
	}

	// Re-render the border on every working-state change, and run a timer at the
	// indicator's cadence while a turn is active so the slot animates. The timer
	// only requests a redraw (cheap); the frame itself is recomputed from the
	// snapshot and wall clock inside render().
	function syncAnimation(snapshot: WorkingSnapshot): void {
		editor?.requestRedraw();
		const cadence = snapshot.visible
			? borderActivityCadenceMs(snapshot)
			: undefined;
		if (cadence === undefined) {
			stopAnimation();
			return;
		}
		if (animationTimer !== undefined && timerCadence === cadence) return;
		stopAnimation();
		timerCadence = cadence;
		animationTimer = setInterval(() => editor?.requestRedraw(), cadence);
	}

	const unsubscribe = working.subscribe(syncAnimation);
	working.setBorderOwnsIndicator(true);

	class BorderStatusEditor extends CustomEditor {
		constructor(
			tui: TUI,
			theme: EditorTheme,
			keybindings: KeybindingsManager,
		) {
			super(tui, theme, keybindings, getBorderEditorOptions(ctx.cwd));
		}

		/** Ask the TUI to re-render so the animated activity slot advances. */
		requestRedraw(): void {
			this.tui.requestRender();
		}

		render(width: number): string[] {
			// Reserve two columns for the rectangle's vertical edges so the
			// framed interior rows span the full width.
			const innerWidth = Math.max(1, width - 2);
			const lines = super.render(innerWidth);
			if (lines.length < 2) return lines;

			const theme = ctx.ui.theme;
			const thinkingLevel = pi.getThinkingLevel() ?? "off";
			const borderColor = resolveEditorBorderColor(
				this.getText(),
				theme,
				thinkingLevel,
			);
			const colorize: BorderColorize = (field, text) =>
				theme.fg(BORDER_TOKENS[field], text);

			const modelId = ctx.model?.id ?? "no-model";

			const thinkingLabel = ctx.model?.reasoning
				? getThinkingLabel(thinkingLevel)
				: "";

			const usage = ctx.getContextUsage();
			const contextWindow =
				usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;

			return composeBorderLines({
				lines,
				width,
				modelId,
				thinkingLabel,
				contextPercent: usage?.percent ?? null,
				contextTokens: usage?.tokens ?? null,
				contextWindow,
				cwd: ctx.cwd,
				colorize,
				borderColor,
				activity: resolveBorderActivity(working.getSnapshot(), Date.now()),
			});
		}
	}

	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		editor = new BorderStatusEditor(tui, theme, keybindings);
		return editor;
	});

	return {
		dispose() {
			stopAnimation();
			unsubscribe();
			working.setBorderOwnsIndicator(false);
			ctx.ui.setEditorComponent(undefined);
		},
	};
}
