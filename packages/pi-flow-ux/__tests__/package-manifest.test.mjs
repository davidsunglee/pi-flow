import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, basename } from 'node:path';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pkgPath(...parts) {
  return resolve(PKG_DIR, ...parts);
}

// Excluded personal extensions from spec out-of-scope.
const EXCLUDED_EXTENSIONS = [
  'answer.ts',
  'context.ts',
  'env.ts',
  'files.ts',
  'guardrails.ts',
  'herdr-agent-state.ts',
  'session-breakdown.ts'
];

const EXPECTED_EXTENSION_ENTRIES = [
  'extensions/status/index.ts',
  'extensions/working/index.ts',
];

// The footer and border-status renderers are now internal implementation
// modules behind the status coordinator; they must NOT be registered as
// independent extensions in the manifest.
const FORBIDDEN_EXTENSION_ENTRIES = [
  'extensions/status/footer.ts',
  'extensions/status/border-status.ts',
];

// Mirror of the glob helper used in aggregate-forwarding.test.mjs and
// pi-flow-core/__tests__/package-manifest.test.mjs. Kept local intentionally to
// avoid a shared test-utility module across packages.
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
          if (e.startsWith('.')) continue;
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

test('package.json identifies @aphotic/pi-flow-ux as a pi-package', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.equal(pkg.name, '@aphotic/pi-flow-ux', 'package name must be @aphotic/pi-flow-ux');
  assert.equal(pkg.type, 'module', 'package type must be module');
  assert.ok(
    Array.isArray(pkg.keywords) && pkg.keywords.includes('pi-package'),
    'keywords must include "pi-package"'
  );
});

test('pi.extensions manifest lists status and working/index entries that resolve on disk', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const entries = pkg.pi?.extensions;
  assert.ok(Array.isArray(entries), 'pi.extensions must be an array');
  assert.deepEqual(
    [...entries].sort(),
    [...EXPECTED_EXTENSION_ENTRIES].sort(),
    `pi.extensions must list exactly ${EXPECTED_EXTENSION_ENTRIES.join(', ')}`
  );
  for (const rel of EXPECTED_EXTENSION_ENTRIES) {
    const full = pkgPath(rel);
    assert.ok(existsSync(full), `pi.extensions entry must exist on disk: ${rel}`);
  }
});

test('pi.extensions does not register footer or border-status as independent extensions', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const entries = pkg.pi?.extensions || [];
  for (const forbidden of FORBIDDEN_EXTENSION_ENTRIES) {
    assert.ok(
      !entries.includes(forbidden),
      `pi.extensions must not load ${forbidden} independently; it is a renderer behind the status coordinator`
    );
  }
});

test('packaged status.json default exists at package root with placement "border"', () => {
  const statusPath = pkgPath('status.json');
  assert.ok(existsSync(statusPath), 'status.json must exist at the package root');
  const raw = JSON.parse(readFileSync(statusPath, 'utf8'));
  assert.equal(raw.placement, 'border', 'packaged status.json must default to placement "border"');
});

test('pi.themes manifest resolves to themes/nord.json', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const themeEntries = pkg.pi?.themes;
  assert.ok(Array.isArray(themeEntries) && themeEntries.length > 0, 'pi.themes must be a non-empty array');

  const nordPath = pkgPath('themes', 'nord.json');
  assert.ok(existsSync(nordPath), 'themes/nord.json must exist');

  let nordCovered = false;
  for (const entry of themeEntries) {
    const full = pkgPath(entry);
    if (!existsSync(full)) continue;
    const stat = statSync(full);
    if (stat.isFile() && basename(full) === 'nord.json') {
      nordCovered = true;
      break;
    }
    if (stat.isDirectory()) {
      const inDir = readdirSync(full).map(e => resolve(full, e));
      if (inDir.some(p => basename(p) === 'nord.json' && existsSync(p))) {
        nordCovered = true;
        break;
      }
    }
  }
  assert.ok(nordCovered, `pi.themes must cover themes/nord.json; entries=${JSON.stringify(themeEntries)}`);
});

test('packaged working.json default exists at package root with Nord-tuned defaults', () => {
  const workingPath = pkgPath('working.json');
  assert.ok(existsSync(workingPath), 'working.json must exist at the package root');
  const raw = JSON.parse(readFileSync(workingPath, 'utf8'));
  assert.equal(raw.indicatorShape, 'pulse', 'packaged working.json must default to indicatorShape "pulse"');
});

test('excluded personal extensions are absent from the UX package', () => {
  const present = [];
  for (const name of EXCLUDED_EXTENSIONS) {
    if (existsSync(pkgPath('extensions', name))) {
      present.push(name);
    }
  }
  assert.deepEqual(present, [], `Excluded personal extensions must not ship in pi-flow-ux: ${present.join(', ')}`);
});

test('package.json declares no install-time side-effect scripts', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const sideEffectScripts = ['preinstall', 'install', 'postinstall', 'setup'];
  for (const scriptName of sideEffectScripts) {
    assert.equal(
      pkg.scripts?.[scriptName],
      undefined,
      `pi-flow-ux/package.json must not declare scripts.${scriptName}`
    );
  }
});

test('peer dependencies cover @earendil-works/pi-coding-agent and pi-tui', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const peers = pkg.peerDependencies || {};
  for (const name of ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui']) {
    assert.ok(peers[name], `peerDependencies must declare ${name}`);
  }
});

test('files array ships extensions, themes, and working.json', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const files = pkg.files || [];
  for (const entry of ['extensions', 'themes', 'working.json', 'status.json']) {
    assert.ok(files.includes(entry), `files array must include "${entry}"`);
  }
});

test('pi.themes glob expansion (when applicable) does not leak directories outside themes/', () => {
  // If themes is declared as a directory pattern, expandGlob should resolve at
  // most files inside themes/. Guard against accidentally pointing at the
  // package root or a sibling directory.
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const themeEntries = pkg.pi?.themes || [];
  const themesDir = pkgPath('themes');
  for (const entry of themeEntries) {
    if (entry.includes('*')) {
      const matches = expandGlob(entry, PKG_DIR);
      for (const m of matches) {
        assert.ok(
          m === themesDir || m.startsWith(themesDir + '/'),
          `theme glob entry "${entry}" must not resolve outside themes/: ${m}`
        );
      }
    }
  }
});
