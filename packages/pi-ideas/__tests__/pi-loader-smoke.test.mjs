import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pkgPath(...parts) {
  return resolve(PKG_DIR, ...parts);
}

async function loadExtensions() {
  const sandbox = mkdtempSync(join(tmpdir(), 'pi-ideas-loader-'));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = sandbox;
  process.env.USERPROFILE = sandbox;

  try {
    const loader = new DefaultResourceLoader({
      cwd: sandbox,
      agentDir: join(sandbox, 'agent'),
      additionalExtensionPaths: [pkgPath('extensions/index.ts')],
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
    });

    await loader.reload();
    return loader.getExtensions();
  } finally {
    process.env.HOME = prevHome;
    process.env.USERPROFILE = prevUserProfile;
    rmSync(sandbox, { recursive: true, force: true });
  }
}

test('pi-loader-smoke: pi loader reports no errors when loading the ideas extension', async () => {
  const extensions = await loadExtensions();
  assert.deepEqual(
    extensions.errors,
    [],
    `extension loader must not report errors; got ${JSON.stringify(extensions.errors)}`
  );
});

test('pi loader discovers extensions/index.ts and registers the ideas command and idea tool', async () => {
  const extensions = await loadExtensions();
  const extension = extensions.extensions.find(
    e => e.resolvedPath === pkgPath('extensions/index.ts')
  );
  assert.ok(
    extension,
    `pi loader must discover extensions/index.ts; loaded paths=${JSON.stringify(
      extensions.extensions.map(e => e.resolvedPath)
    )}`
  );
  assert.ok(
    extension.commands.has('ideas'),
    `ideas extension must register the /ideas command; got commands=${JSON.stringify([
      ...extension.commands.keys(),
    ])}`
  );
  assert.ok(
    extension.tools.has('idea'),
    `ideas extension must register the idea tool; got tools=${JSON.stringify([
      ...extension.tools.keys(),
    ])}`
  );
});
