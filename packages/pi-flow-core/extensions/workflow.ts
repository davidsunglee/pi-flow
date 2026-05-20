import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import { routeArgs, SLASH_TO_SKILL, type SkillKey } from "./router.ts";

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  "flow:scout": "Run scout. Routes a TODO-<id>, brief path, or freeform request to the scout skill.",
  "flow:spec": "Run define-spec. Routes a TODO-<id>, spec path, or freeform request to the define-spec skill.",
  "flow:plan": "Run generate-plan. Routes a TODO-<id>, brief path, or freeform request to the generate-plan skill.",
  "flow:refine-plan": "Run refine-plan against a plan file.",
  "flow:execute": "Run execute-plan against a plan file.",
  "flow:refine-code": "Run refine-code against a review.",
  "flow:fastlane": "Run fastlane for a spec or freeform request.",
};

export function registerWorkflowCommands(pi: ExtensionAPI): void {
  for (const [slashName, skill] of Object.entries(SLASH_TO_SKILL)) {
    pi.registerCommand(slashName, {
      description: COMMAND_DESCRIPTIONS[slashName],
      handler: async (args: string, ctx: ExtensionCommandContext) =>
        handleWorkflowCommand(pi, ctx, skill, args),
    });
  }
}

export async function handleWorkflowCommand(
  pi: Pick<ExtensionAPI, "sendUserMessage">,
  ctx: Pick<ExtensionCommandContext, "ui">,
  skill: SkillKey,
  args: string,
): Promise<void> {
  const outcome = routeArgs(skill, args);

  if (outcome.kind === "exact-required-but-non-exact") {
    ctx.ui.notify(outcome.reason!, "error");
    return;
  }

  await Promise.resolve(pi.sendUserMessage(outcome.prompt!));
}
