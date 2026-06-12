/**
 * /flow:doctor — inventory the managed pi-flow surfaces (helper shim, agent
 * symlinks, npm installs, declared packages, node bins), classify each against
 * the active (executing) pi-flow-core package, and render a diagnosis report
 * that flags version skew between resolution paths and the active skills.
 */

import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  resolveScope,
  DISPATCHER_SIGNATURE,
  type DurableTarget,
  type SetupConflict,
  type SetupScope,
} from "./setup.ts";
import {
  type PiFlowCorePackage,
  realpathOrNull,
  readPiFlowCorePackage,
  findEnclosingCoreRoot,
} from "./package-resolution.ts";
import {
  resolveBinToCore as _resolveBinToCore,
  parseDeclaredPackages as _parseDeclaredPackages,
  resolveEffectiveCoreRoot,
  resolveUserCoreRoot,
  resolveSpecToCoreRoot as _resolveSpecToCoreRoot,
  abbreviatePath,
} from "./lib/effective-package.mjs";

export type SurfaceKind =
  | "helper-shim"
  | "user-agents"
  | "project-agents"
  | "project-install"
  | "user-install"
  | "node-bin"
  | "declared-package";

export type Classification =
  | "active" // realpath === effective pi-flow-core root
  | "local-dev" // a source checkout within the active working tree (intentional)
  | "stale-skew" // a resolution surface pointing at a root that is neither effective, a recognized inactive install, nor a checkout
  | "inactive-overridden" // a real pi-flow install whose scope a higher-priority effective scope overrides (neutral)
  | "inactive-shadowed" // a real pi-flow install in a non-effective scope, shadowed by the effective install (neutral)
  | "absent" // the surface path does not exist (informational)
  | "unresolved" // the surface exists but its pi-flow target could not be resolved
  | "non-pi-flow"; // resolves to something that is not a pi-flow-core package

/** The resolution-path surface kinds — the ones whose skew matters. */
export const RESOLUTION_KINDS: SurfaceKind[] = [
  "helper-shim",
  "user-agents",
  "project-agents",
  "node-bin",
];

export interface SurfaceReport {
  kind: SurfaceKind;
  label: string; // human label, e.g. "helper shim (~/.pi/agent/bin/pi-flow)"
  inspectedPath: string; // the path doctor looked at, pre-realpath
  realpath?: string; // resolved realpath of the surface's pi-flow target root
  pkg?: PiFlowCorePackage; // resolved package (name@version) at realpath
  classification: Classification;
  detail?: string; // e.g. declared spec string + "pinned"/"floating", or notes
  /**
   * The root this surface is intended to resolve to — its own scope's effective
   * root rather than the cwd effective root (e.g. user agents compare against
   * the user/global install even under a project override). Defaults to the cwd
   * effective root when unset. Used by --strict so a surface is only flagged
   * divergent against its intended comparison root.
   */
  compareRoot?: string;
}

export interface BinResolution {
  /** the pi-flow-core package that actually executes when the bin runs, or null */
  core: PiFlowCorePackage | null;
  /** set when resolution passed through the aggregate @aphotic/pi-flow wrapper */
  viaAggregate?: { name: string; version: string; root: string };
}

/**
 * Resolve a bin/pi-flow(.mjs) path to the pi-flow-core package that actually
 * executes, mirroring runtime delegation. Delegates to the shared
 * effective-package module. Returns { core } with viaAggregate set when the
 * path went through the aggregate wrapper; core is null only when the bin is
 * genuinely not pi-flow.
 */
export async function resolveBinToCore(binPath: string): Promise<BinResolution> {
  return _resolveBinToCore(binPath);
}

/** Absolute path to a package root's bundled stable dispatcher launcher. */
function dispatcherPathFor(root: string): string {
  return path.join(root, "bin", "pi-flow-dispatch.mjs");
}

/**
 * Stale-bytes axis: content-compare the installed dispatcher at `installedPath`
 * against the active package's bin/pi-flow-dispatch.mjs. Returns true only when
 * both files are readable and their bytes differ — i.e. the installed launcher
 * is out of date and needs a re-copy. A missing installed file (it isn't a
 * dispatcher) or a missing active dispatcher (nothing to compare against) is not
 * stale. This says nothing about which core the dispatcher resolves at runtime.
 */
export async function isDispatcherStale(args: {
  installedPath: string;
  activeRoot: string;
}): Promise<boolean> {
  const { installedPath, activeRoot } = args;
  let installed: Buffer;
  try {
    installed = await fs.readFile(installedPath);
  } catch {
    return false;
  }
  let active: Buffer;
  try {
    active = await fs.readFile(dispatcherPathFor(activeRoot));
  } catch {
    return false;
  }
  return !installed.equals(active);
}

/**
 * True iff the real file at `filePath` is our stable dispatcher launcher —
 * recognized by the dispatcher signature, or by byte-equality with the active
 * package's dispatcher. Anything else (a foreign script, a legacy core bin copy)
 * reads as not-ours and is preserved untouched.
 */
async function isDispatcherFile(
  filePath: string,
  activeRoot: string,
): Promise<boolean> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    return false;
  }
  if (buf.toString("utf8", 0, 512).includes(DISPATCHER_SIGNATURE)) return true;
  try {
    const active = await fs.readFile(dispatcherPathFor(activeRoot));
    return buf.equals(active);
  } catch {
    return false;
  }
}

export interface DeclaredPackage {
  /** raw spec: "npm:@aphotic/pi-flow@0.8.0", "npm:@aphotic/pi-flow", or a local path */
  spec: string;
  /** "npm" | "local" — classified from the spec form */
  kind: "npm" | "local";
  /** true when an npm spec carries an explicit @<version> pin */
  pinned: boolean;
  /** extracted package name for npm specs (undefined for local specs) */
  name?: string;
}

export type FlowConfigScope = "project" | "user" | "none";

export interface FlowConfigResolution {
  scope: FlowConfigScope;
  path: string | null; // absolute path to the selected config; null when none
  searched: string[]; // absolute paths consulted, in resolution order
}

async function isReadableFlowConfig(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    if (!st.isFile()) return false;
    await fs.access(p, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the active flow config for (cwd, homeDir), mirroring
 * skills/_shared/flow-config-resolution.md: project-local <cwd>/.pi/flow.json,
 * then user/global ~/.pi/agent/flow.json. Selection is on existence +
 * readability only (no JSON parse). Pure over injected paths; never spawns a
 * subprocess so doctor keeps working when the helper shim is broken.
 */
export async function resolveFlowConfig(opts: {
  cwd: string;
  homeDir: string;
}): Promise<FlowConfigResolution> {
  const searched: string[] = [];
  const project = path.join(opts.cwd, ".pi", "flow.json");
  searched.push(project);
  if (await isReadableFlowConfig(project)) {
    return { scope: "project", path: project, searched };
  }
  const user = path.join(opts.homeDir, ".pi", "agent", "flow.json");
  searched.push(user);
  if (await isReadableFlowConfig(user)) {
    return { scope: "user", path: user, searched };
  }
  return { scope: "none", path: null, searched };
}

export interface DoctorDiagnosis {
  active: PiFlowCorePackage; // the executing ("intended") package
  effective: PiFlowCorePackage; // the package at the effective root for this cwd (== active when they coincide)
  scope: SetupScope;
  homeDir: string; // the home directory used for this diagnosis (for path abbreviation)
  effectiveRoot: string; // the pi-flow-core root Pi resolves to for this cwd
  effectiveScope: "project" | "user"; // which scope supplied the effective root
  surfaces: SurfaceReport[];
  hasSkew: boolean; // overall failure verdict
  skewKinds: SurfaceKind[]; // resolution-path surfaces classified stale-skew
  strictDivergence: SurfaceKind[]; // under --strict, resolution surfaces not on the effective root (empty in default mode)
  absentCandidates: string[]; // install/bin candidate paths that were absent (for --all inventory)
  /**
   * Stale-bytes axis for an installed helper-shim dispatcher: true iff a real
   * dispatcher file is installed and its bytes differ from the active package's
   * bin/pi-flow-dispatch.mjs (so --fix should re-copy it). This is independent
   * of the runtime-target axis (the dispatcher surface's classification): a
   * dispatcher can be byte-aligned yet resolve a divergent effective target, and
   * vice versa.
   */
  staleDispatcher: boolean;
  /** Resolved flow config for this cwd (project-local then user/global). */
  flowConfig: FlowConfigResolution;
  /**
   * Flow-config advisory for the report: "missing" when no usable config exists
   * anywhere; "project-package-user-config" when a project-scoped package is
   * effective but flow config resolved to user/global (mixed-version risk);
   * null otherwise.
   */
  flowConfigWarning: "missing" | "project-package-user-config" | null;
}

export interface BuildDiagnosisOptions {
  activeRoot: string; // realpath(import.meta.dirname/..) from the handler
  cwd: string;
  homeDir: string;
  scope: SetupScope;
  /** require every effective resolution surface to resolve to the effective root */
  strict?: boolean;
  /** injectable for tests; defaults read the real filesystem */
}

/**
 * Parse the `packages` array of a parsed `.pi/settings.json` object into
 * DeclaredPackage rows. String entries beginning `npm:` are npm specs; other
 * string entries are local path specs. Object entries with a string `source`
 * are classified by the same `npm:` prefix rule. Malformed entries are
 * ignored; returns [] when `packages` is missing. Delegates to the shared
 * effective-package module.
 */
export function parseDeclaredPackages(settingsJson: unknown): DeclaredPackage[] {
  return _parseDeclaredPackages(settingsJson);
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

/**
 * Decide whether a real-but-inactive pi-flow install reads as overridden or
 * shadowed, from its own scope, the effective scope, and whether the project
 * declares a pi-flow `packages` entry.
 *
 * - A user/global install is "overridden" when a higher-priority project
 *   override is in effect (the project scope supersedes it).
 * - A project install is "overridden" only when a project pi-flow entry is
 *   actually in effect (`effectiveScope === "project"` and the project declared
 *   an entry); otherwise — e.g. an untrusted project or an unresolvable
 *   declaration leaving the user/global package effective — it is a leftover
 *   "shadowed" by the effective install, not overridden by a project package.
 */
export function decideInactiveClassification(opts: {
  surfaceScope: "user" | "project";
  effectiveScope: "project" | "user";
  declaresProjectEntry: boolean;
}): "inactive-overridden" | "inactive-shadowed" {
  const { surfaceScope, effectiveScope, declaresProjectEntry } = opts;
  if (surfaceScope === "user") {
    return effectiveScope === "project"
      ? "inactive-overridden"
      : "inactive-shadowed";
  }
  return effectiveScope === "project" && declaresProjectEntry
    ? "inactive-overridden"
    : "inactive-shadowed";
}

/**
 * Classify a surface against the effective pi-flow-core root. Order: absent →
 * unresolved → active (realpath === effectiveRoot) → local-dev (in-tree
 * checkout) → a recognized inactive install (its precomputed inactive
 * classification) → stale-skew, reserved for a *resolution* surface whose
 * realpath is none of the above. A non-resolution surface pointing elsewhere is
 * a neutral inactive install (never skew).
 */
export function classifySurface(opts: {
  activeRoot: string;
  effectiveRoot: string;
  cwd: string;
  realpath: string | null;
  exists: boolean;
  isResolutionKind: boolean;
  inactiveInstallRoots: Map<string, Classification>;
}): Classification {
  const {
    effectiveRoot,
    cwd,
    realpath,
    exists,
    isResolutionKind,
    inactiveInstallRoots,
  } = opts;
  if (!exists) return "absent";
  if (realpath == null) return "unresolved";
  if (realpath === effectiveRoot) return "active";
  if (isLocalDevCheckout(realpath, cwd)) return "local-dev";
  const inactive = inactiveInstallRoots.get(realpath);
  if (inactive) return inactive;
  if (isResolutionKind) return "stale-skew";
  // A non-resolution (install/declared) surface pointing somewhere other than
  // the effective root or a recognized install is still neutral, never skew.
  return "inactive-shadowed";
}

/** A per-surface classifier closure produced by buildDiagnosis. `compareRoot`
 * overrides the effective root for scope-aware surfaces (e.g. user agents). */
type Classify = (args: {
  realpath: string | null;
  exists: boolean;
  kind: SurfaceKind;
  compareRoot?: string;
}) => Classification;

/** Resolve a bin surface (helper shim or node bin) into a SurfaceReport. */
async function binSurfaceReport(opts: {
  kind: SurfaceKind;
  label: string;
  inspectedPath: string;
  resolvePath: string;
  exists: boolean;
  classify: Classify;
}): Promise<SurfaceReport> {
  const { kind, label, inspectedPath, resolvePath, exists, classify } = opts;
  if (!exists) {
    return { kind, label, inspectedPath, classification: "absent" };
  }

  const { core, viaAggregate } = await resolveBinToCore(resolvePath);
  const detail = viaAggregate
    ? `via @aphotic/pi-flow@${viaAggregate.version} wrapper`
    : undefined;

  if (core) {
    const classification = classify({
      realpath: core.root,
      exists: true,
      kind,
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

/** Resolve an agents symlink directory into a single SurfaceReport. The
 * `compareRoot` lets a scope's agents be judged against their own scope's root
 * (e.g. user agents against the user install even when a project override is
 * effective). */
async function agentsSurfaceReport(opts: {
  kind: SurfaceKind;
  label: string;
  dir: string;
  classify: Classify;
  compareRoot?: string;
}): Promise<SurfaceReport> {
  const { kind, label, dir, classify, compareRoot } = opts;
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
    "stale-skew": 5,
    "local-dev": 4,
    "inactive-overridden": 3,
    "inactive-shadowed": 3,
    active: 2,
    "non-pi-flow": 1,
    unresolved: 0,
    absent: 0,
  };
  let worst: { core: PiFlowCorePackage; classification: Classification } | null =
    null;
  for (const core of roots.values()) {
    const classification = classify({
      realpath: core.root,
      exists: true,
      kind,
      compareRoot,
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
    compareRoot,
  };
}

/** Resolve npm install candidate paths into SurfaceReports (existing only). */
async function installSurfaceReports(opts: {
  kind: SurfaceKind;
  candidates: { path: string; label: string }[];
  classify: Classify;
}): Promise<SurfaceReport[]> {
  const { kind, candidates, classify } = opts;
  const out: SurfaceReport[] = [];
  for (const c of candidates) {
    const rp = await realpathOrNull(c.path);
    if (!rp) continue; // absent — informational, no row
    const core = await readPiFlowCorePackage(c.path);
    const classification = core
      ? classify({ realpath: core.root, exists: true, kind })
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
  classify: Classify;
}): Promise<SurfaceReport[]> {
  const { settingsPath, classify } = opts;
  let parsed: unknown;
  try {
    const content = await fs.readFile(settingsPath, "utf8");
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const settingsDir = path.dirname(settingsPath);
  // settingsPath = <cwd>/.pi/settings.json, so settingsDir = <cwd>/.pi, baseDir = <cwd>
  const baseDir = path.dirname(settingsDir);
  const out: SurfaceReport[] = [];
  for (const declared of parseDeclaredPackages(parsed)) {
    let detail = `${declared.spec} (${declared.pinned ? "pinned" : "floating"}, ${declared.kind})`;
    let realpath: string | undefined;
    let classification: Classification = "unresolved";
    if (declared.kind === "local") {
      // Local specs resolve relative to baseDir (cwd), matching the shared
      // effective resolver — not relative to the settings dir (<cwd>/.pi).
      const resolved = await realpathOrNull(
        path.resolve(baseDir, declared.spec),
      );
      if (resolved) {
        realpath = resolved;
        classification = classify({
          realpath: resolved,
          exists: true,
          kind: "declared-package",
        });
      }
    } else if (declared.kind === "npm") {
      const core = await _resolveSpecToCoreRoot({
        spec: declared.spec,
        kind: declared.kind,
        name: declared.name,
        baseDir,
      });
      if (core) {
        realpath = core.root;
        classification = classify({
          realpath: core.root,
          exists: true,
          kind: "declared-package",
        });
        detail = `${declared.spec} (${declared.pinned ? "pinned" : "floating"}, ${declared.kind}) → v${core.version}`;
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
  const { activeRoot, cwd, homeDir, scope, strict } = opts;

  const active =
    (await readPiFlowCorePackage(activeRoot)) ??
    ({
      root: activeRoot,
      name: "@aphotic/pi-flow-core",
      version: "unknown",
    } satisfies PiFlowCorePackage);

  // The effective pi-flow-core root Pi resolves to for this cwd (honoring a
  // trusted project override, else the user/global install). When neither
  // resolves, the executing package is what is effectively active.
  const resolvedEffective = await resolveEffectiveCoreRoot({ cwd, homeDir });
  const effectiveRoot = resolvedEffective?.root ?? activeRoot;
  const effectiveScope: "project" | "user" = resolvedEffective?.scope ?? "user";

  // The package identity at the effective root — distinct from `active` when an
  // override/local-dev resolution diverges from the executing package.
  const effective =
    effectiveRoot === activeRoot
      ? active
      : ((await readPiFlowCorePackage(effectiveRoot)) ??
        ({
          root: effectiveRoot,
          name: "@aphotic/pi-flow-core",
          version: "unknown",
        } satisfies PiFlowCorePackage));

  // Whether the project declares a pi-flow `packages` entry at all — used to
  // distinguish an overridden project install from a leftover shadowed one.
  const declaresProjectEntry = await projectDeclaresPiFlow(cwd);

  // Install candidate locations, by scope. Reused to both build surface rows
  // and to recognize inactive installs (so a resolution surface pointing at one
  // is not mis-flagged stale-skew).
  const projectInstallCandidates: { path: string; label: string }[] = [
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
  ];
  const userInstallCandidates: { path: string; label: string }[] = [
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
  ];

  // The user/global install root, resolved independently of any project
  // override (including ~/.pi/agent/settings.json declared local/npm packages,
  // which may live outside ~/.pi/agent/npm). Used for scope-aware user agents
  // (they may legitimately serve the user root even when a project override is
  // effective) and to recognize that root as a neutral inactive install.
  const userResolvedRoot =
    effectiveScope === "user"
      ? effectiveRoot
      : ((await resolveUserCoreRoot({ homeDir }))?.root ?? null);
  const userRoot = userResolvedRoot ?? effectiveRoot;

  // Recognized inactive installs: real pi-flow cores at a known install
  // location whose root is not the effective root. Mapped to their resolved
  // (overridden vs shadowed) classification.
  const inactiveInstallRoots = new Map<string, Classification>();
  for (const [surfaceScope, candidates] of [
    ["project", projectInstallCandidates],
    ["user", userInstallCandidates],
  ] as const) {
    for (const c of candidates) {
      const core = await readPiFlowCorePackage(c.path);
      if (!core || core.root === effectiveRoot) continue;
      if (inactiveInstallRoots.has(core.root)) continue;
      inactiveInstallRoots.set(
        core.root,
        decideInactiveClassification({
          surfaceScope,
          effectiveScope,
          declaresProjectEntry,
        }),
      );
    }
  }

  // The settings-declared user/global root (which may sit outside the fixed npm
  // candidates) is also a recognized inactive install when a project override is
  // effective, so surfaces resolving to it read as neutral rather than skew.
  if (
    userResolvedRoot &&
    userResolvedRoot !== effectiveRoot &&
    !inactiveInstallRoots.has(userResolvedRoot)
  ) {
    inactiveInstallRoots.set(
      userResolvedRoot,
      decideInactiveClassification({
        surfaceScope: "user",
        effectiveScope,
        declaresProjectEntry,
      }),
    );
  }

  const classify: Classify = ({ realpath, exists, kind, compareRoot }) =>
    classifySurface({
      activeRoot,
      effectiveRoot: compareRoot ?? effectiveRoot,
      cwd,
      realpath,
      exists,
      isResolutionKind: RESOLUTION_KINDS.includes(kind),
      inactiveInstallRoots,
    });

  const surfaces: SurfaceReport[] = [];
  let staleDispatcher = false;

  // helper-shim. The shim has two recognized forms:
  //  - the new stable dispatcher (a real file copy of bin/pi-flow-dispatch.mjs),
  //    evaluated on two independent axes — its installed bytes vs the active
  //    package's dispatcher (stale-bytes), and its effective runtime target for
  //    this cwd (the per-cwd core it would actually spawn);
  //  - the legacy owned symlink, classified via resolveBinToCore as before.
  const shimLabel = "helper shim (~/.pi/agent/bin/pi-flow)";
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
        label: shimLabel,
        inspectedPath: shimPath,
        classification: "absent",
      });
    } else if (
      !st.isSymbolicLink() &&
      st.isFile() &&
      (await isDispatcherFile(shimPath, activeRoot))
    ) {
      // Dispatcher form — the two independent axes.
      // (a) stale-bytes: installed launcher vs the active package's dispatcher.
      const stale = await isDispatcherStale({ installedPath: shimPath, activeRoot });
      staleDispatcher = stale;
      // (b) runtime-target: the per-cwd delegate the dispatcher would spawn.
      const runtime = await resolveEffectiveCoreRoot({ cwd, homeDir });
      const runtimeRoot = runtime?.root ?? null;
      const pkg = runtimeRoot
        ? ((await readPiFlowCorePackage(runtimeRoot)) ?? undefined)
        : undefined;
      const classification = classify({
        realpath: runtimeRoot,
        exists: true,
        kind: "helper-shim",
      });
      const detail = stale
        ? "dispatcher (stale-dispatcher: bytes differ from active)"
        : "dispatcher (bytes aligned with active)";
      surfaces.push({
        kind: "helper-shim",
        label: shimLabel,
        inspectedPath: shimPath,
        realpath: runtimeRoot ?? undefined,
        pkg,
        classification,
        detail,
      });
    } else {
      // Legacy symlink (or a foreign real file) — classify via resolveBinToCore.
      let resolvePath = shimPath;
      if (st.isSymbolicLink()) {
        const link = await fs.readlink(shimPath);
        resolvePath = path.resolve(path.dirname(shimPath), link);
      }
      surfaces.push(
        await binSurfaceReport({
          kind: "helper-shim",
          label: shimLabel,
          inspectedPath: shimPath,
          resolvePath,
          exists: true,
          classify,
        }),
      );
    }
  }

  // user-agents — judged against the user/global install root.
  surfaces.push(
    await agentsSurfaceReport({
      kind: "user-agents",
      label: "user agents (~/.pi/agent/agents)",
      dir: path.join(homeDir, ".pi", "agent", "agents"),
      classify,
      compareRoot: userRoot,
    }),
  );

  // project-agents — judged against the effective project root.
  surfaces.push(
    await agentsSurfaceReport({
      kind: "project-agents",
      label: "project agents (<cwd>/.pi/agents)",
      dir: path.join(cwd, ".pi", "agents"),
      classify,
    }),
  );

  // project-install
  surfaces.push(
    ...(await installSurfaceReports({
      kind: "project-install",
      candidates: projectInstallCandidates,
      classify,
    })),
  );

  // user-install
  surfaces.push(
    ...(await installSurfaceReports({
      kind: "user-install",
      candidates: userInstallCandidates,
      classify,
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
        classify,
      }),
    );
  }

  // declared-package
  surfaces.push(
    ...(await declaredSurfaceReports({
      settingsPath: path.join(cwd, ".pi", "settings.json"),
      classify,
    })),
  );

  const skewKinds = surfaces
    .filter(
      (s) =>
        RESOLUTION_KINDS.includes(s.kind) && s.classification === "stale-skew",
    )
    .map((s) => s.kind);
  const hasSkew = skewKinds.length > 0;

  // --strict: every effective resolution surface must resolve to its intended
  // comparison root — the cwd effective root, or a scope's own root for
  // scope-aware surfaces (e.g. user agents against the user/global install even
  // under a project override). A clean-by-default local-dev or otherwise-
  // divergent surface fails; a scope-aligned user agent does not.
  const strictDivergence: SurfaceKind[] = strict
    ? surfaces
        .filter(
          (s) =>
            RESOLUTION_KINDS.includes(s.kind) &&
            s.realpath != null &&
            s.realpath !== (s.compareRoot ?? effectiveRoot),
        )
        .map((s) => s.kind)
    : [];

  // Absent candidates: install/bin candidate paths that were silently skipped
  // (not present on disk). Used by --all inventory mode.
  const surfacePaths = new Set(surfaces.map((s) => s.inspectedPath));
  const allCandidates = [
    ...projectInstallCandidates,
    ...userInstallCandidates,
    ...nodeBinCandidates,
  ];
  const absentCandidates = allCandidates
    .map((c) => c.path)
    .filter((p) => !surfacePaths.has(p));

  const flowConfig = await resolveFlowConfig({ cwd, homeDir });
  let flowConfigWarning: DoctorDiagnosis["flowConfigWarning"] = null;
  if (flowConfig.scope === "none") {
    flowConfigWarning = "missing";
  } else if (effectiveScope === "project" && flowConfig.scope === "user") {
    flowConfigWarning = "project-package-user-config";
  }

  return {
    active,
    effective,
    scope,
    homeDir,
    effectiveRoot,
    effectiveScope,
    surfaces,
    hasSkew,
    skewKinds,
    strictDivergence,
    absentCandidates,
    staleDispatcher,
    flowConfig,
    flowConfigWarning,
  };
}

/** Whether <cwd>/.pi/settings.json declares a pi-flow `packages` entry (an npm
 * pi-flow identity or any local spec, which may resolve to pi-flow). */
async function projectDeclaresPiFlow(cwd: string): Promise<boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await fs.readFile(path.join(cwd, ".pi", "settings.json"), "utf8"),
    );
  } catch {
    return false;
  }
  for (const row of parseDeclaredPackages(parsed)) {
    if (row.kind === "local") return true;
    if (row.name === "@aphotic/pi-flow" || row.name === "@aphotic/pi-flow-core") {
      return true;
    }
  }
  return false;
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
    if (!enclosing) {
      const resolvedRealpath = await realpathOrNull(resolvedActual);
      return {
        path: linkPath,
        outcome: "conflict",
        to: desiredTarget,
        from: resolvedRealpath ?? resolvedActual,
        conflict: {
          path: linkPath,
          reason: resolvedRealpath
            ? "non-pi-flow symlink target — refusing to overwrite"
            : "unresolved symlink target — refusing to overwrite",
          expected: desiredTarget,
          actual: resolvedActual,
        },
      };
    }
    if (isLocalDevCheckout(enclosing.root, cwd)) {
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

/**
 * Repair the installed dispatcher launcher at `shimPath` by re-copying the
 * active package's bin/pi-flow-dispatch.mjs, honoring the never-clobber-foreign
 * posture. Outcomes mirror repairLink's vocabulary:
 *  - created: nothing was present; the dispatcher copy was written;
 *  - skipped: an up-to-date dispatcher copy already exists;
 *  - repaired: a stale dispatcher copy was refreshed to the active bytes;
 *  - conflict: a foreign file or a directory occupies the path — left untouched.
 * The desired target (`to`) is the active dispatcher source so the report and
 * target-root derivation stay consistent with symlink repairs.
 */
export async function repairDispatcher(args: {
  shimPath: string;
  dispatcherSrc: string;
}): Promise<RepairResult> {
  const { shimPath, dispatcherSrc } = args;
  const to = dispatcherSrc;

  let st: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    st = await fs.lstat(shimPath);
  } catch (err: any) {
    if (err && err.code === "ENOENT") {
      await fs.mkdir(path.dirname(shimPath), { recursive: true });
      const content = await fs.readFile(dispatcherSrc);
      await fs.writeFile(shimPath, content, { mode: 0o755 });
      await fs.chmod(shimPath, 0o755);
      return { path: shimPath, outcome: "created", to };
    }
    throw err;
  }

  if (st.isDirectory()) {
    return {
      path: shimPath,
      outcome: "conflict",
      to,
      conflict: {
        path: shimPath,
        reason: "directory at target — refusing to overwrite",
      },
    };
  }

  if (st.isFile()) {
    const [existing, source] = await Promise.all([
      fs.readFile(shimPath),
      fs.readFile(dispatcherSrc),
    ]);
    const ours =
      existing.toString("utf8", 0, 512).includes(DISPATCHER_SIGNATURE) ||
      existing.equals(source);
    if (!ours) {
      // Foreign real file — preserve.
      return {
        path: shimPath,
        outcome: "conflict",
        to,
        conflict: {
          path: shimPath,
          reason: "real file at target — refusing to overwrite",
        },
      };
    }
    if (existing.equals(source)) {
      // Up-to-date bytes, but the owned file may have lost its exec bit; restore
      // it so a "skipped" repair never leaves pi-flow non-executable on PATH.
      await fs.chmod(shimPath, 0o755);
      return { path: shimPath, outcome: "skipped", to };
    }
    await fs.writeFile(shimPath, source, { mode: 0o755 });
    // writeFile leaves an existing inode's mode untouched; chmod to guarantee
    // the refreshed dispatcher is executable.
    await fs.chmod(shimPath, 0o755);
    return { path: shimPath, outcome: "repaired", to };
  }

  // Anything else (e.g. a socket/fifo) — refuse to touch.
  return {
    path: shimPath,
    outcome: "conflict",
    to,
    conflict: {
      path: shimPath,
      reason: "non-regular file at target — refusing to overwrite",
    },
  };
}

const TAGS: Record<Classification, string> = {
  active: "[active]",
  "local-dev": "[local-dev]",
  "stale-skew": "[SKEW]",
  "inactive-overridden": "[inactive]",
  "inactive-shadowed": "[inactive]",
  absent: "[absent]",
  unresolved: "[unresolved]",
  "non-pi-flow": "[non-pi-flow]",
};

/** Width of the widest tag "[non-pi-flow]" — all tags are padded to this. */
const TAG_WIDTH = 13; // "[non-pi-flow]".length

function renderSurfaceRow(s: SurfaceReport, homeDir: string): string[] {
  const tag = TAGS[s.classification].padEnd(TAG_WIDTH);
  const version = s.pkg ? `v${s.pkg.version}` : "";
  const displayPath = abbreviatePath(s.realpath ?? s.inspectedPath, homeDir);
  const parts = [`  ${tag}  ${s.label}`];
  if (version) parts[0] += `  ${version}`;
  parts[0] += `  ${displayPath}`;
  if (s.detail) parts[0] += `  — ${s.detail}`;
  // Sub-type continuation line for inactive installs.
  if (s.classification === "inactive-overridden") {
    parts.push(`  ${"".padEnd(TAG_WIDTH)}    overridden by project package`);
  } else if (s.classification === "inactive-shadowed") {
    parts.push(`  ${"".padEnd(TAG_WIDTH)}    shadowed — user package effective`);
  }
  return parts;
}

/** Render a DoctorDiagnosis into a human-readable grouped report string. */
export function renderReport(d: DoctorDiagnosis, opts?: { all?: boolean }): string {
  const { all = false } = opts ?? {};
  const lines: string[] = [];

  // Verdict header
  lines.push(
    d.hasSkew ? "pi-flow doctor — SKEW DETECTED" : "pi-flow doctor — OK, no skew",
  );
  // Package identity line(s). When the executing package and the effective
  // package coincide, a single line carries the scope note. When they diverge
  // (override/local-dev), label the executing package explicitly and add a
  // separate effective line so the scope note describes the right root/version.
  const scopeNote =
    d.effectiveScope === "project" ? "(project override)" : "(user/global)";
  if (d.active.root === d.effectiveRoot) {
    lines.push(
      `  ${d.active.name}@${d.active.version}  ${abbreviatePath(d.active.root, d.homeDir)}  ${scopeNote}`,
    );
  } else {
    lines.push(
      `  ${d.active.name}@${d.active.version}  ${abbreviatePath(d.active.root, d.homeDir)}  (executing)`,
    );
    lines.push(
      `  effective: ${d.effective.name}@${d.effective.version}  ${abbreviatePath(d.effective.root, d.homeDir)}  ${scopeNote}`,
    );
  }
  lines.push("");

  // Flow config section — the active flow config Pi resolves for this cwd,
  // visually distinct from the package-root identity above.
  lines.push("Flow config");
  if (d.flowConfig.scope === "none") {
    const searched = d.flowConfig.searched
      .map((p) => abbreviatePath(p, d.homeDir))
      .join(", ");
    lines.push(`  [none]  no usable flow config; searched ${searched}`);
    lines.push(
      "  warning: no flow config found — copy flow.example.json to a project .pi/flow.json or ~/.pi/agent/flow.json (see flow-config-setup.md).",
    );
  } else {
    const scopeLabel =
      d.flowConfig.scope === "project" ? "(project-local)" : "(user/global)";
    lines.push(
      `  [${d.flowConfig.scope}]  ${abbreviatePath(d.flowConfig.path!, d.homeDir)}  ${scopeLabel}`,
    );
    if (d.flowConfigWarning === "project-package-user-config") {
      lines.push(
        "  warning: project-local pi-flow package is effective but flow config resolved to user/global — add a project .pi/flow.json to pin dispatch config to this package (see version-alignment.md).",
      );
    }
  }
  lines.push("");

  // Group surfaces into three categories
  const effectiveSurfaces = d.surfaces.filter(
    (s) =>
      s.classification !== "inactive-overridden" &&
      s.classification !== "inactive-shadowed" &&
      s.classification !== "stale-skew",
  );
  const inactiveSurfaces = d.surfaces.filter(
    (s) =>
      s.classification === "inactive-overridden" ||
      s.classification === "inactive-shadowed",
  );
  const skewSurfaces = d.surfaces.filter(
    (s) => s.classification === "stale-skew",
  );

  // Effective surfaces section
  lines.push("Effective surfaces");
  if (effectiveSurfaces.length === 0) {
    lines.push("  (none)");
  } else {
    for (const s of effectiveSurfaces) {
      lines.push(...renderSurfaceRow(s, d.homeDir));
    }
  }
  lines.push("");

  // Inactive installs section
  lines.push("Inactive installs");
  if (inactiveSurfaces.length === 0) {
    lines.push("  (none)");
  } else {
    for (const s of inactiveSurfaces) {
      lines.push(...renderSurfaceRow(s, d.homeDir));
    }
  }
  lines.push("");

  // Skew section
  lines.push("Skew");
  if (skewSurfaces.length === 0) {
    lines.push("  (none)");
  } else {
    for (const s of skewSurfaces) {
      lines.push(...renderSurfaceRow(s, d.homeDir));
    }
  }

  // --all: absent candidate inventory
  if (all && d.absentCandidates.length > 0) {
    lines.push("");
    lines.push("Absent candidates");
    for (const p of d.absentCandidates) {
      lines.push(`  [absent]  ${abbreviatePath(p, d.homeDir)}`);
    }
  }

  return lines.join("\n");
}

export interface DoctorArgs {
  help: boolean;
  fix: boolean;
  strict: boolean;
  all: boolean;
  source?: string; // value following --source
}

/** Parse "/flow:doctor" args. Recognizes --help|-h, --fix, --strict, --all, --source <value>. */
export function parseDoctorArgs(raw: string): DoctorArgs {
  const tokens = raw.split(/\s+/).filter((t) => t.length > 0);
  const args: DoctorArgs = { help: false, fix: false, strict: false, all: false };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--help" || t === "-h") {
      args.help = true;
    } else if (t === "--fix") {
      args.fix = true;
    } else if (t === "--strict") {
      args.strict = true;
    } else if (t === "--all") {
      args.all = true;
    } else if (t === "--source") {
      if (i + 1 < tokens.length) {
        args.source = tokens[i + 1];
        i++;
      }
    }
    // Unknown flags are ignored.
  }
  return args;
}

/** Help block for /flow:doctor: the three invocations, the --source forms, and
 * the mutation boundary. */
export function helpText(): string {
  return [
    "/flow:doctor — diagnose pi-flow surface skew and optionally repoint links.",
    "",
    "Invocations:",
    "  /flow:doctor",
    "      inventory the managed surfaces and report version skew (read-only).",
    "  /flow:doctor --fix",
    "      repoint the helper shim and agent symlinks at the reconcile target.",
    "  /flow:doctor --fix --source <target>",
    "      repoint at an explicitly named target (required when ambiguous).",
    "",
    "Flags:",
    "  --strict",
    "      airtight same-root check: every effective resolution surface must",
    "      resolve to the effective root (local-dev divergence fails). Reports",
    "      error when any resolution surface diverges, even without stale-skew.",
    "  --all",
    "      deeper inventory including absent install/bin candidates; adds an",
    "      Absent candidates section to the report.",
    "",
    "--source <target> forms:",
    "  1. An absolute path to an @aphotic/pi-flow-core root — a directory with",
    "     bin/pi-flow.mjs and a package.json whose name is @aphotic/pi-flow-core.",
    "       e.g. --source /Users/me/src/pi-flow/packages/pi-flow-core",
    "  2. A cwd-relative path to the same kind of @aphotic/pi-flow-core root.",
    "       e.g. --source ./packages/pi-flow-core",
    "  3. A checkout root or @aphotic/pi-flow meta-install that contains a single",
    "     resolvable core at packages/pi-flow-core or",
    "     node_modules/@aphotic/pi-flow-core.",
    "       e.g. --source ./node_modules/@aphotic/pi-flow",
    "",
    "doctor never edits .pi/settings.json, never installs, and never creates a",
    "pin file; to make a repoint durable, edit the packages entry in",
    ".pi/settings.json yourself.",
  ].join("\n");
}

export interface DoctorFixReport {
  shim: RepairResult | null; // null when scope is project and shim is absent (guidance instead)
  agents: RepairResult[];
  guidance: string[]; // settings-alignment advice; never an edit
}

/** Run the repair against a resolved target. Pure over injected dirs. */
export async function runDoctorFix(args: {
  target: PiFlowCorePackage;
  effectiveTarget: DurableTarget; // "user" | "project" (from scope)
  shimPath: string; // <home>/.pi/agent/bin/pi-flow
  agentsDir: string; // <home>/.pi/agent/agents OR <cwd>/.pi/agents
  activeRoot: string;
  cwd: string;
  declaredSpecsForTarget: string[]; // declared specs that already name this target (may be empty)
  /** active package's bin/pi-flow-dispatch.mjs — the source for a dispatcher copy */
  dispatcherSrc?: string;
}): Promise<DoctorFixReport> {
  const {
    target,
    effectiveTarget,
    shimPath,
    agentsDir,
    activeRoot,
    cwd,
    declaredSpecsForTarget,
    dispatcherSrc,
  } = args;

  const shimTarget = path.join(target.root, "bin", "pi-flow.mjs");
  const guidance: string[] = [];

  // Determine the current shim form so we repair the right kind of surface
  // without ever deleting an inactive install (we only touch the shim itself).
  let shimStat: Awaited<ReturnType<typeof fs.lstat>> | undefined;
  try {
    shimStat = await fs.lstat(shimPath);
  } catch (err: any) {
    if (err && err.code === "ENOENT") shimStat = undefined;
    else throw err;
  }

  let shim: RepairResult | null;
  if (shimStat?.isSymbolicLink()) {
    // Legacy owned symlink — repoint to the target's bin (back-compat).
    shim = await repairLink({
      linkPath: shimPath,
      desiredTarget: shimTarget,
      activeRoot,
      cwd,
    });
  } else if (!shimStat && effectiveTarget === "project") {
    // No shim, and this scope cannot own the global one — guidance only.
    shim = null;
    guidance.push(
      `no helper shim at ${shimPath}; run /flow:setup --target user (or re-run from a user-scope install) to create it.`,
    );
  } else if (dispatcherSrc) {
    // Dispatcher form: refresh a stale installed launcher, create an absent
    // one (user scope), and preserve any foreign file — never clobber.
    shim = await repairDispatcher({ shimPath, dispatcherSrc });
  } else {
    // No dispatcher source available — fall back to a legacy symlink repoint.
    shim = await repairLink({
      linkPath: shimPath,
      desiredTarget: shimTarget,
      activeRoot,
      cwd,
    });
  }

  const agents: RepairResult[] = [];
  let agentNames: string[];
  try {
    agentNames = await fs.readdir(path.join(target.root, "agents"));
  } catch {
    agentNames = [];
  }
  for (const name of agentNames) {
    if (!name.endsWith(".md")) continue;
    agents.push(
      await repairLink({
        linkPath: path.join(agentsDir, name),
        desiredTarget: path.join(target.root, "agents", name),
        activeRoot,
        cwd,
      }),
    );
  }

  if (declaredSpecsForTarget.length === 0) {
    guidance.push(
      "the repointed target is not named in .pi/settings.json packages; add or update an entry so the change survives reinstall — doctor does not edit settings.",
    );
  }

  return { shim, agents, guidance };
}

const REPAIR_WORD: Record<RepairOutcome, string> = {
  created: "created",
  skipped: "skipped",
  repaired: "repaired",
  "preserved-other": "preserved",
  conflict: "conflict",
};

/** Derive the target root from a repair report's outcomes (both shim and agent
 * desired targets sit two levels under the package root). */
function fixReportTargetRoot(r: DoctorFixReport): string | undefined {
  if (r.shim) return path.dirname(path.dirname(r.shim.to));
  if (r.agents.length > 0) return path.dirname(path.dirname(r.agents[0].to));
  return undefined;
}

/** Render a DoctorFixReport into a human-readable report string. */
export function renderFixReport(r: DoctorFixReport): string {
  const root = fixReportTargetRoot(r) ?? "(unknown)";
  const lines: string[] = [`/flow:doctor --fix (target: ${root}):`];

  const outcomes: RepairResult[] = [];
  if (r.shim) outcomes.push(r.shim);
  outcomes.push(...r.agents);

  let mutations = 0;
  for (const o of outcomes) {
    let line = `  ${REPAIR_WORD[o.outcome]}: ${o.path} -> ${o.to}`;
    if (
      (o.outcome === "repaired" || o.outcome === "preserved-other") &&
      o.from
    ) {
      line += ` (was ${o.from})`;
    }
    lines.push(line);
    if (o.outcome === "created" || o.outcome === "repaired") mutations++;
  }

  for (const g of r.guidance) {
    lines.push(`  note: ${g}`);
  }

  if (mutations > 0) {
    lines.push("Reload Pi or run /reload to pick up the repointed links.");
  }

  return lines.join("\n");
}

/**
 * Resolve a single declared/loaded path into a pi-flow-core package, accepting
 * a direct core root or a checkout/meta-install with a single descent core.
 * Mirrors validateExplicitTarget's acceptance for the reconcile candidate set.
 */
async function resolveCandidateRoot(
  abs: string,
  cwd: string,
): Promise<PiFlowCorePackage | null> {
  const v = await validateExplicitTarget(abs, cwd);
  return v.ok && v.target ? v.target : null;
}

/**
 * Declared specs whose resolved root equals the chosen target root. Both local
 * and npm rows are scanned: local specs resolve through the reconcile candidate
 * path, while npm specs resolve through the same shared `resolveSpecToCoreRoot`
 * resolver `declaredSurfaceReports` uses. This way an entry such as
 * `packages: ["npm:@aphotic/pi-flow-core"]` that already names the effective
 * target is recognized, so the fix-report durability note is suppressed instead
 * of misleadingly telling the user to add or update `.pi/settings.json`.
 */
export async function declaredSpecsNamingTarget(
  cwd: string,
  targetRoot: string,
): Promise<string[]> {
  const settingsPath = path.join(cwd, ".pi", "settings.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const declared of parseDeclaredPackages(parsed)) {
    let root: string | null = null;
    if (declared.kind === "local") {
      // Local specs resolve relative to cwd, matching the shared effective
      // resolver (and declaredSurfaceReports) — not relative to <cwd>/.pi.
      const core = await resolveCandidateRoot(
        path.resolve(cwd, declared.spec),
        cwd,
      );
      root = core?.root ?? null;
    } else {
      const core = await _resolveSpecToCoreRoot({
        spec: declared.spec,
        kind: declared.kind,
        name: declared.name,
        baseDir: cwd,
      });
      root = core?.root ?? null;
    }
    if (root && root === targetRoot) out.push(declared.spec);
  }
  return out;
}

/**
 * Plan a default (`--fix` without `--source`) repair from the effective
 * diagnosis. The target package and repair scope come from the package Pi
 * actually resolves to for this cwd — a trusted project override when present,
 * else the user/global install — never from the executing command scope. This
 * is what lets a user-installed doctor sitting inside a trusted project override
 * repair the project agents instead of repointing the (already-correct) user
 * root and leaving the project-scope agents stale.
 */
export function planDefaultFix(args: {
  diagnosis: DoctorDiagnosis;
  homeDir: string;
  cwd: string;
}): {
  target: PiFlowCorePackage;
  effectiveTarget: DurableTarget;
  agentsDir: string;
} {
  const { diagnosis, homeDir, cwd } = args;
  const effectiveTarget: DurableTarget = diagnosis.effectiveScope;
  const agentsDir =
    effectiveTarget === "user"
      ? path.join(homeDir, ".pi", "agent", "agents")
      : path.join(cwd, ".pi", "agents");
  return { target: diagnosis.effective, effectiveTarget, agentsDir };
}

export function registerDoctor(pi: ExtensionAPI): void {
  pi.registerCommand("flow:doctor", {
    description:
      "Diagnose pi-flow surface skew and, with --fix, repoint the helper shim and agent symlinks at the active package.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      try {
        const ownPackageRoot = await fs.realpath(
          path.resolve(import.meta.dirname, ".."),
        );
        const active = await readPiFlowCorePackage(ownPackageRoot);
        if (!active) {
          ctx.ui.notify(
            "doctor could not resolve its own pi-flow-core package",
            "error",
          );
          return;
        }

        const { scope } = await resolveScope({
          ownPackageRoot,
          commands: pi.getCommands(),
          homeDir: os.homedir(),
          cwd: ctx.cwd,
        });

        const parsed = parseDoctorArgs(args);
        if (parsed.help) {
          ctx.ui.notify(helpText(), "info");
          return;
        }

        const diagnosis = await buildDiagnosis({
          activeRoot: ownPackageRoot,
          cwd: ctx.cwd,
          homeDir: os.homedir(),
          scope,
          strict: parsed.strict,
        });

        if (!parsed.fix) {
          const isError =
            diagnosis.hasSkew ||
            (parsed.strict && diagnosis.strictDivergence.length > 0);
          ctx.ui.notify(
            renderReport(diagnosis, { all: parsed.all }),
            isError ? "error" : "info",
          );
          return;
        }

        // --fix: derive the target package and repair scope from the effective
        // model (the package Pi resolves to for this cwd), not the executing
        // command scope. An explicit --source overrides only the target package.
        const plan = planDefaultFix({
          diagnosis,
          homeDir: os.homedir(),
          cwd: ctx.cwd,
        });
        let target: PiFlowCorePackage = plan.target;
        if (parsed.source) {
          const validation = await validateExplicitTarget(parsed.source, ctx.cwd);
          if (!validation.ok || !validation.target) {
            ctx.ui.notify(
              `${validation.error ?? "invalid --source target"}\n${helpText()}`,
              "error",
            );
            return;
          }
          target = validation.target;
        }

        const effectiveTarget: DurableTarget = plan.effectiveTarget;
        const shimPath = path.join(
          os.homedir(),
          ".pi",
          "agent",
          "bin",
          "pi-flow",
        );
        const agentsDir = plan.agentsDir;

        const declaredSpecsForTarget = await declaredSpecsNamingTarget(
          ctx.cwd,
          target.root,
        );

        const report = await runDoctorFix({
          target,
          effectiveTarget,
          shimPath,
          agentsDir,
          activeRoot: ownPackageRoot,
          cwd: ctx.cwd,
          declaredSpecsForTarget,
          dispatcherSrc: path.join(
            ownPackageRoot,
            "bin",
            "pi-flow-dispatch.mjs",
          ),
        });

        const hasConflict =
          report.shim?.outcome === "conflict" ||
          report.agents.some((a) => a.outcome === "conflict");
        ctx.ui.notify(
          renderFixReport(report),
          hasConflict ? "error" : "info",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`/flow:doctor failed: ${message}`, "error");
      }
    },
  });
}
