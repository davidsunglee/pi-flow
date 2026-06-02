import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installBorderEditor } from "./editor.ts";
import { installBlankFooter } from "./footer.ts";
import { installHeader, type SessionStartReason } from "./header.ts";
import { getTuiSettingsStore } from "./settings.ts";
import { getWorkingCoordinator } from "./working.ts";

export { DEFAULT_TUI_SETTINGS_PATH, PACKAGE_DEFAULT_TUI_SETTINGS_PATH } from "./settings.ts";

export default function (pi: ExtensionAPI): void {
  // The settings store owns config (tui.json load + the /tui command); register
  // it first so the command exists and settings load on session_start.
  const store = getTuiSettingsStore();
  store.ensureRegistered(pi, { registerCommand: true });

  // The working coordinator owns working-state tracking only.
  getWorkingCoordinator().ensureRegistered(pi);

  let handles: { dispose(): void }[] = [];
  const teardown = (): void => {
    for (const h of handles) h.dispose();
    handles = [];
  };

  pi.on("session_start", (event, ctx) => {
    teardown();
    const reason = (event as { reason?: SessionStartReason }).reason ?? "startup";
    handles = [
      installBlankFooter(ctx),
      installBorderEditor(pi, ctx, store),
      installHeader(ctx, reason, store),
    ];
  });

  pi.on("session_shutdown", teardown);
}
