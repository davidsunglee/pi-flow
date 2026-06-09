import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  const home = mkdtempSync(join(tmpdir(), "pi-flow-core-commands-home-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    registerCommands({
      registerCommand(name: string, def: RegisteredCommand) {
        commands.set(name, def);
      },
      registerTool(tool: RegisteredTool) {
        tools.set(tool.name, tool);
      },
    } as any);
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
    rmSync(home, { recursive: true, force: true });
  }

  assert.deepEqual([...commands.keys()], [
    "flow:setup",
    "flow:doctor",
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
