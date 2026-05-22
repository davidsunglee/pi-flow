import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS_PATH = resolve(PKG_DIR, 'extensions', 'commands.ts');
const EXPECTED_COMMANDS = [
  'flow:setup',
  'flow:idea',
  'flow:ideas',
  'flow:scout',
  'flow:spec',
  'flow:plan',
  'flow:refine-plan',
  'flow:execute',
  'flow:refine-code',
  'flow:fastlane',
];

test('pi loader discovers the commands extension with 10 flow commands and the idea tool', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'pi-flow-core-loader-'));
  const loader = new DefaultResourceLoader({
    cwd: sandbox,
    agentDir: join(sandbox, 'agent'),
    additionalExtensionPaths: [COMMANDS_PATH],
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });

  try {
    await loader.reload();

    const extensions = loader.getExtensions();
    assert.deepEqual(
      extensions.errors,
      [],
      `extension loader must not report errors; got ${JSON.stringify(extensions.errors)}`
    );

    const commandsExtension = extensions.extensions.find((e) => e.resolvedPath === COMMANDS_PATH);
    assert.ok(
      commandsExtension,
      `pi loader must discover extensions/commands.ts; loaded paths=${JSON.stringify(extensions.extensions.map((e) => e.resolvedPath))}`
    );
    assert.deepEqual([...commandsExtension.commands.keys()], EXPECTED_COMMANDS);
    assert.deepEqual([...commandsExtension.tools.keys()], ['idea']);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
