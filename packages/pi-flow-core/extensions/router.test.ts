import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  recognizeExact,
  buildExactPrompt,
  buildInterpretedPrompt,
  routeArgs,
} from './router.ts';

// parseArgs
test('parseArgs strips --exact flag and returns rest', () => {
  const result = parseArgs('--exact docs/specs/x.md');
  assert.deepEqual(result, { exactFlag: true, rest: 'docs/specs/x.md' });
});

test('parseArgs strips --no-interpret flag and returns rest', () => {
  const result = parseArgs('--no-interpret TODO-abcd1234');
  assert.deepEqual(result, { exactFlag: true, rest: 'TODO-abcd1234' });
});

test('parseArgs empty string returns defaults', () => {
  const result = parseArgs('');
  assert.deepEqual(result, { exactFlag: false, rest: '' });
});

// recognizeExact - basic cases
test('recognizeExact scout TODO-abcd1234 returns canonical form', () => {
  assert.equal(recognizeExact('scout', 'TODO-abcd1234'), 'TODO-abcd1234');
});

test('recognizeExact scout bare hex returns canonical form', () => {
  assert.equal(recognizeExact('scout', 'abcd1234'), 'TODO-abcd1234');
});

test('recognizeExact scout briefs path returns path', () => {
  assert.equal(
    recognizeExact('scout', 'docs/briefs/2026-05-20-x-brief.md'),
    'docs/briefs/2026-05-20-x-brief.md'
  );
});

test('recognizeExact scout docs/plans returns undefined (wrong artifact dir)', () => {
  assert.equal(recognizeExact('scout', 'docs/plans/x.md'), undefined);
});

test('recognizeExact execute-plan docs/plans returns path', () => {
  assert.equal(recognizeExact('execute-plan', 'docs/plans/x.md'), 'docs/plans/x.md');
});

test('recognizeExact scout empty string returns empty string', () => {
  assert.equal(recognizeExact('scout', ''), '');
});

test('recognizeExact scout prose returns undefined', () => {
  assert.equal(recognizeExact('scout', 'investigate the auth flow'), undefined);
});

// Matrix coverage - accepted cells
test('matrix: scout accepts docs/briefs/*.md', () => {
  assert.equal(recognizeExact('scout', 'docs/briefs/x.md'), 'docs/briefs/x.md');
});

test('matrix: define-spec accepts docs/specs/*.md', () => {
  assert.equal(recognizeExact('define-spec', 'docs/specs/x.md'), 'docs/specs/x.md');
});

test('matrix: generate-plan accepts docs/briefs/*.md', () => {
  assert.equal(recognizeExact('generate-plan', 'docs/briefs/x.md'), 'docs/briefs/x.md');
});

test('matrix: refine-plan accepts docs/plans/*.md', () => {
  assert.equal(recognizeExact('refine-plan', 'docs/plans/x.md'), 'docs/plans/x.md');
});

test('matrix: execute-plan accepts docs/plans/*.md', () => {
  assert.equal(recognizeExact('execute-plan', 'docs/plans/x.md'), 'docs/plans/x.md');
});

test('matrix: refine-code accepts docs/reviews/*.md', () => {
  assert.equal(recognizeExact('refine-code', 'docs/reviews/x.md'), 'docs/reviews/x.md');
});

test('matrix: fastlane accepts docs/specs/*.md', () => {
  assert.equal(recognizeExact('fastlane', 'docs/specs/x.md'), 'docs/specs/x.md');
});

// Empty ✓ cells
test('matrix: scout accepts empty', () => {
  assert.equal(recognizeExact('scout', ''), '');
});

test('matrix: define-spec accepts empty', () => {
  assert.equal(recognizeExact('define-spec', ''), '');
});

test('matrix: generate-plan accepts empty', () => {
  assert.equal(recognizeExact('generate-plan', ''), '');
});

test('matrix: fastlane accepts empty', () => {
  assert.equal(recognizeExact('fastlane', ''), '');
});

// TODO-id ✓ cells
test('matrix: scout accepts TODO-abcd1234', () => {
  assert.equal(recognizeExact('scout', 'TODO-abcd1234'), 'TODO-abcd1234');
});

test('matrix: define-spec accepts TODO-abcd1234', () => {
  assert.equal(recognizeExact('define-spec', 'TODO-abcd1234'), 'TODO-abcd1234');
});

test('matrix: generate-plan accepts TODO-abcd1234', () => {
  assert.equal(recognizeExact('generate-plan', 'TODO-abcd1234'), 'TODO-abcd1234');
});

// Matrix coverage - rejected cells
test('matrix: scout rejects docs/specs/*.md', () => {
  assert.equal(recognizeExact('scout', 'docs/specs/x.md'), undefined);
});

test('matrix: scout rejects docs/plans/*.md', () => {
  assert.equal(recognizeExact('scout', 'docs/plans/x.md'), undefined);
});

test('matrix: scout rejects docs/reviews/*.md', () => {
  assert.equal(recognizeExact('scout', 'docs/reviews/x.md'), undefined);
});

test('matrix: define-spec rejects docs/briefs/*.md', () => {
  assert.equal(recognizeExact('define-spec', 'docs/briefs/x.md'), undefined);
});

test('matrix: define-spec rejects docs/plans/*.md', () => {
  assert.equal(recognizeExact('define-spec', 'docs/plans/x.md'), undefined);
});

test('matrix: define-spec rejects docs/reviews/*.md', () => {
  assert.equal(recognizeExact('define-spec', 'docs/reviews/x.md'), undefined);
});

test('matrix: generate-plan rejects docs/specs/*.md', () => {
  assert.equal(recognizeExact('generate-plan', 'docs/specs/x.md'), undefined);
});

test('matrix: generate-plan rejects docs/plans/*.md', () => {
  assert.equal(recognizeExact('generate-plan', 'docs/plans/x.md'), undefined);
});

test('matrix: generate-plan rejects docs/reviews/*.md', () => {
  assert.equal(recognizeExact('generate-plan', 'docs/reviews/x.md'), undefined);
});

test('matrix: refine-plan rejects empty', () => {
  assert.equal(recognizeExact('refine-plan', ''), undefined);
});

test('matrix: refine-plan rejects TODO-abcd1234', () => {
  assert.equal(recognizeExact('refine-plan', 'TODO-abcd1234'), undefined);
});

test('matrix: refine-plan rejects docs/specs/*.md', () => {
  assert.equal(recognizeExact('refine-plan', 'docs/specs/x.md'), undefined);
});

test('matrix: refine-plan rejects docs/briefs/*.md', () => {
  assert.equal(recognizeExact('refine-plan', 'docs/briefs/x.md'), undefined);
});

test('matrix: refine-plan rejects docs/reviews/*.md', () => {
  assert.equal(recognizeExact('refine-plan', 'docs/reviews/x.md'), undefined);
});

test('matrix: execute-plan rejects empty', () => {
  assert.equal(recognizeExact('execute-plan', ''), undefined);
});

test('matrix: execute-plan rejects TODO-abcd1234', () => {
  assert.equal(recognizeExact('execute-plan', 'TODO-abcd1234'), undefined);
});

test('matrix: execute-plan rejects docs/specs/*.md', () => {
  assert.equal(recognizeExact('execute-plan', 'docs/specs/x.md'), undefined);
});

test('matrix: execute-plan rejects docs/briefs/*.md', () => {
  assert.equal(recognizeExact('execute-plan', 'docs/briefs/x.md'), undefined);
});

test('matrix: execute-plan rejects docs/reviews/*.md', () => {
  assert.equal(recognizeExact('execute-plan', 'docs/reviews/x.md'), undefined);
});

test('matrix: refine-code rejects empty', () => {
  assert.equal(recognizeExact('refine-code', ''), undefined);
});

test('matrix: refine-code rejects TODO-abcd1234', () => {
  assert.equal(recognizeExact('refine-code', 'TODO-abcd1234'), undefined);
});

test('matrix: refine-code rejects docs/specs/*.md', () => {
  assert.equal(recognizeExact('refine-code', 'docs/specs/x.md'), undefined);
});

test('matrix: refine-code rejects docs/briefs/*.md', () => {
  assert.equal(recognizeExact('refine-code', 'docs/briefs/x.md'), undefined);
});

test('matrix: refine-code rejects docs/plans/*.md', () => {
  assert.equal(recognizeExact('refine-code', 'docs/plans/x.md'), undefined);
});

test('matrix: fastlane rejects TODO-abcd1234', () => {
  assert.equal(recognizeExact('fastlane', 'TODO-abcd1234'), undefined);
});

test('matrix: fastlane rejects docs/briefs/*.md', () => {
  assert.equal(recognizeExact('fastlane', 'docs/briefs/x.md'), undefined);
});

test('matrix: fastlane rejects docs/plans/*.md', () => {
  assert.equal(recognizeExact('fastlane', 'docs/plans/x.md'), undefined);
});

test('matrix: fastlane rejects docs/reviews/*.md', () => {
  assert.equal(recognizeExact('fastlane', 'docs/reviews/x.md'), undefined);
});

// buildExactPrompt
test('buildExactPrompt with arg returns exact string', () => {
  assert.equal(
    buildExactPrompt('scout', 'TODO-abcd1234'),
    'Use the scout skill. Argument: TODO-abcd1234.'
  );
});

test('buildExactPrompt with empty arg returns (none)', () => {
  assert.equal(
    buildExactPrompt('scout', ''),
    'Use the scout skill. Argument: (none).'
  );
});

// buildInterpretedPrompt
test('buildInterpretedPrompt returns exact multi-line body', () => {
  const expected =
    'Use the scout skill to handle the following user request.\n\nUser wrote: investigate auth\n\nResolve the correct artifact path or identifier for the skill. If the request is unambiguous, invoke the skill directly. If the request is ambiguous, ask at most one clarifying question before invoking the skill.';
  assert.equal(buildInterpretedPrompt('scout', 'investigate auth'), expected);
});

// routeArgs
test('routeArgs --exact with prose returns exact-required-but-non-exact', () => {
  const result = routeArgs('scout', '--exact investigate auth');
  assert.equal(result.kind, 'exact-required-but-non-exact');
  assert.ok(result.reason?.includes('/flow:scout'), 'reason should contain /flow:scout');
  assert.ok(result.reason?.includes('investigate auth'), 'reason should contain the args');
});

test('routeArgs TODO-abcd1234 returns exact with correct prompt', () => {
  const result = routeArgs('scout', 'TODO-abcd1234');
  assert.deepEqual(result, {
    kind: 'exact',
    prompt: 'Use the scout skill. Argument: TODO-abcd1234.',
  });
});

test('routeArgs prose returns interpreted with correct prompt', () => {
  const expected =
    'Use the scout skill to handle the following user request.\n\nUser wrote: investigate auth\n\nResolve the correct artifact path or identifier for the skill. If the request is unambiguous, invoke the skill directly. If the request is ambiguous, ask at most one clarifying question before invoking the skill.';
  const result = routeArgs('scout', 'investigate auth');
  assert.deepEqual(result, { kind: 'interpreted', prompt: expected });
});

test('routeArgs generate-plan --exact docs/specs/x.md is rejected per matrix', () => {
  const result = routeArgs('generate-plan', '--exact docs/specs/example.md');
  assert.equal(result.kind, 'exact-required-but-non-exact');
  assert.ok(result.reason?.includes('/flow:plan'), 'reason should contain /flow:plan');
  assert.ok(result.reason?.includes('docs/specs/example.md'), 'reason should contain the path');
});

// Flag pass-through on exact-shaped inputs
test('recognizeExact TODO-id with trailing boolean flag preserves flag verbatim', () => {
  assert.equal(
    recognizeExact('scout', 'TODO-abcd1234 --dry-run'),
    'TODO-abcd1234 --dry-run'
  );
});

test('recognizeExact docs path with trailing value flag preserves flag verbatim', () => {
  assert.equal(
    recognizeExact('execute-plan', 'docs/plans/x.md --tier capable'),
    'docs/plans/x.md --tier capable'
  );
});

test('recognizeExact flag-only input routes as empty for empty-allowed skill', () => {
  assert.equal(recognizeExact('scout', '--tier capable'), '--tier capable');
});

test('recognizeExact flag-only input is rejected for skill that disallows empty', () => {
  assert.equal(recognizeExact('execute-plan', '--tier capable'), undefined);
});

test('routeArgs --exact TODO-id with flag routes as exact preserving flag', () => {
  const result = routeArgs('scout', '--exact TODO-abcd1234 --dry-run');
  assert.deepEqual(result, {
    kind: 'exact',
    prompt: 'Use the scout skill. Argument: TODO-abcd1234 --dry-run.',
  });
});

test('routeArgs --exact docs path with value flag routes as exact preserving flag', () => {
  const result = routeArgs('execute-plan', '--exact docs/plans/x.md --tier capable');
  assert.deepEqual(result, {
    kind: 'exact',
    prompt: 'Use the execute-plan skill. Argument: docs/plans/x.md --tier capable.',
  });
});

test('routeArgs --exact with wrong artifact dir returns exact-required-but-non-exact', () => {
  const result = routeArgs('execute-plan', '--exact docs/specs/x.md');
  assert.equal(result.kind, 'exact-required-but-non-exact');
  assert.ok(result.reason?.includes('/flow:execute'), 'reason should contain /flow:execute');
  assert.ok(result.reason?.includes('docs/specs/x.md'), 'reason should contain the path');
});

// Flags before artifacts / prose
test('recognizeExact scout flag-before-prose returns undefined (prose remains)', () => {
  assert.equal(
    recognizeExact('scout', '--tier capable investigate auth'),
    undefined
  );
});

test('recognizeExact execute-plan flag-before-artifact returns rest verbatim', () => {
  assert.equal(
    recognizeExact('execute-plan', '--tier capable docs/plans/x.md'),
    '--tier capable docs/plans/x.md'
  );
});

test('recognizeExact scout flag-before-artifact (briefs) returns rest verbatim', () => {
  assert.equal(
    recognizeExact('scout', '--tier capable docs/briefs/x.md'),
    '--tier capable docs/briefs/x.md'
  );
});

test('recognizeExact scout flag-with-value then TODO id returns rest verbatim', () => {
  assert.equal(
    recognizeExact('scout', '--tier capable TODO-abcd1234'),
    '--tier capable TODO-abcd1234'
  );
});

test('routeArgs scout flag-before-prose routes as interpreted', () => {
  const result = routeArgs('scout', '--tier capable investigate auth');
  assert.equal(result.kind, 'interpreted');
});

test('routeArgs execute-plan --exact with flag-before-artifact routes as exact preserving flag', () => {
  const result = routeArgs('execute-plan', '--exact --tier capable docs/plans/x.md');
  assert.deepEqual(result, {
    kind: 'exact',
    prompt: 'Use the execute-plan skill. Argument: --tier capable docs/plans/x.md.',
  });
});

test('routeArgs scout --exact with flag-before-prose returns exact-required-but-non-exact', () => {
  const result = routeArgs('scout', '--exact --tier capable investigate auth');
  assert.equal(result.kind, 'exact-required-but-non-exact');
});

// Whitespace normalization regressions
test('parseArgs trims leading/trailing whitespace from rest', () => {
  const result = parseArgs('  TODO-abcd1234  ');
  assert.deepEqual(result, { exactFlag: false, rest: 'TODO-abcd1234' });
});

test('parseArgs collapses repeated spaces after --exact', () => {
  const result = parseArgs('--exact   TODO-abcd1234');
  assert.deepEqual(result, { exactFlag: true, rest: 'TODO-abcd1234' });
});

test('parseArgs whitespace-only input yields empty rest', () => {
  const result = parseArgs('   ');
  assert.deepEqual(result, { exactFlag: false, rest: '' });
});

test('parseArgs truly empty input still yields empty rest', () => {
  const result = parseArgs('');
  assert.deepEqual(result, { exactFlag: false, rest: '' });
});

test('routeArgs TODO-id with leading/trailing whitespace routes as exact', () => {
  const result = routeArgs('scout', '  TODO-abcd1234  ');
  assert.deepEqual(result, {
    kind: 'exact',
    prompt: 'Use the scout skill. Argument: TODO-abcd1234.',
  });
});

test('routeArgs --exact with repeated spaces before TODO-id routes as exact', () => {
  const result = routeArgs('scout', '--exact   TODO-abcd1234');
  assert.deepEqual(result, {
    kind: 'exact',
    prompt: 'Use the scout skill. Argument: TODO-abcd1234.',
  });
});

test('routeArgs whitespace-only args routes as exact for empty-allowed skill', () => {
  const result = routeArgs('scout', '   ');
  assert.equal(result.kind, 'exact');
  assert.equal(result.prompt, 'Use the scout skill. Argument: (none).');
});
