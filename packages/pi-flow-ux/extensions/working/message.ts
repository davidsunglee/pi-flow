import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { MESSAGE_ANIMATION_INTERVAL_MS, renderWorkingMessageFrame, shouldAnimateStyle } from "./effects.ts";
import { DEFAULT_SETTINGS_PATH, getWorkingCoordinator } from "./working.ts";
import { pickRandomWorkingMessage } from "./messages.ts";

export function createExtension(settingsPath: string = DEFAULT_SETTINGS_PATH) {
  return function (pi: ExtensionAPI) {
    const coordinator = getWorkingCoordinator(settingsPath);
    coordinator.ensureRegistered(pi, false);

    let currentMessage: string | undefined;
    let frame = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let ctxRef: ExtensionContext | undefined;
    let styledRenderingSupported = true;
    let unsubscribe: (() => void) | undefined;

    function stopAnimation(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    }

    function render(): void {
      if (!ctxRef) return;
      const snapshot = coordinator.getSnapshot();

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
      ctxRef = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    });
  };
}

export default createExtension();
