import type {
  CodexAssistInput,
  CodexAssistRecipeInput,
  CodexAssistResult,
  PromptDraftNodeDto,
  PromptDraftProposalDto,
} from '@/shared/contracts';

export const promptDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    warnings: { type: 'array', maxItems: 8, items: { type: 'string' } },
    contentNodes: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: { kind: { type: 'string', enum: ['TEXT'] }, text: { type: 'string' } },
            required: ['kind', 'text'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['TERM'] },
              termId: { type: 'string' },
              termRevisionId: { type: 'string' },
            },
            required: ['kind', 'termId', 'termRevisionId'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['RECIPE'] },
              paletteId: { type: 'string' },
              paletteRevisionId: { type: 'string' },
            },
            required: ['kind', 'paletteId', 'paletteRevisionId'],
          },
        ],
      },
    },
  },
  required: ['summary', 'warnings', 'contentNodes'],
} as const;

export type PromptDraftValidationInput = Omit<CodexAssistResult, 'promptDraft'> & { promptDraft?: unknown };

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function rawDraft(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { summary?: unknown; warnings?: unknown; contentNodes?: unknown })
    : null;
}

function retainedRecipeInternalTermKeys(
  rawNodes: readonly unknown[],
  allowedRecipes: ReadonlyMap<string, CodexAssistRecipeInput>,
) {
  const retained = new Set<string>();
  for (const rawNode of rawNodes) {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) continue;
    const node = rawNode as Record<string, unknown>;
    if (node.kind !== 'RECIPE') continue;
    const recipe = allowedRecipes.get(text(node.paletteId, 200));
    if (!recipe || recipe.revisionId !== text(node.paletteRevisionId, 200)) continue;
    for (const term of recipe.internalTerms) retained.add(`${term.stableId}\u0000${term.revisionId}`);
  }
  return retained;
}

function isRedundantAddedTerm(
  termId: string,
  termRevisionId: string,
  originalDirectTermIds: ReadonlySet<string>,
  retainedRecipeInternalTerms: ReadonlySet<string>,
) {
  return !originalDirectTermIds.has(termId) && retainedRecipeInternalTerms.has(`${termId}\u0000${termRevisionId}`);
}

function withoutRedundantAddedTerms(
  rawNodes: readonly unknown[],
  allowedTerms: ReadonlyMap<string, CodexAssistInput['directTerms'][number]>,
  originalDirectTermIds: ReadonlySet<string>,
  retainedRecipeInternalTerms: ReadonlySet<string>,
) {
  return rawNodes.filter((rawNode) => {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) return true;
    const node = rawNode as Record<string, unknown>;
    if (node.kind !== 'TERM') return true;
    const term = allowedTerms.get(text(node.termId, 200));
    if (!term || term.revisionId !== text(node.termRevisionId, 200)) return true;
    return !isRedundantAddedTerm(term.stableId, term.revisionId, originalDirectTermIds, retainedRecipeInternalTerms);
  });
}

/** Converts model-authored references into canonical frozen dictionary data.
 * Unknown IDs, stale revisions, duplicate references and arbitrary recipes are
 * rejected instead of being silently flattened into free text. */
export function validatePromptDraftResult(
  input: CodexAssistInput,
  result: PromptDraftValidationInput,
): CodexAssistResult {
  if (input.mode !== 'optimize') return { ...result, promptDraft: undefined };
  const draft = rawDraft(result.promptDraft);
  if (!draft || !Array.isArray(draft.contentNodes) || draft.contentNodes.length === 0) {
    throw new Error('Assistant returned no usable Prompt draft');
  }
  if (draft.contentNodes.length > 100) throw new Error('Assistant Prompt draft contains too many nodes');

  const allowedTerms = new Map(
    [...input.directTerms, ...(input.candidateTerms ?? [])].map((term) => [term.stableId, term] as const),
  );
  const allowedRecipes = new Map(input.recipes.map((recipe) => [recipe.stableId, recipe] as const));
  const originalDirectTermIds = new Set(input.directTerms.map((term) => term.stableId));
  const retainedRecipeInternalTerms = retainedRecipeInternalTermKeys(draft.contentNodes, allowedRecipes);
  const canonicalRawNodes = withoutRedundantAddedTerms(
    draft.contentNodes,
    allowedTerms,
    originalDirectTermIds,
    retainedRecipeInternalTerms,
  );
  const usedTerms = new Set<string>();
  const usedRecipes = new Set<string>();
  const contentNodes: PromptDraftNodeDto[] = [];
  let textLength = 0;
  let hasRenderableContent = false;

  for (const rawNode of canonicalRawNodes) {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) {
      throw new Error('Assistant Prompt draft contains an invalid node');
    }
    const node = rawNode as Record<string, unknown>;
    if (node.kind === 'TEXT') {
      const value = text(node.text, 30_000);
      if (!value.trim()) continue;
      textLength += value.length;
      if (textLength > 30_000) throw new Error('Assistant Prompt draft text is too long');
      hasRenderableContent = true;
      const previous = contentNodes.at(-1);
      if (previous?.kind === 'TEXT') previous.text += value;
      else contentNodes.push({ kind: 'TEXT', text: value });
      continue;
    }
    if (node.kind === 'TERM') {
      const termId = text(node.termId, 200);
      const termRevisionId = text(node.termRevisionId, 200);
      const term = allowedTerms.get(termId);
      if (!term || term.revisionId !== termRevisionId) {
        throw new Error('Assistant Prompt draft referenced an unavailable term revision');
      }
      if (usedTerms.has(termId)) throw new Error('Assistant Prompt draft repeated a term');
      usedTerms.add(termId);
      hasRenderableContent ||= Boolean(term.promptFragment.trim());
      contentNodes.push({
        kind: 'TERM',
        termId,
        termRevisionId,
        displayName: term.displayName,
      });
      continue;
    }
    if (node.kind === 'RECIPE') {
      const paletteId = text(node.paletteId, 200);
      const paletteRevisionId = text(node.paletteRevisionId, 200);
      const recipe = allowedRecipes.get(paletteId);
      if (!recipe || recipe.revisionId !== paletteRevisionId) {
        throw new Error('Assistant Prompt draft referenced an unavailable recipe revision');
      }
      if (usedRecipes.has(paletteId)) throw new Error('Assistant Prompt draft repeated a recipe');
      usedRecipes.add(paletteId);
      hasRenderableContent ||= Boolean(recipe.promptFragment.trim());
      contentNodes.push({
        kind: 'RECIPE',
        paletteId,
        paletteRevisionId,
        displayName: recipe.displayName,
        parameterValues: { ...recipe.parameterValues },
        promptLocale: recipe.promptLocale,
      });
      continue;
    }
    throw new Error('Assistant Prompt draft contains an unknown node kind');
  }

  if (contentNodes.length === 0) throw new Error('Assistant returned an empty Prompt draft');
  if (!hasRenderableContent) throw new Error('Assistant Prompt draft cannot produce a usable Prompt');
  const summary = text(draft.summary, 2_000) || result.assistantMessage;
  const promptDraft: PromptDraftProposalDto = {
    summary,
    warnings: Array.isArray(draft.warnings)
      ? draft.warnings
          .map((warning) => text(warning, 500))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    contentNodes,
  };
  const { optimizedPrompt: _optimizedPrompt, promptEdit: _promptEdit, ...draftResult } = result;
  return {
    ...draftResult,
    directions: [],
    promptDraft,
  };
}
