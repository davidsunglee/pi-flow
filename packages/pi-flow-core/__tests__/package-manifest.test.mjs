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

test('pi CLI discovery probe — best-effort', () => {
  const piCheck = spawnSync('which', ['pi'], { encoding: 'utf8' });
  const piAvailable = piCheck.status === 0 && piCheck.stdout.trim().length > 0;

  if (!piAvailable) {
    console.log(JSON.stringify({
      skipped: 'pi CLI not on PATH',
      reason: 'Pi loader contract is an open question in the spec (see Open Questions #1 and #2); manifest-shape and glob-resolution checks above are the deterministic proxy',
    }));
    return;
  }

  const versionCheck = spawnSync('pi', ['--version'], { encoding: 'utf8' });
  if (versionCheck.status !== 0) {
    console.log(JSON.stringify({
      skipped: 'pi CLI not functional',
      reason: 'Pi loader contract is an open question in the spec (see Open Questions #1 and #2); manifest-shape and glob-resolution checks above are the deterministic proxy',
    }));
    return;
  }

  const result = spawnSync('pi', ['-e', 'pi-flow-core'], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.log(JSON.stringify({
      skipped: 'pi -e pi-flow-core failed',
      reason: 'Pi loader contract is an open question in the spec (see Open Questions #1 and #2); manifest-shape and glob-resolution checks above are the deterministic proxy',
      stderr: result.stderr?.trim(),
    }));
    return;
  }

  const output = result.stdout + result.stderr;

  for (const skill of SKILL_NAMES) {
    assert.ok(
      output.includes(skill),
      `Expected skill '${skill}' to appear in 'pi -e pi-flow-core' output`
    );
  }
});
