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
  const required = [
    'extensions/index.ts',
    'extensions/idea.ts',
    'extensions/storage.ts',
    'extensions/config.ts',
    'README.md',
    'LICENSE',
    'package.json',
  ];
  for (const req of required) {
    assert.ok(files.includes(req), `packlist must include ${req}; got: ${files.join(', ')}`);
  }
});

test('packlist excludes test files and __tests__ directories', () => {
  const files = getPacklist();
  for (const f of files) {
    assert.ok(!f.includes('/__tests__/'), `packlist must not include paths containing "/__tests__/"; found: ${f}`);
    assert.ok(!/\.test\.(mjs|ts|js)$/.test(f), `packlist must not include test files; found: ${f}`);
  }
});
