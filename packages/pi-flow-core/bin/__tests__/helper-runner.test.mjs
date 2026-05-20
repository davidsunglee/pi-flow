import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, statSync, rmSync } from 'node:fs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = resolve(PACKAGE_ROOT, 'bin/pi-flow.mjs');

const SPAWN_ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };

function cleanupPycache(root) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    const full = resolve(root, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    if (entry === '__pycache__') {
      rmSync(full, { recursive: true, force: true });
    } else {
      cleanupPycache(full);
    }
  }
}

const FIXTURE_MODEL_TIERS = resolve(
  PACKAGE_ROOT,
  'skills/_shared/scripts/tests/fixtures/model-tiers-complete.json'
);
const FIXTURE_PLAN = resolve(
  PACKAGE_ROOT,
  'skills/execute-plan/scripts/tests/fixtures/plan-clean.md'
);

function run(...args) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: SPAWN_ENV });
}

test('helper-runner', (t) => {
  t.before(() => cleanupPycache(resolve(PACKAGE_ROOT, 'skills')));
  t.after(() => cleanupPycache(resolve(PACKAGE_ROOT, 'skills')));

  t.test('helper resolves known shared script and forwards exit code', () => {
    const r = run(
      'helper', '_shared/resolve-model-dispatch',
      '--tier', 'nosuchtier',
      '--agent', 'test',
      '--model-tiers', FIXTURE_MODEL_TIERS
    );
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('model-tiers.json has no usable "nosuchtier" model'));
  });

  t.test('helper resolves known per-skill script', () => {
    const r = run('helper', 'execute-plan/extract-plan-tasks', '--plan', FIXTURE_PLAN);
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.tasks));
  });

  t.test('helper rejects unknown shared id', () => {
    const r = run('helper', '_shared/does-not-exist');
    assert.equal(r.status, 2);
    const json = JSON.parse(r.stderr.trim());
    assert.equal(json.failure, 'unknown helper');
    assert.equal(json.id, '_shared/does-not-exist');
  });

  t.test('helper rejects unknown per-skill id', () => {
    const r = run('helper', 'fastlane/does-not-exist');
    assert.equal(r.status, 2);
    const json = JSON.parse(r.stderr.trim());
    assert.equal(json.failure, 'unknown helper');
  });

  t.test('helper rejects malformed id with no slash', () => {
    const r = run('helper', 'just-a-name');
    assert.equal(r.status, 2);
    const json = JSON.parse(r.stderr.trim());
    assert.ok(json.failure); // malformed id → invalid resource id
    assert.equal(json.id, 'just-a-name');
  });

  t.test('helper rejects id with .. traversal', () => {
    const r = run('helper', '../etc/passwd');
    assert.equal(r.status, 2);
    const json = JSON.parse(r.stderr.trim());
    assert.ok(json.failure); // traversal-rejection → invalid resource id
  });

  t.test('helper rejects id with absolute path segment', () => {
    const r = run('helper', '/etc/passwd');
    assert.equal(r.status, 2);
    const json = JSON.parse(r.stderr.trim());
    assert.ok(json.failure);
  });

  t.test('template resolves shared markdown', () => {
    const r = run('template', '_shared/test-runner-dispatch');
    assert.equal(r.status, 0);
    const resolvedPath = r.stdout.trim();
    assert.equal(
      resolvedPath,
      resolve(PACKAGE_ROOT, 'skills/_shared/test-runner-dispatch.md')
    );
    assert.ok(existsSync(resolvedPath));
  });

  t.test('template resolves per-skill markdown', () => {
    const r = run('template', 'fastlane/fastlane-coder-prompt');
    assert.equal(r.status, 0);
    const resolvedPath = r.stdout.trim();
    assert.equal(
      resolvedPath,
      resolve(PACKAGE_ROOT, 'skills/fastlane/fastlane-coder-prompt.md')
    );
  });

  t.test('template rejects unknown id', () => {
    const r = run('template', 'fastlane/does-not-exist');
    assert.equal(r.status, 2);
    const json = JSON.parse(r.stderr.trim());
    assert.equal(json.failure, 'unknown template');
  });

  t.test('help command exits zero and prints both subcommand names', () => {
    const r = run('--help');
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('helper'));
    assert.ok(r.stdout.includes('template'));
  });

  t.test('unknown subcommand exits non-zero', () => {
    const r = run('frobnicate');
    assert.equal(r.status, 2);
    assert.ok(r.stderr.length > 0); // stderr usage hint
  });

  t.test('helper invocation writes no __pycache__ under skills/ even when caller env lacks PYTHONDONTWRITEBYTECODE', () => {
    cleanupPycache(resolve(PACKAGE_ROOT, 'skills'));
    const callerEnv = { ...process.env };
    delete callerEnv.PYTHONDONTWRITEBYTECODE;
    const r = spawnSync(
      'node',
      [CLI, 'helper', 'execute-plan/extract-plan-tasks', '--plan', FIXTURE_PLAN],
      { encoding: 'utf8', env: callerEnv }
    );
    assert.equal(r.status, 0, `helper must succeed: ${r.stderr}`);
    function findPycache(dir) {
      const results = [];
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        let stat;
        try { stat = statSync(full); } catch { continue; }
        if (!stat.isDirectory()) continue;
        if (entry === '__pycache__') results.push(full);
        else results.push(...findPycache(full));
      }
      return results;
    }
    const found = findPycache(resolve(PACKAGE_ROOT, 'skills'));
    assert.deepEqual(
      found,
      [],
      `pi-flow helper must not leave __pycache__ artifacts; found: ${found.join(', ')}`
    );
  });
});
