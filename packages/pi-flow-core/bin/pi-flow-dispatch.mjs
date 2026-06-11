#!/usr/bin/env node
/**
 * pi-flow-dispatch.mjs — the stable per-cwd helper launcher.
 *
 * /flow:setup installs this as a real file copy at ~/.pi/agent/bin/pi-flow so
 * it survives core version changes. At each invocation it resolves the
 * *effective* pi-flow-core for the current cwd and delegates to that core's
 * bin/pi-flow.mjs with the original argv.
 *
 * It carries no semantic resolution knowledge of its own. The only inline
 * concession is the bootstrap candidate list below: a fixed set of known
 * user-install locations probed to locate an importable effective-package.mjs,
 * which then owns trust, project-overrides-user, identity, and npm-spec logic.
 *
 * This file MUST run under bare `node` (no strip-types) with builtin-only
 * imports, and MUST never crash on a missing/malformed install, settings, or
 * trust file — it degrades to the bootstrap user core, else prints actionable
 * guidance.
 *
 * Local/git override limitation: a project that declares a local/path pi-flow
 * override is honored only on a best-effort basis — resolved when its declared
 * root resolves to a usable core, otherwise the dispatcher falls back to the
 * user target. (The shared module trust-gates and resolution-gates this.)
 */

import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Fixed, ordered bootstrap candidate locations (relative to a homeDir) for the
 * shared effective-package.mjs: the direct-core user install first, then the
 * aggregate-nested core. This is the launcher's only inline knowledge.
 */
function bootstrapCandidates(homeDir) {
  const agentNpm = path.join(
    homeDir,
    ".pi",
    "agent",
    "npm",
    "node_modules",
    "@aphotic",
  );
  return [
    path.join(agentNpm, "pi-flow-core", "extensions", "lib", "effective-package.mjs"),
    path.join(
      agentNpm,
      "pi-flow",
      "node_modules",
      "@aphotic",
      "pi-flow-core",
      "extensions",
      "lib",
      "effective-package.mjs",
    ),
  ];
}

/** core root for a candidate effective-package.mjs (`.../<core>/extensions/lib/x.mjs`). */
function coreRootFromCandidate(candidate) {
  return path.resolve(path.dirname(candidate), "..", "..");
}

/**
 * Probe the bootstrap candidates: import the first that loads as a module, and
 * note the first whose core ships a bin/pi-flow.mjs (the bootstrap fallback
 * target). Never throws — a malformed/absent candidate is simply skipped.
 */
async function bootstrap(homeDir) {
  let module = null;
  let bootstrapBin = null;
  for (const candidate of bootstrapCandidates(homeDir)) {
    // Probe the bootstrap bin independently of the shared module: an older user
    // core may ship bin/pi-flow.mjs without effective-package.mjs, and must
    // still serve as the fallback target.
    if (bootstrapBin === null) {
      const coreBin = path.join(coreRootFromCandidate(candidate), "bin", "pi-flow.mjs");
      if (existsSync(coreBin)) bootstrapBin = coreBin;
    }
    if (module === null && existsSync(candidate)) {
      try {
        module = await import(pathToFileURL(candidate).href);
      } catch {
        module = null;
      }
    }
  }
  return { module, bootstrapBin };
}

/**
 * Resolve the bin/pi-flow.mjs the dispatcher should delegate to for
 * (cwd, homeDir). Returns { targetBin, scope }: targetBin is null only when no
 * usable user install exists. The shared module trust-gates project overrides
 * and falls back to the user/global core; if it can't be imported or returns
 * null, we degrade to the bootstrap user core. Never throws.
 */
export async function resolveDispatchTarget({ cwd, homeDir }) {
  const { module, bootstrapBin } = await bootstrap(homeDir);

  if (module && typeof module.resolveEffectiveCoreRoot === "function") {
    try {
      const eff = await module.resolveEffectiveCoreRoot({ cwd, homeDir });
      if (eff && eff.root) {
        return {
          targetBin: path.join(eff.root, "bin", "pi-flow.mjs"),
          scope: eff.scope ?? "user",
        };
      }
    } catch {
      // Degrade to the bootstrap user core below.
    }
  }

  if (bootstrapBin) {
    return { targetBin: bootstrapBin, scope: "user" };
  }

  return { targetBin: null, scope: null };
}

async function main() {
  const homeDir = os.homedir();
  const cwd = process.cwd();

  const { targetBin } = await resolveDispatchTarget({ cwd, homeDir });
  if (!targetBin) {
    process.stderr.write(
      "pi-flow: no usable pi-flow-core install found.\n" +
        "Run `/flow:setup --target user` to install the user/global pi-flow.\n",
    );
    process.exit(1);
  }

  const child = spawnSync("node", [targetBin, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  process.exit(child.status ?? 1);
}

// Run as a CLI only when invoked directly; importing for tests does not spawn.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
