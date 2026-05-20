import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, basename } from 'node:path';

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

const EXPECTED_EXTENSION_ENTRIES = ['extensions/commands.ts'];

const AGENT_NAMES = [
  'code-refiner.md',
  'code-reviewer.md',
  'coder.md',
  'plan-refiner.md',
  'plan-reviewer.md',
  'planner.md',
  'scout.md',
  'spec-designer.md',
  'test-runner.md',
  'verifier.md',
];

const HELPER_RUNNER_SKILLS = [
  'scout',
  'define-spec',
  'fastlane',
  'generate-plan',
  'refine-plan',
  'execute-plan',
  'refine-code',
  'using-git-worktrees',
  'finishing-a-development-branch',
];

function expandGlob(pattern, baseDir) {
  // Minimal expander for patterns like "a/*/b/c" where each `*` matches a
  // single non-hidden directory entry. Returns absolute paths of existing
  // matches.
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

function skillDirsFromManifest(pkg, baseDir) {
  const pattern = pkg.pi?.skills?.[0];
  if (!pattern) return [];
  const matches = expandGlob(pattern, baseDir);
  return matches
    .filter(p => basename(p) === 'SKILL.md')
    .map(p => basename(dirname(p)))
    .sort();
}

function walkMdFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkMdFiles(full));
    } else if (entry.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

test('package.json identifies pi-flow-core as a pi-package', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.equal(pkg.name, 'pi-flow-core', 'package name must be pi-flow-core');
  assert.ok(
    Array.isArray(pkg.keywords) && pkg.keywords.includes('pi-package'),
    'keywords must include pi-package'
  );
});

test('pi.extensions manifest lists extensions/commands.ts and the file exists on disk', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const entries = pkg.pi?.extensions;
  assert.ok(Array.isArray(entries), 'pi.extensions must be an array');
  assert.deepEqual(
    entries,
    EXPECTED_EXTENSION_ENTRIES,
    `pi.extensions must equal ${JSON.stringify(EXPECTED_EXTENSION_ENTRIES)}`
  );
  for (const rel of EXPECTED_EXTENSION_ENTRIES) {
    assert.ok(existsSync(pkgPath(rel)), `pi.extensions entry must exist on disk: ${rel}`);
  }
});

test('pi.skills glob matches exactly 15 SKILL.md files', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.deepEqual(pkg.pi?.skills, ['skills/*/SKILL.md']);
  const found = skillDirsFromManifest(pkg, PKG_DIR);
  const expected = [...EXPECTED_SKILL_NAMES].sort();
  assert.deepEqual(found, expected, `Expected skill dirs to be ${expected.join(', ')}, got ${found.join(', ')}`);
});

test('web-browser skill is absent', () => {
  assert.equal(
    existsSync(pkgPath('skills', 'web-browser')),
    false,
    'skills/web-browser directory must not exist'
  );
});

test('bundled agents directory has exactly 10 required files', () => {
  const agentsDir = pkgPath('agents');
  const found = readdirSync(agentsDir).sort();
  const expected = [...AGENT_NAMES].sort();
  assert.deepEqual(found, expected, `Expected agents: ${expected.join(', ')}, got ${found.join(', ')}`);
});

test('no python3 agent/skills shell invocations remain', () => {
  const skillsDir = pkgPath('skills');
  const mdFiles = walkMdFiles(skillsDir);
  const violations = [];
  for (const file of mdFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/python3 agent\/skills\//.test(lines[i])) {
        violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  assert.deepEqual(violations, [], `Found python3 agent/skills/ invocations:\n${violations.join('\n')}`);
});

test('no python3 ~/.pi/agent/skills shell invocations remain', () => {
  const skillsDir = pkgPath('skills');
  const mdFiles = walkMdFiles(skillsDir);
  const violations = [];
  for (const file of mdFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/python3 ~\/\.pi\/agent\/skills\//.test(lines[i])) {
        violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  assert.deepEqual(violations, [], `Found python3 ~/.pi/agent/skills/ invocations:\n${violations.join('\n')}`);
});

test('every pi-flow helper id in skill markdown has exactly one slash and resolves on disk', () => {
  const skillsDir = pkgPath('skills');
  const mdFiles = walkMdFiles(skillsDir).filter(
    p => !p.includes('/tests/fixtures/') && !p.includes('/__pycache__/')
  );
  const violations = [];
  const idRegex = /pi-flow helper ([^\s`'")]+)/g;
  for (const file of mdFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      idRegex.lastIndex = 0;
      while ((m = idRegex.exec(line)) !== null) {
        const id = m[1];
        const parts = id.split('/');
        if (parts.length !== 2 || parts[0] === '' || parts[1] === '' || parts[0] === '..' || parts[1] === '..') {
          violations.push(`${file}:${i + 1}: invalid id shape: ${id}`);
          continue;
        }
        const [location, name] = parts;
        const scriptPath = location === '_shared'
          ? pkgPath('skills', '_shared', 'scripts', `${name}.py`)
          : pkgPath('skills', location, 'scripts', `${name}.py`);
        if (!existsSync(scriptPath)) {
          violations.push(`${file}:${i + 1}: unresolved id ${id} (searched ${scriptPath})`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], `Broken pi-flow helper ids:\n${violations.join('\n')}`);
});

test('helper-runner invocations exist in every path-rewritten skill', () => {
  const missing = [];
  for (const skill of HELPER_RUNNER_SKILLS) {
    const skillFile = pkgPath('skills', skill, 'SKILL.md');
    const content = readFileSync(skillFile, 'utf8');
    if (!content.includes('pi-flow helper ')) {
      missing.push(skill);
    }
  }
  assert.deepEqual(missing, [], `Skills missing 'pi-flow helper ' invocations: ${missing.join(', ')}`);
});

test('excluded artifacts are absent', () => {
  assert.equal(existsSync(pkgPath('skills', 'web-browser')), false, 'skills/web-browser must not exist');

  function findPycache(dir) {
    const results = [];
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === '__pycache__') results.push(full);
        else results.push(...findPycache(full));
      }
    }
    return results;
  }

  function findDsStore(dir) {
    const results = [];
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry !== 'node_modules') results.push(...findDsStore(full));
      } else if (entry === '.DS_Store') {
        results.push(full);
      }
    }
    return results;
  }

  const pycacheDirs = findPycache(pkgPath('skills'));
  assert.deepEqual(pycacheDirs, [], `Found __pycache__ dirs: ${pycacheDirs.join(', ')}`);

  const dsStores = findDsStore(PKG_DIR);
  assert.deepEqual(dsStores, [], `Found .DS_Store files: ${dsStores.join(', ')}`);

  function findNodeModulesInSkills(dir) {
    const results = [];
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === 'node_modules') results.push(full);
        else results.push(...findNodeModulesInSkills(full));
      }
    }
    return results;
  }

  const nmInSkills = findNodeModulesInSkills(pkgPath('skills'));
  assert.deepEqual(nmInSkills, [], `Found node_modules in skills: ${nmInSkills.join(', ')}`);
});

test('bin entry is executable and starts with node shebang', () => {
  const binPath = pkgPath('bin', 'pi-flow.mjs');
  assert.ok(existsSync(binPath), 'bin/pi-flow.mjs must exist');
  const firstLine = readFileSync(binPath, 'utf8').split('\n')[0];
  assert.equal(firstLine, '#!/usr/bin/env node', 'First line must be #!/usr/bin/env node');
});

test('pi-flow-core ships no UX manifest entries or UX source directories', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.equal(
    pkg.pi?.themes,
    undefined,
    'pi-flow-core must not declare pi.themes; UX themes live in pi-flow-ux'
  );
  assert.equal(
    existsSync(pkgPath('themes')),
    false,
    'themes/ directory must not exist in pi-flow-core'
  );
  assert.equal(
    existsSync(pkgPath('working.json')),
    false,
    'working.json must not exist in pi-flow-core (UX default lives in pi-flow-ux)'
  );
});

test('package.json declares no install-time side-effect scripts', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const sideEffectScripts = ['preinstall', 'install', 'postinstall', 'setup'];
  for (const scriptName of sideEffectScripts) {
    assert.equal(
      pkg.scripts?.[scriptName],
      undefined,
      `pi-flow-core/package.json must not declare scripts.${scriptName}`
    );
  }
});

test('peerDependencies declares @earendil-works/pi-coding-agent', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.ok(
    pkg.peerDependencies?.['@earendil-works/pi-coding-agent'],
    'peerDependencies must declare @earendil-works/pi-coding-agent'
  );
});

test('files array includes extensions', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.ok(pkg.files?.includes('extensions'), 'files array must include "extensions"');
});

test('pi manifest skills glob matches actual SKILL.md placement', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const globPattern = pkg.pi?.skills?.[0];
  assert.ok(globPattern, 'pi.skills[0] glob must be defined in package.json');

  const found = skillDirsFromManifest(pkg, PKG_DIR);
  const expected = [...EXPECTED_SKILL_NAMES].sort();
  assert.deepEqual(found, expected, `Resolved skill set must match spec's 15-name list`);
});

test('pi CLI discovery probe', () => {
  // Detect Pi via `pi --version` per the documented CLI contract.
  const versionCheck = spawnSync('pi', ['--version'], { encoding: 'utf8' });
  const piAvailable =
    !versionCheck.error &&
    versionCheck.status === 0 &&
    (versionCheck.stdout?.trim().length > 0 || versionCheck.stderr?.trim().length > 0);

  if (!piAvailable) {
    console.log(JSON.stringify({
      skipped: 'pi CLI not available (pi --version did not exit 0)',
      reason: 'manifest-shape and glob-resolution checks above are the deterministic proxy',
    }));
    return;
  }

  // Exercise the documented package-loading entry point: `pi -e <abs pkg dir> --help`.
  // This forces Pi to resolve the package directory through its extension loader
  // and exits without invoking any LLM. A non-zero exit (or a "Failed to load
  // extension" diagnostic) means Pi rejected our package layout and the test fails.
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

  // Secondary manifest-driven assertion: the glob still resolves to all 15
  // SKILL.md files. Derived from the manifest, not from a hard-coded path.
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const globPattern = pkg.pi?.skills?.[0];
  assert.ok(globPattern, 'pi.skills[0] glob must be defined in package.json');
  const found = skillDirsFromManifest(pkg, PKG_DIR);
  const expected = [...EXPECTED_SKILL_NAMES].sort();
  assert.deepEqual(
    found,
    expected,
    `manifest glob must resolve to all 15 spec skills. Got: ${found.join(', ')}`
  );
});
