import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function getPacklist() {
  const result = spawnSync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: PKG_DIR,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `pnpm pack --dry-run --json failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  return parsed.files.map(f => f.path);
}

test('packlist includes required files', () => {
  const files = getPacklist();
  const required = ['bin/pi-flow.mjs', 'package.json', 'LICENSE'];
  for (const req of required) {
    assert.ok(files.includes(req), `packlist must include ${req}; got: ${files.join(', ')}`);
  }
});

test('packlist excludes test and build artifacts', () => {
  const files = getPacklist();
  const forbidden = ['tests/', 'fixtures/', '__pycache__/', 'node_modules/'];
  for (const f of files) {
    for (const bad of forbidden) {
      assert.ok(!f.includes(bad), `packlist must not include paths containing "${bad}"; found: ${f}`);
    }
    assert.ok(!f.endsWith('.gitkeep'), `packlist must not include .gitkeep files; found: ${f}`);
  }
});
