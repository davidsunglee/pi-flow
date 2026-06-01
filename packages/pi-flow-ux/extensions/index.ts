import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installBorderEditor } from "./editor.ts";
import { installBlankFooter } from "./footer.ts";
import { installHeader, type SessionStartReason } from "./header.ts";
import { getWorkingCoordinator } from "./working.ts";

export { DEFAULT_TUI_SETTINGS_PATH, PACKAGE_DEFAULT_TUI_SETTINGS_PATH } from "./working.ts";

export default function (pi: ExtensionAPI): void {
  // The coordinator owns event tracking, the /tui command, tui.json loading,
  // and host-working-row suppression. It self-registers its own session
  // handlers, so register it before wiring the UI surfaces.
  getWorkingCoordinator().ensureRegistered(pi, true);

  let handles: { dispose(): void }[] = [];
  const teardown = (): void => {
    for (const h of handles) h.dispose();
    handles = [];
  };

  pi.on("session_start", (event, ctx) => {
    teardown();
    const reason = (event as { reason?: SessionStartReason }).reason ?? "startup";
    handles = [installBlankFooter(ctx), installBorderEditor(pi, ctx), installHeader(ctx, reason)];
  });

  pi.on("session_shutdown", teardown);
}
