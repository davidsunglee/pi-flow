import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

const EXPECTED_ROOT_EXTENSIONS = [
  'packages/pi-flow-core/extensions/commands.ts',
  'packages/pi-flow-ux/extensions/footer.ts',
  'packages/pi-flow-ux/extensions/border-status.ts',
  'packages/pi-flow-ux/extensions/working/index.ts',
];

const EXPECTED_ROOT_THEMES = [
  'packages/pi-flow-ux/themes/nord.json',
];

function rootPath(...parts) {
  return resolve(ROOT_DIR, ...parts);
}

function readRootPackage() {
  return JSON.parse(readFileSync(rootPath('package.json'), 'utf8'));
}

function expandGlob(pattern, baseDir) {
  const segments = pattern.split('/');
  let frontier = [baseDir];
  for (const segment of segments) {
    const next = [];
    for (const current of frontier) {
      if (segment === '*') {
        if (!existsSync(current)) continue;
        let entries;
        try {
          entries = readdirSync(current);
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (entry.startsWith('.')) continue;
          const full = resolve(current, entry);
          try {
            if (statSync(full).isDirectory()) next.push(full);
          } catch {}
        }
      } else {
        const full = resolve(current, segment);
        if (existsSync(full)) next.push(full);
      }
    }
    frontier = next;
  }
  return frontier;
}

test('repo root declares a Pi package manifest for git installs', () => {
  const pkg = readRootPackage();

  assert.ok(
    Array.isArray(pkg.keywords) && pkg.keywords.includes('pi-package'),
    'root package keywords must include pi-package so Pi treats git installs as a Pi package',
  );
  assert.deepEqual(
    pkg.pi?.skills,
    ['packages/pi-flow-core/skills/*/SKILL.md'],
    'root pi.skills must point at the core skills from the git checkout root',
  );
  assert.deepEqual(
    pkg.pi?.extensions,
    EXPECTED_ROOT_EXTENSIONS,
    'root pi.extensions must forward the core commands and UX extensions from the git checkout root',
  );
  assert.deepEqual(
    pkg.pi?.themes,
    EXPECTED_ROOT_THEMES,
    'root pi.themes must forward the UX theme from the git checkout root',
  );
  assert.equal(
    pkg.bin?.['pi-flow'],
    './packages/pi-flow-core/bin/pi-flow.mjs',
    'root bin.pi-flow must expose the core helper runner from the git checkout root',
  );
});

test('root pi.skills glob resolves to the shipped workflow skills', () => {
  const pkg = readRootPackage();
  const globPattern = pkg.pi?.skills?.[0];
  assert.ok(globPattern, 'root pi.skills[0] glob must be defined');

  const found = expandGlob(globPattern, ROOT_DIR)
    .filter(path => basename(path) === 'SKILL.md')
    .map(path => basename(dirname(path)))
    .sort();

  assert.deepEqual(found, [...EXPECTED_SKILL_NAMES].sort());
});

test('root pi.extensions and pi.themes resolve to the shipped command and UX resources', () => {
  const pkg = readRootPackage();

  assert.deepEqual(pkg.pi?.extensions, EXPECTED_ROOT_EXTENSIONS);
  assert.deepEqual(pkg.pi?.themes, EXPECTED_ROOT_THEMES);

  for (const rel of [...EXPECTED_ROOT_EXTENSIONS, ...EXPECTED_ROOT_THEMES]) {
    assert.ok(existsSync(rootPath(rel)), `root pi resource must exist: ${rel}`);
  }
});

test('root pi-flow bin target exists and is executable by node', () => {
  const pkg = readRootPackage();
  const binTarget = pkg.bin?.['pi-flow'];
  assert.ok(binTarget, 'root bin.pi-flow must be defined');

  const binPath = rootPath(binTarget);
  assert.ok(existsSync(binPath), `root bin target must exist: ${binPath}`);
  assert.equal(
    readFileSync(binPath, 'utf8').split('\n')[0],
    '#!/usr/bin/env node',
    'root bin target must use the Node shebang',
  );

  const probe = spawnSync(process.execPath, [binPath, 'template', '_shared/test-runner-dispatch'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });
  assert.equal(
    probe.status,
    0,
    `root pi-flow bin target must execute; got status=${probe.status}, stderr=${(probe.stderr || '').slice(0, 800)}`,
  );
  assert.match(probe.stdout || '', /test-runner-dispatch\.md\n?$/);
});

test('pi can load the git-install package shape from the repo root', () => {
  const versionCheck = spawnSync('pi', ['--version'], { encoding: 'utf8' });
  const piAvailable =
    !versionCheck.error &&
    versionCheck.status === 0 &&
    ((versionCheck.stdout || '').trim().length > 0 || (versionCheck.stderr || '').trim().length > 0);

  if (!piAvailable) {
    console.log(JSON.stringify({
      skipped: 'pi CLI not available (pi --version did not exit 0)',
      reason: 'root manifest and glob-resolution checks above are the deterministic proxy',
    }));
    return;
  }

  const probe = spawnSync('pi', ['-e', ROOT_DIR, '--help'], { encoding: 'utf8' });
  assert.equal(
    probe.status,
    0,
    `pi -e ${ROOT_DIR} --help must exit 0; got status=${probe.status}, stderr=${(probe.stderr || '').slice(0, 800)}`,
  );
  const combined = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  assert.equal(
    /Failed to load extension/i.test(combined),
    false,
    `pi -e ${ROOT_DIR} --help reported a load failure: ${combined.slice(0, 800)}`,
  );
});
