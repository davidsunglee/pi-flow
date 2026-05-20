import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import workingIndicator from "./indicator.ts";
import workingMessage from "./message.ts";

export { DEFAULT_SETTINGS_PATH, PACKAGE_DEFAULT_SETTINGS_PATH } from "./working.ts";

export default function (pi: ExtensionAPI): void {
  workingIndicator(pi);
  workingMessage(pi);
}
