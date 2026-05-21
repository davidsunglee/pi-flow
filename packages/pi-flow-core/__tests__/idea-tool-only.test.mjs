import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS_PATH = resolve(PKG_DIR, "extensions", "commands.ts");

test("packaged extensions register only the built-in `idea` tool — no external `todo` tool required for idea-artifact state", async (t) => {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "pi-flow-idea-tool-only-")));
  const homeDir = join(sandbox, "home");
  mkdirSync(homeDir, { recursive: true });

  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevCwd = process.cwd();
  const prevDeny = process.env.PI_DENY_TOOLS;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.PI_DENY_TOOLS = "";
  process.chdir(sandbox);

  try {
    const loader = new DefaultResourceLoader({
      cwd: sandbox,
      agentDir: join(homeDir, ".pi", "agent"),
      additionalExtensionPaths: [COMMANDS_PATH],
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
    });
    await loader.reload();
    const extensions = loader.getExtensions();
    const commandsExtension = extensions.extensions.find(
      (entry) => entry.resolvedPath === COMMANDS_PATH,
    );
    assert.ok(commandsExtension, "expected commands extension to load");

    await t.test("registers `flow:idea` command and `idea` tool — no `todo` or `flow:todo` registrations", () => {
      const commandNames = [...commandsExtension.commands.keys()];
      const toolNames = [...commandsExtension.tools.keys()];
      assert.ok(commandNames.includes("flow:idea"));
      assert.ok(toolNames.includes("idea"));
      assert.equal(commandNames.some((n) => n === "todo" || n === "flow:todo"), false,
        `no \`todo\`/\`flow:todo\` command should be registered; got ${JSON.stringify(commandNames)}`);
      assert.equal(toolNames.some((n) => n === "todo" || n === "flow:todo"), false,
        `no \`todo\`/\`flow:todo\` tool should be registered; got ${JSON.stringify(toolNames)}`);
    });

    await t.test("generate-plan orchestration prerequisite: skill reads idea bodies via the built-in `idea` tool (no external `todo` tool referenced)", async () => {
      const generatePlanSkill = await import("node:fs/promises").then((m) =>
        m.readFile(resolve(PKG_DIR, "skills", "generate-plan", "SKILL.md"), "utf8"),
      );
      assert.equal(/\btodo tool\b|`todo` tool/.test(generatePlanSkill), false,
        "generate-plan/SKILL.md must not reference an external `todo` tool");
      assert.ok(/\bidea\b.*\btool\b|`idea` tool/.test(generatePlanSkill),
        "generate-plan/SKILL.md must reference the built-in `idea` tool");
    });

    await t.test("execute-plan orchestration end-to-end: Step 16.2 'close linked idea' path round-trips an IDEA-<id> through the `idea` tool's read + update with only the built-in `idea` tool registered", async () => {
      const executePlanSkill = await import("node:fs/promises").then((m) =>
        m.readFile(resolve(PKG_DIR, "skills", "execute-plan", "SKILL.md"), "utf8"),
      );
      assert.equal(/\btodo tool\b|`todo` tool/.test(executePlanSkill), false,
        "execute-plan/SKILL.md must not reference an external `todo` tool (verifies the orchestrator never depends on it)");
      const ideaTool = commandsExtension.tools.get("idea");
      assert.ok(ideaTool, "expected `idea` tool to be registered");
      // Simulate the execute-plan Step 16.2 flow end-to-end:
      //   1) generate-plan emits a plan with `**Source:** IDEA-<id>` (we seed the artifact directly here)
      //   2) execute-plan extracts the IDEA-<id>, reads the artifact via the `idea` tool,
      //   3) execute-plan calls the `idea` tool's `update` action with status="done" and an appended body line.
      const ideaDir = join(sandbox, "docs", "ideas");
      mkdirSync(ideaDir, { recursive: true });
      const id = "abc12345";
      const metadata = JSON.stringify(
        { id, title: "Test idea", tags: [], status: "open", created_at: "2026-05-20T00:00:00.000Z" },
        null, 2,
      );
      writeFileSync(join(ideaDir, `${id}.md`), `${metadata}\n\nSeed body\n`, "utf8");
      // Step 16.2 step 2: read via the built-in `idea` tool.
      const readResult = await ideaTool.definition.execute("call-read", { action: "read", id: `IDEA-${id}` }, undefined, undefined, { cwd: sandbox });
      assert.equal(readResult.isError, undefined);
      const readParsed = JSON.parse(readResult.content[0].text);
      assert.equal(readParsed.id, id);
      assert.equal(readParsed.title, "Test idea");
      assert.equal(readParsed.status, "open");
      // Step 16.2 step 3: update via the built-in `idea` tool with the appended "Completed via plan:" line.
      const completedBody = `${readParsed.body}\nCompleted via plan: docs/plans/sample.md`;
      const updateResult = await ideaTool.definition.execute("call-update", { action: "update", id: `IDEA-${id}`, status: "done", body: completedBody }, undefined, undefined, { cwd: sandbox });
      assert.equal(updateResult.isError, undefined);
      assert.match(updateResult.content[0].text, /^IDEA-abc12345\n/);
      // Confirm the round-trip: a follow-up read sees status="done" and the appended completion line.
      const reReadResult = await ideaTool.definition.execute("call-reread", { action: "read", id: `IDEA-${id}` }, undefined, undefined, { cwd: sandbox });
      const reReadParsed = JSON.parse(reReadResult.content[0].text);
      assert.equal(reReadParsed.status, "done");
      assert.match(reReadParsed.body, /Completed via plan: docs\/plans\/sample\.md/);
    });
  } finally {
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
    if (prevDeny === undefined) delete process.env.PI_DENY_TOOLS; else process.env.PI_DENY_TOOLS = prevDeny;
    rmSync(sandbox, { recursive: true, force: true });
  }
});
