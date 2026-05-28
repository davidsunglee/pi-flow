import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getStatusCoordinator } from "./status.ts";

export {
  DEFAULT_STATUS_SETTINGS_PATH,
  PACKAGE_DEFAULT_STATUS_SETTINGS_PATH,
} from "./status.ts";

export default function (pi: ExtensionAPI): void {
  getStatusCoordinator().ensureRegistered(pi, true);
}
