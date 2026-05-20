import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, basename } from 'node:path';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pkgPath(...parts) {
  return resolve(PKG_DIR, ...parts);
}

const SKILL_NAMES = [
  'scout',
  'define-spec',
  'fastlane',
  'generate-plan',
  'refine-plan',
  'execute-plan',
  'refine-code',
  'requesting-code-review',
  'receiving-code-review',
  'commit',
  'test-driven-development',
  'systematic-debugging',
  'verification-before-completion',
  'using-git-worktrees',
  'finishing-a-development-branch',
];

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

test('package.json declares keywords pi-package', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  assert.ok(
    Array.isArray(pkg.keywords) && pkg.keywords.includes('pi-package'),
    'keywords must include pi-package'
  );
});

test('pi.skills glob matches exactly 15 SKILL.md files', () => {
  const skillsDir = pkgPath('skills');
  const found = readdirSync(skillsDir)
    .filter(name => {
      const skillMd = resolve(skillsDir, name, 'SKILL.md');
      return existsSync(skillMd);
    })
    .sort();
  const expected = [...SKILL_NAMES].sort();
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

  assert.equal(existsSync(pkgPath('node_modules')), false, 'package root node_modules must not exist');

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

test('pi manifest skills glob matches actual SKILL.md placement', () => {
  const pkg = JSON.parse(readFileSync(pkgPath('package.json'), 'utf8'));
  const globPattern = pkg.pi?.skills?.[0];
  assert.ok(globPattern, 'pi.skills[0] glob must be defined in package.json');

  // Expand the glob manually: skills/*/SKILL.md
  const skillsDir = pkgPath('skills');
  const found = readdirSync(skillsDir)
    .filter(name => {
      const skillMd = resolve(skillsDir, name, 'SKILL.md');
      return existsSync(skillMd);
    })
    .sort();

  const expected = [...SKILL_NAMES].sort();
  assert.deepEqual(found, expected, `Resolved skill set must match spec's 15-name list`);
});

function findPiLibIndex() {
  const which = spawnSync('which', ['pi'], { encoding: 'utf8' });
  if (which.status !== 0 || !which.stdout.trim()) return null;
  let binPath;
  try {
    binPath = realpathSync(which.stdout.trim());
  } catch {
    return null;
  }
  let dir = dirname(binPath);
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(
      dir,
      'lib',
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'dist',
      'index.js'
    );
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

test('pi loader discovery probe — enumerates all 15 packaged skills via loadSkillsFromDir', async () => {
  const piCheck = spawnSync('which', ['pi'], { encoding: 'utf8' });
  const piAvailable = piCheck.status === 0 && piCheck.stdout.trim().length > 0;

  if (!piAvailable) {
    console.log(JSON.stringify({
      skipped: 'pi CLI not on PATH',
      reason: 'manifest-shape and glob-resolution checks above are the deterministic proxy',
    }));
    return;
  }

  const libIndex = findPiLibIndex();
  assert.ok(
    libIndex,
    'pi CLI is on PATH but the @earendil-works/pi-coding-agent library could not be located relative to the pi binary; ' +
      'cannot exercise the documented loader entry point'
  );

  const pi = await import(pathToFileURL(libIndex).href);
  assert.equal(typeof pi.loadSkillsFromDir, 'function', 'pi library must export loadSkillsFromDir');

  const skillsDir = pkgPath('skills');
  const { skills, diagnostics } = pi.loadSkillsFromDir({ dir: skillsDir, source: 'project' });

  const errorDiagnostics = (diagnostics || []).filter(d => d.type === 'error');
  assert.deepEqual(
    errorDiagnostics,
    [],
    `loadSkillsFromDir reported errors: ${errorDiagnostics.map(d => d.message).join('; ')}`
  );

  const discoveredNames = skills.map(s => s.name).sort();
  const expectedNames = [...SKILL_NAMES].sort();
  assert.deepEqual(
    discoveredNames,
    expectedNames,
    `Pi's own loader must discover all 15 packaged skills. Got: ${discoveredNames.join(', ')}`
  );
});
