import test from "node:test";
import assert from "node:assert/strict";

import registerCommands from "./commands.ts";

type RegisteredCommand = {
  description?: string;
  handler: (args: string, ctx: unknown) => void | Promise<void>;
};

type RegisteredTool = {
  name: string;
};

test("default extension entry point registers exactly the flow commands and idea tool", () => {
  const commands = new Map<string, RegisteredCommand>();
  const tools = new Map<string, RegisteredTool>();

  registerCommands({
    registerCommand(name: string, def: RegisteredCommand) {
      commands.set(name, def);
    },
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
  } as any);

  assert.deepEqual([...commands.keys()], [
    "flow:setup",
    "flow:idea",
    "flow:ideas",
    "flow:scout",
    "flow:spec",
    "flow:plan",
    "flow:refine-plan",
    "flow:execute",
    "flow:refine-code",
    "flow:fastlane",
  ]);
  assert.deepEqual([...tools.keys()], ["idea"]);
  assert.equal(commands.size, 10);
  assert.equal(tools.size, 1);
});
