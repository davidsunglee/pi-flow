/**
 * /flow:doctor — inventory the managed pi-flow surfaces (helper shim, agent
 * symlinks, npm installs, declared packages, node bins), classify each against
 * the active (executing) pi-flow-core package, and render a diagnosis report
 * that flags version skew between resolution paths and the active skills.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { SetupConflict, SetupScope } from "./setup.ts";
import {
  type PiFlowCorePackage,
  realpathOrNull,
  packageRootFromBin,
  readPiFlowCorePackage,
  findEnclosingCoreRoot,
} from "./package-resolution.ts";

export type SurfaceKind =
  | "helper-shim"
  | "user-agents"
  | "project-agents"
  | "project-install"
  | "user-install"
  | "node-bin"
  | "declared-package";

export type Classification =
  | "active" // realpath === active package root
  | "local-dev" // a source checkout within the active working tree (intentional)
  | "stale-skew" // a different package that is neither active nor a recognized checkout
  | "absent" // the surface path does not exist (informational)
  | "unresolved" // the surface exists but its pi-flow target could not be resolved
  | "non-pi-flow"; // resolves to something that is not a pi-flow-core package

export interface SurfaceReport {
  kind: SurfaceKind;
  label: string; // human label, e.g. "helper shim (~/.pi/agent/bin/pi-flow)"
  inspectedPath: string; // the path doctor looked at, pre-realpath
  realpath?: string; // resolved realpath of the surface's pi-flow target root
  pkg?: PiFlowCorePackage; // resolved package (name@version) at realpath
  classification: Classification;
  detail?: string; // e.g. declared spec string + "pinned"/"floating", or notes
}

export interface BinResolution {
  /** the pi-flow-core package that actually executes when the bin runs, or null */
  core: PiFlowCorePackage | null;
  /** set when resolution passed through the aggregate @aphotic/pi-flow wrapper */
  viaAggregate?: { name: string; version: string; root: string };
}

/**
 * Resolve a bin/pi-flow(.mjs) path to the pi-flow-core package that actually
 * executes, mirroring runtime delegation. First compute PACKAGE_ROOT via
 * packageRootFromBin (runner parity) and try readPiFlowCorePackage on it (a
 * direct core runner). If that root is instead the aggregate `@aphotic/pi-flow`
 * wrapper, reproduce its `createRequire(...).resolve(
 * "@aphotic/pi-flow-core/bin/pi-flow.mjs")` delegation and resolve the bundled/
 * dependency core. Returns { core } with viaAggregate set when the path went
 * through the wrapper; core is null only when the bin is genuinely not pi-flow.
 */
export async function resolveBinToCore(binPath: string): Promise<BinResolution> {
  const root = await packageRootFromBin(binPath);
  if (!root) return { core: null };

  const direct = await readPiFlowCorePackage(root);
  if (direct) return { core: direct };

  // The bin's PACKAGE_ROOT may be the aggregate `@aphotic/pi-flow` wrapper.
  let pkg: Record<string, unknown>;
  try {
    const content = await fs.readFile(path.join(root, "package.json"), "utf8");
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { core: null };
  }

  if (!pkg || typeof pkg !== "object" || pkg.name !== "@aphotic/pi-flow") {
    return { core: null };
  }

  const viaAggregate = {
    name: pkg.name as string,
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

export interface DeclaredPackage {
  /** raw spec: "npm:@aphotic/pi-flow@0.8.0", "npm:@aphotic/pi-flow", or a local path */
  spec: string;
  /** "npm" | "local" — classified from the spec form */
  kind: "npm" | "local";
  /** true when an npm spec carries an explicit @<version> pin */
  pinned: boolean;
}

export interface DoctorDiagnosis {
  active: PiFlowCorePackage; // the executing ("intended") package
  scope: SetupScope;
  surfaces: SurfaceReport[];
  hasSkew: boolean; // overall failure verdict
  skewKinds: SurfaceKind[]; // resolution-path surfaces classified stale-skew
}

export interface BuildDiagnosisOptions {
  activeRoot: string; // realpath(import.meta.dirname/..) from the handler
  cwd: string;
  homeDir: string;
  scope: SetupScope;
  /** injectable for tests; defaults read the real filesystem */
}

/**
 * Parse the `packages` array of a parsed `.pi/settings.json` object into
 * DeclaredPackage rows. String entries are local path specs; object entries
 * with a string `source` are npm or local depending on the `npm:` prefix.
 * Malformed entries are ignored; returns [] when `packages` is missing.
 */
export function parseDeclaredPackages(settingsJson: unknown): DeclaredPackage[] {
  if (!settingsJson || typeof settingsJson !== "object") return [];
  const packages = (settingsJson as Record<string, unknown>).packages;
  if (!Array.isArray(packages)) return [];

  const out: DeclaredPackage[] = [];
  for (const entry of packages) {
    if (typeof entry === "string") {
      out.push({ spec: entry, kind: "local", pinned: false });
      continue;
    }
    if (entry && typeof entry === "object") {
      const source = (entry as Record<string, unknown>).source;
      if (typeof source !== "string") continue;
      const kind: "npm" | "local" = source.startsWith("npm:") ? "npm" : "local";
      const pinned =
        kind === "npm" && /@[^/@]+$/.test(source.slice("npm:".length));
      out.push({ spec: source, kind, pinned });
    }
  }
  return out;
}

/**
 * True iff `realpath` is inside `cwd` (the active working tree) and is a source
 * tree rather than an install — i.e. it contains neither a node_modules segment
 * nor a `.pi/npm` segment.
 */
export function isLocalDevCheckout(realpath: string, cwd: string): boolean {
  const inTree = realpath === cwd || realpath.startsWith(cwd + path.sep);
  if (!inTree) return false;
  const nodeModulesSeg = `${path.sep}node_modules${path.sep}`;
  const piNpmSeg = `${path.sep}.pi${path.sep}npm${path.sep}`;
  return !realpath.includes(nodeModulesSeg) && !realpath.includes(piNpmSeg);
}

/** Classify a surface against the active package root. */
export function classifySurface(opts: {
  activeRoot: string;
  cwd: string;
  realpath: string | null;
  exists: boolean;
}): Classification {
  const { activeRoot, cwd, realpath, exists } = opts;
  if (!exists) return "absent";
  if (realpath == null) return "unresolved";
  if (realpath === activeRoot) return "active";
  if (isLocalDevCheckout(realpath, cwd)) return "local-dev";
  return "stale-skew";
}

/** Resolve a bin surface (helper shim or node bin) into a SurfaceReport. */
async function binSurfaceReport(opts: {
  kind: SurfaceKind;
  label: string;
  inspectedPath: string;
  resolvePath: string;
  exists: boolean;
  activeRoot: string;
  cwd: string;
}): Promise<SurfaceReport> {
  const { kind, label, inspectedPath, resolvePath, exists, activeRoot, cwd } =
    opts;
  if (!exists) {
    return { kind, label, inspectedPath, classification: "absent" };
  }

  const { core, viaAggregate } = await resolveBinToCore(resolvePath);
  const detail = viaAggregate
    ? `via @aphotic/pi-flow@${viaAggregate.version} wrapper`
    : undefined;

  if (core) {
    const classification = classifySurface({
      activeRoot,
      cwd,
      realpath: core.root,
      exists: true,
    });
    return {
      kind,
      label,
      inspectedPath,
      realpath: core.root,
      pkg: core,
      classification,
      detail,
    };
  }

  if (viaAggregate) {
    // Went through the aggregate wrapper but its core could not be resolved.
    return { kind, label, inspectedPath, classification: "unresolved", detail };
  }

  return { kind, label, inspectedPath, classification: "non-pi-flow" };
}

/** Resolve an agents symlink directory into a single SurfaceReport. */
async function agentsSurfaceReport(opts: {
  kind: SurfaceKind;
  label: string;
  dir: string;
  activeRoot: string;
  cwd: string;
}): Promise<SurfaceReport> {
  const { kind, label, dir, activeRoot, cwd } = opts;
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { kind, label, inspectedPath: dir, classification: "absent" };
  }

  const roots = new Map<string, PiFlowCorePackage>();
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const linkPath = path.join(dir, name);
    let st: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      st = await fs.lstat(linkPath);
    } catch {
      continue;
    }
    if (!st.isSymbolicLink()) continue;
    const rp = await realpathOrNull(linkPath);
    if (!rp) continue;
    const core = await findEnclosingCoreRoot(rp);
    if (core) roots.set(core.root, core);
  }

  if (roots.size === 0) {
    return { kind, label, inspectedPath: dir, classification: "unresolved" };
  }

  const rank: Record<Classification, number> = {
    "stale-skew": 4,
    "local-dev": 3,
    active: 2,
    "non-pi-flow": 1,
    unresolved: 0,
    absent: 0,
  };
  let worst: { core: PiFlowCorePackage; classification: Classification } | null =
    null;
  for (const core of roots.values()) {
    const classification = classifySurface({
      activeRoot,
      cwd,
      realpath: core.root,
      exists: true,
    });
    if (!worst || rank[classification] > rank[worst.classification]) {
      worst = { core, classification };
    }
  }

  const detail =
    roots.size > 1
      ? `${roots.size} distinct roots — divergent agent symlinks`
      : undefined;

  return {
    kind,
    label,
    inspectedPath: dir,
    realpath: worst!.core.root,
    pkg: worst!.core,
    classification: worst!.classification,
    detail,
  };
}

/** Resolve npm install candidate paths into SurfaceReports (existing only). */
async function installSurfaceReports(opts: {
  kind: SurfaceKind;
  candidates: { path: string; label: string }[];
  activeRoot: string;
  cwd: string;
}): Promise<SurfaceReport[]> {
  const { kind, candidates, activeRoot, cwd } = opts;
  const out: SurfaceReport[] = [];
  for (const c of candidates) {
    const rp = await realpathOrNull(c.path);
    if (!rp) continue; // absent — informational, no row
    const core = await readPiFlowCorePackage(c.path);
    const classification = core
      ? classifySurface({ activeRoot, cwd, realpath: core.root, exists: true })
      : "unresolved";
    out.push({
      kind,
      label: c.label,
      inspectedPath: c.path,
      realpath: core?.root,
      pkg: core ?? undefined,
      classification,
    });
  }
  return out;
}

/** Resolve declared packages from .pi/settings.json into SurfaceReports. */
async function declaredSurfaceReports(opts: {
  settingsPath: string;
  activeRoot: string;
  cwd: string;
}): Promise<SurfaceReport[]> {
  const { settingsPath, activeRoot, cwd } = opts;
  let parsed: unknown;
  try {
    const content = await fs.readFile(settingsPath, "utf8");
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const settingsDir = path.dirname(settingsPath);
  const out: SurfaceReport[] = [];
  for (const declared of parseDeclaredPackages(parsed)) {
    const detail = `${declared.spec} (${declared.pinned ? "pinned" : "floating"}, ${declared.kind})`;
    let realpath: string | undefined;
    let classification: Classification = "unresolved";
    if (declared.kind === "local") {
      const resolved = await realpathOrNull(
        path.resolve(settingsDir, declared.spec),
      );
      if (resolved) {
        realpath = resolved;
        classification = classifySurface({
          activeRoot,
          cwd,
          realpath: resolved,
          exists: true,
        });
      }
    }
    out.push({
      kind: "declared-package",
      label: `declared package (${declared.kind})`,
      inspectedPath: settingsPath,
      realpath,
      classification,
      detail,
    });
  }
  return out;
}

/**
 * Assemble the full set of SurfaceReports for the managed pi-flow surfaces and
 * compute the skew verdict against the active package.
 */
export async function buildDiagnosis(
  opts: BuildDiagnosisOptions,
): Promise<DoctorDiagnosis> {
  const { activeRoot, cwd, homeDir, scope } = opts;

  const active =
    (await readPiFlowCorePackage(activeRoot)) ??
    ({
      root: activeRoot,
      name: "@aphotic/pi-flow-core",
      version: "unknown",
    } satisfies PiFlowCorePackage);

  const surfaces: SurfaceReport[] = [];

  // helper-shim
  const shimPath = path.join(homeDir, ".pi", "agent", "bin", "pi-flow");
  {
    let st: Awaited<ReturnType<typeof fs.lstat>> | undefined;
    try {
      st = await fs.lstat(shimPath);
    } catch {
      st = undefined;
    }
    if (!st) {
      surfaces.push({
        kind: "helper-shim",
        label: "helper shim (~/.pi/agent/bin/pi-flow)",
        inspectedPath: shimPath,
        classification: "absent",
      });
    } else {
      let resolvePath = shimPath;
      if (st.isSymbolicLink()) {
        const link = await fs.readlink(shimPath);
        resolvePath = path.resolve(path.dirname(shimPath), link);
      }
      surfaces.push(
        await binSurfaceReport({
          kind: "helper-shim",
          label: "helper shim (~/.pi/agent/bin/pi-flow)",
          inspectedPath: shimPath,
          resolvePath,
          exists: true,
          activeRoot,
          cwd,
        }),
      );
    }
  }

  // user-agents
  surfaces.push(
    await agentsSurfaceReport({
      kind: "user-agents",
      label: "user agents (~/.pi/agent/agents)",
      dir: path.join(homeDir, ".pi", "agent", "agents"),
      activeRoot,
      cwd,
    }),
  );

  // project-agents
  surfaces.push(
    await agentsSurfaceReport({
      kind: "project-agents",
      label: "project agents (<cwd>/.pi/agents)",
      dir: path.join(cwd, ".pi", "agents"),
      activeRoot,
      cwd,
    }),
  );

  // project-install
  surfaces.push(
    ...(await installSurfaceReports({
      kind: "project-install",
      candidates: [
        {
          path: path.join(
            cwd,
            ".pi",
            "npm",
            "node_modules",
            "@aphotic",
            "pi-flow-core",
          ),
          label: "project install (<cwd>/.pi/npm/.../pi-flow-core)",
        },
        {
          path: path.join(
            cwd,
            ".pi",
            "npm",
            "node_modules",
            "@aphotic",
            "pi-flow",
            "node_modules",
            "@aphotic",
            "pi-flow-core",
          ),
          label: "project install meta (<cwd>/.pi/npm/.../pi-flow/.../pi-flow-core)",
        },
      ],
      activeRoot,
      cwd,
    })),
  );

  // user-install
  surfaces.push(
    ...(await installSurfaceReports({
      kind: "user-install",
      candidates: [
        {
          path: path.join(
            homeDir,
            ".pi",
            "agent",
            "npm",
            "node_modules",
            "@aphotic",
            "pi-flow-core",
          ),
          label: "user install (~/.pi/agent/npm/.../pi-flow-core)",
        },
        {
          path: path.join(
            homeDir,
            ".pi",
            "agent",
            "npm",
            "node_modules",
            "@aphotic",
            "pi-flow",
            "node_modules",
            "@aphotic",
            "pi-flow-core",
          ),
          label: "user install meta (~/.pi/agent/npm/.../pi-flow/.../pi-flow-core)",
        },
      ],
      activeRoot,
      cwd,
    })),
  );

  // node-bin
  const nodeBinCandidates: { path: string; label: string }[] = [
    {
      path: path.join(cwd, "node_modules", ".bin", "pi-flow"),
      label: "node bin (<cwd>/node_modules/.bin/pi-flow)",
    },
    {
      path: path.join(cwd, ".pi", "npm", "node_modules", ".bin", "pi-flow"),
      label: "node bin (<cwd>/.pi/npm/node_modules/.bin/pi-flow)",
    },
    {
      path: path.join(
        homeDir,
        ".pi",
        "agent",
        "npm",
        "node_modules",
        ".bin",
        "pi-flow",
      ),
      label: "node bin (~/.pi/agent/npm/node_modules/.bin/pi-flow)",
    },
  ];
  for (const c of nodeBinCandidates) {
    let exists = true;
    try {
      await fs.lstat(c.path);
    } catch {
      exists = false;
    }
    if (!exists) continue; // absent — informational, no row
    surfaces.push(
      await binSurfaceReport({
        kind: "node-bin",
        label: c.label,
        inspectedPath: c.path,
        resolvePath: c.path,
        exists: true,
        activeRoot,
        cwd,
      }),
    );
  }

  // declared-package
  surfaces.push(
    ...(await declaredSurfaceReports({
      settingsPath: path.join(cwd, ".pi", "settings.json"),
      activeRoot,
      cwd,
    })),
  );

  const resolutionKinds: SurfaceKind[] = [
    "helper-shim",
    "user-agents",
    "project-agents",
    "node-bin",
  ];
  const skewKinds = surfaces
    .filter(
      (s) =>
        resolutionKinds.includes(s.kind) && s.classification === "stale-skew",
    )
    .map((s) => s.kind);
  const hasSkew = skewKinds.length > 0;

  return { active, scope, surfaces, hasSkew, skewKinds };
}

export interface ReconcileTargetResult {
  kind: "ok" | "ambiguous";
  target?: PiFlowCorePackage; // when kind === "ok"
  candidates?: PiFlowCorePackage[]; // distinct roots when kind === "ambiguous"
}

/**
 * Reconcile target = the single distinct pi-flow-core root among the active
 * package plus every declared/loaded resolvable root. Exactly one distinct root
 * (by .root) => ok (target = active). More than one => ambiguous (caller must
 * require --source). Dedupe by root.
 */
export function resolveReconcileTarget(args: {
  active: PiFlowCorePackage;
  declaredOrLoaded: PiFlowCorePackage[];
}): ReconcileTargetResult {
  const { active, declaredOrLoaded } = args;
  const distinct: PiFlowCorePackage[] = [];
  const seen = new Set<string>();
  for (const pkg of [active, ...declaredOrLoaded]) {
    if (seen.has(pkg.root)) continue;
    seen.add(pkg.root);
    distinct.push(pkg);
  }
  if (distinct.length <= 1) return { kind: "ok", target: active };
  return { kind: "ambiguous", candidates: distinct };
}

export interface TargetValidation {
  ok: boolean;
  target?: PiFlowCorePackage;
  error?: string; // actionable, when ok === false
}

/**
 * Validate an explicit --source <raw> target. Accepts: an absolute or
 * cwd-relative path that is a pi-flow-core root; OR a directory that contains a
 * single resolvable core at "packages/pi-flow-core" or
 * "node_modules/@aphotic/pi-flow-core" (descend). Emits actionable errors.
 */
export async function validateExplicitTarget(
  raw: string,
  cwd: string,
): Promise<TargetValidation> {
  const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
  const rp = await realpathOrNull(abs);
  if (rp == null) {
    return { ok: false, error: `target path does not exist: ${raw}` };
  }

  const direct = await readPiFlowCorePackage(rp);
  if (direct) return { ok: true, target: direct };

  const descents: PiFlowCorePackage[] = [];
  for (const candidate of [
    path.join(rp, "packages", "pi-flow-core"),
    path.join(rp, "node_modules", "@aphotic", "pi-flow-core"),
  ]) {
    const core = await readPiFlowCorePackage(candidate);
    if (core) descents.push(core);
  }

  if (descents.length === 1) return { ok: true, target: descents[0] };
  if (descents.length === 0) {
    return {
      ok: false,
      error: `not a usable @aphotic/pi-flow-core package: ${raw} (expected a directory with bin/pi-flow.mjs and package.json name @aphotic/pi-flow-core)`,
    };
  }
  return {
    ok: false,
    error: `multiple pi-flow-core packages under ${raw}; name one directly`,
  };
}

export type RepairOutcome =
  | "created" // link was absent; created
  | "skipped" // already points at the desired target
  | "repaired" // was a stale-skew symlink; repointed to the target
  | "preserved-other" // points at a local-dev override; refused to clobber
  | "conflict"; // real file/dir, or a divergent symlink we will not touch

export interface RepairResult {
  path: string;
  outcome: RepairOutcome;
  to: string; // desired absolute target
  from?: string; // previous realpath, for repaired/preserved-other
  conflict?: SetupConflict;
}

/** Repoint a single managed symlink, honoring setup's never-overwrite posture. */
export async function repairLink(args: {
  linkPath: string;
  desiredTarget: string; // absolute path the symlink must point at
  activeRoot: string;
  cwd: string;
}): Promise<RepairResult> {
  const { linkPath, desiredTarget, cwd } = args;
  const dir = path.dirname(linkPath);

  let st: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    st = await fs.lstat(linkPath);
  } catch (err: any) {
    if (err && err.code === "ENOENT") {
      await fs.mkdir(dir, { recursive: true });
      await fs.symlink(desiredTarget, linkPath);
      return { path: linkPath, outcome: "created", to: desiredTarget };
    }
    throw err;
  }

  if (st.isSymbolicLink()) {
    const link = await fs.readlink(linkPath);
    const resolvedActual = path.resolve(dir, link);
    if (resolvedActual === desiredTarget) {
      return { path: linkPath, outcome: "skipped", to: desiredTarget };
    }
    const enclosing = await findEnclosingCoreRoot(resolvedActual);
    if (enclosing && isLocalDevCheckout(enclosing.root, cwd)) {
      return {
        path: linkPath,
        outcome: "preserved-other",
        to: desiredTarget,
        from: resolvedActual,
        conflict: {
          path: linkPath,
          reason: "local-dev override — refusing to clobber",
          expected: desiredTarget,
          actual: resolvedActual,
        },
      };
    }
    await fs.unlink(linkPath);
    await fs.symlink(desiredTarget, linkPath);
    return {
      path: linkPath,
      outcome: "repaired",
      to: desiredTarget,
      from: resolvedActual,
    };
  }

  return {
    path: linkPath,
    outcome: "conflict",
    to: desiredTarget,
    conflict: {
      path: linkPath,
      reason: st.isDirectory()
        ? "directory at target — refusing to overwrite"
        : "real file at target — refusing to overwrite",
    },
  };
}

const TAGS: Record<Classification, string> = {
  active: "[active]",
  "local-dev": "[local-dev]",
  "stale-skew": "[SKEW]",
  absent: "[absent]",
  unresolved: "[unresolved]",
  "non-pi-flow": "[non-pi-flow]",
};

/** Render a DoctorDiagnosis into a human-readable report string. */
export function renderReport(d: DoctorDiagnosis): string {
  const lines: string[] = [];
  lines.push(
    `Active pi-flow package: ${d.active.name}@${d.active.version} (${d.active.root})`,
  );
  for (const s of d.surfaces) {
    const tag = TAGS[s.classification];
    lines.push(`  ${tag} ${s.label}`);
    const pkgPart = s.pkg ? ` [${s.pkg.name}@${s.pkg.version}]` : "";
    const detailPart = s.detail ? ` — ${s.detail}` : "";
    lines.push(`    -> ${s.realpath ?? "(unresolved)"}${pkgPart}${detailPart}`);
  }
  lines.push(
    d.hasSkew
      ? "SKEW DETECTED — helper/template/skill resolution can use a different pi-flow version than the active skills."
      : "OK — all managed pi-flow surfaces resolve to the active package.",
  );
  return lines.join("\n");
}
