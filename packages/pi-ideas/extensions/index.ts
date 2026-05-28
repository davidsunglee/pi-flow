import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerIdea } from "./idea.ts";

export default function (pi: ExtensionAPI): void {
  registerIdea(pi);
}
