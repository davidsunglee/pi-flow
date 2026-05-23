import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveScope, runHelperShimSetup, runSetup } from "./setup.ts";

type NotifyLevel = "info" | "warning" | "error";
type NotifyCall = { message: string; level: NotifyLevel };

function makeNotifier() {
  const calls: NotifyCall[] = [];
  return {
    calls,
    notify(message: string, level: NotifyLevel) {
      calls.push({ message, level });
    },
  };
}

function mkSandbox(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function seedAgents(dir: string, names: string[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const name of names) {
    await fs.writeFile(path.join(dir, name), `# ${name}\n`);
  }
}

test("runSetup: creates symlinks for each bundled agent file (happy path)", async () => {
  const sandbox = mkSandbox("pi-flow-setup-happy-");
  const agentsDir = path.join(sandbox, "pkg", "agents");
  const targetDir = path.join(sandbox, "target");
  await seedAgents(agentsDir, ["a.md", "b.md", "c.md"]);
  await fs.mkdir(targetDir, { recursive: true });

  const ui = makeNotifier();
  const result = await runSetup({ agentsDir, targetDir, scope: "user", ui });

  assert.equal(result.created.length, 3);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.conflicts.length, 0);

  const aStat = await fs.lstat(path.join(targetDir, "a.md"));
  assert.equal(aStat.isSymbolicLink(), true);
  const linkTarget = await fs.readlink(path.join(targetDir, "a.md"));
  const resolved = path.resolve(targetDir, linkTarget);
  assert.equal(resolved, path.join(agentsDir, "a.md"));

  // Reload recommendation present since created > 0.
  assert.equal(
    ui.calls.some((c) => c.message.includes("Reload Pi")),
    true,
  );
});

test("runSetup: re-run is idempotent — matching symlinks reported as skipped", async () => {
  const sandbox = mkSandbox("pi-flow-setup-idem-");
  const agentsDir = path.join(sandbox, "pkg", "agents");
  const targetDir = path.join(sandbox, "target");
  await seedAgents(agentsDir, ["a.md", "b.md", "c.md"]);
  await fs.mkdir(targetDir, { recursive: true });

  await runSetup({ agentsDir, targetDir, scope: "user", ui: makeNotifier() });

  const ui = makeNotifier();
  const result = await runSetup({ agentsDir, targetDir, scope: "user", ui });

  assert.equal(result.skipped.length, 3);
  assert.equal(result.created.length, 0);
  assert.equal(result.conflicts.length, 0);

  // Reload line should be absent when no symlinks were newly created.
  assert.equal(
    ui.calls.some((c) => c.message.includes("Reload Pi")),
    false,
  );
});

test("runSetup: refuses to overwrite a real file at the target", async () => {
  const sandbox = mkSandbox("pi-flow-setup-realfile-");
  const agentsDir = path.join(sandbox, "pkg", "agents");
  const targetDir = path.join(sandbox, "target");
  await seedAgents(agentsDir, ["a.md", "b.md", "c.md"]);
  await fs.mkdir(targetDir, { recursive: true });
  const aPath = path.join(targetDir, "a.md");
  await fs.writeFile(aPath, "existing");

  const ui = makeNotifier();
  const result = await runSetup({ agentsDir, targetDir, scope: "user", ui });

  const aConflict = result.conflicts.find((c) => c.path === aPath);
  assert.ok(aConflict, "expected a conflict entry for a.md");
  assert.equal(
    aConflict!.reason,
    "real file at target — refusing to overwrite",
  );
  const content = await fs.readFile(aPath, "utf8");
  assert.equal(content, "existing");
});

test("runSetup: reports divergent symlink as a conflict with expected/actual", async () => {
  const sandbox = mkSandbox("pi-flow-setup-divergent-");
  const agentsDir = path.join(sandbox, "pkg", "agents");
  const targetDir = path.join(sandbox, "target");
  const unrelatedDir = path.join(sandbox, "other");
  await seedAgents(agentsDir, ["a.md", "b.md", "c.md"]);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.mkdir(unrelatedDir, { recursive: true });
  const unrelated = path.join(unrelatedDir, "a.md");
  await fs.writeFile(unrelated, "unrelated");
  const aTarget = path.join(targetDir, "a.md");
  await fs.symlink(unrelated, aTarget);

  const ui = makeNotifier();
  const result = await runSetup({ agentsDir, targetDir, scope: "user", ui });

  const aConflict = result.conflicts.find((c) => c.path === aTarget);
  assert.ok(aConflict, "expected divergent-symlink conflict for a.md");
  assert.equal(aConflict!.reason, "divergent symlink");
  assert.equal(aConflict!.expected, path.join(agentsDir, "a.md"));
  assert.equal(aConflict!.actual, unrelated);
});

test("runSetup: refuses durable setup for temporary scope without --target", async () => {
  const sandbox = mkSandbox("pi-flow-setup-temp-");
  const agentsDir = path.join(sandbox, "pkg", "agents");
  const targetDir = path.join(sandbox, "target");
  await seedAgents(agentsDir, ["a.md", "b.md", "c.md"]);
  await fs.mkdir(targetDir, { recursive: true });

  const ui = makeNotifier();
  const result = await runSetup({
    agentsDir,
    targetDir,
    scope: "temporary",
    ui,
  });

  assert.equal(result.created.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.conflicts.length, 0);

  const errorLine = ui.calls.find(
    (c) =>
      c.level === "error" &&
      c.message.includes("temporary") &&
      c.message.includes("--target"),
  );
  assert.ok(errorLine, "expected an error-level notify about temporary/--target");

  // Nothing should have been written.
  const entries = await fs.readdir(targetDir);
  assert.deepEqual(entries, []);
});

test("runSetup: temporary scope with --target proceeds with setup", async () => {
  const sandbox = mkSandbox("pi-flow-setup-temp-override-");
  const agentsDir = path.join(sandbox, "pkg", "agents");
  const targetDir = path.join(sandbox, "target");
  await seedAgents(agentsDir, ["a.md"]);
  await fs.mkdir(targetDir, { recursive: true });

  const ui = makeNotifier();
  const result = await runSetup({
    agentsDir,
    targetDir,
    scope: "temporary",
    explicitTarget: "user",
    ui,
  });

  assert.ok(result.created.length > 0);
});

test("resolveScope: matches via realpath-normalized sourceInfo.baseDir", async () => {
  const sandbox = mkSandbox("pi-flow-setup-resolve-match-");
  const pkg = path.join(sandbox, "pkg");
  await fs.mkdir(pkg, { recursive: true });

  const result = await resolveScope({
    ownPackageRoot: pkg,
    commands: [
      {
        name: "flow:setup",
        source: "extension",
        sourceInfo: {
          scope: "project",
          baseDir: pkg,
          path: "x",
          source: "x",
          origin: "package",
        },
      } as any,
    ],
    homeDir: path.join(sandbox, "home"),
    cwd: path.join(sandbox, "cwd"),
  });

  assert.equal(result.scope, "project");
  assert.equal(result.matchedBaseDir, pkg);
});

test("resolveScope: heuristic fallback identifies user-scoped install under ~/.pi", async () => {
  const sandbox = mkSandbox("pi-flow-setup-resolve-user-");
  const homeDir = path.join(sandbox, "home");
  const userPkg = path.join(
    homeDir,
    ".pi",
    "agent",
    "extensions",
    "pi-flow-core",
    "extensions",
  );
  await fs.mkdir(userPkg, { recursive: true });

  const result = await resolveScope({
    ownPackageRoot: userPkg,
    commands: [],
    homeDir,
    cwd: path.join(sandbox, "cwd"),
  });

  assert.equal(result.scope, "user");
});

test("resolveScope: heuristic fallback identifies project install via cwd node_modules", async () => {
  const sandbox = mkSandbox("pi-flow-setup-resolve-project-");
  const cwd = path.join(sandbox, "cwd");
  await fs.mkdir(path.join(cwd, "node_modules"), { recursive: true });
  const projectPkg = path.join(cwd, "node_modules", "pi-flow-core", "extensions");
  await fs.mkdir(projectPkg, { recursive: true });

  const result = await resolveScope({
    ownPackageRoot: projectPkg,
    commands: [],
    homeDir: path.join(sandbox, "home"),
    cwd,
  });

  assert.equal(result.scope, "project");
});

test("resolveScope: heuristic fallback returns temporary for standalone installs", async () => {
  const sandbox = mkSandbox("pi-flow-setup-resolve-temp-");
  const standalone = path.join(sandbox, "tmp", "standalone");
  await fs.mkdir(standalone, { recursive: true });

  const result = await resolveScope({
    ownPackageRoot: standalone,
    commands: [],
    homeDir: path.join(sandbox, "home"),
    cwd: path.join(sandbox, "cwd"),
  });

  assert.equal(result.scope, "temporary");
});

async function seedShimTarget(packageRoot: string): Promise<string> {
  const binDir = path.join(packageRoot, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const binPath = path.join(binDir, "pi-flow.mjs");
  await fs.writeFile(binPath, "#!/usr/bin/env node\n");
  return binPath;
}

test("runHelperShimSetup: user target — creates symlink when shim is missing", async () => {
  const sandbox = mkSandbox("pi-flow-shim-create-");
  const packageRoot = path.join(sandbox, "pkg");
  const shimTarget = await seedShimTarget(packageRoot);
  const shimDir = path.join(sandbox, "home", ".pi", "agent", "bin");
  const shimPath = path.join(shimDir, "pi-flow");

  const ui = makeNotifier();
  const result = await runHelperShimSetup({
    shimPath,
    shimTarget,
    effectiveTarget: "user",
    ui,
  });

  assert.equal(result.status, "created");
  assert.equal(result.shimPath, shimPath);

  const stat = await fs.lstat(shimPath);
  assert.equal(stat.isSymbolicLink(), true);
  const linkTarget = await fs.readlink(shimPath);
  const resolved = path.resolve(shimDir, linkTarget);
  assert.equal(resolved, shimTarget);

  assert.equal(
    ui.calls.some(
      (c) =>
        c.level === "info" &&
        c.message.includes("helper-runner shim") &&
        c.message.includes("created"),
    ),
    true,
    `expected info notify mentioning created helper-runner shim; got ${JSON.stringify(ui.calls)}`,
  );
});

test("runHelperShimSetup: user target — idempotent skip when shim already points to this package", async () => {
  const sandbox = mkSandbox("pi-flow-shim-skip-");
  const packageRoot = path.join(sandbox, "pkg");
  const shimTarget = await seedShimTarget(packageRoot);
  const shimDir = path.join(sandbox, "home", ".pi", "agent", "bin");
  await fs.mkdir(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, "pi-flow");
  await fs.symlink(shimTarget, shimPath);

  const ui = makeNotifier();
  const result = await runHelperShimSetup({
    shimPath,
    shimTarget,
    effectiveTarget: "user",
    ui,
  });

  assert.equal(result.status, "skipped");
  const linkTarget = await fs.readlink(shimPath);
  const resolved = path.resolve(shimDir, linkTarget);
  assert.equal(resolved, shimTarget);

  assert.equal(
    ui.calls.some(
      (c) =>
        c.message.includes("helper-runner shim") && c.message.includes("skipped"),
    ),
    true,
  );
});

test("runHelperShimSetup: user target — divergent symlink reported as conflict and not overwritten", async () => {
  const sandbox = mkSandbox("pi-flow-shim-divergent-");
  const packageRoot = path.join(sandbox, "pkg");
  const shimTarget = await seedShimTarget(packageRoot);
  const otherPkg = path.join(sandbox, "other", "bin");
  await fs.mkdir(otherPkg, { recursive: true });
  const otherTarget = path.join(otherPkg, "pi-flow.mjs");
  await fs.writeFile(otherTarget, "#!/usr/bin/env node\n");
  const shimDir = path.join(sandbox, "home", ".pi", "agent", "bin");
  await fs.mkdir(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, "pi-flow");
  await fs.symlink(otherTarget, shimPath);

  const ui = makeNotifier();
  const result = await runHelperShimSetup({
    shimPath,
    shimTarget,
    effectiveTarget: "user",
    ui,
  });

  assert.equal(result.status, "conflict");
  assert.ok(result.conflict, "expected conflict detail");
  assert.equal(result.conflict!.reason, "divergent symlink");
  assert.equal(result.conflict!.expected, shimTarget);
  assert.equal(result.conflict!.actual, otherTarget);

  const linkTarget = await fs.readlink(shimPath);
  const resolved = path.resolve(shimDir, linkTarget);
  assert.equal(resolved, otherTarget);

  assert.equal(
    ui.calls.some(
      (c) =>
        c.level === "error" &&
        c.message.includes("helper-runner shim") &&
        c.message.includes("conflict"),
    ),
    true,
  );
});

test("runHelperShimSetup: user target — real file at shim path reported as conflict and preserved", async () => {
  const sandbox = mkSandbox("pi-flow-shim-realfile-");
  const packageRoot = path.join(sandbox, "pkg");
  const shimTarget = await seedShimTarget(packageRoot);
  const shimDir = path.join(sandbox, "home", ".pi", "agent", "bin");
  await fs.mkdir(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, "pi-flow");
  await fs.writeFile(shimPath, "existing\n");

  const ui = makeNotifier();
  const result = await runHelperShimSetup({
    shimPath,
    shimTarget,
    effectiveTarget: "user",
    ui,
  });

  assert.equal(result.status, "conflict");
  assert.ok(result.conflict, "expected conflict detail");
  assert.equal(
    result.conflict!.reason,
    "real file at target — refusing to overwrite",
  );

  const content = await fs.readFile(shimPath, "utf8");
  assert.equal(content, "existing\n");
});

test("runHelperShimSetup: project target — missing shim emits guidance and does not create", async () => {
  const sandbox = mkSandbox("pi-flow-shim-project-missing-");
  const packageRoot = path.join(sandbox, "pkg");
  const shimTarget = await seedShimTarget(packageRoot);
  const shimDir = path.join(sandbox, "home", ".pi", "agent", "bin");
  const shimPath = path.join(shimDir, "pi-flow");

  const ui = makeNotifier();
  const result = await runHelperShimSetup({
    shimPath,
    shimTarget,
    effectiveTarget: "project",
    ui,
  });

  assert.equal(result.status, "absent-project");
  await assert.rejects(() => fs.lstat(shimPath));

  const guidanceCall = ui.calls.find(
    (c) =>
      c.message.includes("helper-runner shim") &&
      c.message.includes("/flow:setup --target user"),
  );
  assert.ok(guidanceCall, `expected guidance notify; got ${JSON.stringify(ui.calls)}`);
});

test("runHelperShimSetup: project target — existing matching shim reported as skipped", async () => {
  const sandbox = mkSandbox("pi-flow-shim-project-skip-");
  const packageRoot = path.join(sandbox, "pkg");
  const shimTarget = await seedShimTarget(packageRoot);
  const shimDir = path.join(sandbox, "home", ".pi", "agent", "bin");
  await fs.mkdir(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, "pi-flow");
  await fs.symlink(shimTarget, shimPath);

  const ui = makeNotifier();
  const result = await runHelperShimSetup({
    shimPath,
    shimTarget,
    effectiveTarget: "project",
    ui,
  });

  assert.equal(result.status, "skipped");
  const linkTarget = await fs.readlink(shimPath);
  const resolved = path.resolve(shimDir, linkTarget);
  assert.equal(resolved, shimTarget);
});

test("runHelperShimSetup: project target — existing divergent symlink preserved with guidance", async () => {
  const sandbox = mkSandbox("pi-flow-shim-project-preserve-");
  const packageRoot = path.join(sandbox, "pkg");
  const shimTarget = await seedShimTarget(packageRoot);
  const otherPkg = path.join(sandbox, "other", "bin");
  await fs.mkdir(otherPkg, { recursive: true });
  const otherTarget = path.join(otherPkg, "pi-flow.mjs");
  await fs.writeFile(otherTarget, "#!/usr/bin/env node\n");
  const shimDir = path.join(sandbox, "home", ".pi", "agent", "bin");
  await fs.mkdir(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, "pi-flow");
  await fs.symlink(otherTarget, shimPath);

  const ui = makeNotifier();
  const result = await runHelperShimSetup({
    shimPath,
    shimTarget,
    effectiveTarget: "project",
    ui,
  });

  assert.equal(result.status, "preserved-other");
  assert.equal(result.conflict?.expected, shimTarget);
  assert.equal(result.conflict?.actual, otherTarget);

  const linkTarget = await fs.readlink(shimPath);
  const resolved = path.resolve(shimDir, linkTarget);
  assert.equal(resolved, otherTarget);

  const guidanceCall = ui.calls.find(
    (c) =>
      c.message.includes("helper-runner shim") && c.message.includes("preserved"),
  );
  assert.ok(guidanceCall, `expected preserved-guidance notify; got ${JSON.stringify(ui.calls)}`);
});

test("resolveScope: matches a symlinked sourceInfo.baseDir via realpath normalization", async () => {
  const sandbox = mkSandbox("pi-flow-setup-resolve-symlink-");
  const realPkg = path.join(sandbox, "real-pkg");
  await fs.mkdir(realPkg, { recursive: true });
  const symlinkedPkg = path.join(sandbox, "symlinked-pkg");
  await fs.symlink(realPkg, symlinkedPkg);

  const ownPackageRoot = await fs.realpath(symlinkedPkg);
  assert.equal(ownPackageRoot, realPkg);

  const result = await resolveScope({
    ownPackageRoot,
    commands: [
      {
        name: "flow:setup",
        source: "extension",
        sourceInfo: {
          scope: "user",
          baseDir: symlinkedPkg,
          path: "x",
          source: "x",
          origin: "package",
        },
      } as any,
    ],
    homeDir: path.join(sandbox, "home"),
    cwd: path.join(sandbox, "cwd"),
  });

  assert.equal(result.scope, "user");
  assert.equal(result.matchedBaseDir, realPkg);
});

test("resolveScope: silently skips candidate baseDir entries that no longer exist", async () => {
  const sandbox = mkSandbox("pi-flow-setup-resolve-missing-");
  const standalone = path.join(sandbox, "standalone");
  await fs.mkdir(standalone, { recursive: true });

  const result = await resolveScope({
    ownPackageRoot: standalone,
    commands: [
      {
        name: "flow:setup",
        source: "extension",
        sourceInfo: {
          scope: "user",
          baseDir: path.join(sandbox, "missing-pkg"),
          path: "x",
          source: "x",
          origin: "package",
        },
      } as any,
    ],
    homeDir: path.join(sandbox, "home"),
    cwd: path.join(sandbox, "cwd"),
  });

  assert.equal(result.scope, "temporary");
});
