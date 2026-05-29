import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pkgPath(...parts) {
  return resolve(PKG_DIR, ...parts);
}

function readManifest() {
  return JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
}

async function loadResources() {
  // Isolate cwd and agentDir so the Pi loader does not pull in this developer's
  // ~/.pi/agent extensions or any project-local .pi directory.
  const sandbox = mkdtempSync(join(tmpdir(), 'pi-flow-ux-loader-'));
  const pkg = readManifest();
  const extPaths = (pkg.pi?.extensions || []).map(rel => pkgPath(rel));
  const themePaths = (pkg.pi?.themes || []).map(rel => pkgPath(rel));

  const loader = new DefaultResourceLoader({
    cwd: sandbox,
    agentDir: join(sandbox, 'agent'),
    additionalExtensionPaths: extPaths,
    additionalThemePaths: themePaths,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });

  try {
    await loader.reload();
    return {
      extensions: loader.getExtensions(),
      themes: loader.getThemes(),
    };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

test('pi loader discovers the status extension and registers the /status command', async () => {
  const { extensions } = await loadResources();
  assert.deepEqual(
    extensions.errors,
    [],
    `extension loader must not report errors; got ${JSON.stringify(extensions.errors)}`
  );
  const status = extensions.extensions.find(e => e.resolvedPath === pkgPath('extensions/status/index.ts'));
  assert.ok(
    status,
    `pi loader must discover extensions/status/index.ts; loaded paths=${JSON.stringify(
      extensions.extensions.map(e => e.resolvedPath)
    )}`
  );
  assert.ok(
    status.commands.has('status'),
    `status extension must register the /status command; got commands=${JSON.stringify([
      ...status.commands.keys(),
    ])}`
  );
});

test('pi loader does not load footer or border-status as independent extensions', async () => {
  const { extensions } = await loadResources();
  const loadedPaths = extensions.extensions.map(e => e.resolvedPath);
  assert.ok(
    !loadedPaths.includes(pkgPath('extensions/status/footer.ts')),
    'footer.ts must not be loaded as an independent extension'
  );
  assert.ok(
    !loadedPaths.includes(pkgPath('extensions/status/border-status.ts')),
    'border-status.ts must not be loaded as an independent extension'
  );
});

test('pi loader discovers the working extension and registers the /working command', async () => {
  const { extensions } = await loadResources();
  const working = extensions.extensions.find(
    e => e.resolvedPath === pkgPath('extensions/working/index.ts')
  );
  assert.ok(
    working,
    `pi loader must discover extensions/working/index.ts; loaded paths=${JSON.stringify(
      extensions.extensions.map(e => e.resolvedPath)
    )}`
  );
  assert.ok(
    working.commands.has('working'),
    `working extension must register the /working command; got commands=${JSON.stringify([
      ...working.commands.keys(),
    ])}`
  );
});

test('pi loader discovers the nord theme from pi-flow-ux/themes', async () => {
  const { themes } = await loadResources();
  assert.deepEqual(
    themes.diagnostics,
    [],
    `theme loader must not report diagnostics; got ${JSON.stringify(themes.diagnostics)}`
  );
  const nord = themes.themes.find(t => t.name === 'nord');
  assert.ok(
    nord,
    `pi loader must discover the nord theme; loaded theme names=${JSON.stringify(
      themes.themes.map(t => t.name)
    )}`
  );
  assert.equal(
    nord.sourcePath,
    pkgPath('themes', 'nord.json'),
    `nord theme must resolve from packages/pi-flow-ux/themes/nord.json; got ${nord.sourcePath}`
  );
});
