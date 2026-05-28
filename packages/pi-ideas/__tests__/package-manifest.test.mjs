import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pkgPath(...parts) {
  return resolve(PKG_DIR, ...parts);
}

test('package-manifest: package.json identifies @aphotic/pi-ideas as a pi-package', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.equal(pkg.name, '@aphotic/pi-ideas', 'package name must be @aphotic/pi-ideas');
  assert.equal(pkg.type, 'module', 'package type must be module');
  assert.ok(
    Array.isArray(pkg.keywords) && pkg.keywords.includes('pi-package'),
    'keywords must include "pi-package"'
  );
});

test('pi.extensions manifest lists exactly extensions/index.ts and that file exists on disk', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const entries = pkg.pi?.extensions;
  assert.ok(Array.isArray(entries), 'pi.extensions must be an array');
  assert.deepEqual(entries, ['extensions/index.ts'], 'pi.extensions must be ["extensions/index.ts"]');
  assert.ok(existsSync(pkgPath('extensions/index.ts')), 'extensions/index.ts must exist on disk');
});

test('peerDependencies cover @earendil-works/pi-coding-agent and pi-tui', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const peers = pkg.peerDependencies || {};
  for (const name of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui']) {
    assert.ok(peers[name], `peerDependencies must declare ${name}`);
  }
});

test('typebox is a runtime dependency, a peer dependency, and a dev dependency', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.ok(pkg.dependencies?.typebox, 'dependencies.typebox must be truthy');
  assert.equal(pkg.peerDependencies?.typebox, '^1.0.0', 'peerDependencies.typebox must be "^1.0.0"');
  assert.equal(pkg.devDependencies?.typebox, '^1.0.0', 'devDependencies.typebox must be "^1.0.0"');
});

test('files array ships extensions', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const files = pkg.files || [];
  assert.ok(files.includes('extensions'), 'files array must include "extensions"');
});

test('package.json declares no install-time side-effect scripts', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const sideEffectScripts = ['preinstall', 'install', 'postinstall', 'setup'];
  for (const scriptName of sideEffectScripts) {
    assert.equal(
      pkg.scripts?.[scriptName],
      undefined,
      `pi-ideas/package.json must not declare scripts.${scriptName}`
    );
  }
});
