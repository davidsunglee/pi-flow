import test from "node:test";
import assert from "node:assert/strict";

import { installBlankFooter } from "./blank-footer.ts";

test("installBlankFooter installs a footer that renders no lines", () => {
	const footerCalls: unknown[] = [];
	const ctx = {
		ui: {
			setFooter(footer: unknown) {
				footerCalls.push(footer);
			},
		},
	};

	installBlankFooter({} as any, ctx as any);

	assert.equal(
		typeof footerCalls[0],
		"function",
		"installBlankFooter should install a footer builder",
	);
	const renderer = (footerCalls[0] as any)();
	assert.deepEqual(renderer.render(80), [], "blank footer renders no lines");
	assert.equal(typeof renderer.invalidate, "function", "renderer exposes invalidate");
});

test("installBlankFooter dispose restores the built-in/default footer", () => {
	const footerCalls: unknown[] = [];
	const ctx = {
		ui: {
			setFooter(footer: unknown) {
				footerCalls.push(footer);
			},
		},
	};

	const handle = installBlankFooter({} as any, ctx as any);
	handle.dispose();

	assert.equal(
		footerCalls[1],
		undefined,
		"dispose should restore the built-in footer via setFooter(undefined)",
	);
});
