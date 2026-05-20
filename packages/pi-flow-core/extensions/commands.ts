import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerSetup } from "./setup.ts";
import { registerIdea } from "./idea.ts";
import { registerWorkflowCommands } from "./workflow.ts";

export default function (pi: ExtensionAPI): void {
  registerSetup(pi);
  registerIdea(pi);
  registerWorkflowCommands(pi);
}
