/** TypeScript declarations for effective-package.mjs, consumed under strip-types and tsc --noEmit. */

export interface PiFlowCorePackage {
  root: string;
  name: string;
  version: string;
}

export interface BinResolution {
  core: PiFlowCorePackage | null;
  viaAggregate?: { name: string; version: string; root: string };
}

export interface DeclaredPackage {
  spec: string;
  kind: "npm" | "local";
  pinned: boolean;
  /** Extracted package name for npm specs (undefined for local specs). */
  name?: string;
}

export interface EffectiveCoreRoot {
  root: string;
  binPath: string;
  scope: "project" | "user";
  viaAggregate?: { name: string; version: string; root: string };
}

export function realpathOrNull(p: string): Promise<string | null>;
export function packageRootFromBin(binPath: string): Promise<string | null>;
export function readPiFlowCorePackage(root: string): Promise<PiFlowCorePackage | null>;
export function findEnclosingCoreRoot(start: string): Promise<PiFlowCorePackage | null>;
export function resolveBinToCore(binPath: string): Promise<BinResolution>;
export function parseDeclaredPackages(input: unknown): DeclaredPackage[];
export function normalizePiFlowIdentity(name: string): string | null;
export function resolveSpecToCoreRoot(opts: {
  spec: string;
  kind: "npm" | "local";
  name?: string;
  baseDir: string;
}): Promise<PiFlowCorePackage | null>;
export function isTrusted(opts: { cwd: string; homeDir: string }): Promise<boolean>;
export function resolveEffectiveCoreRoot(opts: {
  cwd: string;
  homeDir: string;
}): Promise<EffectiveCoreRoot | null>;
export function abbreviatePath(p: string, homeDir: string): string;
