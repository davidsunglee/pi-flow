import path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerSetup } from "./setup.ts";
import { registerIdea } from "@aphotic/pi-ideas/extensions/idea.ts";
import { registerWorkflowCommands } from "./workflow.ts";

export default function (pi: ExtensionAPI): void {
  registerSetup(pi);
  registerIdea(pi, { defaultConfigPath: path.join(import.meta.dirname, "..", "ideas.json") });
  registerWorkflowCommands(pi);
}
