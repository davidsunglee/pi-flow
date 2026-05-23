#!/usr/bin/env node
// Thin wrapper that delegates to pi-flow-core's runner. Exists so the
// aggregate `pi-flow` package exposes a `node_modules/.bin/pi-flow` entry
// for consumers; the real implementation lives in pi-flow-core.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

let coreBinUrl;
try {
  coreBinUrl = require.resolve('@aphotic/pi-flow-core/bin/pi-flow.mjs');
} catch (err) {
  process.stderr.write(
    JSON.stringify({
      failure: '@aphotic/pi-flow-core not resolvable from aggregate package',
      detail: err?.message ?? String(err),
    }) + '\n',
  );
  process.exit(2);
}

const coreBinPath = coreBinUrl.startsWith('file://') ? fileURLToPath(coreBinUrl) : coreBinUrl;

const child = spawnSync(process.execPath, [coreBinPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(child.status ?? 1);
