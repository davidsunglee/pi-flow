/**
 * Working Indicator Extension
 *
 * Customizes the inline working indicator shown while Pi is working. Settings
 * are persisted globally in `~/.pi/agent/working.json` via the shared
 * `indicatorShape`, `active`, `toolUse`, and `thinking` keys.
 *
 * Command:
 *   /working
 *   /working indicator=dot|pulse|spinner
 *   /working active color=default|#RRGGBB
 *   /working active gleam=on|off
 *   /working active rainbow=on|off
 *   /working tool-use color=default|#RRGGBB
 *   /working tool-use gleam=on|off
 *   /working tool-use rainbow=on|off
 *   /working thinking color=default|#RRGGBB
 *   /working thinking gleam=on|off
 *   /working thinking rainbow=on|off
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { buildWorkingIndicator } from "./effects.ts";
import { DEFAULT_SETTINGS_PATH, getWorkingCoordinator } from "./working.ts";

export { DEFAULT_SETTINGS_PATH } from "./working.ts";

export function createExtension(settingsPath: string = DEFAULT_SETTINGS_PATH) {
  return function (pi: ExtensionAPI): void {
    const coordinator = getWorkingCoordinator(settingsPath);
    coordinator.ensureRegistered(pi, true);

    let ctxRef: ExtensionContext | undefined;
    let unsubscribe: (() => void) | undefined;

    const render = () => {
      if (!ctxRef) return;
      const snapshot = coordinator.getSnapshot();
      if (!snapshot.visible) {
        // Explicitly restore the host default when we're idle so the custom
        // indicator does not linger on the screen between turns.
        ctxRef.ui.setWorkingIndicator();
        return;
      }
      const style = snapshot.settings[snapshot.state];
      ctxRef.ui.setWorkingIndicator(buildWorkingIndicator(snapshot.settings.indicatorShape, style));
    };

    unsubscribe = coordinator.subscribe(() => render());

    pi.on("session_start", (_event, ctx) => {
      ctxRef = ctx;
      render();
    });

    pi.on("session_shutdown", () => {
      unsubscribe?.();
      unsubscribe = undefined;
      ctxRef = undefined;
    });
  };
}

export default createExtension();
