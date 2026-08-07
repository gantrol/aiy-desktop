export type PromptContributionKind = 'USER_INSTRUCTION' | 'TERM' | 'RECIPE_FRAGMENT' | 'RECIPE_PARAMETER' | 'SPEC';
export type PromptExclusionTargetKind = Exclude<PromptContributionKind, 'USER_INSTRUCTION'> | 'REFERENCE';

export interface PromptTermInput {
  stableId: string;
  revisionId: string;
  expressionRevisionId: string;
  label: string;
  positiveExpression: string;
  negativeExpression?: string;
}

export interface RecipeParameterExpressionInput {
  stableId: string;
  revisionId: string;
  optionStableId: string;
  expressionRevisionId: string;
  positiveExpression: string;
  negativeExpression?: string;
}

export interface RecipeReferenceInput {
  stableId: string;
  revisionId: string;
  contentHash: string;
  role: string;
}

export type PromptRecipeContentExpressionInput =
  | { kind: 'TERM'; term: PromptTermInput }
  | {
      kind: 'RECIPE_FRAGMENT';
      stableId: string;
      positiveExpression: string;
      negativeExpression?: string;
    }
  | { kind: 'RECIPE_PARAMETER'; parameter: RecipeParameterExpressionInput };

export interface PromptRecipeUseInput {
  useId: string;
  stableId: string;
  revisionId: string;
  terms: readonly PromptTermInput[];
  parameterExpressions: readonly RecipeParameterExpressionInput[];
  /** Exact authored order, including punctuation and whitespace as fragments. */
  contentExpressions: readonly PromptRecipeContentExpressionInput[];
  references: readonly RecipeReferenceInput[];
}

export interface PromptSpecInput {
  stableId: string;
  revisionId: string;
  expressionRevisionId: string;
  positiveExpression: string;
  negativeExpression?: string;
}

export type PromptExclusionScope = { kind: 'ALL' } | { kind: 'DIRECT' } | { kind: 'RECIPE_USE'; useId: string };

export interface PromptCompositionExclusion {
  targetKind: PromptExclusionTargetKind;
  stableId: string;
  scope?: PromptExclusionScope;
}

export interface PromptCompositionInput {
  userInstruction: string;
  directTerms: readonly PromptTermInput[];
  recipes: readonly PromptRecipeUseInput[];
  /** Optional creator-authored order. References point to the structured inputs above. */
  contentNodes?: readonly PromptCompositionContentNodeInput[];
  exclusions: readonly PromptCompositionExclusion[];
  specs: readonly PromptSpecInput[];
  separator?: string;
  negativeSeparator?: string;
}

export type PromptCompositionContentNodeInput =
  { kind: 'TEXT'; text: string } | { kind: 'TERM'; stableId: string } | { kind: 'RECIPE'; useId: string };

export type PromptSourcePathSegment =
  | { kind: 'USER_INSTRUCTION' }
  | { kind: 'DIRECT_INPUT' }
  | { kind: 'RECIPE_USE'; useId: string; stableId: string; revisionId: string }
  | { kind: 'RECIPE_FRAGMENT'; stableId: string }
  | { kind: 'TERM'; stableId: string; revisionId: string; expressionRevisionId: string }
  | {
      kind: 'RECIPE_PARAMETER';
      stableId: string;
      revisionId: string;
      optionStableId: string;
      expressionRevisionId: string;
    }
  | { kind: 'SPEC'; stableId: string; revisionId: string; expressionRevisionId: string }
  | { kind: 'REFERENCE'; stableId: string; revisionId: string; contentHash: string; role: string };

export interface PromptSourcePath {
  segments: readonly PromptSourcePathSegment[];
}

interface ResolvedContributionBase {
  stableId: string;
  positiveExpression: string;
  negativeExpression: string;
  sourcePaths: readonly PromptSourcePath[];
}

export interface ResolvedUserInstructionContribution extends ResolvedContributionBase {
  kind: 'USER_INSTRUCTION';
}

export interface ResolvedPromptTerm extends ResolvedContributionBase {
  kind: 'TERM';
  revisionId: string;
  expressionRevisionId: string;
  label: string;
}

export interface ResolvedRecipeParameterContribution extends ResolvedContributionBase {
  kind: 'RECIPE_PARAMETER';
  revisionId: string;
  optionStableId: string;
  expressionRevisionId: string;
}

export interface ResolvedRecipeFragmentContribution extends ResolvedContributionBase {
  kind: 'RECIPE_FRAGMENT';
}

export interface ResolvedSpecContribution extends ResolvedContributionBase {
  kind: 'SPEC';
  revisionId: string;
  expressionRevisionId: string;
}

export type ResolvedPromptContribution =
  | ResolvedUserInstructionContribution
  | ResolvedPromptTerm
  | ResolvedRecipeFragmentContribution
  | ResolvedRecipeParameterContribution
  | ResolvedSpecContribution;

interface FrozenReferenceBase {
  sourcePaths: readonly PromptSourcePath[];
}

export interface FrozenTermReference extends FrozenReferenceBase {
  kind: 'TERM_EXPRESSION_REVISION';
  stableId: string;
  revisionId: string;
  expressionRevisionId: string;
}

export interface FrozenRecipeReference extends FrozenReferenceBase {
  kind: 'RECIPE_REVISION';
  useId: string;
  stableId: string;
  revisionId: string;
}

export interface FrozenRecipeParameterReference extends FrozenReferenceBase {
  kind: 'RECIPE_PARAMETER_EXPRESSION';
  recipeUseId: string;
  stableId: string;
  revisionId: string;
  optionStableId: string;
  expressionRevisionId: string;
}

export interface FrozenMaterialReference extends FrozenReferenceBase {
  kind: 'MATERIAL_REVISION';
  stableId: string;
  revisionId: string;
  contentHash: string;
  role: string;
}

export interface FrozenSpecReference extends FrozenReferenceBase {
  kind: 'SPEC_EXPRESSION_REVISION';
  stableId: string;
  revisionId: string;
  expressionRevisionId: string;
}

export interface FrozenExclusionReference extends FrozenReferenceBase {
  kind: 'EXCLUSION';
  targetKind: PromptExclusionTargetKind;
  stableId: string;
  scope: PromptExclusionScope;
}

export type FrozenPromptReference =
  | FrozenTermReference
  | FrozenRecipeReference
  | FrozenRecipeParameterReference
  | FrozenMaterialReference
  | FrozenSpecReference
  | FrozenExclusionReference;

export interface ResolvedPromptComposition {
  userInstruction: string;
  effectiveTerms: readonly ResolvedPromptTerm[];
  contributions: readonly ResolvedPromptContribution[];
  commonExpression: string;
  negativeExpression: string;
  sourcePaths: readonly PromptSourcePath[];
  frozenReferences: readonly FrozenPromptReference[];
}

type CandidateSource = { kind: 'DIRECT' } | { kind: 'RECIPE_USE'; useId: string } | { kind: 'SPEC' };

const userInstructionStableId = 'user-instruction';

function trimmed(value: string | undefined) {
  return value?.trim() ?? '';
}

function requiredId(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function sourcePath(segments: PromptSourcePathSegment[]): PromptSourcePath {
  return { segments };
}

export function promptSourcePathKey(path: PromptSourcePath) {
  return JSON.stringify(path.segments);
}

export function joinPromptExpressions(expressions: readonly string[], separator = ', ') {
  return expressions.map(trimmed).filter(Boolean).join(separator);
}

function contributionKey(contribution: Pick<ResolvedPromptContribution, 'kind' | 'stableId'>) {
  return `${contribution.kind}:${contribution.stableId}`;
}

function contributionSignature(contribution: ResolvedPromptContribution) {
  if (contribution.kind === 'TERM') {
    const { sourcePaths: _sourcePaths, label: _label, ...stable } = contribution;
    return JSON.stringify(stable);
  }
  const { sourcePaths: _sourcePaths, ...stable } = contribution;
  return JSON.stringify(stable);
}

function mergePaths(current: readonly PromptSourcePath[], additions: readonly PromptSourcePath[]) {
  const seen = new Set(current.map(promptSourcePathKey));
  const merged = [...current];
  for (const path of additions) {
    const key = promptSourcePathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(path);
  }
  return merged;
}

function scopeMatches(scope: PromptExclusionScope, source: CandidateSource) {
  if (scope.kind === 'ALL') return true;
  if (scope.kind === 'DIRECT') return source.kind === 'DIRECT';
  return source.kind === 'RECIPE_USE' && source.useId === scope.useId;
}

function isExcluded(
  exclusions: readonly PromptCompositionExclusion[],
  targetKind: PromptExclusionTargetKind,
  stableId: string,
  source: CandidateSource,
) {
  return exclusions.some(
    (exclusion) =>
      exclusion.targetKind === targetKind &&
      exclusion.stableId === stableId &&
      scopeMatches(exclusion.scope ?? { kind: 'ALL' }, source),
  );
}

function termPath(term: PromptTermInput, recipe?: PromptRecipeUseInput): PromptSourcePath {
  const termSegment: PromptSourcePathSegment = {
    kind: 'TERM',
    stableId: term.stableId,
    revisionId: term.revisionId,
    expressionRevisionId: term.expressionRevisionId,
  };
  return recipe
    ? sourcePath([
        {
          kind: 'RECIPE_USE',
          useId: recipe.useId,
          stableId: recipe.stableId,
          revisionId: recipe.revisionId,
        },
        termSegment,
      ])
    : sourcePath([{ kind: 'DIRECT_INPUT' }, termSegment]);
}

function resolvedTerm(term: PromptTermInput, path: PromptSourcePath): ResolvedPromptTerm {
  return {
    kind: 'TERM',
    stableId: term.stableId,
    revisionId: term.revisionId,
    expressionRevisionId: term.expressionRevisionId,
    label: term.label,
    positiveExpression: trimmed(term.positiveExpression),
    negativeExpression: trimmed(term.negativeExpression),
    sourcePaths: [path],
  };
}

export class PromptCompositionConflictError extends Error {
  constructor(
    readonly contributionKind: ResolvedPromptContribution['kind'],
    readonly stableId: string,
  ) {
    super(`Conflicting ${contributionKind} revisions or expressions for stable ID: ${stableId}`);
    this.name = 'PromptCompositionConflictError';
  }
}

export function resolvePromptComposition(input: PromptCompositionInput): ResolvedPromptComposition {
  const userInstruction = trimmed(input.userInstruction);
  const exclusions = input.exclusions.map((exclusion) => {
    const scope = exclusion.scope ?? { kind: 'ALL' as const };
    return {
      ...exclusion,
      stableId: requiredId(exclusion.stableId, 'Exclusion stable ID'),
      scope:
        scope.kind === 'RECIPE_USE'
          ? ({ kind: scope.kind, useId: requiredId(scope.useId, 'Excluded recipe use ID') } as const)
          : ({ kind: scope.kind } as const),
    };
  });

  const contributions: ResolvedPromptContribution[] = [];
  const positiveExpressions: string[] = [];
  const contributionIndexes = new Map<string, number>();
  const frozenReferences: FrozenPromptReference[] = [];
  const frozenIndexes = new Map<string, number>();
  const paths: PromptSourcePath[] = [];
  const pathKeys = new Set<string>();
  const recipeUseIds = new Set<string>();
  const recipeExpressions = new Map<string, string>();
  const materialRevisions = new Map<string, string>();

  function trackPath(path: PromptSourcePath) {
    const key = promptSourcePathKey(path);
    if (pathKeys.has(key)) return;
    pathKeys.add(key);
    paths.push(path);
  }

  function addContribution(contribution: ResolvedPromptContribution) {
    for (const path of contribution.sourcePaths) trackPath(path);
    const key = contributionKey(contribution);
    const existingIndex = contributionIndexes.get(key);
    if (existingIndex === undefined) {
      contributionIndexes.set(key, contributions.length);
      contributions.push(contribution);
      return true;
    }
    const existing = contributions[existingIndex];
    if (contributionSignature(existing) !== contributionSignature(contribution)) {
      throw new PromptCompositionConflictError(contribution.kind, contribution.stableId);
    }
    contributions[existingIndex] = {
      ...existing,
      sourcePaths: mergePaths(existing.sourcePaths, contribution.sourcePaths),
    } as ResolvedPromptContribution;
    return false;
  }

  function addFrozen(key: string, reference: FrozenPromptReference) {
    const existingIndex = frozenIndexes.get(key);
    if (existingIndex === undefined) {
      frozenIndexes.set(key, frozenReferences.length);
      frozenReferences.push(reference);
      return;
    }
    const existing = frozenReferences[existingIndex];
    frozenReferences[existingIndex] = {
      ...existing,
      sourcePaths: mergePaths(existing.sourcePaths, reference.sourcePaths),
    } as FrozenPromptReference;
  }

  function addTerm(term: PromptTermInput, source: CandidateSource, recipe?: PromptRecipeUseInput) {
    const stableId = requiredId(term.stableId, 'Term stable ID');
    const normalizedTerm = {
      ...term,
      stableId,
      revisionId: requiredId(term.revisionId, 'Term revision ID'),
      expressionRevisionId: requiredId(term.expressionRevisionId, 'Term expression revision ID'),
      label: trimmed(term.label) || stableId,
    };
    if (isExcluded(exclusions, 'TERM', stableId, source)) return null;
    const path = termPath(normalizedTerm, recipe);
    const contribution = resolvedTerm(normalizedTerm, path);
    const added = addContribution(contribution);
    addFrozen(`TERM:${stableId}:${normalizedTerm.revisionId}:${normalizedTerm.expressionRevisionId}`, {
      kind: 'TERM_EXPRESSION_REVISION',
      stableId,
      revisionId: normalizedTerm.revisionId,
      expressionRevisionId: normalizedTerm.expressionRevisionId,
      sourcePaths: [path],
    });
    return { contribution, added };
  }

  if (userInstruction) {
    const path = sourcePath([{ kind: 'USER_INSTRUCTION' }]);
    const contribution: ResolvedUserInstructionContribution = {
      kind: 'USER_INSTRUCTION',
      stableId: userInstructionStableId,
      positiveExpression: userInstruction,
      negativeExpression: '',
      sourcePaths: [path],
    };
    if (addContribution(contribution)) positiveExpressions.push(contribution.positiveExpression);
  }

  for (const term of input.directTerms) {
    const resolved = addTerm(term, { kind: 'DIRECT' });
    if (resolved?.added) positiveExpressions.push(resolved.contribution.positiveExpression);
  }

  for (const recipe of input.recipes) {
    const useId = requiredId(recipe.useId, 'Recipe use ID');
    if (recipeUseIds.has(useId)) throw new Error(`Duplicate recipe use ID: ${useId}`);
    recipeUseIds.add(useId);
    const normalizedRecipe = {
      ...recipe,
      useId,
      stableId: requiredId(recipe.stableId, 'Recipe stable ID'),
      revisionId: requiredId(recipe.revisionId, 'Recipe revision ID'),
    };
    const recipePath = sourcePath([
      {
        kind: 'RECIPE_USE',
        useId,
        stableId: normalizedRecipe.stableId,
        revisionId: normalizedRecipe.revisionId,
      },
    ]);
    trackPath(recipePath);
    addFrozen(`RECIPE:${useId}`, {
      kind: 'RECIPE_REVISION',
      useId,
      stableId: normalizedRecipe.stableId,
      revisionId: normalizedRecipe.revisionId,
      sourcePaths: [recipePath],
    });

    const addRecipeParameter = (parameter: RecipeParameterExpressionInput) => {
      const stableId = requiredId(parameter.stableId, 'Recipe parameter stable ID');
      if (isExcluded(exclusions, 'RECIPE_PARAMETER', stableId, { kind: 'RECIPE_USE', useId })) return null;
      const revisionId = requiredId(parameter.revisionId, 'Recipe parameter revision ID');
      const optionStableId = requiredId(parameter.optionStableId, 'Recipe parameter option stable ID');
      const expressionRevisionId = requiredId(
        parameter.expressionRevisionId,
        'Recipe parameter expression revision ID',
      );
      const path = sourcePath([
        recipePath.segments[0],
        {
          kind: 'RECIPE_PARAMETER',
          stableId,
          revisionId,
          optionStableId,
          expressionRevisionId,
        },
      ]);
      const contribution: ResolvedRecipeParameterContribution = {
        kind: 'RECIPE_PARAMETER',
        stableId,
        revisionId,
        optionStableId,
        expressionRevisionId,
        positiveExpression: trimmed(parameter.positiveExpression),
        negativeExpression: trimmed(parameter.negativeExpression),
        sourcePaths: [path],
      };
      const added = addContribution(contribution);
      addFrozen(`RECIPE_PARAMETER:${useId}:${stableId}`, {
        kind: 'RECIPE_PARAMETER_EXPRESSION',
        recipeUseId: useId,
        stableId,
        revisionId,
        optionStableId,
        expressionRevisionId,
        sourcePaths: [path],
      });
      return { contribution, added };
    };

    let authoredExpression = '';
    let pendingSeparator = '';
    const separatorOnly = (value: string) => /^[\s,;:|/·–—-]*$/u.test(value);
    const appendAuthored = (value: string) => {
      if (!value.trim()) return;
      if (authoredExpression.trim()) authoredExpression += pendingSeparator;
      pendingSeparator = '';
      authoredExpression += value;
    };
    for (const content of normalizedRecipe.contentExpressions) {
      if (content.kind === 'TERM') {
        const resolved = addTerm(content.term, { kind: 'RECIPE_USE', useId }, normalizedRecipe);
        if (resolved?.added) appendAuthored(content.term.positiveExpression);
        continue;
      }
      if (content.kind === 'RECIPE_PARAMETER') {
        const resolved = addRecipeParameter(content.parameter);
        if (resolved?.added) appendAuthored(content.parameter.positiveExpression);
        continue;
      }
      const stableId = requiredId(content.stableId, 'Recipe fragment stable ID');
      if (isExcluded(exclusions, 'RECIPE_FRAGMENT', stableId, { kind: 'RECIPE_USE', useId })) continue;
      const path = sourcePath([recipePath.segments[0], { kind: 'RECIPE_FRAGMENT', stableId }]);
      const contribution: ResolvedRecipeFragmentContribution = {
        kind: 'RECIPE_FRAGMENT',
        stableId,
        positiveExpression: content.positiveExpression,
        negativeExpression: content.negativeExpression ?? '',
        sourcePaths: [path],
      };
      if (!addContribution(contribution)) continue;
      if (separatorOnly(content.positiveExpression)) pendingSeparator += content.positiveExpression;
      else {
        if (authoredExpression.trim()) authoredExpression += pendingSeparator;
        pendingSeparator = '';
        authoredExpression += content.positiveExpression;
      }
    }
    recipeExpressions.set(useId, authoredExpression);
    if (authoredExpression.trim()) positiveExpressions.push(authoredExpression);

    for (const reference of normalizedRecipe.references) {
      const stableId = requiredId(reference.stableId, 'Reference stable ID');
      if (isExcluded(exclusions, 'REFERENCE', stableId, { kind: 'RECIPE_USE', useId })) continue;
      const revisionId = requiredId(reference.revisionId, 'Reference revision ID');
      const contentHash = requiredId(reference.contentHash, 'Reference content hash');
      const role = requiredId(reference.role, 'Reference role');
      const materialSignature = `${revisionId}:${contentHash}`;
      const existingMaterialSignature = materialRevisions.get(stableId);
      if (existingMaterialSignature && existingMaterialSignature !== materialSignature) {
        throw new Error(`Conflicting material revisions for stable ID: ${stableId}`);
      }
      materialRevisions.set(stableId, materialSignature);
      const path = sourcePath([
        recipePath.segments[0],
        {
          kind: 'REFERENCE',
          stableId,
          revisionId,
          contentHash,
          role,
        },
      ]);
      trackPath(path);
      addFrozen(`MATERIAL:${stableId}:${revisionId}:${contentHash}:${role}`, {
        kind: 'MATERIAL_REVISION',
        stableId,
        revisionId,
        contentHash,
        role,
        sourcePaths: [path],
      });
    }
  }

  for (const spec of input.specs) {
    const stableId = requiredId(spec.stableId, 'Spec stable ID');
    if (isExcluded(exclusions, 'SPEC', stableId, { kind: 'SPEC' })) continue;
    const revisionId = requiredId(spec.revisionId, 'Spec revision ID');
    const expressionRevisionId = requiredId(spec.expressionRevisionId, 'Spec expression revision ID');
    const path = sourcePath([
      {
        kind: 'SPEC',
        stableId,
        revisionId,
        expressionRevisionId,
      },
    ]);
    const contribution: ResolvedSpecContribution = {
      kind: 'SPEC',
      stableId,
      revisionId,
      expressionRevisionId,
      positiveExpression: trimmed(spec.positiveExpression),
      negativeExpression: trimmed(spec.negativeExpression),
      sourcePaths: [path],
    };
    if (addContribution(contribution)) positiveExpressions.push(contribution.positiveExpression);
    addFrozen(`SPEC:${stableId}:${revisionId}:${expressionRevisionId}`, {
      kind: 'SPEC_EXPRESSION_REVISION',
      stableId,
      revisionId,
      expressionRevisionId,
      sourcePaths: [path],
    });
  }

  for (const [index, exclusion] of exclusions.entries()) {
    addFrozen(`EXCLUSION:${index}:${exclusion.targetKind}:${exclusion.stableId}`, {
      kind: 'EXCLUSION',
      targetKind: exclusion.targetKind,
      stableId: exclusion.stableId,
      scope: exclusion.scope,
      sourcePaths: [],
    });
  }

  const effectiveTerms = contributions.filter(
    (contribution): contribution is ResolvedPromptTerm => contribution.kind === 'TERM',
  );
  const orderedPositiveExpressions = input.contentNodes
    ? (() => {
        const ordered: string[] = [];
        const emitted = new Set<string>();
        const userKey = `${'USER_INSTRUCTION'}:${userInstructionStableId}`;
        const contributionUsesRecipe = (contribution: ResolvedPromptContribution, useId: string) =>
          contribution.sourcePaths.some((path) =>
            path.segments.some((segment) => segment.kind === 'RECIPE_USE' && segment.useId === useId),
          );
        const contributionUsesDirectTerm = (contribution: ResolvedPromptContribution, stableId: string) =>
          contribution.kind === 'TERM' &&
          contribution.stableId === stableId &&
          contribution.sourcePaths.some((path) => path.segments.some((segment) => segment.kind === 'DIRECT_INPUT'));
        const appendContribution = (contribution: ResolvedPromptContribution) => {
          const key = contributionKey(contribution);
          if (emitted.has(key) || !contribution.positiveExpression.trim()) return;
          emitted.add(key);
          ordered.push(contribution.positiveExpression);
        };

        for (const node of input.contentNodes) {
          if (node.kind === 'TEXT') {
            if (node.text.trim()) ordered.push(node.text);
            emitted.add(userKey);
            continue;
          }
          if (node.kind === 'TERM') {
            const contribution = contributions.find((candidate) =>
              contributionUsesDirectTerm(candidate, node.stableId),
            );
            if (contribution) appendContribution(contribution);
            continue;
          }
          const recipeContributions = contributions.filter((contribution) =>
            contributionUsesRecipe(contribution, node.useId),
          );
          recipeContributions.forEach((contribution) => emitted.add(contributionKey(contribution)));
          const expression = recipeExpressions.get(node.useId) ?? '';
          if (expression.trim()) ordered.push(expression);
        }
        contributions.forEach(appendContribution);
        return ordered;
      })()
    : positiveExpressions;
  return {
    userInstruction,
    effectiveTerms,
    contributions,
    commonExpression: joinPromptExpressions(orderedPositiveExpressions, input.separator ?? ', '),
    negativeExpression: joinPromptExpressions(
      contributions.map((contribution) => contribution.negativeExpression),
      input.negativeSeparator ?? input.separator ?? ', ',
    ),
    sourcePaths: paths,
    frozenReferences,
  };
}

export function composePromptFromComposition(input: PromptCompositionInput) {
  return resolvePromptComposition(input).commonExpression;
}

export function collectEffectiveTermsFromComposition(input: PromptCompositionInput) {
  return resolvePromptComposition(input).effectiveTerms;
}
