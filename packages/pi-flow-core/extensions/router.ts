export type SkillKey =
  | 'scout'
  | 'define-spec'
  | 'generate-plan'
  | 'refine-plan'
  | 'execute-plan'
  | 'refine-code'
  | 'fastlane';

export const SLASH_TO_SKILL: Record<string, SkillKey> = {
  'flow:scout': 'scout',
  'flow:spec': 'define-spec',
  'flow:plan': 'generate-plan',
  'flow:refine-plan': 'refine-plan',
  'flow:execute': 'execute-plan',
  'flow:refine-code': 'refine-code',
  'flow:fastlane': 'fastlane',
};

export interface ParsedArgs {
  exactFlag: boolean;
  rest: string;
}

export interface RouteOutcome {
  kind: 'exact' | 'interpreted' | 'exact-required-but-non-exact';
  prompt?: string;
  reason?: string;
}

export const EXACT_INPUT_MATRIX: Record<
  SkillKey,
  { empty: boolean; ideaId: boolean; briefs: boolean; specs: boolean; plans: boolean; reviews: boolean }
> = {
  'scout':         { empty: true,  ideaId: true,  briefs: true,  specs: false, plans: false, reviews: false },
  'define-spec':   { empty: true,  ideaId: true,  briefs: false, specs: true,  plans: false, reviews: false },
  'generate-plan': { empty: true,  ideaId: true,  briefs: true,  specs: false, plans: false, reviews: false },
  'refine-plan':   { empty: false, ideaId: false, briefs: false, specs: false, plans: true,  reviews: false },
  'execute-plan':  { empty: false, ideaId: false, briefs: false, specs: false, plans: true,  reviews: false },
  'refine-code':   { empty: false, ideaId: false, briefs: false, specs: false, plans: false, reviews: true  },
  'fastlane':      { empty: true,  ideaId: false, briefs: false, specs: true,  plans: false, reviews: false },
};

export function parseArgs(rawArgs: string): ParsedArgs {
  if (rawArgs === '') return { exactFlag: false, rest: '' };
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  let exactFlag = false;
  const rest = tokens
    .filter(t => {
      if (t === '--exact' || t === '--no-interpret') {
        exactFlag = true;
        return false;
      }
      return true;
    })
    .join(' ');
  return { exactFlag, rest };
}

const IDEA_RE = /^(IDEA-)?([0-9a-f]{8})$/;
const DOCS_DIR_RE = /docs\/(briefs|specs|plans|reviews)\//;

function isArtifactToken(t: string): boolean {
  if (IDEA_RE.test(t)) return true;
  if (t.endsWith('.md') && DOCS_DIR_RE.test(t)) return true;
  return false;
}

export function recognizeExact(skill: SkillKey, rest: string): string | undefined {
  const matrix = EXACT_INPUT_MATRIX[skill];

  const tokens = rest === '' ? [] : rest.split(/\s+/);

  let positional: string | undefined;
  let multipleArtifacts = false;
  let proseFound = false;
  let prevWasFlag = false;
  let hasFlags = false;

  for (const t of tokens) {
    if (t.startsWith('--')) {
      hasFlags = true;
      prevWasFlag = true;
      continue;
    }
    if (isArtifactToken(t)) {
      if (positional !== undefined) multipleArtifacts = true;
      else positional = t;
      prevWasFlag = false;
      continue;
    }
    if (prevWasFlag) {
      // Treat as the preceding flag's value.
      prevWasFlag = false;
      continue;
    }
    proseFound = true;
  }

  if (proseFound || multipleArtifacts) return undefined;

  if (positional === undefined) {
    return matrix.empty ? rest : undefined;
  }

  const m = positional.match(IDEA_RE);
  if (m) {
    if (!matrix.ideaId) return undefined;
    return hasFlags ? rest : `IDEA-${m[2]}`;
  }

  const dirMatch = positional.match(DOCS_DIR_RE);
  if (dirMatch) {
    const dir = dirMatch[1] as 'briefs' | 'specs' | 'plans' | 'reviews';
    if (!matrix[dir]) return undefined;
    return hasFlags ? rest : positional;
  }

  return undefined;
}

export function buildExactPrompt(skill: SkillKey, resolvedArg: string): string {
  return `Use the ${skill} skill. Argument: ${resolvedArg || '(none)'}.`;
}

export function buildInterpretedPrompt(skill: SkillKey, rawArgs: string): string {
  return (
    `Use the ${skill} skill to handle the following user request.\n\n` +
    `User wrote: ${rawArgs || '(no arguments)'}\n\n` +
    `Resolve the correct artifact path or identifier for the skill. If the request is unambiguous, invoke the skill directly. If the request is ambiguous, ask at most one clarifying question before invoking the skill.`
  );
}

function slashFor(skill: SkillKey): string {
  for (const [slash, s] of Object.entries(SLASH_TO_SKILL)) {
    if (s === skill) return slash.replace('flow:', '');
  }
  return skill;
}

export function routeArgs(skill: SkillKey, rawArgs: string): RouteOutcome {
  const { exactFlag, rest } = parseArgs(rawArgs);
  const resolved = recognizeExact(skill, rest);

  if (resolved !== undefined) {
    return { kind: 'exact', prompt: buildExactPrompt(skill, resolved) };
  }

  if (exactFlag) {
    return {
      kind: 'exact-required-but-non-exact',
      reason: `/flow:${slashFor(skill)} requires an exact artifact when --exact/--no-interpret is set; got: ${rawArgs || '(empty)'}`,
    };
  }

  return { kind: 'interpreted', prompt: buildInterpretedPrompt(skill, rawArgs) };
}
