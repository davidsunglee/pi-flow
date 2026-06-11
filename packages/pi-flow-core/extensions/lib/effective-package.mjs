/**
 * effective-package.mjs — the single source of truth for pi-flow-core
 * resolution, shared by the TypeScript doctor extension (imported under
 * --experimental-strip-types) and the bare-node dispatcher launcher.
 *
 * This module MUST run under plain `node` with no strip-types and no
 * third-party dependencies: imports are limited to node builtins. It owns the
 * resolution primitives, npm-spec parsing, aggregate<->core identity
 * normalization, the trust check, effective-package resolution for a given
 * (cwd, homeDir), and path abbreviation for the report.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

// --- resolution primitives --------------------------------------------------

/** realpath(p), or null if it does not resolve (ENOENT/ENOTDIR/etc.). */
export async function realpathOrNull(p) {
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
export async function packageRootFromBin(binPath) {
  const rp = await realpathOrNull(binPath);
  if (!rp) return null;
  return path.resolve(path.dirname(rp), "..");
}

/**
 * Read and validate a pi-flow-core package at `root`. Returns the parsed
 * {root, name, version} only when root/package.json exists, parses, AND
 * name === "@aphotic/pi-flow-core" AND root/bin/pi-flow.mjs exists; otherwise
 * null. `root` in the returned object is the realpath of the input root.
 */
export async function readPiFlowCorePackage(root) {
  const realRoot = await realpathOrNull(root);
  if (!realRoot) return null;

  let pkg;
  try {
    const content = await fs.readFile(path.join(realRoot, "package.json"), "utf8");
    pkg = JSON.parse(content);
  } catch {
    return null;
  }

  if (!pkg || typeof pkg !== "object" || pkg.name !== "@aphotic/pi-flow-core") {
    return null;
  }

  if ((await realpathOrNull(path.join(realRoot, "bin", "pi-flow.mjs"))) === null) {
    return null;
  }

  return {
    root: realRoot,
    name: pkg.name,
    version: String(pkg.version),
  };
}

/**
 * Walk up from `start` (a realpath to any file/dir inside a package) to the
 * nearest enclosing directory that readPiFlowCorePackage accepts. Returns it or
 * null. Stops at the filesystem root.
 */
export async function findEnclosingCoreRoot(start) {
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

/**
 * Resolve a bin/pi-flow(.mjs) path to the pi-flow-core package that actually
 * executes, mirroring runtime delegation. First compute PACKAGE_ROOT via
 * packageRootFromBin (runner parity) and try readPiFlowCorePackage on it (a
 * direct core runner). If that root is instead the aggregate `@aphotic/pi-flow`
 * wrapper, reproduce its `createRequire(...).resolve(
 * "@aphotic/pi-flow-core/bin/pi-flow.mjs")` delegation and resolve the bundled/
 * dependency core. Returns { core, viaAggregate? }; core is null only when the
 * bin is genuinely not pi-flow.
 */
export async function resolveBinToCore(binPath) {
  const root = await packageRootFromBin(binPath);
  if (!root) return { core: null };

  const direct = await readPiFlowCorePackage(root);
  if (direct) return { core: direct };

  // The bin's PACKAGE_ROOT may be the aggregate `@aphotic/pi-flow` wrapper.
  let pkg;
  try {
    const content = await fs.readFile(path.join(root, "package.json"), "utf8");
    pkg = JSON.parse(content);
  } catch {
    return { core: null };
  }

  if (!pkg || typeof pkg !== "object" || pkg.name !== "@aphotic/pi-flow") {
    return { core: null };
  }

  const viaAggregate = {
    name: pkg.name,
    version: String(pkg.version),
    root,
  };
  try {
    const req = createRequire(path.join(root, "bin", "pi-flow.mjs"));
    const coreBin = req.resolve("@aphotic/pi-flow-core/bin/pi-flow.mjs");
    const coreRoot = await packageRootFromBin(coreBin);
    const core = coreRoot ? await readPiFlowCorePackage(coreRoot) : null;
    return { core, viaAggregate };
  } catch {
    return { core: null, viaAggregate };
  }
}

// --- npm-spec parsing -------------------------------------------------------

/**
 * Normalize the input to the package-entry array. Accepts BOTH a parsed
 * settings object (reads its `.packages` array; a missing/non-array `.packages`
 * is empty) AND a raw package-entry array directly, so both contract shapes
 * yield identical rows.
 */
function toEntries(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === "object") {
    const packages = input.packages;
    return Array.isArray(packages) ? packages : [];
  }
  return [];
}

/**
 * Classify a single spec string into a DeclaredPackage row. A spec beginning
 * `npm:` is `kind:"npm"` (detecting a trailing `@<version>` pin and extracting
 * the package name); anything else is a local path spec.
 */
function classifySpec(spec) {
  if (spec.startsWith("npm:")) {
    const remainder = spec.slice("npm:".length);
    const pinned = /@[^/@]+$/.test(remainder);
    const name = pinned ? remainder.replace(/@[^/@]+$/, "") : remainder;
    return { spec, kind: "npm", pinned, name };
  }
  return { spec, kind: "local", pinned: false };
}

/**
 * Parse declared packages into rows { spec, kind: "npm"|"local", pinned,
 * name? }. Accepts both a settings object and a raw entry array (see
 * toEntries). String entries beginning `npm:` are npm specs (not local);
 * object entries are classified from their string `source`. Malformed entries
 * are ignored.
 */
export function parseDeclaredPackages(input) {
  const out = [];
  for (const entry of toEntries(input)) {
    if (typeof entry === "string") {
      out.push(classifySpec(entry));
      continue;
    }
    if (entry && typeof entry === "object") {
      const source = entry.source;
      if (typeof source !== "string") continue;
      out.push(classifySpec(source));
    }
  }
  return out;
}

// --- identity normalization -------------------------------------------------

/**
 * Map both the aggregate `@aphotic/pi-flow` and the direct
 * `@aphotic/pi-flow-core` to a single logical pi-flow identity ("pi-flow").
 * Returns null for any other name.
 */
export function normalizePiFlowIdentity(name) {
  if (name === "@aphotic/pi-flow" || name === "@aphotic/pi-flow-core") {
    return "pi-flow";
  }
  return null;
}

/**
 * Resolve a candidate root directory to the pi-flow-core package that actually
 * executes there: a direct core, else the aggregate wrapper's delegated core.
 * Returns { core, viaAggregate? }.
 */
async function resolveCandidateToCore(candidateRoot) {
  const direct = await readPiFlowCorePackage(candidateRoot);
  if (direct) return { core: direct };
  return resolveBinToCore(path.join(candidateRoot, "bin", "pi-flow.mjs"));
}

/**
 * Compute the candidate install/checkout root for a declared package row. A
 * local spec resolves relative to baseDir; an npm spec resolves to the
 * project-scoped install under <baseDir>/.pi/npm/node_modules/<name>.
 */
function specToCandidateRoot({ spec, kind, name }, baseDir) {
  if (kind === "local") {
    return path.resolve(baseDir, spec);
  }
  const pkgName = name ?? spec.slice("npm:".length);
  return path.join(baseDir, ".pi", "npm", "node_modules", ...pkgName.split("/"));
}

/**
 * Resolve a declared/installed pi-flow identity to a concrete
 * @aphotic/pi-flow-core root: directly for a core install, or via the
 * aggregate wrapper's @aphotic/pi-flow-core dependency for an aggregate
 * install. Returns the PiFlowCorePackage, or null when not resolvable.
 */
export async function resolveSpecToCoreRoot({ spec, kind, name, baseDir }) {
  const candidate = specToCandidateRoot({ spec, kind, name }, baseDir);
  const { core } = await resolveCandidateToCore(candidate);
  return core ?? null;
}

// --- trust check ------------------------------------------------------------

/**
 * True iff `cwd` is trusted per <homeDir>/.pi/agent/trust.json — a
 * { "<path-prefix>": true } map. A cwd is trusted when some key with value
 * true equals cwd or is a path ancestor of cwd. A missing file, parse error,
 * or non-object map is untrusted. Never throws.
 */
export async function isTrusted({ cwd, homeDir }) {
  const trustPath = path.join(homeDir, ".pi", "agent", "trust.json");
  let map;
  try {
    map = JSON.parse(await fs.readFile(trustPath, "utf8"));
  } catch {
    return false;
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) return false;
  for (const [key, value] of Object.entries(map)) {
    if (value !== true) continue;
    if (key === cwd || cwd.startsWith(key + path.sep)) return true;
  }
  return false;
}

// --- effective-package resolution -------------------------------------------

/** Read and JSON-parse a settings file, returning the parsed value or null. */
async function readSettings(settingsPath) {
  try {
    return JSON.parse(await fs.readFile(settingsPath, "utf8"));
  } catch {
    return null;
  }
}

/** Whether a declared row could name a pi-flow identity worth resolving. */
function isPiFlowCandidate(row) {
  if (row.kind === "local") return true; // identity confirmed by resolution
  return normalizePiFlowIdentity(row.name) !== null;
}

/**
 * Resolve the effective pi-flow-core root for (cwd, homeDir), applying Pi's
 * project-overrides-user rule. A trusted project that declares a resolvable
 * pi-flow `packages` entry overrides the user install (scope "project");
 * otherwise the user/global install is effective (scope "user"). Returns
 * { root, binPath, scope, viaAggregate? } or null when neither resolves.
 * Tolerates missing/malformed settings or trust on either side.
 */
export async function resolveEffectiveCoreRoot({ cwd, homeDir }) {
  // 1. Trusted project override.
  if (await isTrusted({ cwd, homeDir })) {
    const declared = parseDeclaredPackages(
      await readSettings(path.join(cwd, ".pi", "settings.json")),
    );
    for (const row of declared) {
      if (!isPiFlowCandidate(row)) continue;
      const candidate = specToCandidateRoot(row, cwd);
      const { core, viaAggregate } = await resolveCandidateToCore(candidate);
      if (core) {
        return {
          root: core.root,
          binPath: path.join(core.root, "bin", "pi-flow.mjs"),
          scope: "project",
          ...(viaAggregate ? { viaAggregate } : {}),
        };
      }
    }
  }

  // 2. User/global fallback — fixed user-install locations.
  const agentNpm = path.join(
    homeDir,
    ".pi",
    "agent",
    "npm",
    "node_modules",
    "@aphotic",
  );
  const userCandidates = [
    path.join(agentNpm, "pi-flow-core"),
    path.join(agentNpm, "pi-flow"),
  ];
  for (const candidate of userCandidates) {
    const { core, viaAggregate } = await resolveCandidateToCore(candidate);
    if (core) {
      return {
        root: core.root,
        binPath: path.join(core.root, "bin", "pi-flow.mjs"),
        scope: "user",
        ...(viaAggregate ? { viaAggregate } : {}),
      };
    }
  }

  return null;
}

// --- path abbreviation ------------------------------------------------------

/**
 * Abbreviate a filesystem path for the report: replace a leading homeDir with
 * `~`, and collapse predictable install boilerplate
 * (`.../node_modules/@aphotic/<pkg>`, including aggregate-nested chains) to
 * `.../…/<pkg>` while keeping the trailing package segment legible. Pure string
 * transform; idempotent on already-abbreviated input.
 */
export function abbreviatePath(p, homeDir) {
  let out = p;
  if (homeDir) {
    if (out === homeDir) {
      out = "~";
    } else if (out.startsWith(homeDir + path.sep)) {
      out = "~" + out.slice(homeDir.length);
    }
  }
  out = out.replace(/(?:\/node_modules\/@aphotic\/[^/]+)+/g, (match) => {
    const last = match.split("/").pop();
    return "/…/" + last;
  });
  return out;
}
