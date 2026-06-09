import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  realpathOrNull,
  packageRootFromBin,
  readPiFlowCorePackage,
  findEnclosingCoreRoot,
} from "./package-resolution.ts";

function mkSandbox(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function seedValidPackage(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "bin"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@aphotic/pi-flow-core", version: "9.9.9" }),
  );
  await fs.writeFile(path.join(root, "bin", "pi-flow.mjs"), "");
}

test("realpathOrNull: returns null for a non-existent path", async () => {
  const result = await realpathOrNull("/this/path/does/not/exist/ever");
  assert.equal(result, null);
});

test("packageRootFromBin: follows a symlinked bin to the real root's parent-of-bin", async () => {
  const sandbox = mkSandbox("pi-flow-pkgres-bin-");
  const realRoot = path.join(sandbox, "real-pkg");
  await seedValidPackage(realRoot);
  const realBin = path.join(realRoot, "bin", "pi-flow.mjs");

  const symlinkDir = path.join(sandbox, "links");
  await fs.mkdir(symlinkDir, { recursive: true });
  const symlinkedBin = path.join(symlinkDir, "pi-flow.mjs");
  await fs.symlink(realBin, symlinkedBin);

  const result = await packageRootFromBin(symlinkedBin);
  assert.equal(result, realRoot);
});

test("readPiFlowCorePackage: returns name and version for a valid root", async () => {
  const sandbox = mkSandbox("pi-flow-pkgres-valid-");
  const root = path.join(sandbox, "pkg");
  await seedValidPackage(root);

  const result = await readPiFlowCorePackage(root);
  assert.ok(result !== null);
  assert.equal(result.name, "@aphotic/pi-flow-core");
  assert.equal(result.version, "9.9.9");
  assert.equal(result.root, root);
});

test("readPiFlowCorePackage: returns null for wrong-name package.json", async () => {
  const sandbox = mkSandbox("pi-flow-pkgres-wrongname-");
  const root = path.join(sandbox, "pkg");
  await fs.mkdir(path.join(root, "bin"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@other/some-package", version: "1.0.0" }),
  );
  await fs.writeFile(path.join(root, "bin", "pi-flow.mjs"), "");

  const result = await readPiFlowCorePackage(root);
  assert.equal(result, null);
});

test("readPiFlowCorePackage: returns null for missing package.json", async () => {
  const sandbox = mkSandbox("pi-flow-pkgres-nopkg-");
  const root = path.join(sandbox, "pkg");
  await fs.mkdir(path.join(root, "bin"), { recursive: true });
  await fs.writeFile(path.join(root, "bin", "pi-flow.mjs"), "");

  const result = await readPiFlowCorePackage(root);
  assert.equal(result, null);
});

test("readPiFlowCorePackage: returns null for root missing bin/pi-flow.mjs", async () => {
  const sandbox = mkSandbox("pi-flow-pkgres-nobin-");
  const root = path.join(sandbox, "pkg");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@aphotic/pi-flow-core", version: "9.9.9" }),
  );

  const result = await readPiFlowCorePackage(root);
  assert.equal(result, null);
});

test("findEnclosingCoreRoot: finds the root from a nested agents/x.md path", async () => {
  const sandbox = mkSandbox("pi-flow-pkgres-find-");
  const root = path.join(sandbox, "pkg");
  await seedValidPackage(root);
  const agentsDir = path.join(root, "agents");
  await fs.mkdir(agentsDir, { recursive: true });
  const nestedFile = path.join(agentsDir, "x.md");
  await fs.writeFile(nestedFile, "# x\n");

  const result = await findEnclosingCoreRoot(nestedFile);
  assert.ok(result !== null);
  assert.equal(result.root, root);
  assert.equal(result.name, "@aphotic/pi-flow-core");
  assert.equal(result.version, "9.9.9");
});

test("findEnclosingCoreRoot: returns null when not inside any pi-flow-core package", async () => {
  const sandbox = mkSandbox("pi-flow-pkgres-findnull-");
  const outsideDir = path.join(sandbox, "outside");
  await fs.mkdir(outsideDir, { recursive: true });
  const outsideFile = path.join(outsideDir, "file.txt");
  await fs.writeFile(outsideFile, "hello\n");

  const result = await findEnclosingCoreRoot(outsideFile);
  assert.equal(result, null);
});
