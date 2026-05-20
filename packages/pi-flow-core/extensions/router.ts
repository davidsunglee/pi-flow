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
  { empty: boolean; todoId: boolean; briefs: boolean; specs: boolean; plans: boolean; reviews: boolean }
> = {
  'scout':         { empty: true,  todoId: true,  briefs: true,  specs: false, plans: false, reviews: false },
  'define-spec':   { empty: true,  todoId: true,  briefs: false, specs: true,  plans: false, reviews: false },
  'generate-plan': { empty: true,  todoId: true,  briefs: true,  specs: false, plans: false, reviews: false },
  'refine-plan':   { empty: false, todoId: false, briefs: false, specs: false, plans: true,  reviews: false },
  'execute-plan':  { empty: false, todoId: false, briefs: false, specs: false, plans: true,  reviews: false },
  'refine-code':   { empty: false, todoId: false, briefs: false, specs: false, plans: false, reviews: true  },
  'fastlane':      { empty: true,  todoId: false, briefs: false, specs: true,  plans: false, reviews: false },
};

export function parseArgs(rawArgs: string): ParsedArgs {
  if (rawArgs === '') return { exactFlag: false, rest: '' };
  const tokens = rawArgs.split(/\s+/);
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

const TODO_RE = /^(TODO-)?([0-9a-f]{8})$/;
const DOCS_DIR_RE = /docs\/(briefs|specs|plans|reviews)\//;

export function recognizeExact(skill: SkillKey, rest: string): string | undefined {
  const matrix = EXACT_INPUT_MATRIX[skill];

  const tokens = rest === '' ? [] : rest.split(/\s+/);
  const firstFlagIdx = tokens.findIndex(t => t.startsWith('--'));
  const positionalTokens = firstFlagIdx === -1 ? tokens : tokens.slice(0, firstFlagIdx);
  const hasFlags = firstFlagIdx !== -1;

  // Empty / flag-only input
  if (positionalTokens.length === 0) {
    return matrix.empty ? rest : undefined;
  }

  if (positionalTokens.length !== 1) {
    return undefined;
  }

  const positional = positionalTokens[0];

  // TODO-<8hex> or bare <8hex>
  const m = positional.match(TODO_RE);
  if (m) {
    if (!matrix.todoId) return undefined;
    return hasFlags ? rest : `TODO-${m[2]}`;
  }

  // docs/<dir>/*.md
  if (positional.endsWith('.md')) {
    const dirMatch = positional.match(DOCS_DIR_RE);
    if (dirMatch) {
      const dir = dirMatch[1] as 'briefs' | 'specs' | 'plans' | 'reviews';
      if (!matrix[dir]) return undefined;
      return hasFlags ? rest : positional;
    }
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
