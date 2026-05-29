import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { MESSAGE_ANIMATION_INTERVAL_MS, renderWorkingMessageFrame, shouldAnimateStyle } from "./effects.ts";
import { DEFAULT_SETTINGS_PATH, PACKAGE_DEFAULT_SETTINGS_PATH, getWorkingCoordinator } from "./working.ts";
import { pickRandomWorkingMessage } from "./messages.ts";

export function createExtension(
  settingsPath: string = DEFAULT_SETTINGS_PATH,
  packageDefaultPath: string = PACKAGE_DEFAULT_SETTINGS_PATH,
) {
  return function (pi: ExtensionAPI) {
    const coordinator = getWorkingCoordinator(settingsPath, packageDefaultPath);
    coordinator.ensureRegistered(pi, false);

    let currentMessage: string | undefined;
    let frame = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let ctxRef: ExtensionContext | undefined;
    let styledRenderingSupported = true;
    let unsubscribe: (() => void) | undefined;
    // Tracks whether we have hidden the host working loader row so we only
    // toggle visibility on transitions (border <-> footer/off) and restore it
    // exactly once.
    let hostWorkingHidden = false;

    function setHostWorkingHidden(hidden: boolean): void {
      if (hostWorkingHidden === hidden) return;
      hostWorkingHidden = hidden;
      ctxRef?.ui.setWorkingVisible(!hidden);
    }

    function stopAnimation(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    }

    function render(): void {
      if (!ctxRef) return;
      const snapshot = coordinator.getSnapshot();

      if (snapshot.borderOwned) {
        // Border placement relocates the working surface into the compact
        // border slot, so suppress the host working loader row entirely — not
        // just the custom message. Otherwise the built-in loader/message row
        // lingers in its old above-editor location and competes with the
        // border slot.
        stopAnimation();
        setHostWorkingHidden(true);
        return;
      }

      // Footer/off placement keeps the full working surface in its host
      // location, so make sure the loader row we may have hidden is restored.
      setHostWorkingHidden(false);

      if (!snapshot.visible || currentMessage === undefined) {
        stopAnimation();
        ctxRef.ui.setWorkingMessage();
        return;
      }

      if (!ctxRef.hasUI || !styledRenderingSupported) {
        ctxRef.ui.setWorkingMessage(currentMessage);
        return;
      }

      const style = snapshot.settings[snapshot.state];
      try {
        ctxRef.ui.setWorkingMessage(renderWorkingMessageFrame(currentMessage, style, frame));
      } catch {
        styledRenderingSupported = false;
        stopAnimation();
        ctxRef.ui.setWorkingMessage(currentMessage);
      }
    }

    function syncAnimation(): void {
      if (!ctxRef || currentMessage === undefined) return;
      const snapshot = coordinator.getSnapshot();
      if (snapshot.borderOwned) {
        // The border owns the working surface; never animate a host message.
        stopAnimation();
        frame = 0;
        render();
        return;
      }
      const style = snapshot.settings[snapshot.state];
      const animate = snapshot.visible && ctxRef.hasUI && styledRenderingSupported && shouldAnimateStyle(style);

      if (!animate) {
        stopAnimation();
        frame = 0;
        render();
        return;
      }

      if (timer !== undefined) {
        render();
        return;
      }

      frame = 0;
      render();
      if (!styledRenderingSupported) return;
      timer = setInterval(() => {
        frame += 1;
        render();
      }, MESSAGE_ANIMATION_INTERVAL_MS);
    }

    unsubscribe = coordinator.subscribe(() => syncAnimation());

    pi.on("session_start", (_event, ctx) => {
      ctxRef = ctx;
      if (currentMessage !== undefined) syncAnimation();
    });

    pi.on("turn_start", (_event, ctx) => {
      ctxRef = ctx;
      currentMessage = pickRandomWorkingMessage();
      frame = 0;
      syncAnimation();
    });

    pi.on("turn_end", (_event, ctx) => {
      ctxRef = ctx;
      stopAnimation();
      currentMessage = undefined;
      ctx.ui.setWorkingMessage();
    });

    pi.on("session_shutdown", () => {
      stopAnimation();
      currentMessage = undefined;
      // Restore the host loader row if we hid it for border placement, so we
      // never leave the working surface suppressed after teardown.
      setHostWorkingHidden(false);
      ctxRef = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    });
  };
}

export default createExtension();
