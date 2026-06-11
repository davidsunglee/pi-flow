import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Classification } from "./doctor.ts";
import {
  parseDeclaredPackages,
  isLocalDevCheckout,
  classifySurface,
  resolveBinToCore,
  buildDiagnosis,
  renderReport,
  resolveReconcileTarget,
  validateExplicitTarget,
  repairLink,
  parseDoctorArgs,
  helpText,
  runDoctorFix,
} from "./doctor.ts";
import type { PiFlowCorePackage } from "./package-resolution.ts";
import { readPiFlowCorePackage } from "./package-resolution.ts";

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
  const effectiveRoot = "/proj/active";
  const cwd = "/proj";
  const inactiveInstallRoots = new Map<string, Classification>([
    ["/home/user/install", "inactive-overridden"],
    ["/proj/.pi/npm/node_modules/@aphotic/pi-flow-core", "inactive-shadowed"],
  ]);
  const base = {
    activeRoot,
    effectiveRoot,
    cwd,
    isResolutionKind: true,
    inactiveInstallRoots,
  };
  assert.equal(
    classifySurface({ ...base, realpath: "/x", exists: false }),
    "absent",
  );
  assert.equal(
    classifySurface({ ...base, realpath: null, exists: true }),
    "unresolved",
  );
  assert.equal(
    classifySurface({ ...base, realpath: effectiveRoot, exists: true }),
    "active",
  );
  assert.equal(
    classifySurface({ ...base, realpath: "/proj/src/pkg", exists: true }),
    "local-dev",
  );
  // A recognized inactive install carries its precomputed classification.
  assert.equal(
    classifySurface({ ...base, realpath: "/home/user/install", exists: true }),
    "inactive-overridden",
  );
  // A resolution surface pointing at an unrecognized root is genuine skew.
  assert.equal(
    classifySurface({ ...base, realpath: "/elsewhere/pkg", exists: true }),
    "stale-skew",
  );
  // A non-resolution surface pointing elsewhere is neutral, never skew.
  assert.equal(
    classifySurface({
      ...base,
      isResolutionKind: false,
      realpath: "/elsewhere/pkg",
      exists: true,
    }),
    "inactive-shadowed",
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
    { spec: "npm:@aphotic/pi-flow", kind: "npm", pinned: false, name: "@aphotic/pi-flow" },
    { spec: "../packages/pi-flow", kind: "local", pinned: false },
  ]);
});

test("parseDeclaredPackages: marks an explicit @version npm spec as pinned", () => {
  const result = parseDeclaredPackages({
    packages: [{ source: "npm:@aphotic/pi-flow@0.8.0" }],
  });
  assert.deepEqual(result, [
    { spec: "npm:@aphotic/pi-flow@0.8.0", kind: "npm", pinned: true, name: "@aphotic/pi-flow" },
  ]);
});

test("parseDeclaredPackages: bare npm: string is classified as npm, not local", () => {
  const result = parseDeclaredPackages({ packages: ["npm:@aphotic/pi-flow"] });
  assert.equal(result[0].kind, "npm");
  assert.equal(result[0].name, "@aphotic/pi-flow");
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

  // A stale core that is NOT at a recognized install candidate location, so the
  // helper shim pointing at it reads as genuine skew.
  const staleRoot = path.join(sandbox, "stale");
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

test("renderReport: OK verdict — header starts with OK, three sections present, no [SKEW]", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-render-ok-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");

  const d = await buildDiagnosis({ activeRoot, cwd, homeDir: home, scope: "user" });
  const report = renderReport(d);

  assert.ok(
    report.startsWith("pi-flow doctor — OK, no skew"),
    `first line should be OK header, got: ${report.split("\n")[0]}`,
  );
  assert.ok(report.includes("Effective surfaces"), "should have Effective surfaces section");
  assert.ok(report.includes("Inactive installs"), "should have Inactive installs section");
  assert.ok(report.includes("Skew"), "should have Skew section");
  assert.ok(!report.includes("[SKEW]"), "OK report must not contain [SKEW]");
});

test("renderReport: SKEW verdict — header is SKEW DETECTED and [SKEW] tag appears", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-render-skew-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");
  const staleRoot = path.join(sandbox, "stale");
  await seedCore(staleRoot, "0.5.0");
  await makeShim(home, path.join(staleRoot, "bin", "pi-flow.mjs"));

  const d = await buildDiagnosis({ activeRoot, cwd, homeDir: home, scope: "user" });
  const report = renderReport(d);

  assert.ok(
    report.startsWith("pi-flow doctor — SKEW DETECTED"),
    `first line should be SKEW header, got: ${report.split("\n")[0]}`,
  );
  assert.ok(report.includes("[SKEW]"), "SKEW report must contain [SKEW] tag");
});

test("renderReport: coexistence — overridden user install shows [inactive], zero [SKEW]", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-render-coexist-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  const overrideRoot = path.join(cwd, "packages", "pi-flow-core");
  await seedCore(overrideRoot, "1.0.0");
  await seedTrust(home, cwd);
  await seedSettings(cwd, ["packages/pi-flow-core"]);

  const d = await buildDiagnosis({ activeRoot: userRoot, cwd, homeDir: home, scope: "project" });
  const report = renderReport(d);

  assert.ok(!d.hasSkew, "coexistence should have no skew");
  assert.ok(report.includes("[inactive]"), "should have [inactive] row for overridden user install");
  assert.ok(!report.includes("[SKEW]"), "coexistence report must not contain [SKEW]");
  assert.ok(report.includes("Inactive installs"), "should have Inactive installs section");
});

test("renderReport: paths are abbreviated — no raw homeDir, contains ~", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-render-abbrev-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  await makeShim(home, path.join(userRoot, "bin", "pi-flow.mjs"));

  const d = await buildDiagnosis({ activeRoot: userRoot, cwd, homeDir: home, scope: "user" });
  const report = renderReport(d);

  assert.ok(!report.includes(home), `report must not contain raw homeDir path: ${home}`);
  assert.ok(report.includes("~"), "report should contain ~ for home abbreviation");
});

test("renderReport: empty sections render (none)", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-render-none-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");

  const d = await buildDiagnosis({ activeRoot, cwd, homeDir: home, scope: "user" });
  const report = renderReport(d);

  // With no inactive installs and no skew, both sections should show (none)
  const lines = report.split("\n");
  const inactiveIdx = lines.findIndex((l) => l.startsWith("Inactive installs"));
  assert.ok(inactiveIdx >= 0, "should have Inactive installs section");
  const afterInactive = lines[inactiveIdx + 1];
  assert.ok(
    afterInactive?.includes("(none)"),
    `line after "Inactive installs" should be (none), got: ${afterInactive}`,
  );

  const skewIdx = lines.findIndex((l) => l.startsWith("Skew"));
  assert.ok(skewIdx >= 0, "should have Skew section");
  const afterSkew = lines[skewIdx + 1];
  assert.ok(
    afterSkew?.includes("(none)"),
    `line after "Skew" should be (none), got: ${afterSkew}`,
  );
});

test("renderReport --all: adds Absent candidates section; default mode omits it", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-render-all-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");

  const d = await buildDiagnosis({ activeRoot, cwd, homeDir: home, scope: "user" });

  const defaultReport = renderReport(d);
  const allReport = renderReport(d, { all: true });

  assert.ok(
    allReport.includes("Absent candidates"),
    "--all report must have Absent candidates section",
  );
  assert.ok(
    !defaultReport.includes("Absent candidates"),
    "default report must not have Absent candidates section",
  );
  assert.ok(d.absentCandidates.length > 0, "diagnosis should track absent candidate paths");
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

// --- resolveReconcileTarget -------------------------------------------------

test("resolveReconcileTarget: a single distinct root returns ok with the active target", () => {
  const active: PiFlowCorePackage = {
    root: "/proj/active",
    name: "@aphotic/pi-flow-core",
    version: "1.0.0",
  };
  // Same root declared again (e.g. resolved via a different surface).
  const result = resolveReconcileTarget({
    active,
    declaredOrLoaded: [{ ...active }],
  });
  assert.equal(result.kind, "ok");
  assert.equal(result.target, active);
  assert.equal(result.candidates, undefined);
});

test("resolveReconcileTarget: two distinct roots (npm + checkout) returns ambiguous with both candidates", () => {
  const active: PiFlowCorePackage = {
    root: "/proj/.pi/npm/node_modules/@aphotic/pi-flow-core",
    name: "@aphotic/pi-flow-core",
    version: "0.8.0",
  };
  const checkout: PiFlowCorePackage = {
    root: "/proj/packages/pi-flow-core",
    name: "@aphotic/pi-flow-core",
    version: "2.0.0-dev",
  };
  const result = resolveReconcileTarget({
    active,
    declaredOrLoaded: [checkout],
  });
  assert.equal(result.kind, "ambiguous");
  assert.equal(result.target, undefined);
  assert.deepEqual(result.candidates, [active, checkout]);
});

// --- validateExplicitTarget -------------------------------------------------

test("validateExplicitTarget: accepts a seeded core root", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-vet-ok-");
  const coreRoot = path.join(sandbox, "core");
  await seedCore(coreRoot, "1.2.3");

  const result = await validateExplicitTarget(coreRoot, sandbox);
  assert.equal(result.ok, true);
  assert.equal(result.target?.root, realpathSync(coreRoot));
  assert.equal(result.target?.version, "1.2.3");
});

test("validateExplicitTarget: accepts a directory with a single descent core", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-vet-descend-");
  const coreRoot = path.join(sandbox, "packages", "pi-flow-core");
  await seedCore(coreRoot, "3.0.0");

  const result = await validateExplicitTarget(sandbox, sandbox);
  assert.equal(result.ok, true);
  assert.equal(result.target?.root, realpathSync(coreRoot));
});

test("validateExplicitTarget: a non-existent path reports target path does not exist", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-vet-missing-");
  const result = await validateExplicitTarget(
    path.join(sandbox, "nope"),
    sandbox,
  );
  assert.equal(result.ok, false);
  assert.ok(result.error?.includes("target path does not exist"));
});

test("validateExplicitTarget: a dir that is not a core with no descents reports not usable", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-vet-noncore-");
  const result = await validateExplicitTarget(sandbox, sandbox);
  assert.equal(result.ok, false);
  assert.ok(result.error?.includes("not a usable @aphotic/pi-flow-core package"));
});

test("validateExplicitTarget: a dir with two descent cores reports multiple pi-flow-core packages", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-vet-multi-");
  await seedCore(path.join(sandbox, "packages", "pi-flow-core"), "1.0.0");
  await seedCore(
    path.join(sandbox, "node_modules", "@aphotic", "pi-flow-core"),
    "2.0.0",
  );

  const result = await validateExplicitTarget(sandbox, sandbox);
  assert.equal(result.ok, false);
  assert.ok(result.error?.includes("multiple pi-flow-core packages"));
});

// --- repairLink -------------------------------------------------------------

test("repairLink: an absent link is created and points at the target", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-repair-create-");
  const target = path.join(sandbox, "active", "agents", "flow.md");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "# flow\n");
  const linkPath = path.join(sandbox, "home", "agents", "flow.md");

  const result = await repairLink({
    linkPath,
    desiredTarget: target,
    activeRoot: path.join(sandbox, "active"),
    cwd: sandbox,
  });

  assert.equal(result.outcome, "created");
  assert.equal(result.to, target);
  const st = await fs.lstat(linkPath);
  assert.ok(st.isSymbolicLink());
  assert.equal(realpathSync(linkPath), realpathSync(target));
});

test("repairLink: an already-correct link is skipped", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-repair-skip-");
  const target = path.join(sandbox, "active", "agents", "flow.md");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "# flow\n");
  const linkPath = path.join(sandbox, "home", "agents", "flow.md");
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.symlink(target, linkPath);

  const result = await repairLink({
    linkPath,
    desiredTarget: target,
    activeRoot: path.join(sandbox, "active"),
    cwd: sandbox,
  });

  assert.equal(result.outcome, "skipped");
});

test("repairLink: a stale-skew symlink is repaired and repointed at the target", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-repair-repaired-");
  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");
  const staleRoot = path.join(
    sandbox,
    "proj",
    ".pi",
    "npm",
    "node_modules",
    "@aphotic",
    "pi-flow-core",
  );
  await seedCore(staleRoot, "0.5.0");

  const target = path.join(activeRoot, "agents", "flow.md");
  const linkPath = path.join(sandbox, "home", "agents", "flow.md");
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.symlink(path.join(staleRoot, "agents", "flow.md"), linkPath);

  const result = await repairLink({
    linkPath,
    desiredTarget: target,
    activeRoot,
    cwd: path.join(sandbox, "proj"),
  });

  assert.equal(result.outcome, "repaired");
  assert.equal(result.from, realpathSync(path.join(staleRoot, "agents", "flow.md")));
  assert.equal(realpathSync(linkPath), realpathSync(target));
});

test("repairLink: a symlink into a local-dev checkout is preserved and left unchanged", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-repair-preserved-");
  const cwd = path.join(sandbox, "proj");
  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");
  const checkoutRoot = path.join(cwd, "packages", "pi-flow-core");
  await seedCore(checkoutRoot, "2.0.0-dev");

  const target = path.join(activeRoot, "agents", "flow.md");
  const checkoutLink = path.join(checkoutRoot, "agents", "flow.md");
  const linkPath = path.join(sandbox, "home", "agents", "flow.md");
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.symlink(checkoutLink, linkPath);

  const result = await repairLink({
    linkPath,
    desiredTarget: target,
    activeRoot,
    cwd,
  });

  assert.equal(result.outcome, "preserved-other");
  assert.equal(result.from, realpathSync(checkoutLink));
  // Link UNCHANGED — still points at the checkout.
  assert.equal(await fs.readlink(linkPath), checkoutLink);
  assert.equal(realpathSync(linkPath), realpathSync(checkoutLink));
});

test("repairLink: a symlink to a non-pi-flow target is a conflict and left unchanged", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-repair-non-pi-flow-");
  const activeRoot = path.join(sandbox, "active");
  await seedCore(activeRoot, "1.0.0");

  const target = path.join(activeRoot, "agents", "flow.md");
  const foreignTarget = path.join(sandbox, "other-package", "flow.md");
  await fs.mkdir(path.dirname(foreignTarget), { recursive: true });
  await fs.writeFile(foreignTarget, "# not pi-flow\n");

  const linkPath = path.join(sandbox, "home", "agents", "flow.md");
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.symlink(foreignTarget, linkPath);

  const result = await repairLink({
    linkPath,
    desiredTarget: target,
    activeRoot,
    cwd: sandbox,
  });

  assert.equal(result.outcome, "conflict");
  assert.equal(result.from, realpathSync(foreignTarget));
  assert.ok(result.conflict);
  assert.equal(await fs.readlink(linkPath), foreignTarget);
  assert.equal(realpathSync(linkPath), realpathSync(foreignTarget));
});

test("repairLink: a real file at the path is a conflict and its contents are unchanged", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-repair-conflict-");
  const target = path.join(sandbox, "active", "agents", "flow.md");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "# flow\n");
  const linkPath = path.join(sandbox, "home", "agents", "flow.md");
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.writeFile(linkPath, "DO NOT TOUCH\n");

  const result = await repairLink({
    linkPath,
    desiredTarget: target,
    activeRoot: path.join(sandbox, "active"),
    cwd: sandbox,
  });

  assert.equal(result.outcome, "conflict");
  assert.ok(result.conflict);
  // File contents UNCHANGED.
  const st = await fs.lstat(linkPath);
  assert.ok(st.isFile());
  assert.equal(await fs.readFile(linkPath, "utf8"), "DO NOT TOUCH\n");
});

// --- parseDoctorArgs --------------------------------------------------------

test("parseDoctorArgs: an empty string yields all flags false and no source", () => {
  assert.deepEqual(parseDoctorArgs(""), { help: false, fix: false, strict: false, all: false });
});

test("parseDoctorArgs: --fix sets fix only", () => {
  const r = parseDoctorArgs("--fix");
  assert.equal(r.fix, true);
  assert.equal(r.help, false);
  assert.equal(r.strict, false);
  assert.equal(r.source, undefined);
});

test("parseDoctorArgs: --strict sets strict only", () => {
  const r = parseDoctorArgs("--strict");
  assert.equal(r.strict, true);
  assert.equal(r.fix, false);
  assert.equal(r.help, false);
});

test("parseDoctorArgs: --fix --source pkg/x sets fix and captures the source value", () => {
  const r = parseDoctorArgs("--fix --source pkg/x");
  assert.equal(r.fix, true);
  assert.equal(r.source, "pkg/x");
  assert.equal(r.help, false);
});

test("parseDoctorArgs: --help (and -h) set help; unknown flags are ignored", () => {
  assert.equal(parseDoctorArgs("--help").help, true);
  assert.equal(parseDoctorArgs("-h").help, true);
  assert.deepEqual(parseDoctorArgs("--bogus"), { help: false, fix: false, strict: false, all: false });
});

// --- helpText ---------------------------------------------------------------

test("helpText: documents --source, names the core package, and states the never-edit-settings boundary", () => {
  const t = helpText();
  assert.ok(t.includes("--source"));
  assert.ok(t.includes("@aphotic/pi-flow-core"));
  assert.ok(t.includes("never edits"));
});

// --- runDoctorFix -----------------------------------------------------------

test("runDoctorFix: repoints the helper shim and agent links to the target and never writes settings.json", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-fix-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const targetRoot = path.join(sandbox, "active");
  await seedCore(targetRoot, "1.0.0");
  const target = (await readPiFlowCorePackage(targetRoot))!;

  const staleRoot = path.join(
    cwd,
    ".pi",
    "npm",
    "node_modules",
    "@aphotic",
    "pi-flow-core",
  );
  await seedCore(staleRoot, "0.5.0");

  // The shim currently points at the stale core.
  const shimPath = path.join(home, ".pi", "agent", "bin", "pi-flow");
  await fs.mkdir(path.dirname(shimPath), { recursive: true });
  await fs.symlink(path.join(staleRoot, "bin", "pi-flow.mjs"), shimPath);

  // The agents dir holds a stale flow.md link.
  const agentsDir = path.join(home, ".pi", "agent", "agents");
  await fs.mkdir(agentsDir, { recursive: true });
  await fs.symlink(
    path.join(staleRoot, "agents", "flow.md"),
    path.join(agentsDir, "flow.md"),
  );

  // Seed a settings.json and snapshot its bytes.
  const settingsPath = path.join(cwd, ".pi", "settings.json");
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(
    settingsPath,
    JSON.stringify({ packages: ["../active"] }, null, 2) + "\n",
  );
  const before = await fs.readFile(settingsPath);

  const r = await runDoctorFix({
    target,
    effectiveTarget: "user",
    shimPath,
    agentsDir,
    activeRoot: targetRoot,
    cwd,
    declaredSpecsForTarget: [],
  });

  assert.equal(r.shim?.outcome, "repaired");
  assert.equal(
    realpathSync(shimPath),
    realpathSync(path.join(targetRoot, "bin", "pi-flow.mjs")),
  );

  const flowAgent = r.agents.find((a) => a.path.endsWith("flow.md"));
  assert.equal(flowAgent?.outcome, "repaired");
  assert.equal(
    realpathSync(path.join(agentsDir, "flow.md")),
    realpathSync(path.join(targetRoot, "agents", "flow.md")),
  );

  // No declared spec names the target → settings guidance is emitted.
  assert.ok(r.guidance.some((g) => g.includes("doctor does not edit settings")));

  // settings.json is byte-for-byte unchanged (never-write-settings guarantee).
  const after = await fs.readFile(settingsPath);
  assert.ok(before.equals(after));
});

// --- effective model: inactive classifications + scope-aware + strict --------

async function seedUserInstall(home: string, version: string): Promise<string> {
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
  return realpathSync(root);
}

async function seedTrust(home: string, trustedCwd: string): Promise<void> {
  const trustPath = path.join(home, ".pi", "agent", "trust.json");
  await fs.mkdir(path.dirname(trustPath), { recursive: true });
  await fs.writeFile(trustPath, JSON.stringify({ [trustedCwd]: true }));
}

async function seedSettings(cwd: string, packages: unknown[]): Promise<void> {
  const p = path.join(cwd, ".pi", "settings.json");
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify({ packages }, null, 2) + "\n");
}

test("buildDiagnosis: global-only install with aligned shim/agents has no skew", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-globalonly-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  await makeShim(home, path.join(userRoot, "bin", "pi-flow.mjs"));
  await makeUserAgents(home, userRoot);

  const d = await buildDiagnosis({
    activeRoot: userRoot,
    cwd,
    homeDir: home,
    scope: "user",
  });

  assert.equal(d.effectiveRoot, userRoot);
  assert.equal(d.effectiveScope, "user");
  const shim = d.surfaces.find((s) => s.kind === "helper-shim");
  const userAgents = d.surfaces.find((s) => s.kind === "user-agents");
  const userInstall = d.surfaces.find((s) => s.kind === "user-install");
  assert.equal(shim?.classification, "active");
  assert.equal(userAgents?.classification, "active");
  assert.equal(userInstall?.classification, "active");
  assert.equal(d.hasSkew, false);
});

test("buildDiagnosis: global + trusted project override (same version) marks the user install inactive-overridden with no skew", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-override-same-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  const overrideRoot = path.join(cwd, "packages", "pi-flow-core");
  await seedCore(overrideRoot, "1.0.0");
  await seedTrust(home, cwd);
  await seedSettings(cwd, ["packages/pi-flow-core"]);

  const d = await buildDiagnosis({
    activeRoot: userRoot,
    cwd,
    homeDir: home,
    scope: "project",
  });

  assert.equal(d.effectiveRoot, realpathSync(overrideRoot));
  assert.equal(d.effectiveScope, "project");
  const userInstall = d.surfaces.find((s) => s.kind === "user-install");
  assert.equal(userInstall?.classification, "inactive-overridden");
  assert.equal(d.hasSkew, false);
  assert.deepEqual(d.skewKinds, []);
});

test("buildDiagnosis: global + trusted project override (different version) still marks the user install inactive-overridden with no skew", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-override-diff-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  const overrideRoot = path.join(cwd, "packages", "pi-flow-core");
  await seedCore(overrideRoot, "2.0.0-dev");
  await seedTrust(home, cwd);
  await seedSettings(cwd, ["packages/pi-flow-core"]);

  const d = await buildDiagnosis({
    activeRoot: userRoot,
    cwd,
    homeDir: home,
    scope: "project",
  });

  assert.equal(d.effectiveScope, "project");
  const userInstall = d.surfaces.find((s) => s.kind === "user-install");
  assert.equal(userInstall?.classification, "inactive-overridden");
  assert.equal(d.hasSkew, false);
});

test("buildDiagnosis: a stale project .pi/npm install with no project entry is inactive-shadowed, not skew", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-shadowed-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  const projInstall = path.join(
    cwd,
    ".pi",
    "npm",
    "node_modules",
    "@aphotic",
    "pi-flow-core",
  );
  await seedCore(projInstall, "0.5.0");

  const d = await buildDiagnosis({
    activeRoot: userRoot,
    cwd,
    homeDir: home,
    scope: "user",
  });

  assert.equal(d.effectiveRoot, userRoot);
  assert.equal(d.effectiveScope, "user");
  const projectInstall = d.surfaces.find((s) => s.kind === "project-install");
  assert.equal(projectInstall?.classification, "inactive-shadowed");
  assert.equal(d.hasSkew, false);
  assert.deepEqual(d.skewKinds, []);
});

test("buildDiagnosis: a helper shim to a root that is neither effective nor a recognized inactive install is genuine stale-skew", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-genuine-skew-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  // A stale core that is NOT at any recognized install candidate location.
  const staleRoot = path.join(sandbox, "stale");
  await seedCore(staleRoot, "0.5.0");
  await makeShim(home, path.join(staleRoot, "bin", "pi-flow.mjs"));

  const d = await buildDiagnosis({
    activeRoot: userRoot,
    cwd,
    homeDir: home,
    scope: "user",
  });

  const shim = d.surfaces.find((s) => s.kind === "helper-shim");
  assert.equal(shim?.classification, "stale-skew");
  assert.equal(d.hasSkew, true);
  assert.ok(d.skewKinds.includes("helper-shim"));
});

test("buildDiagnosis: --strict flags a clean-by-default local-dev surface as divergent", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-strict-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  const checkoutRoot = path.join(cwd, "packages", "pi-flow-core");
  await seedCore(checkoutRoot, "2.0.0-dev");
  await makeShim(home, path.join(checkoutRoot, "bin", "pi-flow.mjs"));

  // Default mode: the in-tree checkout is local-dev — clean, no skew, no strict divergence.
  const def = await buildDiagnosis({
    activeRoot: userRoot,
    cwd,
    homeDir: home,
    scope: "user",
  });
  const defShim = def.surfaces.find((s) => s.kind === "helper-shim");
  assert.equal(defShim?.classification, "local-dev");
  assert.equal(def.hasSkew, false);
  assert.deepEqual(def.strictDivergence, []);

  // Strict mode: the effective resolution surface diverges from the effective root.
  const strict = await buildDiagnosis({
    activeRoot: userRoot,
    cwd,
    homeDir: home,
    scope: "user",
    strict: true,
  });
  assert.ok(strict.strictDivergence.includes("helper-shim"));
  // hasSkew is unaffected by strict.
  assert.equal(strict.hasSkew, false);
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

// --- npm declared packages resolution ----------------------------------------

async function seedProjectNpmDirectInstall(cwd: string, version: string): Promise<string> {
  const root = path.join(cwd, ".pi", "npm", "node_modules", "@aphotic", "pi-flow-core");
  await seedCore(root, version);
  return realpathSync(root);
}

async function seedProjectNpmAggInstall(cwd: string): Promise<string> {
  const aggRoot = path.join(cwd, ".pi", "npm", "node_modules", "@aphotic", "pi-flow");
  const coreRoot = path.join(aggRoot, "node_modules", "@aphotic", "pi-flow-core");
  await seedAggregate(aggRoot, coreRoot);
  return realpathSync(coreRoot);
}

async function seedUserAggInstall(home: string): Promise<string> {
  const aggRoot = path.join(home, ".pi", "agent", "npm", "node_modules", "@aphotic", "pi-flow");
  const coreRoot = path.join(aggRoot, "node_modules", "@aphotic", "pi-flow-core");
  await seedAggregate(aggRoot, coreRoot);
  return realpathSync(coreRoot);
}

test("buildDiagnosis: declared npm string spec (npm:@aphotic/pi-flow-core) with installed core is not unresolved", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-npm-str-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  await seedProjectNpmDirectInstall(cwd, "1.0.0");
  await seedSettings(cwd, ["npm:@aphotic/pi-flow-core"]);

  const d = await buildDiagnosis({ activeRoot: userRoot, cwd, homeDir: home, scope: "user" });
  const decl = d.surfaces.filter((s) => s.kind === "declared-package");
  assert.equal(decl.length, 1);
  assert.notEqual(decl[0].classification, "unresolved", "npm string spec with install should not be unresolved");
  assert.ok(decl[0].realpath, "npm string spec should resolve to a realpath");
});

test("buildDiagnosis: declared npm object spec ({ source: 'npm:@aphotic/pi-flow' }) with installed core is not unresolved", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-npm-obj-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  await seedProjectNpmDirectInstall(cwd, "1.0.0");
  await seedSettings(cwd, [{ source: "npm:@aphotic/pi-flow-core", extensions: [], skills: [] }]);

  const d = await buildDiagnosis({ activeRoot: userRoot, cwd, homeDir: home, scope: "user" });
  const decl = d.surfaces.filter((s) => s.kind === "declared-package");
  assert.equal(decl.length, 1);
  assert.notEqual(decl[0].classification, "unresolved", "npm object spec with install should not be unresolved");
  assert.ok(decl[0].realpath);
});

test("buildDiagnosis: declared pinned npm spec (npm:@aphotic/pi-flow@0.8.0) with installed core resolves and detail includes version", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-npm-pin-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  await seedProjectNpmDirectInstall(cwd, "0.8.0");
  await seedSettings(cwd, ["npm:@aphotic/pi-flow-core@0.8.0"]);

  const d = await buildDiagnosis({ activeRoot: userRoot, cwd, homeDir: home, scope: "user" });
  const decl = d.surfaces.filter((s) => s.kind === "declared-package");
  assert.equal(decl.length, 1);
  assert.notEqual(decl[0].classification, "unresolved", "pinned npm spec with install should not be unresolved");
  assert.ok(decl[0].realpath);
  assert.ok(decl[0].detail?.includes("pinned"), "detail should mention pinned");
  assert.ok(decl[0].detail?.includes("0.8.0"), "detail should include resolved version");
});

test("buildDiagnosis: declared npm:@aphotic/pi-flow (aggregate) resolves to bundled core, not unresolved", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-npm-agg-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  const userRoot = await seedUserInstall(home, "1.0.0");
  await seedProjectNpmAggInstall(cwd);
  await seedSettings(cwd, ["npm:@aphotic/pi-flow"]);

  const d = await buildDiagnosis({ activeRoot: userRoot, cwd, homeDir: home, scope: "user" });
  const decl = d.surfaces.filter((s) => s.kind === "declared-package");
  assert.equal(decl.length, 1);
  assert.notEqual(decl[0].classification, "unresolved", "aggregate npm spec with install should not be unresolved");
  assert.ok(decl[0].realpath, "aggregate npm spec should resolve to the bundled core root");
});

test("buildDiagnosis: project direct npm:@aphotic/pi-flow-core overrides user aggregate @aphotic/pi-flow (interop)", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-interop-d-a-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  // User has an aggregate install; project has a direct core install.
  await seedUserAggInstall(home);
  const projCoreRoot = await seedProjectNpmDirectInstall(cwd, "1.0.0");
  await seedTrust(home, cwd);
  await seedSettings(cwd, ["npm:@aphotic/pi-flow-core"]);

  const d = await buildDiagnosis({ activeRoot: projCoreRoot, cwd, homeDir: home, scope: "project" });
  assert.equal(d.effectiveScope, "project", "project direct should override user aggregate");
  assert.equal(d.effectiveRoot, projCoreRoot);
  const decl = d.surfaces.filter((s) => s.kind === "declared-package");
  assert.equal(decl.length, 1);
  assert.notEqual(decl[0].classification, "unresolved");
  assert.equal(d.hasSkew, false);
});

test("buildDiagnosis: project aggregate npm:@aphotic/pi-flow overrides user direct @aphotic/pi-flow-core (interop)", async () => {
  const sandbox = mkSandbox("pi-flow-doctor-interop-a-d-");
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "proj");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(cwd, { recursive: true });

  // User has a direct core install; project has an aggregate install.
  await seedUserInstall(home, "1.0.0");
  const projBundledCore = await seedProjectNpmAggInstall(cwd);
  await seedTrust(home, cwd);
  await seedSettings(cwd, ["npm:@aphotic/pi-flow"]);

  const d = await buildDiagnosis({ activeRoot: projBundledCore, cwd, homeDir: home, scope: "project" });
  assert.equal(d.effectiveScope, "project", "project aggregate should override user direct");
  assert.equal(d.effectiveRoot, projBundledCore);
  const decl = d.surfaces.filter((s) => s.kind === "declared-package");
  assert.equal(decl.length, 1);
  assert.notEqual(decl[0].classification, "unresolved");
  assert.equal(d.hasSkew, false);
});
