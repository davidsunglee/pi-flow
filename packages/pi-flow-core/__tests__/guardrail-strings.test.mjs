import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function skillPath(skill, file = 'SKILL.md') {
  return resolve(PKG_DIR, 'skills', skill, file);
}

function sharedPath(file) {
  return resolve(PKG_DIR, 'skills', '_shared', file);
}

test('fastlane customize submenu is preserved byte-equal', () => {
  const content = readFileSync(skillPath('fastlane'), 'utf8');
  const expected = 'Choose a setting to change:\n  (t) Coder tier               — current: capable (high thinking)\n  (r) Refine-code iterations   — current: 3\n  (m) Back to main menu';
  assert.ok(
    content.includes(expected),
    'fastlane SKILL.md must contain the exact three-line customize submenu block'
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

test('model-tier-resolution canonical templates 1 through 4 are preserved byte-equal', () => {
  const content = readFileSync(sharedPath('model-tier-resolution.md'), 'utf8');

  assert.ok(
    content.includes('~/.pi/agent/model-tiers.json missing or unreadable — cannot dispatch <agent>.'),
    'Template (1): missing/unreadable file message must be present byte-equal'
  );

  assert.ok(
    content.includes('model-tiers.json has no usable "<tier>" model — cannot dispatch <agent>.'),
    'Template (2): missing/empty selected tier message must be present byte-equal'
  );

  assert.ok(
    content.includes('model-tiers.json has no dispatch map — cannot dispatch <agent>.'),
    'Template (3): missing dispatch map message must be present byte-equal'
  );

  assert.ok(
    content.includes('model-tiers.json has no dispatch.<provider> mapping for <tier> model <model> — cannot dispatch <agent>.'),
    'Template (4): missing dispatch.<provider> message must be present byte-equal'
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

test('refine-plan coverage-gate error is preserved', () => {
  const content = readFileSync(skillPath('refine-plan'), 'utf8');
  assert.ok(
    content.includes('refine-plan: no coverage source available and --structural-only not set.'),
    'refine-plan SKILL.md must contain the coverage-gate error string'
  );
});
