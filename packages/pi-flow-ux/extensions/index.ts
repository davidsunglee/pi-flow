import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installBorderEditor } from "./editor.ts";
import { installBlankFooter } from "./footer.ts";
import { createDefaultSnapshotSources, createHeaderResources, readQuietStartup } from "./header-data.ts";
import { HEADER_DETAILS_MESSAGE_TYPE, createHeaderDetailsRenderer, showHeaderDetails } from "./header-details.ts";
import { installHeader, type SessionStartReason } from "./header.ts";
import { getTuiSettingsStore } from "./settings.ts";
import { getWorkingCoordinator } from "./working.ts";

export { DEFAULT_TUI_SETTINGS_PATH, PACKAGE_DEFAULT_TUI_SETTINGS_PATH } from "./settings.ts";

export default function (pi: ExtensionAPI): void {
  // The settings store owns config (tui.json load + the /tui command); register
  // it first so the command exists and settings load on session_start.
  const store = getTuiSettingsStore();
  store.ensureRegistered(pi, {
    registerCommand: true,
    showHeaderDetails: (cmdCtx) => showHeaderDetails(pi, cmdCtx),
  });
  pi.registerMessageRenderer(HEADER_DETAILS_MESSAGE_TYPE, createHeaderDetailsRenderer());

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
    const headerResources = createHeaderResources();
    void headerResources.refresh(createDefaultSnapshotSources(pi, ctx)).catch(() => {});
    handles = [
      installBlankFooter(ctx),
      installBorderEditor(pi, ctx, store),
      installHeader(ctx, reason, store, headerResources, readQuietStartup(ctx.cwd)),
    ];
  });

  pi.on("session_shutdown", teardown);
}
