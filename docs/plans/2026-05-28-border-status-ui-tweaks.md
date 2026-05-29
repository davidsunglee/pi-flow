# Border-status UI tweaks: swap cwd/branch (position + colour) and frame the editor as a full rectangle

## Goal

Three UI tweaks to the border-status editor extension in `packages/pi-flow-ux/extensions/border-status.ts`:

1. **Swap position** of the current working directory (cwd) and the git branch in the editor's top-right status block — render the branch first, the cwd second (currently cwd-first, branch-second).
2. **Swap colours** of those two fields — the cwd takes the branch's current token (`success`) and the branch takes the cwd's current token (`muted`).
3. **Frame the editor as a full rectangle** — connect the existing top and bottom horizontal border lines with left/right vertical edges and rounded corners, producing a closed box with the status labels still embedded near the right of the top and bottom edges (as in the reference screenshot's *shape*).

All changes are confined to `border-status.ts` and its test file `border-status.test.ts`. No other module imports `fitBorder`, `fitTopRight`, `composeBorderLines`, or `BORDER_TOKENS` (verified by grep across `packages/`), so the blast radius is exactly these two files.

## Architecture summary

The extension subclasses pi's `CustomEditor` (which extends `Editor` from `@earendil-works/pi-tui`) and overrides `render(width)`. The base `Editor.render(w)` returns an array of lines: a top border (`─`×w), content rows, a bottom border (`─`×w), and optional autocomplete rows appended below the bottom border. The base editor draws **no side borders** — only horizontal lines above and below (confirmed in the compiled source `dist/components/editor.js`: the content row is rendered as `leftPadding + text + padding + rightPadding`, with the comment "no side borders, just horizontal lines above and below").

The extension's pure helper `composeBorderLines()` rewrites the top border (status: cwd + branch) and bottom border (status: model/thinking + token-window/context%), relocating the bottom border below autocomplete rows when present. The hardware cursor is a zero-width marker (`CURSOR_MARKER = "\x1b_pi:c\x07"`) emitted inside a content row; the TUI locates it in the **final** composed lines and computes its column as `visibleWidth(textBeforeMarker)` (`dist/tui.js` `extractCursorPosition`).

**Tasks 1 & 2** are localized swaps (a string-assembly reorder in `fitTopRight`, and a two-value flip in the `BORDER_TOKENS` map) plus doc-comment and test updates. The width-budget math in `composeBorderLines`/`computeBorderVisibility` is order- and token-independent, so it needs no change.

**Task 3 (rectangle)** uses this approach: render the **inner** editor at `width - 2` (reserving two columns for the vertical edges), then in `composeBorderLines`:
- build the top border at full `width` with rounded corner caps `╭ … ╮`,
- build the bottom border at full `width` with rounded corner caps `╰ … ╯`,
- right-pad every interior row (content + autocomplete) to `width - 2`, then frame it by prepending and appending a `borderColor("│")` vertical bar.

Content rows come back exactly `width - 2` wide; shorter interior rows (e.g. autocomplete matches) are right-padded to `width - 2` first, so adding one bar on each side restores the full `width` with the right edge landing at the rectangle's right side **without overwriting any content** — and because the cursor marker stays inside the (now right-shifted by one column) content, the TUI recomputes the cursor column correctly from the final line. This was chosen over the alternative of overlaying bars onto full-width content rows (string surgery on columns 0 and `width-1`), which risks clobbering the first content character or the end-of-line cursor; rendering narrower and framing is non-destructive. The status-text fitting budget (`width - CORNERS - GAP - BLOCK_PAD`, with `CORNERS = 2`) is unchanged because the two corner glyphs still occupy exactly two columns, just as the old corner dashes did.

## Tech stack

- **Language:** TypeScript (ESM, run via `node --experimental-strip-types`; types are stripped, not type-checked — runtime correctness is what matters).
- **Runtime libs:** `@earendil-works/pi-coding-agent` (`CustomEditor`, `ThemeColor`), `@earendil-works/pi-tui` (`Editor`, `visibleWidth`, `truncateToWidth`).
- **Test framework:** `node:test` + `node:assert/strict` (built-in TAP runner).
- **Theme tokens (Nord):** `success` = nord14 (#a3be8c, green), `muted` = nord3 (#4c566a, gray), `accent` = nord8, `borderMuted` = nord3.

## File Structure

- `packages/pi-flow-ux/extensions/border-status.ts` (Modify) — Reorder `fitTopRight` (branch-first); flip `BORDER_TOKENS.cwd`/`BORDER_TOKENS.branch`; generalize `fitBorder` with optional corner caps; refactor `composeBorderLines` to frame the interior with vertical edges and corner-capped top/bottom borders; change the editor's `render()` to render the inner editor at `width - 2`; update the file-header layout diagram and colour-routing doc comments.
- `packages/pi-flow-ux/extensions/border-status.test.ts` (Modify/Test) — Update the two `fitTopRight` tests for branch-first order; update the `BORDER_TOKENS` routing test for the swapped tokens; add a `fitBorder` corner-caps test; update the autocomplete-preservation test fixture to inner-width borders and framed assertions; add a dedicated full-rectangle test; add a branch-before-cwd order assertion and fix a stale inline comment in the existing `composeBorderLines` layout test.

## Tasks

### Task 1 — Swap cwd/branch position in the top-right status block

**Files:**
- Modify: `packages/pi-flow-ux/extensions/border-status.ts`
- Test: `packages/pi-flow-ux/extensions/border-status.test.ts`

**Context:** Today `fitTopRight` renders `cwd` then `branch` (`return cwdColored + branchPart;`, where `branchPart = " " + colorize("branch", branch)`). The cwd is the long, tail-truncatable field; the branch is short and kept intact (all-or-nothing). After the swap the **branch renders first (still intact), the cwd second (still tail-truncatable)**, separated by a single space when a branch is present. Only the visual order changes; the truncation roles stay the same. The total width consumed is identical (`branch + " " + cwd` == `cwd + " " + branch`), so `computeBorderVisibility` and the `branchWidth = visibleWidth(" " + branch)` measurement in `composeBorderLines` need **no** change.

**Steps:**

- [ ] **Step 1: Reorder `fitTopRight`** — Replace the body of `fitTopRight` (the current function spanning the `branchPart`/`cwdColored` assembly through the final `truncateToWidth` fallback) with this branch-first version:

```ts
export function fitTopRight(
	cwdStr: string,
	branch: string | undefined,
	maxWidth: number,
	colorize: BorderColorize,
): string {
	const branchColored = branch ? colorize("branch", branch) : "";
	const branchPlainWidth = branch ? visibleWidth(branch) : 0;
	// The cwd follows the branch, separated by a single space when a branch is shown.
	const sep = branch ? " " : "";
	const sepWidth = branch ? 1 : 0;
	const cwdColored = colorize("cwd", cwdStr);

	if (branchPlainWidth + sepWidth + visibleWidth(cwdColored) <= maxWidth) {
		return branchColored + sep + cwdColored;
	}

	const ellipsis = colorize("symbol", "…");
	const availForCwd = maxWidth - branchPlainWidth - sepWidth - 1; // 1 for the ellipsis
	if (availForCwd >= 1) {
		return (
			branchColored +
			sep +
			ellipsis +
			colorize("cwd", tailTruncate(cwdStr, availForCwd))
		);
	}

	// Not even room for the branch plus one cwd char: last-resort ANSI-safe truncate.
	return truncateToWidth(
		branchColored + sep + cwdColored,
		Math.max(0, maxWidth),
		"",
	);
}
```

- [ ] **Step 2: Update the `fitTopRight` doc comment** — Replace the existing JSDoc above `fitTopRight` so it describes branch-first ordering:

```ts
/**
 * Build the upper-right status block (optional branch + cwd), fitting it within
 * `maxWidth`. The branch is rendered first and kept intact (all-or-nothing); the
 * cwd follows and is tail-truncated (with a leading ellipsis) so the tail of the
 * path stays visible. Callers decide via computeBorderVisibility whether the
 * branch is present at all.
 */
```

- [ ] **Step 3: Update the "full cwd and branch" test** — In `border-status.test.ts`, change the expectation in `test("fitTopRight returns full cwd and branch when they fit", ...)` from `assert.equal(out, "~/proj main");` to `assert.equal(out, "main ~/proj");`.

- [ ] **Step 4: Update the "tail-truncate" test** — In `test("fitTopRight tail-truncates cwd while keeping branch intact", ...)`, change `assert.equal(out, "…c/deep main");` to `assert.equal(out, "main …c/deep");`. The width math: branch `"main"` (4) + sep (1) + ellipsis (1) leaves `availForCwd = 12 - 4 - 1 - 1 = 6`; tail-6 of `"/a/b/c/deep"` is `"c/deep"`; result `"main …c/deep"` has visibleWidth 12. Leave the `out.includes("main")` and `visibleWidth(out) <= 12` assertions unchanged.

- [ ] **Step 5: Add a branch-before-cwd order assertion** — In `test("composeBorderLines places model+thinking lower-left, context lower-right, cwd+branch upper-right", ...)`, immediately after the two existing `top.includes(...)` assertions for cwd and branch, add:

```ts
		// Branch renders before the cwd in the top-right block (position swap).
		assert.ok(
			top.indexOf("[branch:feature]") < top.indexOf("[cwd:~/proj]"),
			"branch must render before the cwd",
		);
```

**Acceptance criteria:**

- `fitTopRight` renders the branch before the cwd, keeping the branch intact and tail-truncating the cwd.
  Verify: run `node --experimental-strip-types --test packages/pi-flow-ux/extensions/border-status.test.ts` from the repo root and confirm exit code 0 with `ok` lines (and no `not ok`) for both `fitTopRight returns full cwd and branch when they fit` and `fitTopRight tail-truncates cwd while keeping branch intact`.
- The composed top border places the branch to the left of the cwd.
  Verify: in the same test run, confirm the `ok` line for `composeBorderLines places model+thinking lower-left, context lower-right, cwd+branch upper-right` passes (it now asserts `top.indexOf("[branch:feature]") < top.indexOf("[cwd:~/proj]")`).
- The source no longer assembles cwd-before-branch in `fitTopRight`.
  Verify: `grep -n "return branchColored + sep + cwdColored" packages/pi-flow-ux/extensions/border-status.ts` returns at least one match, and `grep -n "return cwdColored + branchPart" packages/pi-flow-ux/extensions/border-status.ts` returns no matches.

**Model recommendation:** standard

---

### Task 2 — Swap the cwd/branch colour tokens

**Files:**
- Modify: `packages/pi-flow-ux/extensions/border-status.ts`
- Test: `packages/pi-flow-ux/extensions/border-status.test.ts`

**Context:** `BORDER_TOKENS` currently maps `branch: "success"` and `cwd: "muted"`. The swap makes `cwd: "success"` and `branch: "muted"`. `"success"`, `"muted"`, `"accent"`, and `"borderMuted"` are all valid `ThemeColor` members, so the change is type-safe. The `composeBorderLines` layout test uses a field-name marker colorize (not token resolution), so its assertions are unaffected by the token flip — only the BORDER_TOKENS test and the doc comments need updating.

**Steps:**

- [ ] **Step 1: Flip the two token values** — In the `BORDER_TOKENS` object, change `branch: "success",` to `branch: "muted",` and change `cwd: "muted",` to `cwd: "success",`. Leave `model: "accent"`, `context: "accent"`, `symbol: "borderMuted"`, `thinking: "muted"`, `contextTokensUsed: "muted"`, `contextWindowTotal: "muted"` unchanged. Final object:

```ts
export const BORDER_TOKENS: Record<BorderColorField, ThemeColor> = {
	model: "accent",
	context: "accent",
	branch: "muted",
	symbol: "borderMuted",
	cwd: "success",
	thinking: "muted",
	contextTokensUsed: "muted",
	contextWindowTotal: "muted",
};
```

- [ ] **Step 2: Update the file-header colour-routing block** — In the top-of-file block comment, replace the branch/cwd lines so the routing list reads (swap the `branch` and `cwd` rows, keeping the others):

```
 *   - model              → "accent"      (footer modelName: accent / Nord nord8)
 *   - context %          → "accent"      (footer contextUsage: accent / Nord nord8)
 *   - cwd                → "success"     (emphasized path / Nord nord14)
 *   - "/" and ellipsis   → "borderMuted" (footer symbols: borderMuted / Nord nord3)
 *   - branch             → "muted"       (de-emphasized; own field, shares muted)
 *   - thinking           → "muted"       (de-emphasized; own field, shares muted)
 *   - contextTokensUsed  → "muted"       (de-emphasized; own field, shares muted)
 *   - contextWindowTotal → "muted"       (de-emphasized; own field, shares muted)
```

- [ ] **Step 3: Update the `BorderColorField` doc comment** — The JSDoc above `export type BorderColorField` currently names `cwd, thinking, contextTokensUsed, contextWindowTotal` as the fields sharing the `muted` token. Replace `cwd` with `branch` in that sentence so it reads "`branch`, `thinking`, `contextTokensUsed`, and `contextWindowTotal` are conceptually distinct values that currently happen to share the `muted` token; keeping them as separate fields lets a future theme change re-colour any one of them independently."

- [ ] **Step 4: Update the `BORDER_TOKENS` doc comment** — The JSDoc above `export const BORDER_TOKENS` currently says "The four secondary fields (cwd, thinking, used tokens, total window) are intentionally de-emphasized to the same `muted` token". Change the parenthetical to "(branch, thinking, used tokens, total window)".

- [ ] **Step 5: Update the BORDER_TOKENS routing test** — Replace the body and name of `test("border tokens map model/context to accent, branch to success, symbol to borderMuted, and secondary fields to muted", ...)` with:

```ts
test("border tokens map model/context to accent, cwd to success, symbol to borderMuted, and secondary fields to muted", () => {
	assert.equal(BORDER_TOKENS.model, "accent");
	assert.equal(BORDER_TOKENS.context, "accent");
	assert.equal(BORDER_TOKENS.cwd, "success");
	assert.equal(BORDER_TOKENS.symbol, "borderMuted");
	assert.equal(BORDER_TOKENS.branch, "muted");
	assert.equal(BORDER_TOKENS.thinking, "muted");
	assert.equal(BORDER_TOKENS.contextTokensUsed, "muted");
	assert.equal(BORDER_TOKENS.contextWindowTotal, "muted");
	// The secondary fields remain distinct keys even though they share the token.
	const secondaryKeys = ["branch", "thinking", "contextTokensUsed", "contextWindowTotal"];
	assert.equal(new Set(secondaryKeys).size, secondaryKeys.length);
});
```

- [ ] **Step 6: Fix the stale inline comment in the layout test** — In `test("composeBorderLines places model+thinking lower-left, context lower-right, cwd+branch upper-right", ...)`, change the inline comment `// Upper-right: cwd (muted) and branch (success).` to `// Upper-right: branch (muted) and cwd (success).` (assertions there use the marker colorize and stay as-is).

**Acceptance criteria:**

- `BORDER_TOKENS` resolves the cwd to `success` and the branch to `muted`, with the other six fields unchanged.
  Verify: run `node --experimental-strip-types --test packages/pi-flow-ux/extensions/border-status.test.ts` from the repo root and confirm exit code 0 with an `ok` line (no `not ok`) for `border tokens map model/context to accent, cwd to success, symbol to borderMuted, and secondary fields to muted`.
- The source map literally assigns the swapped tokens.
  Verify: `grep -n 'cwd: "success"' packages/pi-flow-ux/extensions/border-status.ts` and `grep -n 'branch: "muted"' packages/pi-flow-ux/extensions/border-status.ts` each return exactly one match, and `grep -n 'branch: "success"' packages/pi-flow-ux/extensions/border-status.ts` returns no matches.
- Doc comments no longer describe the cwd as muted or the branch as success.
  Verify: open `packages/pi-flow-ux/extensions/border-status.ts` and confirm the file-header routing block shows `cwd → "success"` and `branch → "muted"`, and that the `BorderColorField` and `BORDER_TOKENS` JSDoc list `branch` (not `cwd`) among the muted secondary fields.

**Model recommendation:** cheap

---

### Task 3 — Frame the editor as a full rectangle (vertical edges + rounded corners)

**Files:**
- Modify: `packages/pi-flow-ux/extensions/border-status.ts`
- Test: `packages/pi-flow-ux/extensions/border-status.test.ts`

**Context:** The base editor draws only top/bottom horizontal lines. To close the box we (a) render the inner editor two columns narrower (`super.render(width - 2)`) so there is room for a vertical edge on each side, (b) rebuild the top/bottom borders at full `width` with rounded corner caps, and (c) right-pad each interior row to `width - 2` and prepend/append a `│`. Content rows already span `width - 2`; padding shorter rows (e.g. autocomplete matches) before framing keeps the right edge at the rectangle's right side, so each framed row is exactly `width` wide with no content overwritten. The cursor marker remains inside the content (shifted one column right by the left bar); the TUI computes its column from the final line, so cursor positioning stays correct. The status-text budget is unchanged because the corner glyphs still occupy two columns.

Corner glyphs (rounded, matching the reference screenshot's shape): top-left `╭` (U+256D), top-right `╮` (U+256E), bottom-left `╰` (U+2570), bottom-right `╯` (U+256F); vertical edge `│` (U+2502); existing horizontal `─` (U+2500). All are single-column box-drawing glyphs.

**Format/constraint notes:**
- `fitBorder` keeps `fixedWidth = 2` (the two end caps) and `minimumGap = 3`; the caps are the only thing that changes glyph. Do not alter the truncation loops or the `gapWidth` computation.
- Detection (`findEditorBottomBorderIndex` / `isEditorBorderLine`) must run against the **inner** width (`width - 2`) because the base editor's borders now come back at that width; passing the full `width` would fail to match and mis-place the bottom border.
- The framing loop must run **after** the splice/relocation so indices are final, and must skip index 0 (top border) and the last index (bottom border).

**Steps:**

- [ ] **Step 1: Generalize `fitBorder` with corner caps** — Add an optional `caps` parameter (defaulting to dashes for backward compatibility) and use it for the two end characters. Replace the `fitBorder` signature and the two `border("─")` end-cap usages so the function reads:

```ts
export function fitBorder(
	left: string,
	right: string,
	width: number,
	border: (text: string) => string,
	fill: (text: string) => string = border,
	caps: { left: string; right: string } = { left: "─", right: "─" },
): string {
	if (width <= 0) return "";
	if (width === 1) return border(caps.left);

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
	return `${border(caps.left)}${leftText}${fill("─".repeat(gapWidth))}${rightText}${border(caps.right)}`;
}
```

- [ ] **Step 2: Refactor `composeBorderLines` to frame the rectangle** — Keep all the width-measurement and `computeBorderVisibility`/`bottomLeft`/`bottomRight`/`topRight` composition code unchanged. Replace only the final assembly block (from the `bottomLine` construction through the `return out;`) with the version below, which (1) computes `innerWidth`, (2) caps the top/bottom borders with rounded corners, (3) detects the inner bottom border at `innerWidth`, and (4) frames interior rows with vertical edges:

```ts
	// Two columns are reserved for the left/right vertical edges. The caller
	// renders the inner editor at this width, so each interior row — padded to
	// `innerWidth` if shorter, then wrapped in a vertical bar on each side —
	// spans exactly `width`.
	const innerWidth = Math.max(1, width - 2);

	const topLine = fitBorder("", ` ${topRight} `, width, p.borderColor, p.borderColor, {
		left: "╭",
		right: "╮",
	});
	const bottomLine = fitBorder(
		` ${bottomLeft} `,
		` ${bottomRight} `,
		width,
		p.borderColor,
		p.borderColor,
		{ left: "╰", right: "╯" },
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
	const verticalEdge = p.borderColor("│");
	for (let i = 1; i < out.length - 1; i++) {
		const pad = Math.max(0, innerWidth - visibleWidth(out[i]));
		out[i] = verticalEdge + out[i] + " ".repeat(pad) + verticalEdge;
	}
	return out;
```

Note: the line `const cwdStr = formatCwd(p.cwd);` and the measurement/visibility/`topRightBudget`/`topRight` lines stay exactly as they are above this block. Delete the old `const bottomLine = fitBorder(...)`, `const bottomBorderIndex = findEditorBottomBorderIndex(p.lines, width);`, the old `out[0] = fitBorder("", ...)`, and the old splice/return — they are replaced by the block above.

- [ ] **Step 3: Render the inner editor two columns narrower** — In the `BorderStatusEditor.render(width)` method (inside `installBorderStatus`), change the first lines from:

```ts
			render(width: number): string[] {
				const lines = super.render(width);
				if (lines.length < 2) return lines;
```

to:

```ts
			render(width: number): string[] {
				// Reserve two columns for the rectangle's vertical edges so the
				// framed interior rows span the full width.
				const innerWidth = Math.max(1, width - 2);
				const lines = super.render(innerWidth);
				if (lines.length < 2) return lines;
```

Leave the rest of `render` unchanged — it still passes the full `width` to `composeBorderLines`.

- [ ] **Step 4: Update the file-header layout diagram** — In the top-of-file block comment, replace the existing `Layout:` diagram (the `top border` / `bottom border` lines) with a rectangle diagram that reflects both the branch-first order (Task 1) and the new vertical edges/corners:

```
 * Layout (closed rectangle; branch precedes cwd on the top edge):
 *   top edge:    ╭──────────────────────────  branch ~/path ─╮
 *   side rows:   │ …editor content…                          │
 *   bottom edge: ╰─ model thinking ──────  used/total context% ─╯
```

Also update the sentence on the next lines that says the extension follows pi's `border-status-editor.ts` example by "rewrite the top/bottom border rows" so it reads "rewrite the top/bottom border rows and frame the interior rows with vertical edges to close the rectangle."

- [ ] **Step 5: Add a `fitBorder` corner-caps test** — In `border-status.test.ts`, add a test after the existing `fitBorder` tests:

```ts
test("fitBorder applies custom corner caps", () => {
	const line = fitBorder(" L ", " R ", 20, idBorder, idBorder, {
		left: "╭",
		right: "╮",
	});
	assert.equal(visibleWidth(line), 20);
	assert.ok(line.startsWith("╭"), "left cap applied");
	assert.ok(line.endsWith("╮"), "right cap applied");
});
```

- [ ] **Step 6: Update the autocomplete-preservation test for inner-width borders and framing** — Replace `test("composeBorderLines preserves autocomplete matches and removes the interior stock border", ...)` with the version below. The fixture now uses inner-width (`width - 2`) stock borders (matching what `super.render(width - 2)` produces), the preserved autocomplete row is asserted in its framed form, and the interior-border check uses `.includes` since interior rows are now framed:

```ts
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
		branch: undefined,
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
```

- [ ] **Step 7: Add a dedicated full-rectangle test** — In `border-status.test.ts`, add this test in the `composeBorderLines` section. It feeds inner-width (`width - 2`) lines and asserts corners, vertical edges, and full-width rows:

```ts
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
		branch: "main",
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
```

**Acceptance criteria:**

- `fitBorder` accepts and applies custom corner caps while preserving full width and existing default-cap behaviour.
  Verify: run `node --experimental-strip-types --test packages/pi-flow-ux/extensions/border-status.test.ts` from the repo root and confirm exit code 0 with `ok` lines (no `not ok`) for `fitBorder applies custom corner caps`, `fitBorder places left and right text and fills the full width`, and `fitBorder truncates right text first when too narrow`.
- `composeBorderLines` produces a closed rectangle: rounded corners on the top/bottom edges, vertical bars framing interior rows, and every row exactly `width` wide.
  Verify: in the same test run, confirm the `ok` line (no `not ok`) for `composeBorderLines frames the editor as a full rectangle with corners and vertical edges`.
- Autocomplete rows are preserved inside the framed box, padded so they span the full `width`, and the stock interior border is removed.
  Verify: in the same test run, confirm the `ok` line (no `not ok`) for `composeBorderLines preserves autocomplete matches and removes the interior stock border` (which now asserts `out[2] === "│" + exactMatch.padEnd(innerWidth, " ") + "│"` and `visibleWidth(out[2]) === width`).
- The whole border-status suite passes (no regressions in the narrow-width, drop-order, or lifecycle tests).
  Verify: run `node --experimental-strip-types --test packages/pi-flow-ux/extensions/border-status.test.ts` from the repo root and confirm exit code 0 and a summary line `# fail 0` (and `# not ok` count of 0 / no `not ok` lines).
- The editor renders its inner content two columns narrower and `composeBorderLines` detects/frames at the inner width.
  Verify: `grep -n "super.render(innerWidth)" packages/pi-flow-ux/extensions/border-status.ts` returns one match; `grep -n "findEditorBottomBorderIndex(p.lines, innerWidth)" packages/pi-flow-ux/extensions/border-status.ts` returns one match; `grep -n 'p.borderColor("│")' packages/pi-flow-ux/extensions/border-status.ts` returns one match; and `grep -n "left: \"╭\"" packages/pi-flow-ux/extensions/border-status.ts` and `grep -n "left: \"╰\"" packages/pi-flow-ux/extensions/border-status.ts` each return one match.
- The file-header layout diagram shows the closed rectangle with branch-before-cwd ordering.
  Verify: open `packages/pi-flow-ux/extensions/border-status.ts` and confirm the header `Layout` diagram uses `╭`/`╮`/`╰`/`╯` and `│` glyphs and shows `branch ~/path` (branch before cwd) on the top edge.

**Model recommendation:** capable

---

## Dependencies

- Task 2 depends on: Task 1 — both edit `border-status.ts` and `border-status.test.ts`; serialize to avoid edit conflicts.
- Task 3 depends on: Task 1, Task 2 — Task 3 edits the same two files (including the file-header comment and the shared `composeBorderLines` layout test that Task 1 also touches), and its full-suite acceptance check requires the Task 1 order assertion and the Task 2 token test to already be in place.

(The three changes are logically independent in behaviour, but they edit overlapping regions of the same two files, so they are sequenced rather than parallelized.)

## Risk Assessment

- **Cursor positioning after framing (Task 3).** Prepending `│` to a content row shifts the embedded `CURSOR_MARKER` one column right. Mitigation: confirmed in `@earendil-works/pi-tui` `dist/tui.js` that `extractCursorPosition` computes the column as `visibleWidth(textBeforeMarker)` on the *final* composed line, so the shift is absorbed correctly. Residual risk: a stale or differently-versioned pi-tui could compute the cursor before composition — covered by the manual QA step below.
- **End-of-line / wide-character edge cases (Task 3).** With `paddingX: 0`, the base editor reserves one column for the cursor within the layout width, so a `width - 2`-wide content row never has the cursor at its absolute right edge; framing adds bars *outside* the content. Mitigation: manual QA — type a line long enough to wrap and confirm the cursor and the right `│` edge do not collide or clip; paste a multi-line block and confirm each side row is framed.
- **Very narrow terminals (Task 3).** `innerWidth = Math.max(1, width - 2)` guards against non-positive inner widths; `composeBorderLines` already returns early when `lines.length < 2`. At extreme narrow widths the box may look degenerate but will not crash. No code change needed beyond the `Math.max` guard.
- **Autocomplete rows inside the box (Task 3).** When autocomplete is active, match rows are relocated between the top and bottom borders and are now framed with `│`. This is the intended closed-box behaviour. Mitigation: manual QA — trigger a slash-command autocomplete (e.g. type `/stat`) and confirm the match rows render inside the rectangle with vertical edges and the status border sits below them.
- **No TypeScript type-check gate.** Tests run via `--experimental-strip-types` (types stripped, not checked). The token swap (Task 2) and the `caps` parameter (Task 3) are type-safe, but a typo in a token string would only surface at theme-resolution time. Mitigation: the BORDER_TOKENS test asserts exact token strings; corner glyphs are asserted by the rectangle test.
- **Terminal glyph support.** Rounded corners `╭╮╰╯` and `│` are standard box-drawing glyphs already adjacent in usage to the existing `─`; virtually all modern terminals render them. No mitigation required beyond using the same Unicode block as the existing border.
- **Manual UI verification required.** Unit tests cover the pure layout functions but cannot confirm the live editor renders correctly. After implementation, run the agent with `placement=border` (the default per `status.json`) in a real terminal and visually confirm: (a) the editor is a closed rounded rectangle, (b) the branch appears left of the cwd on the top edge, (c) the cwd is green (`success`) and the branch is gray (`muted`), and (d) typing, wrapping, and autocomplete behave correctly. State explicitly in the completion report that this live check was or was not performed.

## Test Command

```bash
node --experimental-strip-types --test packages/pi-flow-ux/extensions/border-status.test.ts
```

(Run from the repo root `/Users/david/Code/pi-flow`. This mirrors the package's own `test:node` script — `node --experimental-strip-types --test` over the `.test.ts` files — but scoped to the file this plan changes. To run the full package suite instead: `pnpm --filter @aphotic/pi-flow-ux test`.)

## Self-Review

**Spec coverage:**
1. "Swap the position of the cwd and the branch" → Task 1 (reorders `fitTopRight` to branch-first; tests + order assertion updated).
2. "Swap the colors of those two fields (branch↔cwd tokens)" → Task 2 (`cwd: "success"`, `branch: "muted"`; doc comments + BORDER_TOKENS test updated).
3. "Assess and plan whether/how to connect the two horizontal border lines with vertical lines into a full rectangle" → Task 3 (assessment recorded in Architecture summary — render inner at `width-2`, corner-cap top/bottom, frame interior with `│`; feasibility confirmed against the compiled `Editor.render` structure and the TUI cursor-marker mechanism; new + updated tests). The reference screenshot was used only for the border *shape* (rounded rectangle, labels embedded near the right edge), per the task instruction; its field content/positions were not treated as authoritative.

No requirement is left without a task.

**Placeholder scan:** No "TBD"/"TODO"/"implement later"/"similar to Task N" present. Every step contains the literal code or the exact comment/test text to apply. Every acceptance criterion is immediately followed by its own `Verify:` line, and every `Verify:` recipe names a concrete command or a file + grep/inspection target with a success condition (no "check that it works" placeholders).

**Type consistency:** `BorderColorField`, `BorderColorize`, and `ThemeColor` usages are unchanged. `fitBorder`'s new `caps` parameter is optional with a dash default, so the existing 4-argument call sites remain valid; the two new call sites pass all six arguments. `fitTopRight`'s signature is unchanged (only its body is reordered). `composeBorderLines` keeps its `ComposeBorderLinesOptions` interface and its `width` contract; the new `innerWidth` is a local. The editor `render` still passes the full `width` to `composeBorderLines`.

PLAN_ARTIFACT: /Users/david/Code/pi-flow/docs/plans/2026-05-28-border-status-ui-tweaks.md
