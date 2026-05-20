import test from "node:test";
import assert from "node:assert/strict";

import footerFactory, {
	computeVisibility,
	DEFAULT_TOKENS,
	formatContextTokenWindow,
	getProviderPrefix,
	getThinkingLabel,
	joinMetrics,
	sanitizeStatusTexts,
	THEME_COLORS,
	type FieldWidths,
} from "./footer.ts";

/** Stub colorize: wraps text in a `[field:text]` marker for easy assertion. */
const mockColorize = (field: string, text: string) => `[${field}:${text}]`;

/**
 * These tests exercise the production priority dropper directly (imported
 * from ./footer.ts) to guarantee production divergence cannot slip through.
 *
 * FieldWidths semantics reminder:
 *   - branchWidth includes the single-space branch separator (matches production measurement).
 *   - sessionNameWidth is the raw session label width (no padding).
 *   - ellipsisWidth is the "..." glyph width used by the cwd truncation path.
 */

const ELLIPSIS_WIDTH = 3; // "..."

/**
 * Build a FieldWidths object for a given terminal width with sensible defaults.
 * Individual tests override only the fields they care about.
 */
function fw(width: number, overrides: Partial<FieldWidths> = {}): FieldWidths {
	const base: FieldWidths = {
		width,
		pwdStrWidth: 0,
		branchWidth: 0,
		sessionNameWidth: 0,
		ellipsisWidth: ELLIPSIS_WIDTH,
		modelNameWidth: 0,
		thinkingWidth: 0,
		providerWidth: 0,
		contextPercentWidth: 0,
		contextDenomWidth: 0,
		hasBranch: false,
		hasSessionName: false,
		hasThinking: false,
		hasProvider: false,
	};
	return { ...base, ...overrides };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test("wide terminal: all live fields visible", () => {
	const flags = computeVisibility(fw(200, {
		pwdStrWidth: 20, branchWidth: 9, sessionNameWidth: 10,
		modelNameWidth: 14, thinkingWidth: 12, providerWidth: 12,
		contextPercentWidth: 6, contextDenomWidth: 8,
		hasBranch: true, hasSessionName: true, hasThinking: true,
		hasProvider: true,
	}));

	assert.ok(flags.showProvider);
	assert.ok(flags.showContextDenom);
	assert.ok(flags.showSessionName);
	assert.ok(flags.showBranch);
	assert.ok(flags.showThinking);
	assert.equal("showAutoCompact" in flags, false);
});

test("provider drops before context token window metric", () => {
	const fields = {
		pwdStrWidth: 10, branchWidth: 0, sessionNameWidth: 0,
		modelNameWidth: 14, thinkingWidth: 0, providerWidth: 12,
		contextPercentWidth: 6, contextDenomWidth: 8,
		hasBranch: false, hasSessionName: false, hasThinking: false,
		hasProvider: true,
	};
	// With provider: 14 + 12 + 2 + 6 + 1 + 8 = 43.
	// Without provider: 14 + 2 + 6 + 1 + 8 = 31.
	const flags = computeVisibility(fw(42, fields));
	assert.ok(!flags.showProvider, "provider should drop first");
	assert.ok(flags.showContextDenom, "context token window should remain visible");
});

test("session name drops before branch on row 1", () => {
	// branchWidth includes one literal space separator, so 1 + 8 = 9.
	// With session: right = 2 + 15 = 17, left max = width - 17.
	//   min left keeping branch = ellipsis(3) + 4 + 9 = 16, needs width >= 33.
	// Without session: left max = width, needs >= 16.
	// Row 2: 10 + 2 + 6 + 8 = 26, fits easily.
	// Width = 32: can't fit with session, can without.
	const flags = computeVisibility(fw(32, {
		pwdStrWidth: 30, branchWidth: 9, sessionNameWidth: 15,
		modelNameWidth: 10, contextPercentWidth: 6, contextDenomWidth: 8,
		hasBranch: true, hasSessionName: true,
	}));
	assert.ok(!flags.showSessionName, "session name should drop");
	assert.ok(flags.showBranch, "branch should remain");
});

test("branch drops after session name", () => {
	// Very narrow: can't even fit truncated pwd + branch.
	// Need: ellipsis(3) + 4 chars + branchWidth(9) = 16
	const flags = computeVisibility(fw(15, {
		pwdStrWidth: 30, branchWidth: 9,
		modelNameWidth: 10, contextPercentWidth: 6,
		hasBranch: true,
	}));
	assert.ok(!flags.showBranch, "branch should drop when too narrow");
});

test("model name and context percent are never hidden", () => {
	const flags = computeVisibility(fw(20, {
		pwdStrWidth: 5,
		modelNameWidth: 10, thinkingWidth: 8, providerWidth: 10,
		contextPercentWidth: 6, contextDenomWidth: 8,
		hasThinking: true, hasProvider: true,
	}));
	assert.ok(!flags.showThinking, "thinking should be hidden");
	assert.ok(!flags.showProvider, "provider should be hidden");
	// Model name + context percent minimum = 10 + 2 + 6 = 18, fits in 20.
});

test("long cwd does NOT cause row-2 fields to drop when truncation suffices", () => {
	// Row 2 full need: 14 + 12 + 2 + 6 + 1 + 8 = 43
	const flags = computeVisibility(fw(72, {
		pwdStrWidth: 100, // very long cwd
		branchWidth: 9,
		modelNameWidth: 14, providerWidth: 12,
		contextPercentWidth: 6, contextDenomWidth: 8,
		hasBranch: true, hasProvider: true,
	}));

	assert.ok(flags.showContextDenom, "context token window should survive when cwd truncation handles row 1");
	assert.ok(flags.showBranch, "branch should survive when cwd truncation handles row 1");
});

test("context token window drops as a unit with / separator", () => {
	// With denom:    14 + 2 + 6 + 1 + 8 = 31
	// Without denom: 14 + 2 + 6         = 22
	const flags = computeVisibility(fw(25, {
		pwdStrWidth: 10,
		modelNameWidth: 14,
		contextPercentWidth: 6, contextDenomWidth: 8,
	}));
	assert.ok(!flags.showContextDenom, "context denom + separator should drop as unit");
});

test("cross-row priority: context token window drops before row-1 session name", () => {
	// Row 2 with context token window: 14 + 2 + 6 + 1 + 20 = 43.
	// Row 2 without context token window: 14 + 2 + 6 = 22.
	// With session row 1 needs ellipsis(3) + 4 + branch(9) + padding(2) + sessionName(15) = 33 ≤ 40.
	// So at width 40 context token window drops and session survives.
	const flags = computeVisibility(fw(40, {
		pwdStrWidth: 20, branchWidth: 9, sessionNameWidth: 15,
		modelNameWidth: 14,
		contextPercentWidth: 6, contextDenomWidth: 20,
		hasBranch: true, hasSessionName: true,
	}));
	assert.ok(!flags.showContextDenom, "context token window should drop");
	assert.ok(flags.showSessionName, "session name should survive (higher priority)");
});

test("thinking drops last among visibility-droppable fields (#3)", () => {
	// Row 2 with thinking:    10 + 12 + 2 + 6 = 30
	// Row 2 without thinking: 10 + 2 + 6      = 18
	const flags = computeVisibility(fw(25, {
		pwdStrWidth: 5,
		modelNameWidth: 10, thinkingWidth: 12,
		contextPercentWidth: 6,
		hasThinking: true,
	}));
	assert.ok(!flags.showThinking, "thinking should drop");
});

test("thinking label is hidden when thinking is off", () => {
	assert.equal(getThinkingLabel("off"), "");
	assert.equal(getThinkingLabel("minimal"), "minimal");
	assert.equal(getThinkingLabel("high"), "high");
});

test("provider prefix is omitted unless multiple providers are available", () => {
	assert.equal(getProviderPrefix("anthropic", 1), "");
	assert.equal(getProviderPrefix(undefined, 3), "");
	assert.equal(getProviderPrefix("anthropic", 2), "anthropic ");
});

test("blank extension statuses are filtered out", () => {
	assert.deepEqual(sanitizeStatusTexts(["", "   ", "ok", "line\nwrap"]), [
		"ok",
		"line wrap",
	]);
});

test("context token window wraps '/' in symbols color and uses token color for both counts", () => {
	// formatTokens(9300) === "9.3k" and formatTokens(200000) === "200k"
	assert.equal(
		formatContextTokenWindow(9300, 200000, mockColorize),
		"[tokens:9.3k][symbols:/][tokens:200k]",
	);
	assert.equal(
		formatContextTokenWindow(null, 200000, mockColorize),
		"[tokens:?][symbols:/][tokens:200k]",
	);
});

test("row 1 renders cwd and branch with one literal space separator", async () => {
	const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
	footerFactory({
		on(event: string, handler: (event: any, ctx: any) => void | Promise<void>) {
			handlers.set(event, handler);
		},
		getSessionName() {
			return "";
		},
		getThinkingLevel() {
			return "off";
		},
	} as any);

	let footerBuilder: any;
	const ctx = {
		cwd: "/repo/main",
		model: { id: "model", contextWindow: 200000 },
		getContextUsage() {
			return { percent: 12.3, contextWindow: 200000 };
		},
		sessionManager: {
			getEntries() {
				return [];
			},
		},
		ui: {
			setFooter(builder: unknown) {
				footerBuilder = builder;
			},
		},
	};
	const footerData = {
		onBranchChange() {
			return () => {};
		},
		getGitBranch() {
			return "feature";
		},
		getAvailableProviderCount() {
			return 1;
		},
		getExtensionStatuses() {
			return new Map();
		},
	};
	const theme = {
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
	};

	await handlers.get("session_start")!({}, ctx);
	const footer = footerBuilder({ requestRender() {} }, theme, footerData);
	const [line1, line2] = footer.render(80);

	assert.equal(line1, "/repo/main feature");
	assert.equal(line1.includes(" · "), false);
	assert.equal(line2.includes(" · "), false, "row 2 should remain free of dot separators");
});

test("row 2 shows context percentage and context token window without input/output arrows", async () => {
	const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
	footerFactory({
		on(event: string, handler: (event: any, ctx: any) => void | Promise<void>) {
			handlers.set(event, handler);
		},
		getSessionName() {
			return "";
		},
		getThinkingLevel() {
			return "off";
		},
	} as any);

	let footerBuilder: any;
	const ctx = {
		cwd: "/repo/main",
		model: { id: "model", contextWindow: 200000 },
		getContextUsage() {
			return { percent: 12.3, tokens: 9300, contextWindow: 200000 };
		},
		sessionManager: {
			getEntries() {
				return [
					{
						type: "message",
						message: {
							role: "assistant",
							usage: { input: 1000, output: 2000 },
						},
					},
				];
			},
		},
		ui: {
			setFooter(builder: unknown) {
				footerBuilder = builder;
			},
		},
	};
	const footerData = {
		onBranchChange() {
			return () => {};
		},
		getGitBranch() {
			return "";
		},
		getAvailableProviderCount() {
			return 1;
		},
		getExtensionStatuses() {
			return new Map();
		},
	};
	const theme = {
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
	};

	await handlers.get("session_start")!({}, ctx);
	const footer = footerBuilder({ requestRender() {} }, theme, footerData);
	const [, line2] = footer.render(80);

	assert.ok(line2.endsWith("12.3% 9.3k/200k"));
	assert.equal(line2.includes("↑"), false);
	assert.equal(line2.includes("↓"), false);
});

test("row 2 shows question mark over context window when context tokens are unknown", async () => {
	const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
	footerFactory({
		on(event: string, handler: (event: any, ctx: any) => void | Promise<void>) {
			handlers.set(event, handler);
		},
		getSessionName() {
			return "";
		},
		getThinkingLevel() {
			return "off";
		},
	} as any);

	let footerBuilder: any;
	const ctx = {
		cwd: "/repo/main",
		model: { id: "model", contextWindow: 200000 },
		getContextUsage() {
			return { percent: 12.3, tokens: null, contextWindow: 200000 };
		},
		sessionManager: {
			getEntries() {
				return [];
			},
		},
		ui: {
			setFooter(builder: unknown) {
				footerBuilder = builder;
			},
		},
	};
	const footerData = {
		onBranchChange() {
			return () => {};
		},
		getGitBranch() {
			return "";
		},
		getAvailableProviderCount() {
			return 1;
		},
		getExtensionStatuses() {
			return new Map();
		},
	};
	const theme = {
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
	};

	await handlers.get("session_start")!({}, ctx);
	const footer = footerBuilder({ requestRender() {} }, theme, footerData);
	const [, line2] = footer.render(80);

	assert.ok(line2.endsWith("12.3% ?/200k"));
});

test("joinMetrics joins present metrics with a single literal space", () => {
	assert.equal(
		joinMetrics(["A", "B", "C"], mockColorize),
		"A B C",
	);
	assert.equal(joinMetrics(["A", "B"], mockColorize), "A B");
	assert.equal(joinMetrics(["A"], mockColorize), "A");
	assert.equal(joinMetrics([], mockColorize), "");
	// Empty entries must not produce doubled spaces or dead separators.
	assert.equal(
		joinMetrics(["A", "", "C"], mockColorize),
		"A C",
	);
});

test("row 2 width budget accounts for 1-char ' ' metric separator", () => {
	// With 1-char separator between 2 metrics (percent, token window):
	//   left: modelName=14 + provider=12 = 26
	//   padding: 2
	//   right: 6 + 1 + 8 = 15
	//   total: 43
	const fields = {
		pwdStrWidth: 10,
		modelNameWidth: 14, providerWidth: 12,
		contextPercentWidth: 6, contextDenomWidth: 8,
		hasProvider: true,
	};
	const fits = computeVisibility(fw(43, fields));
	assert.ok(fits.showProvider, "provider should fit exactly at width 43");
	assert.ok(fits.showContextDenom, "context token window should fit exactly at width 43");

	const justUnder = computeVisibility(fw(42, fields));
	assert.ok(!justUnder.showProvider, "provider should drop when row 2 needs 43 but width is 42");
	assert.ok(justUnder.showContextDenom, "context token window should remain after provider drops");
});

test("extremely narrow width keeps only model name and context percent", () => {
	const flags = computeVisibility(fw(20, {
		pwdStrWidth: 30, branchWidth: 9, sessionNameWidth: 15,
		modelNameWidth: 10, thinkingWidth: 8, providerWidth: 12,
		contextPercentWidth: 6, contextDenomWidth: 5,
		hasBranch: true, hasSessionName: true, hasThinking: true,
		hasProvider: true,
	}));
	assert.ok(!flags.showProvider, "provider drops");
	assert.ok(!flags.showContextDenom, "context denom drops");
	assert.ok(!flags.showSessionName, "session name drops");
	assert.ok(!flags.showBranch, "branch drops");
	assert.ok(!flags.showThinking, "thinking drops");
});

test("provider drops before model name when row 2 is constrained", () => {
	const flags = computeVisibility(fw(22, {
		pwdStrWidth: 5,
		modelNameWidth: 14, providerWidth: 12,
		contextPercentWidth: 6,
		hasProvider: true,
	}));
	assert.ok(!flags.showProvider, "provider drops first");
	// Without provider: 14 + 2 + 6 = 22, fits exactly at width 22.
});

test("nord theme override sets provider prefix color to nord3 (#4c566a)", () => {
	assert.equal(THEME_COLORS.nord?.provider, "#4c566a", "Nord override must use nord3 hex");
	assert.equal(DEFAULT_TOKENS.provider, "dim", "default provider color must fall back to the theme's dim token");
	assert.equal(THEME_COLORS.carbonfox?.provider, undefined, "non-Nord themes must not override provider so they keep their dim-token rendering");
	assert.equal(THEME_COLORS.everblush?.provider, undefined, "non-Nord themes must not override provider so they keep their dim-token rendering");
});

test("session_shutdown restores the built-in footer", async () => {
	const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
	footerFactory({
		on(event: string, handler: (event: any, ctx: any) => void | Promise<void>) {
			handlers.set(event, handler);
		},
	} as any);

	const sessionStart = handlers.get("session_start");
	const sessionShutdown = handlers.get("session_shutdown");
	assert.ok(sessionStart, "session_start handler should be registered");
	assert.ok(sessionShutdown, "session_shutdown handler should be registered");

	const footerCalls: unknown[] = [];
	const ctx = {
		ui: {
			setFooter(footer: unknown) {
				footerCalls.push(footer);
			},
		},
	};

	await sessionStart!({}, ctx);
	await sessionShutdown!({ reason: "quit" }, ctx);

	assert.equal(typeof footerCalls[0], "function", "session_start should install a custom footer");
	assert.equal(footerCalls[1], undefined, "session_shutdown should restore the built-in footer");
});
