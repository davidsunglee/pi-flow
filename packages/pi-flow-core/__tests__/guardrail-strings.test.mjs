import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function skillPath(skill, file = 'SKILL.md') {
  return resolve(PKG_DIR, 'skills', skill, file);
}

function sharedPath(file) {
  return resolve(PKG_DIR, 'skills', '_shared', file);
}

test('fastlane customize submenu options are preserved', () => {
  const content = readFileSync(skillPath('fastlane'), 'utf8');
  const lines = content.split('\n').map(line => line.trim());
  const expected = [
    'Choose a setting to change:',
    '(t) Coder tier               — current: capable (high thinking)',
    '(r) Refine-code iterations   — current: 3',
    '(m) Back to main menu',
  ];
  const found = lines.some((_, index) =>
    expected.every((line, offset) => lines[index + offset] === line)
  );
  assert.ok(
    found,
    'fastlane SKILL.md must contain the customize submenu options in order'
  );
});

test('fastlane BLOCKED handler banner is preserved', () => {
  const content = readFileSync(skillPath('fastlane'), 'utf8');
  assert.ok(
    content.includes('🚫 Coder returned BLOCKED:'),
    'fastlane SKILL.md must contain the BLOCKED handler banner'
  );
});

test('scout commit gate menu is preserved', () => {
  const content = readFileSync(skillPath('scout'), 'utf8');
  assert.ok(
    content.includes('Brief written to <path>. Review it, then choose:'),
    'scout SKILL.md must contain the commit gate menu string'
  );
});

test('define-spec spec-design-procedure missing-file error is preserved', () => {
  const content = readFileSync(skillPath('define-spec'), 'utf8');
  assert.ok(
    content.includes('cannot run define-spec'),
    'define-spec SKILL.md must contain the missing-file error string'
  );
});

test('dispatch-contract canonical leaf templates 1 through 5 are preserved byte-equal', () => {
  const content = readFileSync(sharedPath('dispatch-contract.md'), 'utf8');

  assert.ok(
    content.includes('~/.pi/agent/flow.json missing or unreadable — cannot dispatch <agent>.'),
    'Template (1): missing/unreadable file message must be present byte-equal'
  );

  assert.ok(
    content.includes('flow.json has no usable "<tier>" model — cannot dispatch <agent>.'),
    'Template (2): missing/empty selected tier message must be present byte-equal'
  );

  assert.ok(
    content.includes('flow.json has no subagentDispatch map — cannot dispatch <agent>.'),
    'Template (3): missing subagentDispatch map message must be present byte-equal'
  );

  assert.ok(
    content.includes('flow.json has no subagentDispatch.<provider> mapping for <tier> model <model> — cannot dispatch <agent>.'),
    'Template (4): missing subagentDispatch.<provider> message must be present byte-equal'
  );

  assert.ok(
    content.includes('flow.json has no usable executionPolicy ("guarded" or "unrestricted") — cannot dispatch <agent>.'),
    'Template (5): missing/invalid executionPolicy message must be present byte-equal'
  );
});

test('refine-code STATUS handlers are preserved', () => {
  const content = readFileSync(skillPath('refine-code'), 'utf8');
  for (const status of ['STATUS: approved', 'STATUS: approved_with_concerns', 'STATUS: not_approved_within_budget', 'STATUS: failed']) {
    assert.ok(content.includes(status), `refine-code SKILL.md must contain '${status}'`);
  }
});

test('execute-plan verifier-dispatch boundary blockquote is preserved', () => {
  const content = readFileSync(skillPath('execute-plan'), 'utf8');
  const lines = content.split('\n');
  const found = lines.some(line => line.startsWith('> ') && line.includes('MUST NOT'));
  assert.ok(found, 'execute-plan SKILL.md must contain a blockquote line starting with "> " that includes "MUST NOT"');
});

test('execute-plan intermediate-wave failure menu choices are preserved byte-for-byte', () => {
  const content = readFileSync(skillPath('execute-plan'), 'utf8');
  for (const choice of [
    '(d) Debug failures now        — dispatch the Debugger-first flow against current_non_baseline_stable ∪ current_non_reconcilable, then re-test',
    '(c) Continue despite failures — proceed to wave <N+1> without modifying baseline_failures',
    '(x) Stop execution            — halt the plan; prior wave commits remain in git history',
  ]) {
    assert.ok(content.includes(choice), `execute-plan SKILL.md must contain intermediate-wave menu choice: '${choice}'`);
  }
});

test('execute-plan final-wave failure menu choices are preserved byte-for-byte', () => {
  const content = readFileSync(skillPath('execute-plan'), 'utf8');
  for (const choice of [
    '(d) Debug failures now — dispatch the Debugger-first flow against current_non_baseline_stable ∪ current_non_reconcilable, then re-test',
    '(x) Stop execution     — halt the plan; prior wave commits remain in git history',
  ]) {
    assert.ok(content.includes(choice), `execute-plan SKILL.md must contain final-wave menu choice: '${choice}'`);
  }
});

test('execute-plan expected-failure skip path is conservative and intermediate-wave only', () => {
  const content = readFileSync(skillPath('execute-plan'), 'utf8');
  assert.ok(
    content.includes('Expected-failure skip (intermediate waves only)'),
    'execute-plan SKILL.md must contain the expected-failure skip subsection heading'
  );
  assert.ok(
    /blanket excuse/i.test(content),
    'execute-plan SKILL.md must caution against using the expected-failure skip path as a blanket excuse for regressions'
  );
  assert.ok(
    content.includes('ℹ️ Integration tests failed after wave'),
    'execute-plan SKILL.md must contain the expected-failure notification banner prefix'
  );
  assert.ok(
    content.includes('evaluate each failing entry'),
    'execute-plan SKILL.md must frame the skip path as executor evaluation against remaining plan work'
  );
  assert.ok(
    !content.includes('The plan file explicitly names'),
    'execute-plan SKILL.md must not require the plan to explicitly name future tasks responsible for failures'
  );
});

test('refine-plan coverage-gate error is preserved', () => {
  const content = readFileSync(skillPath('refine-plan'), 'utf8');
  assert.ok(
    content.includes('refine-plan: no coverage source available and --structural-only not set.'),
    'refine-plan SKILL.md must contain the coverage-gate error string'
  );
});

test('dispatch-contract coordinator templates are preserved byte-equal', () => {
  const content = readFileSync(sharedPath('dispatch-contract.md'), 'utf8');

  assert.ok(
    content.includes('flow.json has no coordinatorSubagentDispatch section — cannot dispatch <agent>.'),
    'Missing coordinatorSubagentDispatch section template must be present byte-equal'
  );

  assert.ok(
    content.includes('flow.json coordinatorSubagentDispatch has no usable modelChain — cannot dispatch <agent>.'),
    'No usable modelChain template must be present byte-equal'
  );

  assert.ok(
    content.includes('coordinator-dispatch: all coordinatorSubagentDispatch.modelChain models failed; last attempt: <model> via pi — <error>'),
    'Runtime exhaustion template must be present byte-equal'
  );
});

test('old four-tier coordinator chain strings are gone', () => {
  const files = [
    sharedPath('dispatch-contract.md'),
    skillPath('refine-plan'),
    skillPath('refine-code'),
  ];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const stale of ['no model tier in', 'pi-eligible', 'four-tier', 'skip-silently', 'resolves to a pi CLI']) {
      assert.ok(!content.includes(stale), `${file} must not contain '${stale}'`);
    }
  }
});

test('refine skill flow-config stop strings are preserved byte-equal', () => {
  const refinePlan = readFileSync(skillPath('refine-plan'), 'utf8');
  assert.ok(
    refinePlan.includes('refine-plan requires ~/.pi/agent/flow.json — see flow config setup.'),
    'refine-plan SKILL.md must contain the flow-config stop string byte-equal'
  );

  const refineCode = readFileSync(skillPath('refine-code'), 'utf8');
  assert.ok(
    refineCode.includes('refine-code requires ~/.pi/agent/flow.json — see flow config setup.'),
    'refine-code SKILL.md must contain the flow-config stop string byte-equal'
  );
});

test('execute-plan tolerant-verifier routing strings are present', () => {
  const skill = readFileSync(skillPath('execute-plan'), 'utf8');
  for (const s of [
    'PASS_WITH_PROTOCOL_WARNINGS',
    '⚠️ Task <N> verified PASS with protocol warnings (auto-accepted; evidence complete):',
    '(a) Amend Verify: recipe',
  ]) {
    assert.ok(skill.includes(s), `execute-plan SKILL.md must contain: ${s}`);
  }
  assert.ok(
    !skill.includes('Protocol errors never pass and are never silently interpreted as'),
    'execute-plan SKILL.md must not retain the unconditional protocol-error-fail claim'
  );
  const acv = readFileSync(skillPath('execute-plan', 'acceptance-criteria-verification.md'), 'utf8');
  assert.ok(acv.includes('PASS_WITH_PROTOCOL_WARNINGS'), 'acceptance-criteria-verification.md must route the tolerant verdict');
  const boundary = readFileSync(sharedPath('orchestrator-verification-boundary.md'), 'utf8');
  assert.ok(
    boundary.includes('Sole exception — user-directed recipe amendment.'),
    'orchestrator-verification-boundary.md must document the user-directed recipe-amendment carve-out'
  );
});

test('legacy flow configuration naming is absent from package source', () => {
  // Split literals so this test file itself never contains the banned strings.
  const LEGACY_FILE_NAME = new RegExp('model' + '-tier', 'i');
  const LEGACY_CONTENT = [
    new RegExp('model' + '-tiers', 'i'),
    new RegExp('model' + '[ ._-]' + 'matrix', 'i'),
  ];

  const violations = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;
        walk(resolve(dir, entry.name));
      } else {
        const filePath = resolve(dir, entry.name);
        if (LEGACY_FILE_NAME.test(entry.name)) {
          violations.push(`file name: ${filePath}`);
        }
        let content;
        try {
          content = readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }
        for (const pattern of LEGACY_CONTENT) {
          if (pattern.test(content)) {
            violations.push(`content (${pattern}): ${filePath}`);
            break;
          }
        }
      }
    }
  }

  walk(PKG_DIR);

  assert.deepEqual(violations, [], 'No files should contain legacy flow configuration naming');
});
