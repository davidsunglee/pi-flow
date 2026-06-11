import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseDeclaredPackages,
  normalizePiFlowIdentity,
  resolveSpecToCoreRoot,
  isTrusted,
  resolveEffectiveCoreRoot,
  resolveUserCoreRoot,
  abbreviatePath,
} from "./effective-package.mjs";

// --- sandbox helpers (plain JS, mirror doctor.test.ts) ----------------------

function mkSandbox(prefix) {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function seedCore(root, version) {
  await fs.mkdir(path.join(root, "bin"), { recursive: true });
  await fs.mkdir(path.join(root, "agents"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@aphotic/pi-flow-core", version }),
  );
  await fs.writeFile(path.join(root, "bin", "pi-flow.mjs"), "");
  await fs.writeFile(path.join(root, "agents", "flow.md"), "# flow\n");
}

async function seedAggregate(aggRoot, bundledCoreRoot) {
  await fs.mkdir(path.join(aggRoot, "bin"), { recursive: true });
  await fs.writeFile(
    path.join(aggRoot, "package.json"),
    JSON.stringify({ name: "@aphotic/pi-flow", version: "0.8.0" }),
  );
  await fs.writeFile(path.join(aggRoot, "bin", "pi-flow.mjs"), "");
  await seedCore(bundledCoreRoot, "0.8.0");
}

async function writeTrust(homeDir, map) {
  const trustPath = path.join(homeDir, ".pi", "agent", "trust.json");
  await fs.mkdir(path.dirname(trustPath), { recursive: true });
  await fs.writeFile(trustPath, JSON.stringify(map));
}

async function writeProjectSettings(cwd, settings) {
  const settingsPath = path.join(cwd, ".pi", "settings.json");
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings));
}

async function writeUserSettings(home, settings) {
  const settingsPath = path.join(home, ".pi", "agent", "settings.json");
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings));
}

// --- parseDeclaredPackages --------------------------------------------------

test("parseDeclaredPackages: a string npm: spec is kind npm (bug fix), not local", () => {
  const rows = parseDeclaredPackages(["npm:@aphotic/pi-flow"]);
  assert.deepEqual(rows, [
    { spec: "npm:@aphotic/pi-flow", kind: "npm", pinned: false, name: "@aphotic/pi-flow" },
  ]);
});

test("parseDeclaredPackages: both contract shapes yield identical rows", () => {
  const fromArray = parseDeclaredPackages(["npm:@aphotic/pi-flow"]);
  const fromSettings = parseDeclaredPackages({ packages: ["npm:@aphotic/pi-flow"] });
  assert.deepEqual(fromArray, fromSettings);
});

test("parseDeclaredPackages: object-form npm spec is classified the same as string-form", () => {
  const rows = parseDeclaredPackages({
    packages: [{ source: "npm:@aphotic/pi-flow-core", extensions: [] }],
  });
  assert.deepEqual(rows, [
    {
      spec: "npm:@aphotic/pi-flow-core",
      kind: "npm",
      pinned: false,
      name: "@aphotic/pi-flow-core",
    },
  ]);
});

test("parseDeclaredPackages: a pinned @version npm spec sets pinned and strips the version from name", () => {
  const rows = parseDeclaredPackages(["npm:@aphotic/pi-flow@0.8.0"]);
  assert.deepEqual(rows, [
    {
      spec: "npm:@aphotic/pi-flow@0.8.0",
      kind: "npm",
      pinned: true,
      name: "@aphotic/pi-flow",
    },
  ]);
});

test("parseDeclaredPackages: a bare path string stays local", () => {
  const rows = parseDeclaredPackages(["../packages/pi-flow"]);
  assert.deepEqual(rows, [
    { spec: "../packages/pi-flow", kind: "local", pinned: false },
  ]);
});

test("parseDeclaredPackages: missing/non-array packages yields []", () => {
  assert.deepEqual(parseDeclaredPackages({}), []);
  assert.deepEqual(parseDeclaredPackages({ packages: "nope" }), []);
  assert.deepEqual(parseDeclaredPackages(null), []);
});

// --- normalizePiFlowIdentity ------------------------------------------------

test("normalizePiFlowIdentity: aggregate and core map to one identity; foreign names are null", () => {
  assert.equal(normalizePiFlowIdentity("@aphotic/pi-flow"), "pi-flow");
  assert.equal(normalizePiFlowIdentity("@aphotic/pi-flow-core"), "pi-flow");
  assert.equal(normalizePiFlowIdentity("@aphotic/pi-flow"), normalizePiFlowIdentity("@aphotic/pi-flow-core"));
  assert.equal(normalizePiFlowIdentity("@other/thing"), null);
  assert.equal(normalizePiFlowIdentity(undefined), null);
});

// --- resolveSpecToCoreRoot --------------------------------------------------

test("resolveSpecToCoreRoot: resolves a direct-core npm install under the project npm tree", async () => {
  const sandbox = mkSandbox("eff-spec-direct-");
  const cwd = path.join(sandbox, "proj");
  const coreRoot = path.join(
    cwd,
    ".pi",
    "npm",
    "node_modules",
    "@aphotic",
    "pi-flow-core",
  );
  await seedCore(coreRoot, "1.2.3");

  const core = await resolveSpecToCoreRoot({
    spec: "npm:@aphotic/pi-flow-core",
    kind: "npm",
    name: "@aphotic/pi-flow-core",
    baseDir: cwd,
  });
  assert.ok(core);
  assert.equal(core.name, "@aphotic/pi-flow-core");
  assert.equal(core.version, "1.2.3");
  assert.equal(core.root, realpathSync(coreRoot));
});

test("resolveSpecToCoreRoot: resolves an aggregate install to its delegated core", async () => {
  const sandbox = mkSandbox("eff-spec-agg-");
  const cwd = path.join(sandbox, "proj");
  const aggRoot = path.join(cwd, ".pi", "npm", "node_modules", "@aphotic", "pi-flow");
  const bundledCore = path.join(aggRoot, "node_modules", "@aphotic", "pi-flow-core");
  await seedAggregate(aggRoot, bundledCore);

  const core = await resolveSpecToCoreRoot({
    spec: "npm:@aphotic/pi-flow",
    kind: "npm",
    name: "@aphotic/pi-flow",
    baseDir: cwd,
  });
  assert.ok(core);
  assert.equal(core.name, "@aphotic/pi-flow-core");
  assert.equal(core.version, "0.8.0");
});

test("resolveSpecToCoreRoot: resolves a local checkout spec relative to baseDir", async () => {
  const sandbox = mkSandbox("eff-spec-local-");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(cwd, { recursive: true });
  const coreRoot = path.join(sandbox, "checkout", "pi-flow-core");
  await seedCore(coreRoot, "9.9.9");

  const core = await resolveSpecToCoreRoot({
    spec: "../checkout/pi-flow-core",
    kind: "local",
    baseDir: cwd,
  });
  assert.ok(core);
  assert.equal(core.version, "9.9.9");
});

test("resolveSpecToCoreRoot: returns null when nothing resolves", async () => {
  const sandbox = mkSandbox("eff-spec-none-");
  const core = await resolveSpecToCoreRoot({
    spec: "npm:@aphotic/pi-flow-core",
    kind: "npm",
    name: "@aphotic/pi-flow-core",
    baseDir: path.join(sandbox, "empty"),
  });
  assert.equal(core, null);
});

// --- isTrusted --------------------------------------------------------------

test("isTrusted: exact key match is trusted", async () => {
  const home = mkSandbox("eff-trust-exact-");
  const cwd = "/work/proj";
  await writeTrust(home, { [cwd]: true });
  assert.equal(await isTrusted({ cwd, homeDir: home }), true);
});

test("isTrusted: an ancestor key trusts a descendant cwd", async () => {
  const home = mkSandbox("eff-trust-anc-");
  await writeTrust(home, { "/work": true });
  assert.equal(await isTrusted({ cwd: "/work/proj/sub", homeDir: home }), true);
});

test("isTrusted: a key with value false (or a sibling prefix) does not trust", async () => {
  const home = mkSandbox("eff-trust-untrusted-");
  await writeTrust(home, { "/work/proj": false, "/work/other": true });
  assert.equal(await isTrusted({ cwd: "/work/proj", homeDir: home }), false);
  // "/work/proj" is not a descendant of "/work/other"
  assert.equal(await isTrusted({ cwd: "/work/projector", homeDir: home }), false);
});

test("isTrusted: missing trust file is untrusted and does not throw", async () => {
  const home = mkSandbox("eff-trust-missing-");
  assert.equal(await isTrusted({ cwd: "/anywhere", homeDir: home }), false);
});

// --- resolveEffectiveCoreRoot -----------------------------------------------

async function seedUserCore(home, version) {
  const root = path.join(
    home,
    ".pi",
    "agent",
    "npm",
    "node_modules",
    "@aphotic",
    "pi-flow-core",
  );
  await seedCore(root, version);
  return root;
}

test("resolveEffectiveCoreRoot: a trusted project override resolves to the project core (scope project)", async () => {
  const sandbox = mkSandbox("eff-eff-proj-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await seedUserCore(home, "1.0.0");

  const projCore = path.join(cwd, ".pi", "npm", "node_modules", "@aphotic", "pi-flow-core");
  await seedCore(projCore, "2.0.0");
  await writeProjectSettings(cwd, { packages: ["npm:@aphotic/pi-flow-core"] });
  await writeTrust(home, { [cwd]: true });

  const eff = await resolveEffectiveCoreRoot({ cwd, homeDir: home });
  assert.ok(eff);
  assert.equal(eff.scope, "project");
  assert.equal(eff.root, realpathSync(projCore));
  assert.equal(eff.binPath, path.join(realpathSync(projCore), "bin", "pi-flow.mjs"));
});

test("resolveEffectiveCoreRoot: no project pi-flow entry falls back to the user core (scope user)", async () => {
  const sandbox = mkSandbox("eff-eff-user-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  const userCore = await seedUserCore(home, "1.0.0");
  await writeProjectSettings(cwd, { packages: [] });
  await writeTrust(home, { [cwd]: true });

  const eff = await resolveEffectiveCoreRoot({ cwd, homeDir: home });
  assert.ok(eff);
  assert.equal(eff.scope, "user");
  assert.equal(eff.root, realpathSync(userCore));
});

test("resolveEffectiveCoreRoot: an untrusted project override falls back to the user core", async () => {
  const sandbox = mkSandbox("eff-eff-untrusted-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  const userCore = await seedUserCore(home, "1.0.0");

  const projCore = path.join(cwd, ".pi", "npm", "node_modules", "@aphotic", "pi-flow-core");
  await seedCore(projCore, "2.0.0");
  await writeProjectSettings(cwd, { packages: ["npm:@aphotic/pi-flow-core"] });
  // no trust.json — project is untrusted

  const eff = await resolveEffectiveCoreRoot({ cwd, homeDir: home });
  assert.ok(eff);
  assert.equal(eff.scope, "user");
  assert.equal(eff.root, realpathSync(userCore));
});

test("resolveEffectiveCoreRoot: a user settings local pi-flow-core package resolves (scope user) without a fixed npm install", async () => {
  const sandbox = mkSandbox("eff-eff-user-local-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(cwd, { recursive: true });

  // A local core checkout declared by user settings, NOT at the fixed
  // ~/.pi/agent/npm install path. Local specs resolve relative to the agent dir.
  const userCore = path.join(home, ".pi", "agent", "checkout", "pi-flow-core");
  await seedCore(userCore, "3.3.3");
  await writeUserSettings(home, { packages: ["checkout/pi-flow-core"] });

  const eff = await resolveEffectiveCoreRoot({ cwd, homeDir: home });
  assert.ok(eff, "user-declared local package should resolve");
  assert.equal(eff.scope, "user");
  assert.equal(eff.root, realpathSync(userCore));
});

test("resolveEffectiveCoreRoot: a user settings npm pi-flow package resolves under ~/.pi/agent/npm (scope user)", async () => {
  const sandbox = mkSandbox("eff-eff-user-npm-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(cwd, { recursive: true });

  const userCore = await seedUserCore(home, "4.4.4");
  await writeUserSettings(home, { packages: ["npm:@aphotic/pi-flow-core"] });

  const eff = await resolveEffectiveCoreRoot({ cwd, homeDir: home });
  assert.ok(eff);
  assert.equal(eff.scope, "user");
  assert.equal(eff.root, realpathSync(userCore));
});

test("resolveEffectiveCoreRoot: returns null when neither project nor user resolves", async () => {
  const sandbox = mkSandbox("eff-eff-none-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(cwd, { recursive: true });
  const eff = await resolveEffectiveCoreRoot({ cwd, homeDir: home });
  assert.equal(eff, null);
});

// --- resolveUserCoreRoot ----------------------------------------------------

test("resolveUserCoreRoot: resolves a user settings-declared local package outside ~/.pi/agent/npm", async () => {
  const sandbox = mkSandbox("eff-user-local-");
  const home = path.join(sandbox, "home");
  // A local core checkout declared by user settings, NOT at the fixed npm path.
  const userCore = path.join(home, ".pi", "agent", "checkout", "pi-flow-core");
  await seedCore(userCore, "3.3.3");
  await writeUserSettings(home, { packages: ["checkout/pi-flow-core"] });

  const res = await resolveUserCoreRoot({ homeDir: home });
  assert.ok(res, "user-declared local package should resolve");
  assert.equal(res.scope, "user");
  assert.equal(res.root, realpathSync(userCore));
});

test("resolveUserCoreRoot: resolves the fixed npm install when no settings package is declared", async () => {
  const sandbox = mkSandbox("eff-user-fixed-");
  const home = path.join(sandbox, "home");
  const userCore = await seedUserCore(home, "1.0.0");

  const res = await resolveUserCoreRoot({ homeDir: home });
  assert.ok(res);
  assert.equal(res.scope, "user");
  assert.equal(res.root, realpathSync(userCore));
});

test("resolveUserCoreRoot: ignores any project override and returns null when no user install exists", async () => {
  const sandbox = mkSandbox("eff-user-none-");
  const home = path.join(sandbox, "home");
  await fs.mkdir(home, { recursive: true });

  const res = await resolveUserCoreRoot({ homeDir: home });
  assert.equal(res, null);
});

// --- abbreviatePath ---------------------------------------------------------

test("abbreviatePath: replaces a leading homeDir with ~", () => {
  const home = "/Users/me";
  assert.equal(abbreviatePath("/Users/me/.pi/agent", home), "~/.pi/agent");
  assert.equal(abbreviatePath("/Users/me", home), "~");
  // unrelated path untouched
  assert.equal(abbreviatePath("/opt/pkg", home), "/opt/pkg");
});

test("abbreviatePath: elides @aphotic install boilerplate, keeping the trailing package", () => {
  const home = "/Users/me";
  assert.equal(
    abbreviatePath("/Users/me/.pi/agent/npm/node_modules/@aphotic/pi-flow-core", home),
    "~/.pi/agent/npm/…/pi-flow-core",
  );
  assert.equal(
    abbreviatePath(
      "/Users/me/.pi/agent/npm/node_modules/@aphotic/pi-flow/node_modules/@aphotic/pi-flow-core",
      home,
    ),
    "~/.pi/agent/npm/…/pi-flow-core",
  );
});

test("abbreviatePath: is idempotent on already-abbreviated input", () => {
  const home = "/Users/me";
  const once = abbreviatePath(
    "/Users/me/.pi/agent/npm/node_modules/@aphotic/pi-flow-core",
    home,
  );
  assert.equal(abbreviatePath(once, home), once);
});
