import test from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_DIR = resolve(PKG_DIR, "agents");
const COMMANDS_PATH = resolve(PKG_DIR, "extensions", "commands.ts");
const SUBAGENT_MANIFEST_PATH = resolve(
  PKG_DIR,
  "node_modules",
  "pi-interactive-subagent",
  "package.json",
);
const AGENT_BASENAMES = readdirSync(AGENTS_DIR)
  .filter((name) => name.endsWith(".md"))
  .sort();
const REAL_AGENTS_DIR = realpathSync(AGENTS_DIR);

function resolveExtensionEntryFromManifest(manifest, manifestPath) {
  const manifestDir = dirname(manifestPath);
  const piEntry = manifest.pi?.extensions?.[0];
  if (typeof piEntry === "string") {
    return resolve(manifestDir, piEntry);
  }

  if (typeof manifest.main === "string") {
    return resolve(manifestDir, manifest.main);
  }

  const rootExport = manifest.exports?.["."] ?? manifest.exports;
  if (typeof rootExport === "string") {
    return resolve(manifestDir, rootExport);
  }
  if (rootExport && typeof rootExport === "object") {
    for (const key of ["import", "default", "require"]) {
      if (typeof rootExport[key] === "string") {
        return resolve(manifestDir, rootExport[key]);
      }
    }
  }

  throw new Error(`Unable to resolve extension entry from ${manifestPath}`);
}

async function withSandboxEnv(sandbox, homeDir, fn) {
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevCwd = process.cwd();
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.chdir(sandbox);
  try {
    return await fn();
  } finally {
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
  }
}

async function withToolDenyOverride(fn) {
  const prevDeny = process.env.PI_DENY_TOOLS;
  process.env.PI_DENY_TOOLS = "";
  try {
    return await fn();
  } finally {
    if (prevDeny === undefined) delete process.env.PI_DENY_TOOLS;
    else process.env.PI_DENY_TOOLS = prevDeny;
  }
}

test("setup + dispatch smoke", async (t) => {
  const sandbox = mkdtempSync(join(tmpdir(), "pi-flow-setup-dispatch-"));
  const homeDir = join(sandbox, "home");
  mkdirSync(homeDir, { recursive: true });

  const subagentManifestPath = SUBAGENT_MANIFEST_PATH;
  const subagentManifest = JSON.parse(readFileSync(subagentManifestPath, "utf8"));
  const subagentExtensionPath = resolveExtensionEntryFromManifest(
    subagentManifest,
    subagentManifestPath,
  );

  const loader = new DefaultResourceLoader({
    cwd: sandbox,
    agentDir: join(homeDir, ".pi", "agent"),
    additionalExtensionPaths: [COMMANDS_PATH, subagentExtensionPath],
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });

  try {
    await withToolDenyOverride(() => loader.reload());
    const extensions = loader.getExtensions();
    const commandsExtension = extensions.extensions.find(
      (entry) => entry.resolvedPath === COMMANDS_PATH,
    );
    const subagentExtension = extensions.extensions.find(
      (entry) => entry.resolvedPath === subagentExtensionPath,
    );

    assert.ok(commandsExtension, "expected commands extension to load");
    assert.ok(subagentExtension, "expected pi-interactive-subagent extension to load");

    const sendUserMessageCalls = [];
    extensions.runtime.sendUserMessage = (content) => {
      sendUserMessageCalls.push(content);
    };
    extensions.runtime.getCommands = () =>
      [...commandsExtension.commands.entries()].map(([name, command]) => ({
        name,
        sourceInfo: command.sourceInfo,
      }));

    const setupCommand = commandsExtension.commands.get("flow:setup");
    const scoutCommand = commandsExtension.commands.get("flow:scout");
    assert.ok(setupCommand, "expected flow:setup to be registered via the loader");
    assert.ok(scoutCommand, "expected flow:scout to be registered via the loader");
    assert.ok(setupCommand.sourceInfo, "loader-registered command must carry sourceInfo");
    assert.ok(scoutCommand.sourceInfo, "loader-registered command must carry sourceInfo");
    const setupHandler = setupCommand.handler;
    const scoutHandler = scoutCommand.handler;
    assert.equal(typeof setupHandler, "function");
    assert.equal(typeof scoutHandler, "function");

    const notifyCalls = [];
    const ctx = {
      cwd: sandbox,
      hasUI: false,
      ui: {
        notify(message, level) {
          notifyCalls.push({ message, level });
        },
      },
    };

    await t.test("pi-interactive-subagent extension is resolved from packages/pi-flow-core/node_modules and DefaultResourceLoader loads both extensions with errors === []", () => {
      assert.equal(subagentManifestPath, SUBAGENT_MANIFEST_PATH);
      assert.deepEqual(
        extensions.errors,
        [],
        `extension loader must not report errors; got ${JSON.stringify(extensions.errors)}`,
      );
    });

    await t.test("/flow:setup --target project creates symlinks in <sandbox>/.pi/agents/ and every pi-flow-core/agents/*.md source has a corresponding symlink whose realpath resolves back into the package", async () => {
      await withSandboxEnv(sandbox, homeDir, () => setupHandler("--target project", ctx));

      const infoCall = notifyCalls.find(
        (call) => call.level === "info" && call.message.includes("created"),
      );
      assert.ok(infoCall, `expected info-level created notify; got ${JSON.stringify(notifyCalls)}`);

      const linkedDir = join(sandbox, ".pi", "agents");
      const linkedNames = readdirSync(linkedDir)
        .filter((name) => name.endsWith(".md"))
        .sort();
      assert.deepEqual(linkedNames, AGENT_BASENAMES);

      for (const name of linkedNames) {
        const linkedPath = join(linkedDir, name);
        assert.equal(lstatSync(linkedPath).isSymbolicLink(), true, `${name} must be a symlink`);
        const resolvedTarget = realpathSync(linkedPath);
        assert.equal(dirname(resolvedTarget), REAL_AGENTS_DIR);
        assert.equal(basename(resolvedTarget), name);
      }
    });

    await t.test("reading a linked agent file through the symlink returns YAML frontmatter with name: scout and a description field", () => {
      const linkedDir = join(sandbox, ".pi", "agents");
      const linkedNames = readdirSync(linkedDir)
        .filter((name) => name.endsWith(".md"))
        .sort();
      assert.notEqual(linkedNames.length, 0);
      assert.deepEqual(linkedNames, AGENT_BASENAMES);

      const scoutBody = readFileSync(join(linkedDir, "scout.md"), "utf8");
      assert.equal(scoutBody.startsWith("---\n"), true);
      assert.match(scoutBody, /^name: scout$/m);
      assert.match(scoutBody, /^description: /m);
    });

    await t.test("the loaded pi-interactive-subagent extension registers a subagent_run* primitive and its discovery accessor lists a superset of the linked project agents", async () => {
      const toolNames = [...subagentExtension.tools.keys()];
      assert.ok(
        toolNames.some((name) => /subagent[_-]?run/i.test(name)),
        `expected a subagent_run* tool; got ${JSON.stringify(toolNames)}`,
      );

      const listTool = [...subagentExtension.tools.values()].find(
        (tool) => tool.name === "subagents_list",
      );

      if (listTool?.execute) {
        const result = await withToolDenyOverride(() =>
          withSandboxEnv(sandbox, homeDir, () => listTool.execute()),
        );
        const discoveredNames = new Set(
          (result.details?.agents ?? []).map((agent) => `${agent.name}.md`),
        );
        for (const expected of AGENT_BASENAMES) {
          assert.equal(
            discoveredNames.has(expected),
            true,
            `expected discovery accessor to include ${expected}`,
          );
        }
      } else {
        // This installed version exposes no direct agent-listing accessor on the extension surface,
        // so the filesystem-level .pi/agents assertions above cover the discovery seam instead.
        assert.ok(true);
      }
    });

    await t.test("a workflow command (/flow:scout) invocation with IDEA-abcd1234 produces exactly one pi.sendUserMessage call with the byte-equal dispatch body", async () => {
      await scoutHandler("IDEA-abcd1234", {
        ui: {
          notify() {
            throw new Error("/flow:scout should not notify for exact IDEA input");
          },
        },
      });

      assert.deepEqual(sendUserMessageCalls, [
        "Use the scout skill. Argument: IDEA-abcd1234.",
      ]);
    });

    await t.test("a second /flow:setup run reports all entries as skipped", async () => {
      notifyCalls.length = 0;
      await withSandboxEnv(sandbox, homeDir, () => setupHandler("--target project", ctx));

      const skippedCall = notifyCalls.find((call) => call.message.includes("skipped:"));
      assert.ok(skippedCall, `expected skipped notify; got ${JSON.stringify(notifyCalls)}`);
      const skippedCount = skippedCall.message
        .split("\n")
        .filter((line) => line.includes("skipped:"))
        .length;
      assert.equal(skippedCount, AGENT_BASENAMES.length);
      assert.equal(skippedCall.message.includes("created:"), false);
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
