/**
 * Blank-footer renderer
 *
 * Suppresses Pi's built-in footer by installing a footer that renders no lines.
 * The border editor draws session metadata into the editor border, so without
 * this the default footer would duplicate model/context/session info below the
 * editor. Disposing restores Pi's default footer via setFooter(undefined).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface FooterHandle { dispose(): void; }

export function installBlankFooter(ctx: ExtensionContext): FooterHandle {
	ctx.ui.setFooter(() => ({ render: () => [], invalidate() {} }));
	return { dispose() { ctx.ui.setFooter(undefined); } };
}
