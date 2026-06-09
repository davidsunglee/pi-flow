import fs from "node:fs/promises";
import path from "node:path";

export interface PiFlowCorePackage {
  /** realpath of the package root directory */
  root: string;
  /** package.json "name" (expected "@aphotic/pi-flow-core") */
  name: string;
  /** package.json "version" */
  version: string;
}

/** realpath(p), or null if it does not resolve (ENOENT/ENOTDIR/etc.). */
export async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

/**
 * Compute the pi-flow-core PACKAGE_ROOT from a path to a bin/pi-flow.mjs entry,
 * mirroring bin/pi-flow.mjs EXACTLY: realpath the bin file, then resolve the
 * parent of its containing bin/ directory. Returns the realpath of the root, or
 * null if the bin path does not resolve.
 */
export async function packageRootFromBin(binPath: string): Promise<string | null> {
  const rp = await realpathOrNull(binPath);
  if (!rp) return null;
  return path.resolve(path.dirname(rp), "..");
}

/**
 * Read and validate a pi-flow-core package at `root`. Returns the parsed
 * {root, name, version} only when root/package.json exists, parses, AND
 * name === "@aphotic/pi-flow-core" AND root/bin/pi-flow.mjs exists; otherwise null.
 * `root` in the returned object is the realpath of the input root.
 */
export async function readPiFlowCorePackage(root: string): Promise<PiFlowCorePackage | null> {
  const realRoot = await realpathOrNull(root);
  if (!realRoot) return null;

  let pkg: unknown;
  try {
    const content = await fs.readFile(path.join(realRoot, "package.json"), "utf8");
    pkg = JSON.parse(content);
  } catch {
    return null;
  }

  if (
    !pkg ||
    typeof pkg !== "object" ||
    (pkg as Record<string, unknown>).name !== "@aphotic/pi-flow-core"
  ) {
    return null;
  }

  if ((await realpathOrNull(path.join(realRoot, "bin", "pi-flow.mjs"))) === null) {
    return null;
  }

  return {
    root: realRoot,
    name: (pkg as Record<string, unknown>).name as string,
    version: String((pkg as Record<string, unknown>).version),
  };
}

/**
 * Walk up from `start` (a realpath to any file/dir inside a package) to the
 * nearest enclosing directory that readPiFlowCorePackage accepts. Returns it or
 * null. Stops at the filesystem root.
 */
export async function findEnclosingCoreRoot(start: string): Promise<PiFlowCorePackage | null> {
  let dir = await realpathOrNull(start);
  if (!dir) return null;

  while (true) {
    const pkg = await readPiFlowCorePackage(dir);
    if (pkg) return pkg;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
