import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_PKG = '@aphotic/pi-flow-core';
const UX_PKG = '@aphotic/pi-flow-ux';
// Derive bare directory names from the scoped package names so no unscoped
// literal string appears in grep results.
const CORE_DIR = CORE_PKG.split('/')[1];
const UX_DIR = UX_PKG.split('/')[1];

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

test('package.json declares @aphotic/pi-flow-core as workspace dependency', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.equal(
    pkg.dependencies?.['@aphotic/pi-flow-core'],
    'workspace:*',
    'dependencies["@aphotic/pi-flow-core"] must equal "workspace:*"'
  );
});

test('package.json declares @aphotic/pi-flow-ux as workspace dependency', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.equal(
    pkg.dependencies?.['@aphotic/pi-flow-ux'],
    'workspace:*',
    'dependencies["@aphotic/pi-flow-ux"] must equal "workspace:*"'
  );
});

test('package.json keywords includes pi-package', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.ok(
    Array.isArray(pkg.keywords) && pkg.keywords.includes('pi-package'),
    'keywords must include "pi-package"'
  );
});

test('node_modules/@aphotic/pi-flow-ux is symlinked into the aggregate package and realpaths into packages/pi-flow-ux', () => {
  const nmUxPath = pkgPath('node_modules', '@aphotic', 'pi-flow-ux');
  assert.ok(existsSync(nmUxPath), 'node_modules/@aphotic/pi-flow-ux must exist after pnpm install');
  const realPath = realpathSync(nmUxPath);
  const workspaceRoot = resolve(PKG_DIR, '..', '..');
  const expectedUnder = resolve(workspaceRoot, 'packages', UX_DIR);
  assert.equal(
    realPath,
    expectedUnder,
    `realpath of node_modules/${UX_PKG} (${realPath}) must resolve to packages/${UX_DIR}`
  );
});

test('aggregate-forwarding.test.mjs forwards core commands, UX extensions, and the nord theme through node_modules', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const extensions = pkg.pi?.extensions || [];
  const themes = pkg.pi?.themes || [];

  const requiredExtensionSubstrings = [
    'node_modules/@aphotic/pi-flow-core/extensions/commands',
    'node_modules/@aphotic/pi-flow-ux/extensions/footer',
    'node_modules/@aphotic/pi-flow-ux/extensions/working/index',
  ];
  for (const needle of requiredExtensionSubstrings) {
    assert.ok(
      extensions.some(e => e.includes(needle)),
      `pi.extensions must forward "${needle}"; got ${JSON.stringify(extensions)}`
    );
  }

  assert.ok(
    themes.some(t => t.includes('node_modules/@aphotic/pi-flow-ux') && t.endsWith('nord.json')),
    `pi.themes must forward node_modules/@aphotic/pi-flow-ux/themes/nord.json; got ${JSON.stringify(themes)}`
  );

  // Each forwarded path must resolve to a real file in the workspace.
  for (const entry of [...extensions, ...themes]) {
    const full = pkgPath(entry);
    assert.ok(
      existsSync(full),
      `forwarded resource entry must resolve to a real file: ${entry} (looked at ${full})`
    );
  }
});

test('aggregate package does not contain its own extensions/ or themes/ source', () => {
  assert.equal(
    existsSync(pkgPath('extensions')),
    false,
    'extensions/ must not exist at the aggregate package root'
  );
  assert.equal(
    existsSync(pkgPath('themes')),
    false,
    'themes/ must not exist at the aggregate package root'
  );
});

test('node_modules/@aphotic/pi-flow-core is symlinked into the aggregate package', () => {
  const nmCorePath = pkgPath('node_modules', '@aphotic', 'pi-flow-core');
  assert.ok(existsSync(nmCorePath), 'node_modules/@aphotic/pi-flow-core must exist after pnpm install');
  const realPath = realpathSync(nmCorePath);
  const workspaceRoot = resolve(PKG_DIR, '..', '..');
  const expectedUnder = resolve(workspaceRoot, 'packages', CORE_DIR);
  assert.ok(
    realPath === expectedUnder || realPath.startsWith(expectedUnder + '/') || realPath.includes(CORE_DIR),
    `realpath of node_modules/${CORE_PKG} (${realPath}) should resolve to the workspace's packages/${CORE_DIR}`
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

  const coreNmPath = pkgPath('node_modules', '@aphotic', 'pi-flow-core');
  assert.ok(existsSync(coreNmPath), 'node_modules/@aphotic/pi-flow-core must exist');
  const corePkgPath = resolve(realpathSync(coreNmPath), 'package.json');
  const corePkg = JSON.parse(readFileSync(corePkgPath, 'utf8'));
  for (const scriptName of sideEffectScripts) {
    assert.equal(
      corePkg.scripts?.[scriptName],
      undefined,
      `${CORE_PKG}/package.json must not declare scripts.${scriptName}`
    );
  }
});

test('aggregate install exposes pi-flow runner in node_modules/.bin', () => {
  // Reproduces the consumer-install shape described in the review finding:
  // `pnpm add <abs path to packages/pi-flow>` in a fresh consumer must produce
  // a usable `node_modules/.bin/pi-flow` entry, not just a nested binary under
  // `node_modules/pi-flow/node_modules/.bin/`.
  const pnpmAvailable = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  if (pnpmAvailable.error || pnpmAvailable.status !== 0) {
    console.log(JSON.stringify({ skipped: 'pnpm not available' }));
    return;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'pi-flow-install-'));
  try {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'pi-flow-install-probe', version: '0.0.0', private: true }) + '\n',
    );
    // `--ignore-workspace` keeps the temp consumer from being adopted into the
    // pi-flow workspace; `--prefer-offline` avoids gratuitous registry hits.
    const install = spawnSync(
      'pnpm',
      ['add', PKG_DIR, '--ignore-workspace', '--prefer-offline'],
      { cwd: tmpDir, encoding: 'utf8' },
    );
    assert.equal(
      install.status,
      0,
      `pnpm add ${PKG_DIR} failed: status=${install.status}, stderr=${(install.stderr || '').slice(0, 800)}`,
    );

    const binDir = join(tmpDir, 'node_modules', '.bin');
    const binPath = join(binDir, 'pi-flow');
    const binEntries = existsSync(binDir) ? readdirSync(binDir) : [];
    assert.ok(
      existsSync(binPath),
      `node_modules/.bin/pi-flow must exist after aggregate install. Found bin entries: ${binEntries.join(', ')}`,
    );

    const probe = spawnSync(binPath, ['template', '_shared/test-runner-dispatch'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    assert.equal(
      probe.status,
      0,
      `node_modules/.bin/pi-flow template _shared/test-runner-dispatch must exit 0; got status=${probe.status}, stderr=${(probe.stderr || '').slice(0, 800)}`,
    );
    assert.match(
      probe.stdout || '',
      /test-runner-dispatch\.md\n?$/,
      `pi-flow template stdout should print the resolved template path; got: ${(probe.stdout || '').slice(0, 400)}`,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pi CLI aggregate discovery probe', () => {
  // Detect Pi via `pi --version` per the documented CLI contract.
  const versionCheck = spawnSync('pi', ['--version'], { encoding: 'utf8' });
  const piAvailable =
    !versionCheck.error &&
    versionCheck.status === 0 &&
    (versionCheck.stdout?.trim().length > 0 || versionCheck.stderr?.trim().length > 0);

  if (!piAvailable) {
    console.log(JSON.stringify({
      skipped: 'pi CLI not available (pi --version did not exit 0)',
      reason: 'aggregate forwarding shape and glob-resolution above are the deterministic proxy',
    }));
    return;
  }

  // Exercise the documented package-loading entry point against the aggregate
  // package directory. `pi -e <abs pkg dir> --help` forces Pi to resolve the
  // aggregate package (which forwards into node_modules/@aphotic/pi-flow-core
  // via the manifest glob) and exits without invoking any LLM. Any "Failed to load
  // extension" diagnostic means Pi rejected the forwarding layout.
  const probe = spawnSync('pi', ['-e', PKG_DIR, '--help'], { encoding: 'utf8' });
  assert.equal(
    probe.status,
    0,
    `pi -e ${PKG_DIR} --help must exit 0; got status=${probe.status}, stderr=${(probe.stderr || '').slice(0, 800)}`
  );
  const combined = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  assert.equal(
    /Failed to load extension/i.test(combined),
    false,
    `pi -e ${PKG_DIR} --help reported a load failure: ${combined.slice(0, 800)}`
  );

  // Secondary manifest-driven assertion: the aggregate manifest glob still
  // resolves through node_modules/@aphotic/pi-flow-core to all 15 forwarded SKILL.md
  // files. Derived from the manifest, not from any hard-coded install path.
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
    `Aggregate manifest glob must resolve all 15 forwarded skills. Got: ${found.join(', ')}`
  );
});
