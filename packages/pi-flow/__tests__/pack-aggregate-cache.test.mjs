import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { buildAggregateTarball } from '../scripts/pack-aggregate.mjs';

test('buildAggregateTarball isolates internal npm pack cache from parent npm_config_cache', () => {
  const previous = process.env.npm_config_cache;
  let tarball;
  process.env.npm_config_cache = '/dev/null';
  try {
    ({ tarball } = buildAggregateTarball());
    assert.ok(existsSync(tarball), `tarball should be written even with bad parent npm_config_cache: ${tarball}`);
  } finally {
    if (previous === undefined) delete process.env.npm_config_cache;
    else process.env.npm_config_cache = previous;
    if (tarball) rmSync(dirname(tarball), { recursive: true, force: true });
  }
});
