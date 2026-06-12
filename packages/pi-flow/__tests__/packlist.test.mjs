import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

import {
  buildAggregateTarball,
  classifyUnsafeEntries,
  REQUIRED_BUNDLED_PATHS,
  EXPECTED_SKILL_NAMES,
} from '../scripts/pack-aggregate.mjs';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The aggregate publishes a self-contained tarball via the pack-aggregate helper
// (NOT `pnpm pack`, which fails on bundledDependencies under the isolated linker).
// These tests assert the *published artifact* shape, not workspace symlinks.
let tarball;
let entries;

before(() => {
  ({ tarball } = buildAggregateTarball());
  const list = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
  assert.equal(list.status, 0, `tar -tzf failed: ${list.stderr}`);
  entries = list.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => (line.startsWith('package/') ? line.slice('package/'.length) : line))
    .filter(Boolean);
});

after(() => {
  if (tarball) rmSync(dirname(tarball), { recursive: true, force: true });
});

test('tarball includes the aggregate own files', () => {
  for (const req of ['bin/pi-flow.mjs', 'package.json', 'LICENSE']) {
    assert.ok(entries.includes(req), `tarball must include ${req}; got: ${entries.join(', ')}`);
  }
});

test('tarball bundles the required nested subpackage resources', () => {
  for (const req of REQUIRED_BUNDLED_PATHS) {
    assert.ok(
      entries.includes(req),
      `tarball must bundle ${req}; this is what makes the aggregate self-contained`,
    );
  }
});

test('tarball bundles all 15 core workflow skills', () => {
  const found = entries
    .filter(p => p.startsWith('node_modules/@aphotic/pi-flow-core/skills/') && p.endsWith('/SKILL.md'))
    .map(p => p.split('/').at(-2))
    .sort();
  assert.deepEqual(
    found,
    [...EXPECTED_SKILL_NAMES].sort(),
    `bundled skill set must match the 15-name spec list. Got: ${found.join(', ')}`,
  );
});

test('tarball is NOT a thin shell of only bin/README/LICENSE/package.json', () => {
  // Regression guard for the original bug: an aggregate that shipped only its own
  // bin/README/LICENSE/package.json with no bundled subpackages. The presence of
  // bundled node_modules/@aphotic/* resources is mandatory.
  const thinShell = new Set(['bin/pi-flow.mjs', 'README.md', 'LICENSE', 'package.json']);
  const extras = entries.filter(p => !thinShell.has(p));
  assert.ok(
    extras.length > 0,
    'tarball must contain more than bin/README/LICENSE/package.json',
  );
  const bundled = entries.filter(p => p.startsWith('node_modules/@aphotic/'));
  assert.ok(
    bundled.length > 0,
    'tarball must contain bundled node_modules/@aphotic/* resources, not just the thin shell',
  );
});

test('tarball excludes test and build artifacts from bundled subpackages', () => {
  for (const f of entries) {
    assert.ok(
      !/\.test\.(ts|mjs|js)$/.test(f),
      `tarball must not include test files; found: ${f}`,
    );
    assert.ok(!f.includes('/__tests__/'), `tarball must not include __tests__ paths; found: ${f}`);
    assert.ok(!f.endsWith('.gitkeep'), `tarball must not include .gitkeep files; found: ${f}`);
  }
});

test('packed aggregate manifest declares bundledDependencies and pins exact versions', () => {
  const show = spawnSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' });
  assert.equal(show.status, 0, `tar -xzOf package.json failed: ${show.stderr}`);
  const pkg = JSON.parse(show.stdout);

  for (const name of ['@aphotic/pi-flow-core', '@aphotic/pi-flow-ux', '@aphotic/pi-ideas']) {
    assert.ok(
      Array.isArray(pkg.bundledDependencies) && pkg.bundledDependencies.includes(name),
      `packed bundledDependencies must include ${name}`,
    );
    assert.match(
      pkg.dependencies?.[name] ?? '',
      /^\d+\.\d+\.\d+/,
      `packed dependencies["${name}"] must be a pinned version, not a workspace spec`,
    );
  }
});

test('aggregate manifest does not register pi-ideas standalone extension index', () => {
  // ideas is wired through pi-flow-core only; registering pi-ideas/extensions/index.ts
  // here would duplicate the idea tool/browser.
  const show = spawnSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' });
  assert.equal(show.status, 0, `tar -xzOf package.json failed: ${show.stderr}`);
  const pkg = JSON.parse(show.stdout);
  const extensions = pkg.pi?.extensions || [];
  for (const entry of extensions) {
    assert.ok(
      !entry.includes('pi-ideas/extensions/index'),
      `aggregate pi.extensions must not register pi-ideas standalone index; found: ${entry}`,
    );
  }
});

test('pnpm pack is documented as unusable for the aggregate (bundledDependencies present)', () => {
  // Asserts the helper is required: `pnpm pack` rejects bundledDependencies under
  // the isolated linker, so the deterministic staging helper is the release path.
  const pkg = JSON.parse(
    spawnSync('cat', [resolve(PKG_DIR, 'package.json')], { encoding: 'utf8' }).stdout,
  );
  assert.equal(
    pkg.scripts?.['pack:aggregate'],
    'node scripts/pack-aggregate.mjs',
    'package.json must expose a pack:aggregate release script',
  );
  assert.ok(
    Array.isArray(pkg.bundledDependencies) && pkg.bundledDependencies.length === 4,
    'source package.json must declare the four bundledDependencies',
  );
});

test('release guard flags unsafe tarball entries (symlink, outside package/, .. traversal)', () => {
  const names = [
    'package/',
    'package/package.json',
    'package/node_modules/@aphotic/pi-flow-core/extensions/commands.ts',
    'package/badlink',
    'package/../escape.txt',
    'outside.txt',
  ];
  const typeChars = ['d', '-', '-', 'l', '-', '-'];
  const { symlinks, outside, traversal } = classifyUnsafeEntries(names, typeChars);
  assert.deepEqual(symlinks, ['package/badlink'], 'symlink members must be flagged');
  assert.deepEqual(traversal, ['package/../escape.txt'], "members with a '..' segment must be flagged");
  assert.ok(outside.includes('outside.txt'), 'members not rooted at package/ must be flagged');
});

test('release guard accepts a clean bundled entry set', () => {
  const names = [
    'package/',
    'package/package.json',
    'package/node_modules/@aphotic/pi-ideas/extensions/idea.ts',
  ];
  const typeChars = ['d', '-', '-'];
  const { symlinks, outside, traversal } = classifyUnsafeEntries(names, typeChars);
  assert.equal(symlinks.length, 0, 'no symlink members expected');
  assert.equal(outside.length, 0, 'all members rooted at package/');
  assert.equal(traversal.length, 0, "no '..' segments expected");
});
