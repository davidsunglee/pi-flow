/**
 * Blank-footer renderer
 *
 * Suppresses Pi's built-in/default footer by installing a footer that renders
 * no lines. The border-status editor draws session metadata into the editor
 * border, so without this the default footer would still show redundant
 * model/context/session information below the editor. Pairing the border editor
 * with this blank footer keeps the border as the only visible status surface.
 *
 * Disposing restores Pi's default footer via setFooter(undefined).
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import type { StatusRendererHandle } from "./status.ts";

export function installBlankFooter(
	_pi: ExtensionAPI,
	ctx: ExtensionContext,
): StatusRendererHandle {
	ctx.ui.setFooter(() => ({ render: () => [], invalidate() {} }));

	return {
		dispose() {
			ctx.ui.setFooter(undefined);
		},
	};
}
