import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	BORDER_TOKENS,
	composeBorderLines,
	computeBorderVisibility,
	fitBorder,
	fitTopRight,
	formatContextPercent,
	formatContextTokenWindow,
	formatCwd,
	getThinkingLabel,
	installBorderEditor,
	resolveBorderActivity,
	resolveEditorBorderColor,
	resolveEditorTimerCadence,
	type BorderFieldWidths,
} from "./editor.ts";
import { buildWorkingIndicator, pickWorkingIndicatorFrame } from "./effects.ts";
import type { WorkingSnapshot } from "./working.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

/** Marker colorize for routing assertions: wraps text in `[field:text]`. */
const markerColorize = (field: string, text: string) => `[${field}:${text}]`;
/** Identity colorize for width-sensitive assertions. */
const idColorize = (_field: string, text: string) => text;
/** Identity border/fill renderer so visibleWidth stays accurate. */
const idBorder = (text: string) => text;

/**
 * Build a BorderFieldWidths object with sensible zero defaults; tests override
 * only the fields they exercise.
 *
 * Width-measurement reminder:
 *   - thinkingWidth / tokenWindowWidth INCLUDE their leading single-space
 *     separator (matches production measurement).
 */
function bw(
	width: number,
	overrides: Partial<BorderFieldWidths> = {},
): BorderFieldWidths {
	const base: BorderFieldWidths = {
		width,
		modelWidth: 0,
		thinkingWidth: 0,
		pctWidth: 0,
		tokenWindowWidth: 0,
		hasThinking: false,
		hasTokenWindow: false,
	};
	return { ...base, ...overrides };
}

// ─── Footer independence ───────────────────────────────────────────────────────

test("editor does not import from the footer extension", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./editor.ts", import.meta.url)),
		"utf8",
	);
	assert.ok(
		!/from\s+["']\.\/footer(\.ts)?["']/.test(source),
		"editor.ts must be self-contained and not import from ./footer",
	);
});

// ─── No git branch in the border ─────────────────────────────────────────────

test("editor carries no git branch tracking", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./editor.ts", import.meta.url)),
		"utf8",
	);
	assert.ok(
		!/branch/i.test(source),
		"editor.ts must not reference the git branch anywhere",
	);
});

// ─── getThinkingLabel ──────────────────────────────────────────────────────────

test("getThinkingLabel returns the level when reasoning is active", () => {
	assert.equal(getThinkingLabel("high"), "high");
	assert.equal(getThinkingLabel("xhigh"), "xhigh");
});

test("getThinkingLabel hides the label when off, null, or undefined", () => {
	assert.equal(getThinkingLabel("off"), "");
	assert.equal(getThinkingLabel(null), "");
	assert.equal(getThinkingLabel(undefined), "");
});

// ─── formatCwd ────────────────────────────────────────────────────────────────

test("formatCwd substitutes home prefix with ~", () => {
	const origHome = process.env.HOME;
	process.env.HOME = "/Users/test";
	try {
		assert.equal(formatCwd("/Users/test/proj"), "~/proj");
		assert.equal(formatCwd("/Users/test"), "~");
		assert.equal(formatCwd("/var/log"), "/var/log");
	} finally {
		process.env.HOME = origHome;
	}
});

// ─── Colour-field routing ──────────────────────────────────────────────────────

test("context percentage is routed to the context color", () => {
	assert.equal(formatContextPercent(12.3, markerColorize), "[context:12.3%]");
});

test("unknown context percentage uses the subdued symbol color", () => {
	assert.equal(formatContextPercent(null, markerColorize), "[symbol:?]");
});

test("token window routes used/total counts through their own semantic fields and the slash to symbol color", () => {
	// formatTokens(9300) === "9.3k", formatTokens(200000) === "200k"
	assert.equal(
		formatContextTokenWindow(9300, 200000, markerColorize),
		"[contextTokensUsed:9.3k][symbol:/][contextWindowTotal:200k]",
	);
	assert.equal(
		formatContextTokenWindow(null, 200000, markerColorize),
		"[contextTokensUsed:?][symbol:/][contextWindowTotal:200k]",
	);
});

test("border tokens map model/context to accent, cwd to success, symbol to borderMuted, and muted secondary fields to muted", () => {
	assert.equal(BORDER_TOKENS.model, "accent");
	assert.equal(BORDER_TOKENS.context, "accent");
	assert.equal(BORDER_TOKENS.cwd, "success");
	assert.equal(BORDER_TOKENS.symbol, "borderMuted");
	assert.equal(BORDER_TOKENS.thinking, "muted");
	assert.equal(BORDER_TOKENS.contextTokensUsed, "muted");
	assert.equal(BORDER_TOKENS.contextWindowTotal, "muted");
	// thinking is now a muted semantic status field with its own static token —
	// the editor border *stroke* tracks the active thinking level separately.
	assert.equal(
		Object.prototype.hasOwnProperty.call(BORDER_TOKENS, "thinking"),
		true,
		"thinking is a muted semantic status field, covered by a static token",
	);
	assert.equal(
		Object.prototype.hasOwnProperty.call(BORDER_TOKENS, "branch"),
		false,
		"there must be no branch token",
	);
	// The muted secondary fields remain distinct semantic keys even though they
	// share the muted token.
	const secondaryKeys = ["thinking", "contextTokensUsed", "contextWindowTotal"];
	assert.equal(new Set(secondaryKeys).size, secondaryKeys.length);
});

// ─── computeBorderVisibility (priority dropper) ────────────────────────────────

test("wide terminal keeps every optional border field visible", () => {
	const flags = computeBorderVisibility(
		bw(200, {
			modelWidth: 7,
			thinkingWidth: 6,
			pctWidth: 5,
			tokenWindowWidth: 10,
			hasThinking: true,
			hasTokenWindow: true,
		}),
	);
	assert.ok(flags.showTokenWindow);
	assert.ok(flags.showThinking);
});

test("token window drops before thinking", () => {
	// bottom overhead 11 (corners 2 + shoulders 2 + 2×block-pad 4 + gap 3).
	// with token window: 11 + (7 + 6) + (5 + 10) = 39 > 30 → drop token window.
	// without token window: 11 + (7 + 6) + 5 = 29 ≤ 30 → thinking survives.
	const flags = computeBorderVisibility(
		bw(30, {
			modelWidth: 7,
			thinkingWidth: 6,
			pctWidth: 5,
			tokenWindowWidth: 10,
			hasThinking: true,
			hasTokenWindow: true,
		}),
	);
	assert.ok(!flags.showTokenWindow, "token window should drop first");
	assert.ok(flags.showThinking, "thinking should survive");
});

test("thinking drops last among optional border fields", () => {
	// bottom with thinking: 11 + (3 + 3) + 2 = 19 > 16 → thinking drops.
	const flags = computeBorderVisibility(
		bw(16, {
			modelWidth: 3,
			thinkingWidth: 3,
			pctWidth: 2,
			hasThinking: true,
		}),
	);
	assert.ok(!flags.showThinking, "thinking should drop when even it cannot fit");
});

// ─── fitTopRight ───────────────────────────────────────────────────────────────

test("fitTopRight returns the full cwd when it fits", () => {
	const out = fitTopRight("~/proj", 40, idColorize);
	assert.equal(out, "~/proj");
});

test("fitTopRight tail-truncates the cwd with a leading ellipsis", () => {
	// maxWidth 7: ellipsis (1) leaves availForCwd = 6; tail 6 of "/a/b/c/deep" === "c/deep".
	const out = fitTopRight("/a/b/c/deep", 7, idColorize);
	assert.equal(out, "…c/deep");
	assert.ok(visibleWidth(out) <= 7);
});

// ─── fitBorder ─────────────────────────────────────────────────────────────────

test("fitBorder places left and right text and fills the full width", () => {
	const line = fitBorder(" L ", " R ", 20, idBorder);
	assert.equal(visibleWidth(line), 20);
	assert.ok(line.includes(" L "));
	assert.ok(line.includes(" R "));
});

test("fitBorder truncates right text first when too narrow", () => {
	const line = fitBorder("LEFT", "RIGHTSIDE", 12, idBorder);
	assert.equal(visibleWidth(line), 12);
});

test("fitBorder applies custom corner caps", () => {
	const line = fitBorder(" L ", " R ", 20, idBorder, idBorder, {
		left: "╭",
		right: "╮",
	});
	assert.equal(visibleWidth(line), 20);
	assert.ok(line.startsWith("╭"), "left cap applied");
	assert.ok(line.endsWith("╮"), "right cap applied");
});

// ─── composeBorderLines (integration of formatting + layout) ───────────────────

function baseLines(): string[] {
	return ["TOP-BORDER", "  editor content", "BOTTOM-BORDER"];
}

test("composeBorderLines returns lines unchanged when there are fewer than two", () => {
	const out = composeBorderLines({
		lines: ["only"],
		width: 80,
		modelId: "gpt-5.5",
		thinkingLabel: "",
		contextPercent: 10,
		contextTokens: 1000,
		contextWindow: 200000,
		cwd: "/repo",
		colorize: idColorize,
		borderColor: idBorder,
	});
	assert.deepEqual(out, ["only"]);
});

test("composeBorderLines places model+thinking lower-left, context lower-right, cwd upper-right", () => {
	const origHome = process.env.HOME;
	process.env.HOME = "/Users/test";
	try {
		const out = composeBorderLines({
			lines: baseLines(),
			// Wide enough that the marker colorize's inflated field names (which
			// add visible width that real zero-width ANSI would not) all fit.
			width: 160,
			modelId: "gpt-5.5",
			thinkingLabel: "xhigh",
			contextPercent: 12.3,
			contextTokens: 9300,
			contextWindow: 200000,
			cwd: "/Users/test/proj",
			colorize: markerColorize,
			borderColor: idBorder,
		});

		const top = out[0];
		const bottom = out[2];
		assert.notEqual(top, "TOP-BORDER", "top border should be rewritten");
		assert.notEqual(bottom, "BOTTOM-BORDER", "bottom border should be rewritten");

		// Upper-right: cwd only (success), with ~ home substitution. No branch.
		assert.ok(top.includes("[cwd:~/proj]"), "cwd routed to cwd color with ~ substitution");
		assert.ok(!/\[branch:/.test(top), "no git branch should appear on the top border");

		// Lower-left: model (accent) and thinking de-emphasized via the thinking field.
		assert.ok(bottom.includes("[model:gpt-5.5]"), "model routed to model color");
		assert.ok(bottom.includes("[thinking:xhigh]"), "thinking routed to its own muted field");

		// Lower-right: used/total token window with subdued slash, then percentage.
		assert.ok(bottom.includes("[context:12.3%]"), "percentage routed to context color");
		assert.ok(bottom.includes("[contextTokensUsed:9.3k]"), "used tokens routed to their own field");
		assert.ok(bottom.includes("[symbol:/]"), "slash uses subdued symbol color");
		assert.ok(bottom.includes("[contextWindowTotal:200k]"), "total tokens routed to their own field");
		// Used/total render before the percentage (percentage rightmost).
		assert.ok(
			bottom.indexOf("[contextTokensUsed:9.3k]") <
				bottom.indexOf("[symbol:/]"),
			"used tokens appear before the slash",
		);
		assert.ok(
			bottom.indexOf("[symbol:/]") <
				bottom.indexOf("[contextWindowTotal:200k]"),
			"slash appears before the total window",
		);
		assert.ok(
			bottom.indexOf("[contextWindowTotal:200k]") <
				bottom.indexOf("[context:12.3%]"),
			"token window appears before the context percentage",
		);
	} finally {
		process.env.HOME = origHome;
	}
});

test("composeBorderLines keeps model and context percent at very narrow widths", () => {
	const out = composeBorderLines({
		lines: baseLines(),
		width: 24,
		modelId: "gpt",
		thinkingLabel: "high",
		contextPercent: 50,
		contextTokens: 1000,
		contextWindow: 200000,
		cwd: "/some/deep/path/here",
		colorize: idColorize,
		borderColor: idBorder,
	});
	const bottom = out[2];
	assert.ok(bottom.includes("gpt"), "model is never hidden");
	assert.ok(bottom.includes("50.0%"), "context percent is never hidden");
	assert.equal(visibleWidth(out[0]), 24, "top border spans full width");
	assert.equal(visibleWidth(out[2]), 24, "bottom border spans full width");
});

test("composeBorderLines always keeps the cwd on the top border, tail-truncated", () => {
	const out = composeBorderLines({
		lines: baseLines(),
		width: 24,
		modelId: "gpt",
		thinkingLabel: "",
		contextPercent: 50,
		contextTokens: 1000,
		contextWindow: 200000,
		cwd: "/some/deep/path/here",
		colorize: idColorize,
		borderColor: idBorder,
	});
	const top = out[0];
	// The tail of the path is preserved behind a leading ellipsis.
	assert.ok(top.includes("here"), "cwd tail stays visible");
	assert.ok(top.includes("…"), "cwd is tail-truncated with a leading ellipsis");
	assert.equal(visibleWidth(top), 24, "top border spans full width");
});

test("composeBorderLines drops token window, then thinking as width shrinks", () => {
	const opts = {
		lines: baseLines(),
		modelId: "m",
		thinkingLabel: "lo",
		contextPercent: 50,
		contextTokens: 1000,
		contextWindow: 200000,
		cwd: "/r",
		colorize: idColorize,
		borderColor: idBorder,
	};

	const wide = composeBorderLines({ ...opts, width: 30 });
	assert.ok(wide[2].includes("1.0k/200k"), "wide keeps token window");
	assert.ok(wide[2].includes(" lo "), "wide keeps thinking");
	assert.ok(
		wide[2].indexOf("1.0k/200k") < wide[2].indexOf("50.0%"),
		"token window renders to the left of the percentage",
	);

	// Drop token window first: pct stays, used/total gone, thinking remains.
	const noToken = composeBorderLines({ ...opts, width: 27 });
	assert.ok(!noToken[2].includes("1.0k/200k"), "token window dropped first");
	assert.ok(noToken[2].includes(" lo "), "thinking still present");
	assert.ok(noToken[2].includes("50.0%"), "percentage retained");

	// Narrower: thinking dropped next.
	const noThinking = composeBorderLines({ ...opts, width: 18 });
	assert.ok(!noThinking[2].includes(" lo "), "thinking dropped after token window");
	assert.ok(noThinking[2].includes("50.0%"), "percentage retained");
});

test("composeBorderLines preserves autocomplete matches and removes the interior stock border", () => {
	const width = 80;
	const innerWidth = width - 2;
	const stockBorder = "─".repeat(innerWidth);
	const exactMatch = "→ status";
	const out = composeBorderLines({
		lines: [stockBorder, "/stat █", stockBorder, exactMatch],
		width,
		modelId: "gpt-5.5",
		thinkingLabel: "xhigh",
		contextPercent: 12.3,
		contextTokens: 9300,
		contextWindow: 200000,
		cwd: "/repo",
		colorize: idColorize,
		borderColor: idBorder,
	});

	assert.equal(out.length, 4, "rewrapping should not add vertical height");
	assert.equal(
		out[2],
		"│" + exactMatch.padEnd(innerWidth, " ") + "│",
		"single exact command match stays visible, padded and framed to the full rectangle width",
	);
	assert.equal(
		visibleWidth(out[2]),
		width,
		"the framed autocomplete row spans the full rectangle width",
	);
	assert.ok(out[3].includes("gpt-5.5"), "status border moves below autocomplete");
	assert.equal(
		out.slice(1, -1).some((line) => line.includes(stockBorder)),
		false,
		"the original editor bottom border should not remain as an extra interior line",
	);
});

test("composeBorderLines frames the editor as a full rectangle with corners and vertical edges", () => {
	const width = 40;
	const innerWidth = width - 2;
	const content = "  hello".padEnd(innerWidth, " ");
	const out = composeBorderLines({
		lines: ["─".repeat(innerWidth), content, "─".repeat(innerWidth)],
		width,
		modelId: "m",
		thinkingLabel: "",
		contextPercent: 50,
		contextTokens: 1000,
		contextWindow: 200000,
		cwd: "/r",
		colorize: idColorize,
		borderColor: idBorder,
	});

	for (const line of out) {
		assert.equal(visibleWidth(line), width, "every row spans the full width");
	}
	assert.ok(out[0].startsWith("╭"), "top-left rounded corner");
	assert.ok(out[0].endsWith("╮"), "top-right rounded corner");
	assert.ok(out[out.length - 1].startsWith("╰"), "bottom-left rounded corner");
	assert.ok(out[out.length - 1].endsWith("╯"), "bottom-right rounded corner");
	assert.ok(out[1].startsWith("│"), "left vertical edge frames content");
	assert.ok(out[1].endsWith("│"), "right vertical edge frames content");
});

test("composeBorderLines nudges bottom-left right and bottom-right/top-right left with shoulder dashes inside the corners", () => {
	const out = composeBorderLines({
		lines: baseLines(),
		width: 60,
		modelId: "gpt",
		thinkingLabel: "high",
		contextPercent: 50,
		contextTokens: 1000,
		contextWindow: 200000,
		cwd: "/r",
		colorize: idColorize,
		borderColor: idBorder,
	});
	const top = out[0];
	const bottom = out[2];

	// Top-right shifts one column inward: a border dash sits just inside the
	// right corner, between the status text's trailing pad and the corner glyph.
	assert.ok(top.endsWith("─╮"), "top-right gains a shoulder dash before the corner");
	// The top-left corner is untouched (it leads straight into the fill dashes).
	assert.ok(top.startsWith("╭"), "top-left corner is unchanged");

	// Bottom-left shifts one column inward: a shoulder dash follows the corner
	// before the status text's leading pad.
	assert.ok(
		bottom.startsWith("╰─ "),
		"bottom-left gains a shoulder dash after the corner",
	);
	// Bottom-right shifts one column inward: a shoulder dash before the corner.
	assert.ok(bottom.endsWith("─╯"), "bottom-right gains a shoulder dash before the corner");

	// Every framed row still spans exactly the requested width.
	for (const line of out) {
		assert.equal(visibleWidth(line), 60, "shoulder dashes preserve the full width");
	}
});

// ─── Activity slot (border working indicator) ──────────────────────────────────

test("composeBorderLines renders the active indicator glyph in the activity slot before the model", () => {
	const out = composeBorderLines({
		lines: baseLines(),
		width: 60,
		modelId: "claude",
		thinkingLabel: "",
		contextPercent: 21,
		contextTokens: 42000,
		contextWindow: 200000,
		cwd: "/r",
		colorize: idColorize,
		borderColor: idBorder,
		activity: { active: true, glyph: "⠋" },
	});
	const bottom = out[2];
	// Active slot: corner + shoulder, a space, the glyph, a space, then model.
	assert.ok(
		bottom.startsWith("╰─ ⠋ claude"),
		`active glyph should sit before the model: ${bottom}`,
	);
	assert.equal(visibleWidth(bottom), 60, "bottom border still spans the full width");
});

test("composeBorderLines renders idle border fill in the activity slot", () => {
	const out = composeBorderLines({
		lines: baseLines(),
		width: 60,
		modelId: "claude",
		thinkingLabel: "",
		contextPercent: 21,
		contextTokens: 42000,
		contextWindow: 200000,
		cwd: "/r",
		colorize: idColorize,
		borderColor: idBorder,
		activity: { active: false, glyph: "" },
	});
	const bottom = out[2];
	// Idle slot: the glyph column is filled with border dashes so the border
	// stays visually continuous instead of leaving a gap.
	assert.ok(
		bottom.startsWith("╰─── claude"),
		`idle slot should be filled with border dashes: ${bottom}`,
	);
	assert.equal(visibleWidth(bottom), 60, "bottom border still spans the full width");
});

test("composeBorderLines keeps the model column stable across idle and active activity frames", () => {
	const opts = {
		lines: baseLines(),
		width: 60,
		modelId: "claude",
		thinkingLabel: "xhigh",
		contextPercent: 21,
		contextTokens: 42000,
		contextWindow: 200000,
		cwd: "/r",
		colorize: idColorize,
		borderColor: idBorder,
	};
	const idle = composeBorderLines({ ...opts, activity: { active: false, glyph: "" } });
	const spinner = composeBorderLines({ ...opts, activity: { active: true, glyph: "⠋" } });
	const pulse = composeBorderLines({ ...opts, activity: { active: true, glyph: "●" } });
	const wave = composeBorderLines({ ...opts, activity: { active: true, glyph: "≈" } });

	const modelCol = (line: string) => line.indexOf("claude");
	const base = modelCol(idle[2]);
	assert.ok(base > 0, "model should be present");
	assert.equal(modelCol(spinner[2]), base, "spinner frame keeps the model column stable");
	assert.equal(modelCol(pulse[2]), base, "pulse frame keeps the model column stable");
	assert.equal(modelCol(wave[2]), base, "wave frame keeps the model column stable");
	for (const out of [idle, spinner, pulse, wave]) {
		assert.equal(visibleWidth(out[2]), 60, "every activity frame spans the full width");
	}
});

test("computeBorderVisibility reserves the activity slot width in the bottom-left budget", () => {
	// Without the slot the layout just fits; reserving the 2-column slot pushes
	// the lowest-priority optional field (token window) out.
	// bottom overhead is 11 (corners 2 + shoulders 2 + 2×block-pad 4 + gap 3).
	// without slot: 11 + (7 + 6) + (5 + 10) = 39 ≤ 40 → token window fits.
	// with a 2-col slot: 11 + (2 + 7 + 6) + (5 + 10) = 41 > 40 → token window drops.
	const base = bw(40, {
		modelWidth: 7,
		thinkingWidth: 6,
		pctWidth: 5,
		tokenWindowWidth: 10,
		hasThinking: true,
		hasTokenWindow: true,
	});
	const withoutSlot = computeBorderVisibility(base);
	const withSlot = computeBorderVisibility({ ...base, activitySlotWidth: 2 });
	assert.ok(withoutSlot.showTokenWindow, "token window fits without the reserved slot");
	assert.ok(!withSlot.showTokenWindow, "reserving the slot drops the token window first");
});

test("composeBorderLines keeps every line within the requested width at extremely narrow widths", () => {
	// pi-tui validates rendered line width against the terminal width, so an
	// over-wide row can stop rendering. At widths 0/1/2 there is no room for both
	// vertical edges plus content, so framing must be skipped/bounded.
	for (const width of [0, 1, 2]) {
		const innerWidth = Math.max(1, width - 2); // mirrors BorderStatusEditor.render
		const stockBorder = "─".repeat(innerWidth);
		const out = composeBorderLines({
			lines: [stockBorder, "x".repeat(innerWidth), stockBorder],
			width,
			modelId: "m",
			thinkingLabel: "",
			contextPercent: 50,
			contextTokens: 1000,
			contextWindow: 200000,
			cwd: "/r",
			colorize: idColorize,
			borderColor: idBorder,
		});
		for (const line of out) {
			assert.ok(
				visibleWidth(line) <= width,
				`width ${width}: line "${line}" (${visibleWidth(line)}) must not exceed ${width}`,
			);
		}
	}
});

// ─── Effect stylers (model gleam / thinking rainbow) ───────────────────────────

test("composeBorderLines applies the model styler to the model id", () => {
	const out = composeBorderLines({
		lines: baseLines(),
		width: 160,
		modelId: "gpt-5.5",
		thinkingLabel: "",
		contextPercent: 12.3,
		contextTokens: 9300,
		contextWindow: 200000,
		cwd: "/repo",
		colorize: idColorize,
		borderColor: idBorder,
		modelStyler: (t) => `<g>${t}</g>`,
	});
	const bottom = out[2];
	assert.ok(bottom.includes("<g>gpt-5.5</g>"), `model styler should wrap the model id: ${bottom}`);
	assert.equal(visibleWidth(bottom), 160, "styler markers do not change the laid-out width");
});

test("composeBorderLines applies the thinking styler to the thinking label", () => {
	const out = composeBorderLines({
		lines: baseLines(),
		width: 160,
		modelId: "gpt-5.5",
		thinkingLabel: "xhigh",
		contextPercent: 12.3,
		contextTokens: 9300,
		contextWindow: 200000,
		cwd: "/repo",
		colorize: idColorize,
		borderColor: idBorder,
		thinkingStyler: (t) => `<r>${t}</r>`,
	});
	const bottom = out[2];
	assert.ok(bottom.includes("<r>xhigh</r>"), `thinking styler should wrap the thinking label: ${bottom}`);
});

// ─── resolveEditorTimerCadence ─────────────────────────────────────────────────

test("resolveEditorTimerCadence returns undefined when not visible", () => {
	assert.equal(resolveEditorTimerCadence(snapshot({ visible: false })), undefined);
});

test("resolveEditorTimerCadence drives a 120ms cadence for a visible static dot indicator", () => {
	const cadence = resolveEditorTimerCadence(
		snapshot({
			visible: true,
			state: "active",
			settings: {
				version: 1,
				working: { indicator: "dot" },
				header: {},
				editor: {},
				footer: {},
			},
		}),
	);
	assert.equal(cadence, 120, "static dot still animates the model gleam / thinking rainbow");
});

test("resolveEditorTimerCadence mirrors the spinner interval for a visible spinner indicator", () => {
	const cadence = resolveEditorTimerCadence(snapshot({ visible: true, state: "active" }));
	assert.equal(cadence, buildWorkingIndicator("spinner", "active").intervalMs);
});

// ─── resolveBorderActivity (working snapshot → border slot) ────────────────────

function snapshot(overrides: Partial<WorkingSnapshot> = {}): WorkingSnapshot {
	return {
		visible: false,
		state: "active",
		settings: {
			version: 1,
			working: { indicator: "spinner" },
			header: {},
			editor: {},
			footer: {},
		},
		...overrides,
	};
}

test("resolveBorderActivity reports an idle slot when no turn is active", () => {
	const activity = resolveBorderActivity(snapshot({ visible: false }), 0);
	assert.deepEqual(activity, { active: false, glyph: "" });
});

test("resolveBorderActivity renders the spinner frame for the current state and time", () => {
	const snap = snapshot({ visible: true, state: "active" });
	const activity = resolveBorderActivity(snap, 0);
	assert.equal(activity.active, true);
	assert.equal(
		activity.glyph,
		pickWorkingIndicatorFrame("spinner", snap.state, 0),
		"glyph reuses the shared working indicator frame generation",
	);
});

test("resolveBorderActivity applies the thinking style (rainbow) when thinking", () => {
	const snap = snapshot({ visible: true, state: "thinking" });
	const activity = resolveBorderActivity(snap, 0);
	assert.ok(activity.active);
	assert.equal(
		activity.glyph,
		pickWorkingIndicatorFrame("spinner", snap.state, 0),
		"thinking uses the thinking state's rainbow frame",
	);
});

// ─── Editor settings / border colour integration ───────────────────────────────

const fakeTui = {
	terminal: { rows: 24 },
	requestRender() {},
};

const fakeKeybindings = {
	matches() {
		return false;
	},
	getKeys() {
		return [];
	},
};

const fakeEditorTheme = {
	borderColor(text: string) {
		return text;
	},
	selectList: {},
};

async function withTempPiSettings(
	settings: Record<string, unknown>,
	fn: (paths: { agentDir: string; cwd: string }) => Promise<void>,
): Promise<void> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "pi-border-status-"));
	const agentDir = path.join(dir, "agent");
	const cwd = path.join(dir, "project");
	const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			path.join(agentDir, "settings.json"),
			`${JSON.stringify(settings)}\n`,
			"utf8",
		);
		await fn({ agentDir, cwd });
	} finally {
		if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
		await rm(dir, { recursive: true, force: true });
	}
}

test("resolveEditorBorderColor uses thinking-level color unless the editor is in bash mode", () => {
	const theme = {
		getThinkingBorderColor(level: string) {
			return (text: string) => `[thinking-${level}:${text}]`;
		},
		getBashModeBorderColor() {
			return (text: string) => `[bash:${text}]`;
		},
	};

	assert.equal(
		resolveEditorBorderColor("", theme as any, "high" as any)("─"),
		"[thinking-high:─]",
	);
	assert.equal(
		resolveEditorBorderColor("  ! git status", theme as any, "high" as any)("─"),
		"[bash:─]",
	);
});

test("installBorderEditor initializes autocomplete max visible from Pi settings on first install", async () => {
	await withTempPiSettings({ autocompleteMaxVisible: 10 }, async ({ cwd }) => {
		const pi = {
			getThinkingLevel() {
				return "off";
			},
		};

		let editorFactory: any;
		const ctx = {
			cwd,
			model: undefined,
			getContextUsage() {
				return undefined;
			},
			ui: {
				setEditorComponent(factory: unknown) {
					editorFactory = factory;
				},
				theme: {
					name: "test",
					getColorMode() {
						return "truecolor";
					},
					fg(_token: string, text: string) {
						return text;
					},
					getThinkingBorderColor() {
						return (text: string) => text;
					},
					getBashModeBorderColor() {
						return (text: string) => text;
					},
				},
			},
		};

		const handle = installBorderEditor(pi as any, ctx as any);
		const editor = editorFactory(fakeTui as any, fakeEditorTheme as any, fakeKeybindings as any);
		assert.equal(
			editor.getAutocompleteMaxVisible(),
			10,
			"border editor should inherit the user's autocomplete visible-item setting on first load",
		);
		handle.dispose();
	});
});

test("border editor border stroke follows the active thinking level while the thinking label stays muted", () => {
	const pi = {
		getThinkingLevel() {
			return "high";
		},
	};

	let editorFactory: any;
	const ctx = {
		cwd: "/repo",
		model: { id: "model", reasoning: true, contextWindow: 200000 },
		getContextUsage() {
			return { percent: 12.3, tokens: 9300, contextWindow: 200000 };
		},
		ui: {
			setEditorComponent(factory: unknown) {
				editorFactory = factory;
			},
			theme: {
				name: "test",
				getColorMode() {
					return "truecolor";
				},
				// Tag the semantic token so we can tell the muted status label apart
				// from the thinking-level border stroke colour.
				fg(token: string, text: string) {
					return `[fg-${token}:${text}]`;
				},
				getThinkingBorderColor(level: string) {
					return (text: string) => `[thinking-${level}:${text}]`;
				},
				getBashModeBorderColor() {
					return (text: string) => `[bash:${text}]`;
				},
			},
		},
	};

	const handle = installBorderEditor(pi as any, ctx as any);
	const editor = editorFactory(fakeTui as any, fakeEditorTheme as any, fakeKeybindings as any);
	// Simulate Pi's setCustomEditorComponent copying a stale default-editor border
	// colour into the custom editor after the factory returns.
	editor.borderColor = (text: string) => `[stale:${text}]`;

	const lines = editor.render(60);
	const bottom = lines[lines.length - 1]!;
	// The top/bottom border *stroke* (dashes, corners) tracks the active thinking
	// level via resolveEditorBorderColor.
	assert.ok(lines[0].includes("[thinking-high:"), "top border stroke should use high thinking colour");
	assert.ok(
		bottom.includes("[thinking-high:"),
		"bottom border stroke should use high thinking colour",
	);
	// The thinking *status label* is a muted semantic status field, not the
	// thinking-level colour. (Idle snapshot → no rainbow styler, so the static
	// muted token is used.)
	assert.ok(
		bottom.includes("[fg-muted:high]"),
		"thinking status label should use the muted semantic token",
	);
	assert.equal(
		bottom.includes("[thinking-high:high]"),
		false,
		"thinking status label must not use the thinking-level border colour",
	);
	assert.equal(
		lines.some((line: string) => line.includes("[stale:")),
		false,
		"stale copied border colour must not leak into the rendered border",
	);
	handle.dispose();
});

// ─── Extension lifecycle ───────────────────────────────────────────────────────

test("installBorderEditor installs a border-status editor without touching the footer", async () => {
	const pi = {
		getThinkingLevel() {
			return "off";
		},
	};

	const editorFactories: unknown[] = [];
	let footerCalls = 0;
	const ctx = {
		cwd: "/repo",
		model: undefined,
		getContextUsage() {
			return undefined;
		},
		ui: {
			setEditorComponent(factory: unknown) {
				editorFactories.push(factory);
			},
			setFooter() {
				footerCalls++;
			},
			theme: {
				name: "test",
				getColorMode() {
					return "truecolor";
				},
				fg(_token: string, text: string) {
					return text;
				},
				getThinkingBorderColor() {
					return (text: string) => text;
				},
			},
		},
	};

	installBorderEditor(pi as any, ctx as any);
	assert.equal(typeof editorFactories[0], "function", "installBorderEditor installs a custom editor");
	assert.equal(footerCalls, 0, "border editor must not touch the footer");
});

test("dispose restores the built-in editor", async () => {
	const pi = {
		getThinkingLevel() {
			return "off";
		},
	};

	const editorCalls: unknown[] = [];
	const ctx = {
		cwd: "/repo",
		model: undefined,
		getContextUsage() {
			return undefined;
		},
		ui: {
			setEditorComponent(factory: unknown) {
				editorCalls.push(factory);
			},
			setFooter() {},
			theme: {
				name: "test",
				getColorMode() {
					return "truecolor";
				},
				fg(_t: string, text: string) {
					return text;
				},
				getThinkingBorderColor() {
					return (text: string) => text;
				},
			},
		},
	};

	const handle = installBorderEditor(pi as any, ctx as any);
	handle.dispose();

	assert.equal(typeof editorCalls[0], "function", "installBorderEditor installs a custom editor");
	assert.equal(editorCalls[1], undefined, "dispose restores the built-in editor");
});
