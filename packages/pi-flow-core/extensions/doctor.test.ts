import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseDeclaredPackages,
  isLocalDevCheckout,
  classifySurface,
  resolveBinToCore,
  buildDiagnosis,
  renderReport,
} from "./doctor.ts";

function mkSandbox(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function seedCore(root: string, version: string): Promise<void> {
  await fs.mkdir(path.join(root, "bin"), { recursive: true });
  await fs.mkdir(path.join(root, "agents"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@aphotic/pi-flow-core", version }),
  );
  await fs.writeFile(path.join(root, "bin", "pi-flow.mjs"), "");
  await fs.writeFile(path.join(root, "agents", "flow.md"), "# flow\n");
}

// --- classifySurface / isLocalDevCheckout -----------------------------------

test("classifySurface: returns each classification for crafted inputs", () => {
  const activeRoot = "/proj/active";
  const cwd = "/proj";
  assert.equal(
    classifySurface({ activeRoot, cwd, realpath: "/x", exists: false }),
    "absent",
  );
  assert.equal(
    classifySurface({ activeRoot, cwd, realpath: null, exists: true }),
    "unresolved",
  );
  assert.equal(
    classifySurface({ activeRoot, cwd, realpath: activeRoot, exists: true }),
    "active",
  );
  assert.equal(
    classifySurface({ activeRoot, cwd, realpath: "/proj/src/pkg", exists: true }),
    "local-dev",
  );
  assert.equal(
    classifySurface({ activeRoot, cwd, realpath: "/elsewhere/pkg", exists: true }),
    "stale-skew",
  );
});

test("isLocalDevCheckout: a checkout under cwd with no install segment is local-dev", () => {
  assert.equal(isLocalDevCheckout("/proj/packages/pi-flow", "/proj"), true);
  assert.equal(isLocalDevCheckout("/proj", "/proj"), true);
  // install segments under cwd are NOT local-dev
  assert.equal(
    isLocalDevCheckout("/proj/node_modules/@aphotic/pi-flow-core", "/proj"),
    false,
  );
  assert.equal(
    isLocalDevCheckout("/proj/.pi/npm/node_modules/@aphotic/pi-flow-core", "/proj"),
    false,
  );
  // outside the tree
  assert.equal(isLocalDevCheckout("/elsewhere/pkg", "/proj"), false);
});

// --- parseDeclaredPackages --------------------------------------------------

test("parseDeclaredPackages: parses the live two-entry shape (object npm floating + bare local)", () => {
  const settings = {
    packages: [
      { source: "npm:@aphotic/pi-flow", extensions: [], skills: [] },
      "../packages/pi-flow",
    ],
  };
  const result = parseDeclaredPackages(settings);
  assert.deepEqual(result, [
    { spec: "npm:@aphotic/pi-flow", kind: "npm", pinned: false },
    { spec: "../packages/pi-flow", kind: "local", pinned: false },
  ]);
});

test("parseDeclaredPackages: marks an explicit @version npm spec as pinned", () => {
  const result = parseDeclaredPackages({
    packages: [{ source: "npm:@aphotic/pi-flow@0.8.0" }],
  });
  assert.deepEqual(result, [
    { spec: "npm:@aphotic/pi-flow@0.8.0", kind: "npm", pinned: true },
  ]);
});

test("parseDeclaredPackages: returns [] when packages is absent or not an array", () => {
  assert.deepEqual(parseDeclaredPackages({}), []);
  assert.deepEqual(parseDeclaredPackages({ packages: "nope" }), []);
  assert.deepEqual(parseDeclaredPackages(null), []);
});

// --- buildDiagnosis: skew via helper shim -----------------------------------

async function makeShim(homeDir: string, targetBin: string): Promise<void> {
  const shimPath = path.join(homeDir, ".pi", "agent", "bin", "pi-flow");
  await fs.mkdir(path.dirname(shimPath), { recursive: true });
  await fs.symlink(targetBin, shimPath);
}

async function makeUserAgents(homeDir: string, coreRoot: string): Promise<void> {
  const dir = path.join(homeDir, ".pi", "agent", "agents");
  await fs.mkdir(dir, { recursive: true });
  await fs.symlink(path.join(coreRoot, "agents", "flow.md"), path.join(dir, "flow.md"));
}

test("buildDiagnosis: helper shim to a stale core yields stale-skew and hasSkew=true", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-skew-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");

  const staleRoot = path.join(cwd, ".pi", "npm", "node_modules", "@aphotic", "pi-flow-core");
  await seedCore(staleRoot, "0.5.0");

  await makeShim(home, path.join(staleRoot, "bin", "pi-flow.mjs"));
  await makeUserAgents(home, activeRoot);

  const d = await buildDiagnosis({ activeRoot, cwd, homeDir: home, scope: "user" });

  const shim = d.surfaces.find((s) => s.kind === "helper-shim");
  assert.ok(shim);
  assert.equal(shim.classification, "stale-skew");
  assert.equal(d.hasSkew, true);
  assert.ok(d.skewKinds.includes("helper-shim"));
});

test("buildDiagnosis: helper shim and agents resolving to active yields hasSkew=false", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-ok-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");

  await makeShim(home, path.join(activeRoot, "bin", "pi-flow.mjs"));
  await makeUserAgents(home, activeRoot);

  const d = await buildDiagnosis({ activeRoot, cwd, homeDir: home, scope: "user" });

  const shim = d.surfaces.find((s) => s.kind === "helper-shim");
  const agents = d.surfaces.find((s) => s.kind === "user-agents");
  assert.equal(shim?.classification, "active");
  assert.equal(agents?.classification, "active");
  assert.equal(d.hasSkew, false);
});

test("buildDiagnosis: a checkout under cwd (no node_modules) is local-dev and not skew", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-localdev-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");

  // A source checkout living inside the working tree (not an install).
  const checkoutRoot = path.join(cwd, "packages", "pi-flow-core");
  await seedCore(checkoutRoot, "2.0.0-dev");

  await makeShim(home, path.join(checkoutRoot, "bin", "pi-flow.mjs"));

  const d = await buildDiagnosis({ activeRoot, cwd, homeDir: home, scope: "user" });
  const shim = d.surfaces.find((s) => s.kind === "helper-shim");
  assert.equal(shim?.classification, "local-dev");
  assert.equal(d.hasSkew, false);
});

test("renderReport: names the active package and emits the SKEW verdict when skewed", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-render-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");
  const staleRoot = path.join(cwd, ".pi", "npm", "node_modules", "@aphotic", "pi-flow-core");
  await seedCore(staleRoot, "0.5.0");
  await makeShim(home, path.join(staleRoot, "bin", "pi-flow.mjs"));

  const d = await buildDiagnosis({ activeRoot, cwd, homeDir: home, scope: "user" });
  const report = renderReport(d);

  const firstLine = report.split("\n")[0];
  assert.ok(firstLine.startsWith("Active pi-flow package: @aphotic/pi-flow-core@1.0.0 ("));
  assert.ok(report.includes("[SKEW]"));
  assert.ok(
    report.endsWith(
      "SKEW DETECTED — helper/template/skill resolution can use a different pi-flow version than the active skills.",
    ),
  );
});

test("renderReport: emits the OK verdict when nothing is skewed", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-ok-render-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");

  const d = await buildDiagnosis({ activeRoot, cwd, homeDir: home, scope: "user" });
  const report = renderReport(d);
  assert.ok(
    report.endsWith("OK — all managed pi-flow surfaces resolve to the active package."),
  );
});

// --- aggregate wrapper bin --------------------------------------------------

async function seedAggregate(
  aggRoot: string,
  bundledCoreRoot: string,
): Promise<void> {
  await fs.mkdir(path.join(aggRoot, "bin"), { recursive: true });
  await fs.writeFile(
    path.join(aggRoot, "package.json"),
    JSON.stringify({ name: "@aphotic/pi-flow", version: "0.8.0" }),
  );
  await fs.writeFile(path.join(aggRoot, "bin", "pi-flow.mjs"), "");
  await seedCore(bundledCoreRoot, "0.8.0");
}

test("resolveBinToCore: follows an aggregate wrapper .bin symlink to the delegated core", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-agg-");
  const cwd = path.join(sandbox, "proj");
  const aggRoot = path.join(cwd, "node_modules", "@aphotic", "pi-flow");
  const bundledCore = path.join(aggRoot, "node_modules", "@aphotic", "pi-flow-core");
  await seedAggregate(aggRoot, bundledCore);

  const dotBin = path.join(cwd, "node_modules", ".bin");
  await fs.mkdir(dotBin, { recursive: true });
  const binLink = path.join(dotBin, "pi-flow");
  await fs.symlink(path.join("..", "@aphotic", "pi-flow", "bin", "pi-flow.mjs"), binLink);

  const res = await resolveBinToCore(binLink);
  assert.ok(res.core);
  assert.equal(res.core.name, "@aphotic/pi-flow-core");
  assert.equal(res.core.version, "0.8.0");
  assert.ok(res.viaAggregate);
  assert.equal(res.viaAggregate.name, "@aphotic/pi-flow");
});

test("buildDiagnosis: node-bin through aggregate wrapper reports the delegated core, never non-pi-flow", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-agg-bd-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });

  const aggRoot = path.join(cwd, "node_modules", "@aphotic", "pi-flow");
  const bundledCore = path.join(aggRoot, "node_modules", "@aphotic", "pi-flow-core");
  await seedAggregate(aggRoot, bundledCore);

  const dotBin = path.join(cwd, "node_modules", ".bin");
  await fs.mkdir(dotBin, { recursive: true });
  await fs.symlink(
    path.join("..", "@aphotic", "pi-flow", "bin", "pi-flow.mjs"),
    path.join(dotBin, "pi-flow"),
  );

  const activeRoot = realpathSync(bundledCore);
  const d = await buildDiagnosis({ activeRoot, cwd, homeDir: home, scope: "project" });

  const nodeBin = d.surfaces.find((s) => s.kind === "node-bin");
  assert.ok(nodeBin);
  assert.equal(nodeBin.pkg?.name, "@aphotic/pi-flow-core");
  assert.notEqual(nodeBin.classification, "non-pi-flow");
  assert.equal(nodeBin.classification, "active");
  assert.ok(nodeBin.detail?.includes("via @aphotic/pi-flow@0.8.0 wrapper"));
});
