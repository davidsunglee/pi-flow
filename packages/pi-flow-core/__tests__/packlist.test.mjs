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
  const required = ['bin/pi-flow.mjs', 'package.json', 'LICENSE', 'model-tiers.example.json'];
  for (const req of required) {
    assert.ok(files.includes(req), `packlist must include ${req}; got: ${files.join(', ')}`);
  }
  assert.ok(
    files.some(f => /^skills\/[^/]+\/SKILL\.md$/.test(f)),
    `packlist must include at least one skills/*/SKILL.md path`
  );
  assert.ok(files.includes('extensions/commands.ts'), `packlist must include extensions/commands.ts`);
});

test('packlist excludes test and build artifacts', () => {
  const files = getPacklist();
  for (const f of files) {
    assert.ok(!f.includes('/tests/'), `packlist must not include paths containing "/tests/"; found: ${f}`);
    assert.ok(!f.includes('/fixtures/'), `packlist must not include paths containing "/fixtures/"; found: ${f}`);
    assert.ok(!f.includes('/__pycache__/'), `packlist must not include paths containing "/__pycache__/"; found: ${f}`);
    assert.ok(!f.endsWith('.gitkeep'), `packlist must not include .gitkeep files; found: ${f}`);
    assert.ok(!f.endsWith('__init__.py'), `packlist must not include __init__.py files; found: ${f}`);
  }
});
