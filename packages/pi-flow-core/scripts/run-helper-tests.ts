#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const suites = [
  "skills/_shared/scripts/tests",
  "skills/define-spec/scripts/tests",
  "skills/execute-plan/scripts/tests",
  "skills/fastlane/scripts/tests",
  "skills/refine-code/scripts/tests",
  "skills/refine-plan/scripts/tests",
];

function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function assertInsideSkills(candidate: string): void {
  const skillsRoot = path.resolve(packageRoot, "skills");
  const resolved = path.resolve(candidate);
  const relative = path.relative(skillsRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`refusing to clean outside skills/: ${resolved}`);
  }
}

function removePycacheDirs(root: string): void {
  if (!fs.existsSync(root)) return;
  assertInsideSkills(root);

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === "__pycache__") {
      assertInsideSkills(fullPath);
      fs.rmSync(fullPath, { recursive: true, force: true });
      continue;
    }
    removePycacheDirs(fullPath);
  }
}

const forwardedArgs = process.argv.slice(2);
if (forwardedArgs.length > 0) {
  fail(
    "test:helpers does not accept file arguments. Use `node --test <path>` for targeted Node tests, or run this script with no arguments for all Python helper tests.",
    2,
  );
}

for (const suite of suites) {
  const result = spawnSync(
    "python3",
    ["-m", "unittest", "discover", "-s", suite, "-p", "test_*.py"],
    {
      cwd: packageRoot,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      stdio: "inherit",
    },
  );

  if (result.error) {
    fail(`failed to run Python helper tests for ${suite}: ${result.error.message}`);
  }
  if (result.signal) {
    fail(`Python helper tests for ${suite} terminated by signal ${result.signal}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

removePycacheDirs(path.join(packageRoot, "skills"));
