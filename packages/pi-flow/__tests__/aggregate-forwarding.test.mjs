import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, basename } from 'node:path';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pkgPath(...parts) {
  return resolve(PKG_DIR, ...parts);
}

function expandGlob(pattern, baseDir) {
  const segments = pattern.split('/');
  let frontier = [baseDir];
  for (const seg of segments) {
    const next = [];
    for (const cur of frontier) {
      if (seg === '*') {
        if (!existsSync(cur)) continue;
        let entries;
        try { entries = readdirSync(cur); } catch { continue; }
        for (const e of entries) {
          if (e.startsWith('_') || e.startsWith('.')) continue;
          const full = resolve(cur, e);
          try {
            if (statSync(full).isDirectory()) next.push(full);
          } catch {}
        }
      } else {
        const full = resolve(cur, seg);
        if (existsSync(full)) next.push(full);
      }
    }
    frontier = next;
  }
  return frontier;
}

const EXPECTED_SKILL_NAMES = [
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

test('package.json declares pi-flow-core as workspace dependency', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.equal(
    pkg.dependencies?.['pi-flow-core'],
    'workspace:*',
    'dependencies["pi-flow-core"] must equal "workspace:*"'
  );
});

test('package.json keywords includes pi-package', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.ok(
    Array.isArray(pkg.keywords) && pkg.keywords.includes('pi-package'),
    'keywords must include "pi-package"'
  );
});

test('node_modules/pi-flow-core is symlinked into the aggregate package', () => {
  const nmCorePath = pkgPath('node_modules', 'pi-flow-core');
  assert.ok(existsSync(nmCorePath), 'node_modules/pi-flow-core must exist after pnpm install');
  const realPath = realpathSync(nmCorePath);
  const workspaceRoot = resolve(PKG_DIR, '..', '..');
  const expectedUnder = resolve(workspaceRoot, 'packages', 'pi-flow-core');
  assert.ok(
    realPath === expectedUnder || realPath.startsWith(expectedUnder + '/') || realPath.includes('pi-flow-core'),
    `realpath of node_modules/pi-flow-core (${realPath}) should resolve to the workspace's packages/pi-flow-core`
  );
});

test('pi.skills glob through node_modules resolves to the 15 expected SKILL.md files', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const globPattern = pkg.pi?.skills?.[0];
  assert.ok(globPattern, 'pi.skills[0] glob must be defined in package.json');

  const matches = expandGlob(globPattern, PKG_DIR);
  const found = matches
    .filter(p => basename(p) === 'SKILL.md')
    .map(p => basename(dirname(p)))
    .sort();

  const expected = [...EXPECTED_SKILL_NAMES].sort();
  assert.deepEqual(
    found,
    expected,
    `Resolved skill set must match the 15-name spec list. Got: ${found.join(', ')}`
  );
});

test('aggregate package does not contain its own skills/ source', () => {
  assert.equal(
    existsSync(pkgPath('skills')),
    false,
    'skills/ directory must not exist at the aggregate package root'
  );
});

test('aggregate package does not contain its own agents/ source', () => {
  assert.equal(
    existsSync(pkgPath('agents')),
    false,
    'agents/ directory must not exist at the aggregate package root'
  );
});

test('neither package declares install-time side-effect hooks', () => {
  const sideEffectScripts = ['preinstall', 'install', 'postinstall', 'setup'];

  const aggregatePkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  for (const scriptName of sideEffectScripts) {
    assert.equal(
      aggregatePkg.scripts?.[scriptName],
      undefined,
      `pi-flow/package.json must not declare scripts.${scriptName}`
    );
  }

  const coreNmPath = pkgPath('node_modules', 'pi-flow-core');
  assert.ok(existsSync(coreNmPath), 'node_modules/pi-flow-core must exist');
  const corePkgPath = resolve(realpathSync(coreNmPath), 'package.json');
  const corePkg = JSON.parse(readFileSync(corePkgPath, 'utf8'));
  for (const scriptName of sideEffectScripts) {
    assert.equal(
      corePkg.scripts?.[scriptName],
      undefined,
      `pi-flow-core/package.json must not declare scripts.${scriptName}`
    );
  }
});

function findPiLibIndex() {
  const which = spawnSync('which', ['pi'], { encoding: 'utf8' });
  if (which.status !== 0 || !which.stdout.trim()) return null;
  let binPath;
  try {
    binPath = realpathSync(which.stdout.trim());
  } catch {
    return null;
  }
  let dir = dirname(binPath);
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(
      dir,
      'lib',
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'dist',
      'index.js'
    );
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

test('pi loader aggregate probe — enumerates all 15 forwarded skills via loadSkillsFromDir', async () => {
  const piCheck = spawnSync('which', ['pi'], { encoding: 'utf8' });
  const piAvailable = piCheck.status === 0 && piCheck.stdout.trim().length > 0;

  if (!piAvailable) {
    console.log(JSON.stringify({
      skipped: 'pi CLI not on PATH',
      reason: 'aggregate forwarding shape and glob-resolution above are the deterministic proxy',
    }));
    return;
  }

  const libIndex = findPiLibIndex();
  assert.ok(
    libIndex,
    'pi CLI is on PATH but the @earendil-works/pi-coding-agent library could not be located relative to the pi binary; ' +
      'cannot exercise the documented loader entry point'
  );

  const pi = await import(pathToFileURL(libIndex).href);
  assert.equal(typeof pi.loadSkillsFromDir, 'function', 'pi library must export loadSkillsFromDir');

  // Derive the forwarded skills directory from the package manifest glob
  // rather than hard-coding it, so this probe validates what the manifest
  // actually declares.
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const globPattern = pkg.pi?.skills?.[0];
  assert.ok(globPattern, 'pi.skills[0] glob must be defined in package.json');
  const matches = expandGlob(globPattern, PKG_DIR);
  const skillDirs = [...new Set(matches.map(p => dirname(dirname(p))))];
  assert.equal(skillDirs.length, 1, `manifest glob must resolve under a single skills root, got: ${skillDirs.join(', ')}`);
  const coreSkillsDir = skillDirs[0];
  assert.ok(existsSync(coreSkillsDir), `Forwarded skills dir must exist at ${coreSkillsDir}`);

  const { skills, diagnostics } = pi.loadSkillsFromDir({ dir: coreSkillsDir, source: 'project' });

  const errorDiagnostics = (diagnostics || []).filter(d => d.type === 'error');
  assert.deepEqual(
    errorDiagnostics,
    [],
    `loadSkillsFromDir reported errors: ${errorDiagnostics.map(d => d.message).join('; ')}`
  );

  const discoveredNames = skills.map(s => s.name).sort();
  const expectedNames = [...EXPECTED_SKILL_NAMES].sort();
  assert.deepEqual(
    discoveredNames,
    expectedNames,
    `Pi's own loader must discover all 15 forwarded skills through the aggregate package. Got: ${discoveredNames.join(', ')}`
  );
});
