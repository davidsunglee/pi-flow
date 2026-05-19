import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../bin/pi-flow.mjs');

function run(...args) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
}

test('--help exits 0 and mentions helper and template', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /helper/);
  assert.match(r.stdout, /template/);
});

test('-h exits 0 and mentions helper and template', () => {
  const r = run('-h');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /helper/);
  assert.match(r.stdout, /template/);
});

test('no subcommand exits 2', () => {
  const r = run();
  assert.equal(r.status, 2);
});

test('unknown subcommand exits 2', () => {
  const r = run('unknown-cmd');
  assert.equal(r.status, 2);
});

test('helper with no id exits 2 with missing resource id JSON', () => {
  const r = run('helper');
  assert.equal(r.status, 2);
  const json = JSON.parse(r.stderr.trim());
  assert.equal(json.failure, 'missing resource id');
});

test('helper with unknown id exits non-zero with unknown helper JSON', () => {
  const r = run('helper', '_shared/does-not-exist');
  assert.notEqual(r.status, 0);
  const json = JSON.parse(r.stderr.trim());
  assert.equal(json.failure, 'unknown helper');
  assert.equal(json.id, '_shared/does-not-exist');
  assert.ok(json.searched);
});

test('template with no id exits 2 with missing resource id JSON', () => {
  const r = run('template');
  assert.equal(r.status, 2);
  const json = JSON.parse(r.stderr.trim());
  assert.equal(json.failure, 'missing resource id');
});

test('template with unknown id exits non-zero with unknown template JSON', () => {
  const r = run('template', 'fastlane/does-not-exist');
  assert.notEqual(r.status, 0);
  const json = JSON.parse(r.stderr.trim());
  assert.equal(json.failure, 'unknown template');
  assert.equal(json.id, 'fastlane/does-not-exist');
  assert.ok(json.searched);
});

test('helper rejects id with .. segment', () => {
  const r = run('helper', '../etc/passwd');
  assert.equal(r.status, 2);
});

test('helper rejects id with leading slash', () => {
  const r = run('helper', '/etc/passwd');
  assert.equal(r.status, 2);
});

test('template rejects id with .. segment', () => {
  const r = run('template', '../etc/passwd');
  assert.equal(r.status, 2);
});
