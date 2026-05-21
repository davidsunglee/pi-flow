import test from "node:test";
import assert from "node:assert/strict";

import { buildInterpretedPrompt, SLASH_TO_SKILL, type SkillKey } from "./router.ts";
import { registerWorkflowCommands } from "./workflow.ts";

type CommandDef = {
  description: string;
  handler: (args: string, ctx: any) => void | Promise<void>;
};

type NotifyLevel = "info" | "warning" | "error";
type NotifyCall = { message: string; level: NotifyLevel };

const EXPECTED_DESCRIPTIONS = {
  "flow:scout": "Run scout. Routes a IDEA-<id>, brief path, or freeform request to the scout skill.",
  "flow:spec": "Run define-spec. Routes a IDEA-<id>, spec path, or freeform request to the define-spec skill.",
  "flow:plan": "Run generate-plan. Routes a IDEA-<id>, brief path, or freeform request to the generate-plan skill.",
  "flow:refine-plan": "Run refine-plan against a plan file.",
  "flow:execute": "Run execute-plan against a plan file.",
  "flow:refine-code": "Run refine-code against a review.",
  "flow:fastlane": "Run fastlane for a spec or freeform request.",
} as const;

const EXACT_ARGS: Record<string, string> = {
  "flow:scout": "IDEA-abcd1234",
  "flow:spec": "IDEA-abcd1234",
  "flow:plan": "IDEA-abcd1234",
  "flow:refine-plan": "docs/plans/x.md",
  "flow:execute": "docs/plans/x.md",
  "flow:refine-code": "docs/reviews/x.md",
  "flow:fastlane": "docs/specs/x.md",
};

const PROSE_ARGS: Record<string, string> = {
  "flow:scout": "investigate the auth flow",
  "flow:spec": "write the auth spec",
  "flow:plan": "plan the auth work",
  "flow:refine-plan": "tighten the rollout plan",
  "flow:execute": "ship the rollout plan",
  "flow:refine-code": "review the auth changes",
  "flow:fastlane": "implement auth quickly",
};

function bootExtension() {
  const commands = new Map<string, CommandDef>();
  const sendUserMessageCalls: string[] = [];
  const notifyCalls: NotifyCall[] = [];

  const stubPi = {
    registerCommand(name: string, def: CommandDef) {
      commands.set(name, def);
    },
    sendUserMessage(message: string) {
      sendUserMessageCalls.push(message);
    },
  };

  registerWorkflowCommands(stubPi as any);

  const ctx = {
    ui: {
      notify(message: string, level: NotifyLevel) {
        notifyCalls.push({ message, level });
      },
    },
  };

  return { commands, sendUserMessageCalls, notifyCalls, ctx };
}

test("registerWorkflowCommands registers the 7 flow commands with exact descriptions", () => {
  const { commands } = bootExtension();

  assert.deepEqual([...commands.keys()], Object.keys(EXPECTED_DESCRIPTIONS));

  for (const [name, description] of Object.entries(EXPECTED_DESCRIPTIONS)) {
    assert.equal(commands.get(name)?.description, description);
  }
});

for (const [slashName, skill] of Object.entries(SLASH_TO_SKILL)) {
  test(`${slashName} exact routing sends the exact prompt once`, async () => {
    const { commands, sendUserMessageCalls, notifyCalls, ctx } = bootExtension();

    await commands.get(slashName)!.handler(EXACT_ARGS[slashName]!, ctx);

    assert.deepEqual(sendUserMessageCalls, [
      `Use the ${skill} skill. Argument: ${EXACT_ARGS[slashName]}.`,
    ]);
    assert.deepEqual(notifyCalls, []);
  });

  test(`${slashName} interpreted routing sends the interpreted prompt once`, async () => {
    const { commands, sendUserMessageCalls, notifyCalls, ctx } = bootExtension();
    const rawArgs = PROSE_ARGS[slashName]!;

    await commands.get(slashName)!.handler(rawArgs, ctx);

    assert.equal(sendUserMessageCalls.length, 1);
    assert.equal(sendUserMessageCalls[0], buildInterpretedPrompt(skill as SkillKey, rawArgs));
    assert.deepEqual(notifyCalls, []);
  });

  test(`${slashName} rejects --exact on non-exact input`, async () => {
    const { commands, sendUserMessageCalls, notifyCalls, ctx } = bootExtension();

    await commands.get(slashName)!.handler(`--exact ${PROSE_ARGS[slashName]}`, ctx);

    assert.deepEqual(sendUserMessageCalls, []);
    assert.equal(notifyCalls.length, 1);
    assert.equal(notifyCalls[0]?.level, "error");
    assert.match(notifyCalls[0]?.message ?? "", new RegExp(`/${slashName}`));
    assert.match(notifyCalls[0]?.message ?? "", /--exact|--no-interpret/);
  });

  test(`${slashName} rejects --no-interpret on non-exact input`, async () => {
    const { commands, sendUserMessageCalls, notifyCalls, ctx } = bootExtension();

    await commands.get(slashName)!.handler(`--no-interpret ${PROSE_ARGS[slashName]}`, ctx);

    assert.deepEqual(sendUserMessageCalls, []);
    assert.equal(notifyCalls.length, 1);
    assert.equal(notifyCalls[0]?.level, "error");
    assert.match(notifyCalls[0]?.message ?? "", new RegExp(`/${slashName}`));
    assert.match(notifyCalls[0]?.message ?? "", /--exact|--no-interpret/);
  });
}
