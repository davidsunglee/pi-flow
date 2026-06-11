import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveDispatchTarget } from "../pi-flow-dispatch.mjs";

// Path to the real shared module — copied into each sandbox so the dispatcher
// bootstrap probe finds and imports a genuine effective-package.mjs.
const MODULE_SRC = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "extensions",
  "lib",
  "effective-package.mjs",
);

// --- sandbox helpers --------------------------------------------------------

function mkSandbox(prefix) {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function seedCore(root, version) {
  await fs.mkdir(path.join(root, "bin"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@aphotic/pi-flow-core", version }),
  );
  await fs.writeFile(path.join(root, "bin", "pi-flow.mjs"), "");
}

// Seed a core AND copy the shared module into it so its extensions/lib path is a
// valid bootstrap candidate.
async function seedBootstrapCore(root, version) {
  await seedCore(root, version);
  const libDir = path.join(root, "extensions", "lib");
  await fs.mkdir(libDir, { recursive: true });
  await fs.copyFile(MODULE_SRC, path.join(libDir, "effective-package.mjs"));
}

function agentNpm(home) {
  return path.join(home, ".pi", "agent", "npm", "node_modules", "@aphotic");
}

async function seedUserDirectCore(home, version) {
  const root = path.join(agentNpm(home), "pi-flow-core");
  await seedBootstrapCore(root, version);
  return root;
}

async function seedUserAggregateCore(home, version) {
  const aggRoot = path.join(agentNpm(home), "pi-flow");
  await fs.mkdir(path.join(aggRoot, "bin"), { recursive: true });
  await fs.writeFile(
    path.join(aggRoot, "package.json"),
    JSON.stringify({ name: "@aphotic/pi-flow", version }),
  );
  await fs.writeFile(path.join(aggRoot, "bin", "pi-flow.mjs"), "");
  const bundledCore = path.join(aggRoot, "node_modules", "@aphotic", "pi-flow-core");
  await seedBootstrapCore(bundledCore, version);
  return bundledCore;
}

async function writeTrust(home, map) {
  const trustPath = path.join(home, ".pi", "agent", "trust.json");
  await fs.mkdir(path.dirname(trustPath), { recursive: true });
  await fs.writeFile(trustPath, JSON.stringify(map));
}

async function writeProjectSettings(cwd, settings) {
  const settingsPath = path.join(cwd, ".pi", "settings.json");
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, settings);
}

// --- tests ------------------------------------------------------------------

test("trusted project override resolves to the project core", async () => {
  const sandbox = mkSandbox("disp-proj-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await seedUserDirectCore(home, "1.0.0");

  const projCore = path.join(cwd, ".pi", "npm", "node_modules", "@aphotic", "pi-flow-core");
  await seedCore(projCore, "2.0.0");
  await writeProjectSettings(cwd, JSON.stringify({ packages: ["npm:@aphotic/pi-flow-core"] }));
  await writeTrust(home, { [cwd]: true });

  const { targetBin } = await resolveDispatchTarget({ cwd, homeDir: home });
  assert.equal(targetBin, path.join(realpathSync(projCore), "bin", "pi-flow.mjs"));
});

test("no project pi-flow entry falls back to the user core", async () => {
  const sandbox = mkSandbox("disp-user-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  const userCore = await seedUserDirectCore(home, "1.0.0");
  await writeProjectSettings(cwd, JSON.stringify({ packages: [] }));

  const { targetBin } = await resolveDispatchTarget({ cwd, homeDir: home });
  assert.equal(targetBin, path.join(realpathSync(userCore), "bin", "pi-flow.mjs"));
});

test("untrusted project override is ignored; resolves to the user core", async () => {
  const sandbox = mkSandbox("disp-untrusted-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  const userCore = await seedUserDirectCore(home, "1.0.0");

  const projCore = path.join(cwd, ".pi", "npm", "node_modules", "@aphotic", "pi-flow-core");
  await seedCore(projCore, "2.0.0");
  await writeProjectSettings(cwd, JSON.stringify({ packages: ["npm:@aphotic/pi-flow-core"] }));
  // No trust entry → override ignored.

  const { targetBin } = await resolveDispatchTarget({ cwd, homeDir: home });
  assert.equal(targetBin, path.join(realpathSync(userCore), "bin", "pi-flow.mjs"));
});

test("a direct-core user install resolves to its bin/pi-flow.mjs", async () => {
  const sandbox = mkSandbox("disp-direct-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  const userCore = await seedUserDirectCore(home, "1.2.3");
  await fs.mkdir(cwd, { recursive: true });

  const { targetBin } = await resolveDispatchTarget({ cwd, homeDir: home });
  assert.equal(targetBin, path.join(realpathSync(userCore), "bin", "pi-flow.mjs"));
});

test("an aggregate user install resolves to its delegated core bin/pi-flow.mjs", async () => {
  const sandbox = mkSandbox("disp-agg-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  const bundledCore = await seedUserAggregateCore(home, "0.8.0");
  await fs.mkdir(cwd, { recursive: true });

  const { targetBin } = await resolveDispatchTarget({ cwd, homeDir: home });
  assert.equal(targetBin, path.join(realpathSync(bundledCore), "bin", "pi-flow.mjs"));
});

test("malformed project settings.json falls back to the user core without throwing", async () => {
  const sandbox = mkSandbox("disp-bad-settings-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  const userCore = await seedUserDirectCore(home, "1.0.0");
  await writeProjectSettings(cwd, "{ this is not json");
  await writeTrust(home, { [cwd]: true });

  const { targetBin } = await resolveDispatchTarget({ cwd, homeDir: home });
  assert.equal(targetBin, path.join(realpathSync(userCore), "bin", "pi-flow.mjs"));
});

test("malformed trust.json falls back to the user core without throwing", async () => {
  const sandbox = mkSandbox("disp-bad-trust-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  const userCore = await seedUserDirectCore(home, "1.0.0");

  const projCore = path.join(cwd, ".pi", "npm", "node_modules", "@aphotic", "pi-flow-core");
  await seedCore(projCore, "2.0.0");
  await writeProjectSettings(cwd, JSON.stringify({ packages: ["npm:@aphotic/pi-flow-core"] }));
  // Malformed trust → untrusted → override ignored → user core.
  const trustPath = path.join(home, ".pi", "agent", "trust.json");
  await fs.mkdir(path.dirname(trustPath), { recursive: true });
  await fs.writeFile(trustPath, "}{ broken");

  const { targetBin } = await resolveDispatchTarget({ cwd, homeDir: home });
  assert.equal(targetBin, path.join(realpathSync(userCore), "bin", "pi-flow.mjs"));
});

test("no user install found yields a null target", async () => {
  const sandbox = mkSandbox("disp-none-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(cwd, { recursive: true });

  const { targetBin } = await resolveDispatchTarget({ cwd, homeDir: home });
  assert.equal(targetBin, null);
});
