import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildAggregateTarball, REQUIRED_BUNDLED_PATHS } from '../scripts/pack-aggregate.mjs';

// End-to-end proof that a fresh consumer install of the published aggregate
// tarball is self-contained: the bundled subpackage resources land under
// node_modules/@aphotic/pi-flow/node_modules/@aphotic/..., and Pi can load the
// installed package without extension load failures.
//
// Uses `npm install <tarball> --offline` so the assertion is hermetic: a fully
// self-contained bundle needs no registry access. `--legacy-peer-deps` keeps npm
// from trying to auto-install the Pi runtime peer dependencies.

let tarball;
let tmpRoot;
let consumerDir;
let installedPkgDir;
let install;
let npmAvailable = false;
let previousNpmConfigCache;

before(() => {
  const npmProbe = spawnSync('npm', ['--version'], { encoding: 'utf8' });
  npmAvailable = !npmProbe.error && npmProbe.status === 0;
  // Building the tarball runs `npm pack`; without npm there is nothing to install
  // and the tests below skip explicitly rather than erroring in this hook.
  if (!npmAvailable) return;

  previousNpmConfigCache = process.env.npm_config_cache;
  process.env.npm_config_cache = '/dev/null';

  ({ tarball } = buildAggregateTarball());

  tmpRoot = mkdtempSync(join(tmpdir(), 'pi-flow-smoke-'));
  consumerDir = join(tmpRoot, 'consumer');
  const npmCacheDir = join(tmpRoot, 'npm-cache');
  mkdirSync(consumerDir, { recursive: true });
  mkdirSync(npmCacheDir, { recursive: true });
  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'pi-flow-aggregate-consumer', version: '0.0.0', private: true }) + '\n',
  );

  install = spawnSync(
    'npm',
    ['install', tarball, '--offline', '--legacy-peer-deps', '--no-audit', '--no-fund'],
    {
      cwd: consumerDir,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: npmCacheDir },
    },
  );
  installedPkgDir = join(consumerDir, 'node_modules', '@aphotic', 'pi-flow');
});

after(() => {
  if (previousNpmConfigCache === undefined) delete process.env.npm_config_cache;
  else process.env.npm_config_cache = previousNpmConfigCache;
  if (tarball) rmSync(dirname(tarball), { recursive: true, force: true });
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

test('fresh install bundles the nested subpackage resources under the aggregate', (t) => {
  if (!npmAvailable) {
    t.skip('npm not available; cannot build or install the aggregate tarball');
    return;
  }
  assert.equal(
    install.status,
    0,
    `npm install ${tarball} must exit 0; status=${install.status}, stderr=${(install.stderr || '').slice(0, 800)}`,
  );
  assert.ok(existsSync(installedPkgDir), `installed aggregate dir must exist: ${installedPkgDir}`);

  for (const rel of REQUIRED_BUNDLED_PATHS) {
    const full = join(installedPkgDir, rel);
    assert.ok(
      existsSync(full),
      `fresh install must contain bundled resource node_modules/@aphotic/pi-flow/${rel} (looked at ${full})`,
    );
  }
});

test('pi can load the installed aggregate package without extension load failures', (t) => {
  if (!npmAvailable) {
    t.skip('npm not available; cannot build or install the aggregate tarball for the pi load probe');
    return;
  }
  assert.equal(install.status, 0, 'install must have succeeded for the pi load probe');

  const versionCheck = spawnSync('pi', ['--version'], { encoding: 'utf8' });
  const piAvailable =
    !versionCheck.error &&
    versionCheck.status === 0 &&
    ((versionCheck.stdout || '').trim().length > 0 || (versionCheck.stderr || '').trim().length > 0);

  if (!piAvailable) {
    t.skip(
      'pi CLI not available (pi --version did not exit 0); the install-shape assertions above are the deterministic proxy',
    );
    return;
  }

  const probe = spawnSync('pi', ['-e', installedPkgDir, '--help'], { encoding: 'utf8' });
  assert.equal(
    probe.status,
    0,
    `pi -e ${installedPkgDir} --help must exit 0; status=${probe.status}, stderr=${(probe.stderr || '').slice(0, 800)}`,
  );
  const combined = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  assert.equal(
    /Failed to load extension/i.test(combined),
    false,
    `pi -e ${installedPkgDir} --help reported a load failure: ${combined.slice(0, 800)}`,
  );
});
