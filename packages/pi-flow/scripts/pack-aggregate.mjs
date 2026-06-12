#!/usr/bin/env node
// Deterministic pack/publish helper for the @aphotic/pi-flow aggregate.
//
// `pnpm pack` cannot pack this package: with bundledDependencies present under
// pnpm's isolated linker it fails with ERR_PNPM_BUNDLED_DEPENDENCIES_WITHOUT_HOISTED.
// Instead we build a clean staging directory that physically contains the Pi
// subpackages under stage/node_modules/@aphotic/..., rewrite workspace:* specs to
// exact versions, then run `npm pack`/`npm publish` from the stage. npm bundles
// each name listed in bundledDependencies (recursively, including its own nested
// node_modules), producing a self-contained aggregate tarball.
//
// Usage:
//   node scripts/pack-aggregate.mjs [--out <dir>] [--keep-stage]
//   node scripts/pack-aggregate.mjs --publish [-- <extra npm publish args>]
//
// Prints a JSON line: { "tarball": "<abs>", "stageDir": "<abs|null>" }

import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SCRIPT_DIR, '..');
const WORKSPACE_ROOT = resolve(PKG_DIR, '..', '..');
const PACKAGES_DIR = resolve(WORKSPACE_ROOT, 'packages');

// Subpackages bundled into the aggregate, in dependency order. Each maps the
// scoped package name to its workspace source directory.
export const BUNDLED_PACKAGES = [
  { name: '@aphotic/pi-flow-core', dir: 'pi-flow-core' },
  { name: '@aphotic/pi-flow-ux', dir: 'pi-flow-ux' },
  { name: '@aphotic/pi-ideas', dir: 'pi-ideas' },
  { name: '@aphotic/pi-release', dir: 'pi-release' },
];

// Resource paths (relative to the aggregate package root inside the tarball)
// that MUST exist for the published aggregate to be self-contained. This is the
// release guard: pack fails if any of these are missing from the produced tarball.
export const REQUIRED_BUNDLED_PATHS = [
  'node_modules/@aphotic/pi-flow-core/extensions/commands.ts',
  'node_modules/@aphotic/pi-flow-core/ideas.json',
  'node_modules/@aphotic/pi-flow-ux/extensions/index.ts',
  'node_modules/@aphotic/pi-flow-ux/themes/nord.json',
  'node_modules/@aphotic/pi-flow-ux/tui.json',
  'node_modules/@aphotic/pi-ideas/extensions/idea.ts',
  // pi-ideas's runtime dependency must travel with the bundle so the idea tool
  // (loaded via pi-flow-core) resolves without a separate install.
  'node_modules/@aphotic/pi-ideas/node_modules/typebox/package.json',
  'node_modules/@aphotic/pi-release/skills/release/SKILL.md',
];

export const EXPECTED_SKILL_NAMES = [
  'commit',
  'define-spec',
  'execute-plan',
  'fastlane',
  'finishing-a-development-branch',
  'generate-plan',
  'receiving-code-review',
  'refine-code',
  'refine-plan',
  'requesting-code-review',
  'scout',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'verification-before-completion',
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (result.error) {
    throw new Error(`${cmd} ${args.join(' ')} failed to spawn: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} exited ${result.status}\n${result.stdout || ''}\n${result.stderr || ''}`,
    );
  }
  return result;
}

// Map every workspace package name -> version so workspace:* specs can be
// rewritten to exact versions in the staged manifests.
function buildVersionIndex() {
  const index = new Map();
  for (const { name, dir } of BUNDLED_PACKAGES) {
    const pkg = readJson(resolve(PACKAGES_DIR, dir, 'package.json'));
    index.set(name, pkg.version);
  }
  // The aggregate itself, for completeness.
  index.set('@aphotic/pi-flow', readJson(resolve(PKG_DIR, 'package.json')).version);
  return index;
}

function rewriteSpec(spec, name, versionIndex) {
  if (typeof spec !== 'string' || !spec.startsWith('workspace:')) return spec;
  const version = versionIndex.get(name);
  if (!version) {
    throw new Error(`cannot rewrite workspace spec for ${name}: no known version`);
  }
  const range = spec.slice('workspace:'.length);
  if (range === '' || range === '*') return version;
  if (range === '^') return `^${version}`;
  if (range === '~') return `~${version}`;
  return range; // workspace:1.2.3 -> 1.2.3 style: trust the pinned range
}

function rewriteManifestSpecs(pkg, versionIndex) {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const block = pkg[field];
    if (!block) continue;
    for (const dep of Object.keys(block)) {
      block[dep] = rewriteSpec(block[dep], dep, versionIndex);
    }
  }
  return pkg;
}

// Resolve a runtime dependency's installed directory in the workspace so it can
// be copied into a bundled subpackage's node_modules. Prefers the subpackage's
// own node_modules, then falls back to the workspace root.
function resolveDependencyDir(subpackageDir, depName) {
  const candidates = [
    resolve(PACKAGES_DIR, subpackageDir, 'node_modules', depName),
    resolve(WORKSPACE_ROOT, 'node_modules', depName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  return null;
}

function stageOwnFiles(stageDir, versionIndex) {
  const pkg = readJson(resolve(PKG_DIR, 'package.json'));
  // Rewrite workspace:* deps to exact versions; keep bundledDependencies as-is.
  rewriteManifestSpecs(pkg, versionIndex);
  writeFileSync(join(stageDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // Copy the aggregate's own published files: its `files` globs plus the files
  // npm always includes (README, LICENSE). package.json is written above.
  const ownEntries = new Set([...(pkg.files || []), 'README.md', 'LICENSE']);
  for (const entry of ownEntries) {
    const src = resolve(PKG_DIR, entry);
    if (!existsSync(src)) continue;
    cpSync(src, join(stageDir, entry), { recursive: true });
  }
  return pkg;
}

function stageSubpackage(stageDir, sub, versionIndex, tmpRoot, npmPackEnv) {
  const sourceDir = resolve(PACKAGES_DIR, sub.dir);
  const sourcePkg = readJson(resolve(sourceDir, 'package.json'));

  // `npm pack` respects the subpackage's `files`/ignore rules, giving the exact
  // publishable file set without symlinks or stray workspace artifacts.
  const packDest = mkdtempSync(join(tmpRoot, 'sub-'));
  const packed = run(
    'npm',
    ['pack', sourceDir, '--ignore-scripts', '--pack-destination', packDest, '--json'],
    { cwd: tmpRoot, env: npmPackEnv },
  );
  const tarball = resolve(packDest, JSON.parse(packed.stdout)[0].filename);

  const extractDir = mkdtempSync(join(tmpRoot, 'extract-'));
  run('tar', ['-xzf', tarball, '-C', extractDir]);

  const destDir = join(stageDir, 'node_modules', sub.name);
  mkdirSync(dirname(destDir), { recursive: true });
  cpSync(join(extractDir, 'package'), destDir, { recursive: true });

  // Rewrite the staged subpackage manifest: workspace:* -> exact version.
  const stagedPkgPath = join(destDir, 'package.json');
  const stagedPkg = readJson(stagedPkgPath);
  rewriteManifestSpecs(stagedPkg, versionIndex);
  writeFileSync(stagedPkgPath, JSON.stringify(stagedPkg, null, 2) + '\n');

  // Materialize this subpackage's non-bundled runtime dependencies into its own
  // node_modules so the bundle is self-contained (e.g. pi-ideas -> typebox).
  const bundledNames = new Set(BUNDLED_PACKAGES.map(p => p.name));
  for (const depName of Object.keys(sourcePkg.dependencies || {})) {
    if (bundledNames.has(depName)) continue; // sibling bundled at aggregate root
    const depDir = resolveDependencyDir(sub.dir, depName);
    if (!depDir) {
      throw new Error(
        `runtime dependency ${depName} of ${sub.name} is not installed in the workspace; ` +
          `cannot bundle a self-contained aggregate. Run pnpm install first.`,
      );
    }
    cpSync(depDir, join(destDir, 'node_modules', depName), {
      recursive: true,
      dereference: true,
    });
  }

  rmSync(packDest, { recursive: true, force: true });
  rmSync(extractDir, { recursive: true, force: true });
}

function listTarballEntriesRaw(tarball) {
  const result = run('tar', ['-tzf', tarball]);
  return result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function listTarballEntries(tarball) {
  // npm tarballs prefix every entry with `package/`.
  return listTarballEntriesRaw(tarball)
    .map(line => (line.startsWith('package/') ? line.slice('package/'.length) : line))
    .filter(Boolean);
}

// Verbose listing yields one line per archive member in the same order as the
// plain `-tzf` listing. The first character of each mode string encodes the
// entry type ('l' for a symlink, 'd' for a directory, '-' for a regular file).
function listTarballEntryTypes(tarball) {
  const result = run('tar', ['-tzvf', tarball]);
  return result.stdout
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => line.trimStart()[0]);
}

// Classify tarball members that would make the published aggregate unsafe to
// extract: symlink entries (which can resolve outside the bundle), members not
// rooted at `package/` (npm always prefixes `package/`), and any member with a
// `..` path segment (path traversal on extract). `typeChars[i]` is the tar mode
// type character for member `names[i]` (see listTarballEntryTypes).
export function classifyUnsafeEntries(names, typeChars = []) {
  const symlinks = [];
  const outside = [];
  const traversal = [];
  names.forEach((name, i) => {
    if (name.split('/').includes('..')) traversal.push(name);
    if (!(name === 'package' || name === 'package/' || name.startsWith('package/'))) {
      outside.push(name);
    }
    if ((typeChars[i] || '') === 'l') symlinks.push(name);
  });
  return { symlinks, outside, traversal };
}

// Defense-in-depth on the produced tarball: a self-contained npm aggregate must
// contain only regular files/directories rooted at `package/`. Reject anything
// that could dereference or escape the bundle on extract.
function assertTarballSafety(tarball) {
  const names = listTarballEntriesRaw(tarball);
  const typeChars = listTarballEntryTypes(tarball);
  const { symlinks, outside, traversal } = classifyUnsafeEntries(names, typeChars);
  if (symlinks.length || outside.length || traversal.length) {
    throw new Error(
      'Aggregate release guard failed: the produced tarball contains unsafe entries.\n' +
        (symlinks.length ? `Symlink entries:\n  ${symlinks.join('\n  ')}\n` : '') +
        (outside.length ? `Entries outside package/:\n  ${outside.join('\n  ')}\n` : '') +
        (traversal.length ? `Entries with '..' path segments:\n  ${traversal.join('\n  ')}\n` : ''),
    );
  }
}

function assertReleaseGuard(tarball) {
  assertTarballSafety(tarball);
  const entries = new Set(listTarballEntries(tarball));
  const missing = REQUIRED_BUNDLED_PATHS.filter(p => !entries.has(p));

  const skillEntries = [...entries].filter(
    p => p.startsWith('node_modules/@aphotic/pi-flow-core/skills/') && p.endsWith('/SKILL.md'),
  );
  const foundSkills = skillEntries
    .map(p => p.split('/').at(-2))
    .sort();
  const missingSkills = EXPECTED_SKILL_NAMES.filter(name => !foundSkills.includes(name));

  if (missing.length || missingSkills.length) {
    throw new Error(
      'Aggregate release guard failed: the produced tarball is missing required bundled resources.\n' +
        (missing.length ? `Missing files:\n  ${missing.join('\n  ')}\n` : '') +
        (missingSkills.length ? `Missing skills:\n  ${missingSkills.join('\n  ')}\n` : ''),
    );
  }
}

// Build the staged, self-contained aggregate tarball. Returns
// { tarball, stageDir } (stageDir is null when cleaned up).
export function buildAggregateTarball({ outDir, keepStage = false } = {}) {
  const versionIndex = buildVersionIndex();
  const tmpRoot = mkdtempSync(join(tmpdir(), 'pi-flow-pack-'));
  const stageDir = join(tmpRoot, 'stage');
  const npmCacheDir = join(tmpRoot, 'npm-cache');
  mkdirSync(stageDir, { recursive: true });
  mkdirSync(npmCacheDir, { recursive: true });
  const npmPackEnv = { ...process.env, npm_config_cache: npmCacheDir };

  try {
    stageOwnFiles(stageDir, versionIndex);
    for (const sub of BUNDLED_PACKAGES) {
      stageSubpackage(stageDir, sub, versionIndex, tmpRoot, npmPackEnv);
    }

    const destination = outDir ? resolve(outDir) : mkdtempSync(join(tmpdir(), 'pi-flow-tgz-'));
    mkdirSync(destination, { recursive: true });
    const packed = run(
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', destination, '--json'],
      { cwd: stageDir, env: npmPackEnv },
    );
    const tarball = resolve(destination, JSON.parse(packed.stdout)[0].filename);

    assertReleaseGuard(tarball);

    if (keepStage) {
      return { tarball, stageDir };
    }
    return { tarball, stageDir: null };
  } finally {
    if (!keepStage) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

function parseArgs(argv) {
  // Known flags are consumed wherever they appear. A bare `--` (which pnpm
  // injects ahead of forwarded args) is ignored as a separator. Any remaining
  // unrecognized token is forwarded verbatim to `npm publish` (e.g. --dry-run,
  // --tag next), so `pnpm run publish:aggregate -- --dry-run` works as expected.
  const opts = { publish: false, keepStage: false, outDir: undefined, publishArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--publish') opts.publish = true;
    else if (arg === '--keep-stage') opts.keepStage = true;
    else if (arg === '--out') opts.outDir = argv[++i];
    else if (arg === '--') continue;
    else opts.publishArgs.push(arg);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  // For publish we always keep the (verified) tarball; stage cleanup is fine.
  const { tarball, stageDir } = buildAggregateTarball({
    outDir: opts.outDir,
    keepStage: opts.keepStage,
  });

  if (opts.publish) {
    // Publish the exact, release-guarded tarball.
    run('npm', ['publish', tarball, ...opts.publishArgs], { stdio: 'inherit' });
  }

  process.stdout.write(JSON.stringify({ tarball, stageDir: stageDir ?? null }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
    process.exit(1);
  }
}
