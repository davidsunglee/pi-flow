import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_BASE = resolve(PKG_DIR, 'skills', 'release');

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

test('package.json pi.skills deep-equals ["skills/*/SKILL.md"]', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.deepEqual(
    pkg.pi?.skills,
    ['skills/*/SKILL.md'],
    'pi.skills must equal ["skills/*/SKILL.md"]'
  );
});

test('pi.skills glob resolves to exactly skills/release/SKILL.md', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const globPattern = pkg.pi?.skills?.[0];
  assert.ok(globPattern, 'pi.skills[0] must be defined');

  const matches = expandGlob(globPattern, PKG_DIR)
    .filter(p => p.endsWith('SKILL.md'));

  assert.equal(
    matches.length,
    1,
    `glob must resolve to exactly one SKILL.md; got ${matches.length}: ${matches.join(', ')}`
  );
  assert.equal(
    matches[0],
    resolve(SKILLS_BASE, 'SKILL.md'),
    `resolved SKILL.md must be skills/release/SKILL.md`
  );
});

test('package.json does not mention pi-flow-core', () => {
  const raw = readFileSync(pkgPath('package.json'), 'utf8');
  assert.equal(
    raw.includes('pi-flow-core'),
    false,
    'package.json must not contain the substring "pi-flow-core"'
  );
});

test('SKILL.md references single-package.md and monorepo.md', () => {
  const spine = readFileSync(resolve(SKILLS_BASE, 'SKILL.md'), 'utf8');
  assert.ok(
    spine.includes('single-package.md'),
    'SKILL.md must reference single-package.md'
  );
  assert.ok(
    spine.includes('monorepo.md'),
    'SKILL.md must reference monorepo.md'
  );
});

test('single-package.md and monorepo.md exist on disk', () => {
  assert.ok(
    existsSync(resolve(SKILLS_BASE, 'single-package.md')),
    'skills/release/single-package.md must exist'
  );
  assert.ok(
    existsSync(resolve(SKILLS_BASE, 'monorepo.md')),
    'skills/release/monorepo.md must exist'
  );
});

test('SKILL.md contains all required guardrails', () => {
  const spine = readFileSync(resolve(SKILLS_BASE, 'SKILL.md'), 'utf8');
  const checks = [
    ['gitleaks', 'gitleaks'],
    ['git status --short --branch', 'git status --short --branch'],
    ['audit --prod', 'audit --prod'],
    ['npm publish', 'npm publish'],
    ['git push', 'git push'],
    ['gh release create', 'gh release create'],
  ];
  for (const [needle, label] of checks) {
    assert.ok(
      spine.includes(needle),
      `SKILL.md must contain "${label}"`
    );
  }
  assert.ok(
    /security audit/i.test(spine),
    'SKILL.md must contain "security audit" (case-insensitive)'
  );
});

test('shape files do not duplicate gitleaks detect from the spine', () => {
  const single = readFileSync(resolve(SKILLS_BASE, 'single-package.md'), 'utf8');
  const mono = readFileSync(resolve(SKILLS_BASE, 'monorepo.md'), 'utf8');
  assert.equal(
    single.includes('gitleaks detect'),
    false,
    'single-package.md must not contain "gitleaks detect"'
  );
  assert.equal(
    mono.includes('gitleaks detect'),
    false,
    'monorepo.md must not contain "gitleaks detect"'
  );
});

test('monorepo.md references a publish: custom-script and dependency order', () => {
  const mono = readFileSync(resolve(SKILLS_BASE, 'monorepo.md'), 'utf8');
  assert.ok(
    /publish:/i.test(mono),
    'monorepo.md must contain a case-insensitive "publish:" custom-script reference'
  );
  assert.ok(
    /dependency order/i.test(mono),
    'monorepo.md must contain a case-insensitive "dependency order" reference'
  );
});
