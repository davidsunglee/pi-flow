/**
 * /flow:setup — symlink bundled pi-flow agent definitions into the
 * @aphotic/pi-mux-subagents discovery directory matching the install scope,
 * and (for user-scope setup) create the ~/.pi/agent/bin/pi-flow helper-runner
 * shim so `pi-flow` resolves on PATH inside Pi tool/subagent contexts.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";

export type SetupScope = "user" | "project" | "temporary";
export type DurableTarget = "user" | "project";

export interface SetupNotifier {
  notify(message: string, level: "info" | "warning" | "error"): void;
}

export interface SetupConflict {
  path: string;
  reason: string;
  expected?: string;
  actual?: string;
}

export interface SetupResult {
  created: string[];
  skipped: string[];
  conflicts: SetupConflict[];
}

export interface RunSetupOptions {
  agentsDir: string;
  targetDir: string;
  scope: SetupScope;
  explicitTarget?: DurableTarget;
  ui: SetupNotifier;
}

export interface ResolveScopeOptions {
  ownPackageRoot: string;
  commands: SlashCommandInfo[];
  homeDir: string;
  cwd: string;
}

export interface ResolveScopeResult {
  scope: SetupScope;
  matchedBaseDir?: string;
}

const TEMPORARY_REFUSAL_MESSAGE =
  "/flow:setup detected a temporary package load (pi -e). Re-run with --target user or --target project to perform a durable setup.";

export async function resolveScope(
  opts: ResolveScopeOptions,
): Promise<ResolveScopeResult> {
  const { ownPackageRoot, commands, homeDir, cwd } = opts;

  const matches: Array<{ scope: SetupScope; baseDir: string }> = [];
  for (const entry of commands) {
    if (entry.name !== "flow:setup") continue;
    const baseDir = entry.sourceInfo?.baseDir;
    if (!baseDir) continue;
    let resolved: string;
    try {
      resolved = await fs.realpath(baseDir);
    } catch {
      // ENOENT / ENOTDIR: stale registry entry — skip silently.
      continue;
    }
    if (resolved === ownPackageRoot) {
      matches.push({ scope: entry.sourceInfo.scope, baseDir: resolved });
    }
  }

  if (matches.length === 1) {
    return { scope: matches[0].scope, matchedBaseDir: matches[0].baseDir };
  }

  // Heuristic fallback against the realpath-normalized own root.
  const userPrefix = path.join(homeDir, ".pi");
  if (
    ownPackageRoot === userPrefix ||
    ownPackageRoot.startsWith(userPrefix + path.sep)
  ) {
    return { scope: "user" };
  }

  const projectSegment = path.join("node_modules", "pi-flow-core");
  if (ownPackageRoot.includes(projectSegment)) {
    try {
      const stat = await fs.stat(path.join(cwd, "node_modules"));
      if (stat.isDirectory()) {
        return { scope: "project" };
      }
    } catch {
      // fall through to temporary
    }
  }

  return { scope: "temporary" };
}

export async function runSetup(opts: RunSetupOptions): Promise<SetupResult> {
  const { agentsDir, targetDir, scope, explicitTarget, ui } = opts;

  if (scope === "temporary" && explicitTarget === undefined) {
    ui.notify(TEMPORARY_REFUSAL_MESSAGE, "error");
    return { created: [], skipped: [], conflicts: [] };
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const conflicts: SetupConflict[] = [];

  const entries = await fs.readdir(agentsDir);
  const agentFiles = entries.filter((name) => name.endsWith(".md"));
  await fs.mkdir(targetDir, { recursive: true });

  for (const name of agentFiles) {
    const src = path.join(agentsDir, name);
    const dst = path.join(targetDir, name);

    let stat: Awaited<ReturnType<typeof fs.lstat>> | undefined;
    try {
      stat = await fs.lstat(dst);
    } catch (err: any) {
      if (err && err.code === "ENOENT") {
        await fs.symlink(src, dst);
        created.push(dst);
        continue;
      }
      throw err;
    }

    if (stat.isSymbolicLink()) {
      const linkTarget = await fs.readlink(dst);
      const resolvedActual = path.resolve(targetDir, linkTarget);
      if (resolvedActual === src) {
        skipped.push(dst);
      } else {
        conflicts.push({
          path: dst,
          reason: "divergent symlink",
          expected: src,
          actual: resolvedActual,
        });
      }
    } else if (stat.isDirectory()) {
      conflicts.push({
        path: dst,
        reason: "directory at target — refusing to overwrite",
      });
    } else {
      conflicts.push({
        path: dst,
        reason: "real file at target — refusing to overwrite",
      });
    }
  }

  const header =
    explicitTarget !== undefined
      ? `/flow:setup (${scope} → ${explicitTarget}):`
      : `/flow:setup (${scope}):`;
  const lines: string[] = [header];
  for (const p of created) {
    lines.push(`  created: ${path.relative(targetDir, p) || p}`);
  }
  for (const p of skipped) {
    lines.push(`  skipped: ${path.relative(targetDir, p) || p}`);
  }
  for (const c of conflicts) {
    lines.push(
      `  conflict: ${path.relative(targetDir, c.path) || c.path} — ${c.reason}`,
    );
  }
  if (created.length > 0) {
    lines.push(
      "Reload Pi or run /reload to make newly linked agents discoverable.",
    );
  }

  const level: "info" | "warning" | "error" =
    conflicts.length > 0 ? "error" : "info";
  ui.notify(lines.join("\n"), level);

  return { created, skipped, conflicts };
}

export type HelperShimStatus =
  | "created"
  | "skipped"
  | "conflict"
  | "absent-project"
  | "preserved-other";

export interface HelperShimResult {
  status: HelperShimStatus;
  shimPath: string;
  conflict?: SetupConflict;
}

export interface RunHelperShimOptions {
  shimPath: string;
  shimTarget: string;
  effectiveTarget: DurableTarget;
  ui: SetupNotifier;
}

export async function runHelperShimSetup(
  opts: RunHelperShimOptions,
): Promise<HelperShimResult> {
  const { shimPath, shimTarget, effectiveTarget, ui } = opts;

  let stat: Awaited<ReturnType<typeof fs.lstat>> | undefined;
  try {
    stat = await fs.lstat(shimPath);
  } catch (err: any) {
    if (!err || err.code !== "ENOENT") throw err;
  }

  if (stat === undefined) {
    if (effectiveTarget === "project") {
      ui.notify(
        `/flow:setup helper-runner shim (project): no shim at ${shimPath}. Run /flow:setup --target user to install the global helper-runner shim.`,
        "info",
      );
      return { status: "absent-project", shimPath };
    }
    await fs.mkdir(path.dirname(shimPath), { recursive: true });
    await fs.symlink(shimTarget, shimPath);
    ui.notify(
      `/flow:setup helper-runner shim (user):\n  created: ${shimPath} -> ${shimTarget}\nReload Pi or run /reload to make pi-flow available on PATH.`,
      "info",
    );
    return { status: "created", shimPath };
  }

  if (stat.isSymbolicLink()) {
    const linkTarget = await fs.readlink(shimPath);
    const resolvedActual = path.resolve(path.dirname(shimPath), linkTarget);
    if (resolvedActual === shimTarget) {
      ui.notify(
        `/flow:setup helper-runner shim (${effectiveTarget}):\n  skipped: ${shimPath} (already points to this package)`,
        "info",
      );
      return { status: "skipped", shimPath };
    }
    const conflict: SetupConflict = {
      path: shimPath,
      reason: "divergent symlink",
      expected: shimTarget,
      actual: resolvedActual,
    };
    if (effectiveTarget === "project") {
      ui.notify(
        `/flow:setup helper-runner shim (project):\n  preserved: ${shimPath} (points to ${resolvedActual}; this package's bin is ${shimTarget}). Run /flow:setup --target user to install this package's shim, or remove the existing one first.`,
        "info",
      );
      return { status: "preserved-other", shimPath, conflict };
    }
    ui.notify(
      `/flow:setup helper-runner shim (user):\n  conflict: ${shimPath} — divergent symlink (expected ${shimTarget}, actual ${resolvedActual})`,
      "error",
    );
    return { status: "conflict", shimPath, conflict };
  }

  const reason = stat.isDirectory()
    ? "directory at target — refusing to overwrite"
    : "real file at target — refusing to overwrite";
  const conflict: SetupConflict = { path: shimPath, reason };

  if (effectiveTarget === "project") {
    ui.notify(
      `/flow:setup helper-runner shim (project):\n  preserved: ${shimPath} (${reason}). Run /flow:setup --target user to install this package's shim, or remove the existing entry first.`,
      "info",
    );
    return { status: "preserved-other", shimPath, conflict };
  }
  ui.notify(
    `/flow:setup helper-runner shim (user):\n  conflict: ${shimPath} — ${reason}`,
    "error",
  );
  return { status: "conflict", shimPath, conflict };
}

function parseExplicitTarget(args: string): DurableTarget | undefined {
  const tokens = args.split(/\s+/).filter((t) => t.length > 0);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === "--target") {
      const v = tokens[i + 1];
      if (v === "user" || v === "project") return v;
    }
  }
  return undefined;
}

export function registerSetup(pi: ExtensionAPI): void {
  pi.registerCommand("flow:setup", {
    description:
      "Symlink bundled pi-flow agent definitions into the matching @aphotic/pi-mux-subagents discovery directory.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      try {
        const ownPackageRoot = await fs.realpath(
          path.resolve(import.meta.dirname, ".."),
        );
        const { scope } = await resolveScope({
          ownPackageRoot,
          commands: pi.getCommands(),
          homeDir: os.homedir(),
          cwd: ctx.cwd,
        });

        const explicitTarget = parseExplicitTarget(args);
        const effectiveTarget: DurableTarget =
          explicitTarget ?? (scope === "temporary" ? "user" : scope);

        const agentsDir = path.resolve(
          import.meta.dirname,
          "..",
          "agents",
        );
        const targetDir =
          effectiveTarget === "user"
            ? path.join(os.homedir(), ".pi", "agent", "agents")
            : path.join(ctx.cwd, ".pi", "agents");

        const notifier: SetupNotifier = {
          notify: (message, level) => ctx.ui.notify(message, level),
        };

        await runSetup({
          agentsDir,
          targetDir,
          scope,
          explicitTarget,
          ui: notifier,
        });

        if (scope !== "temporary" || explicitTarget !== undefined) {
          const shimPath = path.join(
            os.homedir(),
            ".pi",
            "agent",
            "bin",
            "pi-flow",
          );
          const shimTarget = path.join(ownPackageRoot, "bin", "pi-flow.mjs");
          await runHelperShimSetup({
            shimPath,
            shimTarget,
            effectiveTarget,
            ui: notifier,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`/flow:setup failed: ${message}`, "error");
      }
    },
  });
}
