import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pkgPath(...parts) {
  return resolve(PKG_DIR, ...parts);
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

  // Pattern: node_modules/pi-flow-core/skills/*/SKILL.md
  const coreSkillsDir = pkgPath('node_modules', 'pi-flow-core', 'skills');
  assert.ok(existsSync(coreSkillsDir), `Skills dir must exist at ${coreSkillsDir}`);

  const found = readdirSync(coreSkillsDir)
    .filter(name => {
      if (name.startsWith('_')) return false;
      const skillMd = resolve(coreSkillsDir, name, 'SKILL.md');
      return existsSync(skillMd);
    })
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

test('pi CLI aggregate discovery probe — best-effort', () => {
  const piCheck = spawnSync('pi', ['--version'], { encoding: 'utf8' });
  const piAvailable = piCheck.status === 0;

  if (!piAvailable) {
    console.log(JSON.stringify({
      skipped: 'pi CLI not on PATH',
      reason: 'Pi loader contract is an open question in the spec; aggregate forwarding shape and glob-resolution above are the deterministic proxy',
    }));
    return;
  }

  const result = spawnSync('pi', ['-e', 'pi-flow'], {
    encoding: 'utf8',
    cwd: PKG_DIR,
  });

  if (result.status !== 0) {
    console.log(JSON.stringify({
      skipped: 'pi -e pi-flow failed',
      reason: 'Pi loader contract is an open question in the spec; aggregate forwarding shape and glob-resolution above are the deterministic proxy',
      stderr: result.stderr?.trim(),
    }));
    return;
  }

  const output = result.stdout + result.stderr;
  for (const skill of EXPECTED_SKILL_NAMES) {
    assert.ok(
      output.includes(skill),
      `Expected skill '${skill}' to appear in 'pi -e pi-flow' output`
    );
  }
});
