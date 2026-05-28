import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	BORDER_TOKENS,
	composeBorderLines,
	computeBorderVisibility,
	createBranchTracker,
	fitBorder,
	fitTopRight,
	formatContextPercent,
	formatContextTokenWindow,
	formatCwd,
	getThinkingLabel,
	installBorderStatus,
	type BorderFieldWidths,
} from "./border-status.ts";
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
 *   - thinkingWidth / branchWidth / tokenWindowWidth INCLUDE their leading
 *     single-space separator (matches production measurement).
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
		cwdWidth: 0,
		branchWidth: 0,
		ellipsisWidth: 1,
		hasThinking: false,
		hasBranch: false,
		hasTokenWindow: false,
	};
	return { ...base, ...overrides };
}

// ─── Footer independence ───────────────────────────────────────────────────────

test("border-status does not import from the footer extension", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./border-status.ts", import.meta.url)),
		"utf8",
	);
	assert.ok(
		!/from\s+["']\.\/footer(\.ts)?["']/.test(source),
		"border-status.ts must be self-contained and not import from ./footer",
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

test("token window routes counts to context color and the slash to symbol color", () => {
	// formatTokens(9300) === "9.3k", formatTokens(200000) === "200k"
	assert.equal(
		formatContextTokenWindow(9300, 200000, markerColorize),
		"[context:9.3k][symbol:/][context:200k]",
	);
	assert.equal(
		formatContextTokenWindow(null, 200000, markerColorize),
		"[context:?][symbol:/][context:200k]",
	);
});

test("border tokens map model/context to accent, branch to success, symbol to borderMuted, cwd to muted", () => {
	assert.equal(BORDER_TOKENS.model, "accent");
	assert.equal(BORDER_TOKENS.context, "accent");
	assert.equal(BORDER_TOKENS.branch, "success");
	assert.equal(BORDER_TOKENS.symbol, "borderMuted");
	assert.equal(BORDER_TOKENS.cwd, "muted");
});

// ─── computeBorderVisibility (priority dropper) ────────────────────────────────

test("wide terminal keeps every optional border field visible", () => {
	const flags = computeBorderVisibility(
		bw(200, {
			modelWidth: 7,
			thinkingWidth: 6,
			pctWidth: 5,
			tokenWindowWidth: 10,
			cwdWidth: 30,
			branchWidth: 8,
			hasThinking: true,
			hasBranch: true,
			hasTokenWindow: true,
		}),
	);
	assert.ok(flags.showTokenWindow);
	assert.ok(flags.showBranch);
	assert.ok(flags.showThinking);
});

test("token window drops before branch", () => {
	// bottom with token window: 7 + 5 + 10 + 9 = 31 > 30 → drop token window.
	// bottom without: 7 + 5 + 9 = 21 ≤ 30.
	// top with branch: 12 + 8 = 20 ≤ 30 → branch survives.
	const flags = computeBorderVisibility(
		bw(30, {
			modelWidth: 7,
			pctWidth: 5,
			tokenWindowWidth: 10,
			cwdWidth: 20,
			branchWidth: 8,
			hasBranch: true,
			hasTokenWindow: true,
		}),
	);
	assert.ok(!flags.showTokenWindow, "token window should drop first");
	assert.ok(flags.showBranch, "branch should survive");
});

test("branch drops before thinking", () => {
	// top with branch needs width ≥ 12 + branchWidth(8) = 20; at 19 branch drops.
	// bottom with thinking: 3 + 3 + 2 + 9 = 17 ≤ 19 → thinking survives.
	const flags = computeBorderVisibility(
		bw(19, {
			modelWidth: 3,
			thinkingWidth: 3,
			pctWidth: 2,
			cwdWidth: 20,
			branchWidth: 8,
			hasThinking: true,
			hasBranch: true,
		}),
	);
	assert.ok(!flags.showBranch, "branch should drop");
	assert.ok(flags.showThinking, "thinking should survive (lower drop priority)");
});

test("thinking drops last among optional border fields", () => {
	// bottom with thinking: 3 + 3 + 2 + 9 = 17 > 16 → thinking drops.
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

test("fitTopRight returns full cwd and branch when they fit", () => {
	const out = fitTopRight("~/proj", "main", 40, idColorize);
	assert.equal(out, "~/proj main");
});

test("fitTopRight tail-truncates cwd while keeping branch intact", () => {
	// branch part " main" = 5; ellipsis 1; maxWidth 12 → availForCwd = 12 - 5 - 1 = 6.
	// tail 6 chars of "/a/b/c/deep" === "c/deep".
	const out = fitTopRight("/a/b/c/deep", "main", 12, idColorize);
	assert.equal(out, "…c/deep main");
	assert.ok(out.includes("main"), "branch must remain intact");
	assert.ok(visibleWidth(out) <= 12);
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
		thinkingColor: idBorder,
		contextPercent: 10,
		contextTokens: 1000,
		contextWindow: 200000,
		cwd: "/repo",
		branch: undefined,
		colorize: idColorize,
		borderColor: idBorder,
	});
	assert.deepEqual(out, ["only"]);
});

test("composeBorderLines places model+thinking lower-left, context lower-right, cwd+branch upper-right", () => {
	const origHome = process.env.HOME;
	process.env.HOME = "/Users/test";
	try {
		const out = composeBorderLines({
			lines: baseLines(),
			width: 90,
			modelId: "gpt-5.5",
			thinkingLabel: "xhigh",
			thinkingColor: (t) => `<th:${t}>`,
			contextPercent: 12.3,
			contextTokens: 9300,
			contextWindow: 200000,
			cwd: "/Users/test/proj",
			branch: "feature",
			colorize: markerColorize,
			borderColor: idBorder,
		});

		const top = out[0];
		const bottom = out[2];
		assert.notEqual(top, "TOP-BORDER", "top border should be rewritten");
		assert.notEqual(bottom, "BOTTOM-BORDER", "bottom border should be rewritten");

		// Upper-right: cwd (muted) and branch (success).
		assert.ok(top.includes("[cwd:~/proj]"), "cwd routed to cwd color with ~ substitution");
		assert.ok(top.includes("[branch:feature]"), "branch routed to branch color");

		// Lower-left: model (accent) and thinking via thinking border color.
		assert.ok(bottom.includes("[model:gpt-5.5]"), "model routed to model color");
		assert.ok(bottom.includes("<th:xhigh>"), "thinking uses the thinking border color");

		// Lower-right: percentage + used/total token window with subdued slash.
		assert.ok(bottom.includes("[context:12.3%]"), "percentage routed to context color");
		assert.ok(bottom.includes("[context:9.3k]"), "used tokens routed to context color");
		assert.ok(bottom.includes("[symbol:/]"), "slash uses subdued symbol color");
		assert.ok(bottom.includes("[context:200k]"), "total tokens routed to context color");
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
		thinkingColor: idBorder,
		contextPercent: 50,
		contextTokens: 1000,
		contextWindow: 200000,
		cwd: "/some/deep/path/here",
		branch: "feature-branch",
		colorize: idColorize,
		borderColor: idBorder,
	});
	const bottom = out[2];
	assert.ok(bottom.includes("gpt"), "model is never hidden");
	assert.ok(bottom.includes("50.0%"), "context percent is never hidden");
	assert.equal(visibleWidth(out[0]), 24, "top border spans full width");
	assert.equal(visibleWidth(out[2]), 24, "bottom border spans full width");
});

test("composeBorderLines drops token window, then branch, then thinking as width shrinks", () => {
	// Geometry chosen so the top branch block is the binding constraint before
	// the bottom thinking block, exercising the global token→branch→thinking order.
	const opts = {
		lines: baseLines(),
		modelId: "m",
		thinkingLabel: "lo",
		thinkingColor: idBorder,
		contextPercent: 50,
		contextTokens: 1000,
		contextWindow: 200000,
		cwd: "/r",
		branch: "feature-xyz",
		colorize: idColorize,
		borderColor: idBorder,
	};

	const wide = composeBorderLines({ ...opts, width: 30 });
	assert.ok(wide[2].includes("1.0k/200k"), "wide keeps token window");
	assert.ok(wide[0].includes("feature-xyz"), "wide keeps branch");
	assert.ok(wide[2].includes(" lo "), "wide keeps thinking");

	// Drop token window first: pct stays, used/total gone, branch + thinking remain.
	const noToken = composeBorderLines({ ...opts, width: 27 });
	assert.ok(!noToken[2].includes("1.0k/200k"), "token window dropped first");
	assert.ok(noToken[0].includes("feature-xyz"), "branch still present");
	assert.ok(noToken[2].includes("50.0%"), "percentage retained");

	// Narrower: branch dropped next, thinking still retained.
	const noBranch = composeBorderLines({ ...opts, width: 23 });
	assert.ok(!noBranch[0].includes("feature-xyz"), "branch dropped after token window");
	assert.ok(noBranch[2].includes(" lo "), "thinking retained after branch drops");
});

// ─── createBranchTracker (rerender-on-change) ──────────────────────────────────

test("branch tracker only fires the change callback when the branch actually changes", async () => {
	const tracker = createBranchTracker();
	let renders = 0;
	const onChange = () => {
		renders++;
	};
	const execReturning = (value: string) => async () => ({ stdout: value, stderr: "", code: 0 });

	await tracker.refresh(execReturning("main\n") as any, "/r", onChange);
	assert.equal(tracker.current(), "main");
	assert.equal(renders, 1, "first resolution should trigger a render");

	await tracker.refresh(execReturning("main\n") as any, "/r", onChange);
	assert.equal(renders, 1, "unchanged branch should not trigger a render");

	await tracker.refresh(execReturning("dev\n") as any, "/r", onChange);
	assert.equal(tracker.current(), "dev");
	assert.equal(renders, 2, "changed branch should trigger a render");

	await tracker.refresh(execReturning("") as any, "/r", onChange);
	assert.equal(tracker.current(), undefined);
	assert.equal(renders, 3, "clearing the branch should trigger a render");
});

test("branch tracker treats exec failures as no branch", async () => {
	const tracker = createBranchTracker();
	let renders = 0;
	const failingExec = async () => {
		throw new Error("not a git repo");
	};
	await tracker.refresh(failingExec as any, "/r", () => {
		renders++;
	});
	assert.equal(tracker.current(), undefined);
	assert.equal(renders, 0, "staying at undefined should not trigger a render");
});

// ─── Extension lifecycle ───────────────────────────────────────────────────────

test("installBorderStatus installs a border-status editor without touching the footer", async () => {
	const pi = {
		getThinkingLevel() {
			return "off";
		},
		async exec() {
			return { stdout: "", stderr: "", code: 0 };
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

	installBorderStatus(pi as any, ctx as any);
	assert.equal(typeof editorFactories[0], "function", "installBorderStatus installs a custom editor");
	assert.equal(footerCalls, 0, "border-status must not touch the footer");
});

test("dispose restores the built-in editor", async () => {
	const pi = {
		getThinkingLevel() {
			return "off";
		},
		async exec() {
			return { stdout: "", stderr: "", code: 0 };
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

	const handle = installBorderStatus(pi as any, ctx as any);
	handle.dispose();

	assert.equal(typeof editorCalls[0], "function", "installBorderStatus installs a custom editor");
	assert.equal(editorCalls[1], undefined, "dispose restores the built-in editor");
});
