import type {
  AssetDto,
  CodexAssistInput,
  CodexAssistTermInput,
  CreatorAgentAssistInput,
  CreatorPromptNodeInput,
  GenerationTargetInput,
  Locale,
  PromptCommonContentNodeDto,
  PromptSeriesDto,
  PromptVersionDto,
  TermListItem,
  TermModelExpressionDto,
  WordPaletteDto,
  WordPaletteReferenceInput,
  WordPaletteRevisionDto,
} from '@/shared/contracts';
import {
  DEFAULT_IMAGE_PROMPT_PROFILE_ID,
  imageGenerationPromptProfileId,
} from '@/shared/image-generation-prompt-profile';
import { resolveTermExpression, resolveTermTitle } from '@/shared/term-localization';
import {
  resolveLocalizedName,
  resolveWordPaletteOptionLabel,
  resolveWordPaletteParameterName,
} from '@/shared/word-palette-localization';
import {
  resolvePromptComposition,
  type PromptCompositionContentNodeInput,
  type PromptRecipeContentExpressionInput,
  type PromptRecipeUseInput,
  type PromptSourcePath,
  type PromptTermInput,
  type ResolvedPromptComposition,
  type ResolvedPromptTerm,
} from '@/shared/prompt-composition';
import { renderPaletteParameters } from '@/renderer/components/palette/utils';

export interface AppliedWordPalette {
  palette: WordPaletteDto;
  revision: WordPaletteRevisionDto;
  parameterValues: Record<string, string>;
  promptLocale: Locale;
}

export function appliedWordPalettesFromReferences(
  palettes: readonly WordPaletteDto[],
  references: readonly WordPaletteReferenceInput[],
): AppliedWordPalette[] {
  return references.flatMap((reference) => {
    const palette = palettes.find((item) => item.id === reference.paletteId);
    const revision = palette?.revisions.find((item) => item.id === reference.paletteRevisionId);
    return palette && revision
      ? [
          {
            palette,
            revision,
            parameterValues: reference.parameterValues,
            promptLocale: reference.promptLocale,
          },
        ]
      : [];
  });
}

export interface CreatorEffectiveTerm {
  term: TermListItem;
  resolved: ResolvedPromptTerm;
  directSource: boolean;
  recipeUseIds: string[];
}

export interface CreatorRecipeSource {
  useId: string;
  reference: AppliedWordPalette;
}

export interface CreatorPromptResolution {
  promptProfileId: string;
  composition: ResolvedPromptComposition;
  livePrompt: string;
  negativePrompt: string;
  effectiveTerms: CreatorEffectiveTerm[];
  recipeSources: CreatorRecipeSource[];
}

export type CreatorAssistContext = Pick<CodexAssistInput, 'prompt' | 'locale' | 'directTerms' | 'recipes'>;

export interface CreatorAssistantContextKeyInput {
  resolution: CreatorPromptResolution;
  referenceAssets: readonly AssetDto[];
  canvasPresetKey: string | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
  generationTargets: readonly GenerationTargetInput[];
}

export interface CreatorAssistantEnvironmentInput {
  context: CreatorAssistContext;
  referenceAssets: readonly AssetDto[];
  termPromptLocale: Locale;
  canvasPresetKey: string | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
  generationTargets: readonly GenerationTargetInput[];
}

export interface ResolveCreatorPromptInput {
  manualPrompt: string;
  promptNodes?: readonly CreatorPromptNodeInput[];
  selectedTerms: TermListItem[];
  appliedPalettes: AppliedWordPalette[];
  termPromptLocale?: Locale;
  promptProfileId?: string;
  /** @deprecated Pass promptProfileId; this was never an executable route key. */
  modelKey?: string;
}

export interface CreatorVersionInput {
  version: PromptVersionDto | undefined;
  manualPrompt: string;
  promptNodes?: readonly CreatorPromptNodeInput[];
  selectedTerms: readonly TermListItem[];
  appliedPalettes: readonly AppliedWordPalette[];
  termPromptLocale: Locale;
  referenceAssets: readonly AssetDto[];
}

export function wordPaletteUseId(reference: Pick<AppliedWordPalette, 'palette' | 'revision'>) {
  return `${reference.palette.id}:${reference.revision.id}`;
}

function uniqueInOrder(values: readonly string[]) {
  return [...new Set(values)];
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringRecord(left: Record<string, string>, right: Record<string, string>) {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value)
  );
}

/**
 * A synchronous renderer-safe fingerprint used only to detect whether an
 * assistant proposal still targets the visible creator state. The main process
 * also stores a SHA-256 hash of the exact request for durable audit.
 */
export function buildCreatorAssistantContextKey({
  resolution,
  referenceAssets,
  canvasPresetKey,
  canvasWidth,
  canvasHeight,
  generationTargets,
}: CreatorAssistantContextKeyInput) {
  const serialized = JSON.stringify({
    schema: 'creator-assistant-context.v1',
    composition: resolution.composition,
    references: referenceAssets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      originType: asset.originType ?? '',
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
      createdAt: asset.createdAt,
    })),
    canvasPresetKey,
    canvasWidth,
    canvasHeight,
    generationTargets: generationTargets.map((target) => ({
      modelKey: target.modelKey,
      count: target.count,
      quality: target.quality,
    })),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    const codePoint = serialized.codePointAt(index)!;
    const utf16CodeUnit = codePoint > 0xffff ? ((codePoint - 0x10000) >> 10) + 0xd800 : codePoint;
    hash ^= utf16CodeUnit;
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1:${(hash >>> 0).toString(16).padStart(8, '0')}:${serialized.length}`;
}

function normalizedAssistantTerm(term: CodexAssistTermInput) {
  return {
    stableId: term.stableId,
    revisionId: term.revisionId,
    expressionRevisionId: term.expressionRevisionId,
    promptFragment: term.promptFragment,
    negativeFragment: term.negativeFragment,
  };
}

function normalizedAssistantAsset(asset: {
  assetId: string;
  kind: AssetDto['kind'];
  originType?: string;
  width: number;
  height: number;
  mimeType: string;
}) {
  return {
    assetId: asset.assetId,
    kind: asset.kind,
    originType: asset.originType ?? '',
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
  };
}

function normalizedAssistantContext(
  input: Pick<
    CreatorAgentAssistInput,
    | 'directTerms'
    | 'recipes'
    | 'referenceAssets'
    | 'termPromptLocale'
    | 'canvasPresetKey'
    | 'canvasWidth'
    | 'canvasHeight'
    | 'generationTargets'
  >,
) {
  return {
    termPromptLocale: input.termPromptLocale,
    directTerms: input.directTerms.map(normalizedAssistantTerm),
    recipes: input.recipes.map((recipe) => ({
      useId: recipe.useId,
      stableId: recipe.stableId,
      revisionId: recipe.revisionId,
      promptLocale: recipe.promptLocale,
      parameterValues: Object.fromEntries(
        Object.entries(recipe.parameterValues).sort(([left], [right]) => left.localeCompare(right)),
      ),
      parameters: recipe.parameters.map((parameter) => ({
        stableId: parameter.stableId,
        revisionId: parameter.revisionId,
        selectedValue: parameter.selectedValue,
        selectedOptionId: parameter.selectedOptionId,
        promptFragment: parameter.promptFragment,
      })),
      referenceAssets: recipe.referenceAssets.map(normalizedAssistantAsset),
      promptFragment: recipe.promptFragment,
      negativeFragment: recipe.negativeFragment,
      internalTerms: recipe.internalTerms.map(normalizedAssistantTerm),
    })),
    referenceAssets: input.referenceAssets.map(normalizedAssistantAsset),
    canvasPresetKey: input.canvasPresetKey,
    canvasWidth: input.canvasWidth,
    canvasHeight: input.canvasHeight,
    generationTargets: input.generationTargets.map((target) => ({
      modelKey: target.modelKey,
      count: target.count,
      quality: target.quality,
    })),
  };
}

/** Prompt edits may adopt a proposal, but they must never re-authorize terms,
 * references, canvas, or targets that changed after the frozen request. */
export function creatorAssistantEnvironmentMatches(
  frozen: CreatorAgentAssistInput,
  current: CreatorAssistantEnvironmentInput,
) {
  const currentInput: CreatorAgentAssistInput = {
    ...frozen,
    ...current.context,
    referenceAssets: current.referenceAssets.map((asset) => ({
      assetId: asset.id,
      kind: asset.kind,
      ...(asset.originType ? { originType: asset.originType } : {}),
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
    })),
    termPromptLocale: current.termPromptLocale,
    canvasPresetKey: current.canvasPresetKey,
    canvasWidth: current.canvasWidth,
    canvasHeight: current.canvasHeight,
    generationTargets: current.generationTargets.map((target) => ({ ...target })),
  };
  return (
    JSON.stringify(normalizedAssistantContext(frozen)) === JSON.stringify(normalizedAssistantContext(currentInput))
  );
}

/**
 * Imported output may inherit a PromptVersion only while the mutable editor is
 * still showing that exact frozen input. A similar rendered string is not
 * sufficient: revision, recipe, parameter and reference identities matter.
 */
export function creatorInputMatchesVersion({
  version,
  manualPrompt,
  promptNodes,
  selectedTerms,
  appliedPalettes,
  termPromptLocale,
  referenceAssets,
}: CreatorVersionInput) {
  const snapshot = version?.promptInputSnapshot;
  if (!version || snapshot?.sourceKind !== 'COMPOSED') return false;
  const commonInput = snapshot.commonInput;
  if (commonInput.userInstruction !== manualPrompt) return false;
  if (commonInput.contentNodes) {
    const recipeUseIdByPaletteId = new Map(
      appliedPalettes.map((reference) => [reference.palette.id, wordPaletteUseId(reference)]),
    );
    const currentNodes = promptNodes?.flatMap<PromptCommonContentNodeDto>((node) => {
      if (node.kind === 'TEXT') return [{ kind: 'TEXT' as const, text: node.text }];
      if (node.kind === 'TERM') return [{ kind: 'TERM' as const, termId: node.termId }];
      const useId = recipeUseIdByPaletteId.get(node.paletteId);
      return useId ? [{ kind: 'RECIPE' as const, useId }] : [];
    });
    if (JSON.stringify(commonInput.contentNodes) !== JSON.stringify(currentNodes ?? [])) return false;
  }
  if (commonInput.directTermPromptLocale !== termPromptLocale) return false;

  const directTerms = uniqueInOrder(selectedTerms.map((term) => term.id));
  const currentPromptLocaleByTermId = new Map(
    (promptNodes ?? []).flatMap((node) =>
      node.kind === 'TERM' && node.promptLocale ? [[node.termId, node.promptLocale] as const] : [],
    ),
  );
  if (
    !sameStringArray(
      commonInput.directTerms.map((term) => term.termId),
      directTerms,
    )
  )
    return false;
  if (
    !commonInput.directTerms.every(
      (term, index) =>
        term.termRevisionId === selectedTerms.find((item) => item.id === directTerms[index])?.termRevisionId &&
        (term.promptLocale ?? commonInput.directTermPromptLocale) ===
          (currentPromptLocaleByTermId.get(term.termId) ?? termPromptLocale),
    )
  )
    return false;

  const directReferences = uniqueInOrder(referenceAssets.map((asset) => asset.id));
  if (
    !sameStringArray(
      commonInput.directReferences.map((reference) => reference.assetId),
      directReferences,
    )
  )
    return false;
  if (commonInput.recipes.length !== appliedPalettes.length) return false;

  return commonInput.recipes.every((recipe, index) => {
    const applied = appliedPalettes[index];
    if (!applied) return false;
    if (
      recipe.useId !== wordPaletteUseId(applied) ||
      recipe.paletteId !== applied.palette.id ||
      recipe.paletteRevisionId !== applied.revision.id ||
      recipe.promptLocale !== applied.promptLocale ||
      !sameStringRecord(recipe.parameterValues, applied.parameterValues)
    )
      return false;

    const selectedOptionTerms = applied.revision.parameters.flatMap((parameter) => {
      const option = parameter.options.find((item) => item.value === applied.parameterValues[parameter.stableKey]);
      return (option?.contents ?? []).flatMap((content) => (content.kind === 'TERM' ? [content.term] : []));
    });
    const revisionTerms = [...applied.revision.terms, ...selectedOptionTerms].filter(
      (term, termIndex, all) => all.findIndex((item) => item.id === term.id) === termIndex,
    );
    if (
      !sameStringArray(
        recipe.terms.map((term) => term.termId),
        revisionTerms.map((term) => term.id),
      )
    )
      return false;
    if (!recipe.terms.every((term, termIndex) => term.termRevisionId === revisionTerms[termIndex]?.termRevisionId))
      return false;

    const selectedParameters = applied.revision.parameters.flatMap((parameter) => {
      const valueKey = applied.parameterValues[parameter.stableKey];
      const option = parameter.options.find((item) => item.value === valueKey);
      return option
        ? [{ parameterRevisionId: parameter.id, stableKey: parameter.stableKey, optionId: option.id, valueKey }]
        : [];
    });
    if (recipe.parameters.length !== selectedParameters.length) return false;
    if (
      !recipe.parameters.every((parameter, parameterIndex) => {
        const selected = selectedParameters[parameterIndex];
        return (
          selected &&
          parameter.parameterRevisionId === selected.parameterRevisionId &&
          parameter.stableKey === selected.stableKey &&
          parameter.optionId === selected.optionId &&
          parameter.valueKey === selected.valueKey
        );
      })
    )
      return false;

    return sameStringArray(
      recipe.references.map((reference) => reference.assetId),
      applied.revision.referenceAssets.map((asset) => asset.id),
    );
  });
}

function latestModelExpression(
  term: TermListItem,
  modelKey: string,
  locale: Locale,
): TermModelExpressionDto | undefined {
  return resolveTermExpression(term, modelKey, locale) ?? undefined;
}

function promptTerm(term: TermListItem, modelKey: string, locale: Locale): PromptTermInput | null {
  const expression = latestModelExpression(term, modelKey, locale);
  if (!expression || (!expression.positive.trim() && !expression.negative.trim())) return null;
  return {
    stableId: term.id,
    revisionId: term.termRevisionId,
    expressionRevisionId: expression.id,
    label: resolveTermTitle(term, locale),
    positiveExpression: expression.positive,
    negativeExpression: expression.negative,
  };
}

function recipeInput(reference: AppliedWordPalette, modelKey: string): PromptRecipeUseInput {
  const contentExpressions = reference.revision.promptNodes.flatMap<PromptRecipeContentExpressionInput>((node) => {
    if (node.kind === 'TERM') {
      const term = promptTerm(node.term, modelKey, reference.promptLocale);
      return term ? [{ kind: 'TERM' as const, term }] : [];
    }
    if (node.kind === 'TEXT') {
      return [
        {
          kind: 'RECIPE_FRAGMENT' as const,
          stableId: node.id,
          positiveExpression: node.promptFragment,
          negativeExpression: node.negativeFragment,
        },
      ];
    }
    const parameter = reference.revision.parameters.find((item) => item.stableKey === node.stableKey);
    const option = parameter?.options.find((item) => item.value === reference.parameterValues[node.stableKey]);
    if (!parameter || !option) return [];
    return option.contents.flatMap<PromptRecipeContentExpressionInput>((content) => {
      if (content.kind === 'TERM') {
        const term = promptTerm(content.term, modelKey, reference.promptLocale);
        return term ? [{ kind: 'TERM' as const, term }] : [];
      }
      return [
        {
          kind: 'RECIPE_PARAMETER' as const,
          parameter: {
            stableId: `${parameter.id}:${content.id}`,
            revisionId: parameter.id,
            optionStableId: option.id,
            expressionRevisionId: content.id,
            positiveExpression: content.promptFragment,
            negativeExpression: content.negativeFragment,
          },
        },
      ];
    });
  });
  return {
    useId: wordPaletteUseId(reference),
    stableId: reference.palette.id,
    revisionId: reference.revision.id,
    terms: [],
    parameterExpressions: [],
    contentExpressions,
    // AssetDto currently has no immutable revision/hash identity. Keep these
    // references out of the frozen prompt graph until that real identity exists.
    references: [],
  };
}

function recipeUseIds(paths: readonly PromptSourcePath[]) {
  return [
    ...new Set(
      paths.flatMap((path) =>
        path.segments.flatMap((segment) => (segment.kind === 'RECIPE_USE' ? [segment.useId] : [])),
      ),
    ),
  ];
}

export function resolveCreatorPrompt({
  manualPrompt,
  promptNodes,
  selectedTerms,
  appliedPalettes,
  termPromptLocale = 'en',
  promptProfileId,
  modelKey,
}: ResolveCreatorPromptInput): CreatorPromptResolution {
  const effectivePromptProfileId =
    promptProfileId?.trim() ||
    imageGenerationPromptProfileId(modelKey ? { key: modelKey, modelId: modelKey } : undefined);
  const recipes = appliedPalettes.map((reference) => recipeInput(reference, effectivePromptProfileId));
  const promptLocaleByTermId = new Map(
    (promptNodes ?? []).flatMap((node) =>
      node.kind === 'TERM' && node.promptLocale ? [[node.termId, node.promptLocale] as const] : [],
    ),
  );
  const recipeUseIdByPaletteId = new Map(
    appliedPalettes.map((reference) => [reference.palette.id, wordPaletteUseId(reference)]),
  );
  const composition = resolvePromptComposition({
    userInstruction: manualPrompt,
    directTerms: selectedTerms.flatMap(
      (term) => promptTerm(term, effectivePromptProfileId, promptLocaleByTermId.get(term.id) ?? termPromptLocale) ?? [],
    ),
    recipes,
    ...(promptNodes
      ? {
          contentNodes: promptNodes.flatMap<PromptCompositionContentNodeInput>((node) => {
            if (node.kind === 'TEXT') return [{ kind: 'TEXT' as const, text: node.text }];
            if (node.kind === 'TERM') return [{ kind: 'TERM' as const, stableId: node.termId }];
            const useId = recipeUseIdByPaletteId.get(node.paletteId);
            return useId ? [{ kind: 'RECIPE' as const, useId }] : [];
          }),
        }
      : {}),
    exclusions: [],
    specs: [],
  });
  const termsById = new Map<string, TermListItem>();
  for (const term of selectedTerms) termsById.set(term.id, term);
  for (const reference of appliedPalettes) {
    for (const term of reference.revision.terms) {
      if (!termsById.has(term.id)) termsById.set(term.id, term);
    }
  }
  const effectiveTerms = composition.effectiveTerms.flatMap((resolved) => {
    const term = termsById.get(resolved.stableId);
    if (!term) return [];
    return [
      {
        term,
        resolved,
        directSource: resolved.sourcePaths.some((path) =>
          path.segments.some((segment) => segment.kind === 'DIRECT_INPUT'),
        ),
        recipeUseIds: recipeUseIds(resolved.sourcePaths),
      },
    ];
  });
  return {
    promptProfileId: effectivePromptProfileId,
    composition,
    livePrompt: composition.commonExpression,
    negativePrompt: composition.negativeExpression,
    effectiveTerms,
    recipeSources: appliedPalettes.map((reference) => ({ useId: wordPaletteUseId(reference), reference })),
  };
}

function localizedTermName(term: TermListItem, locale: Locale) {
  return resolveTermTitle(term, locale);
}

export function creatorAssistantTermInput(
  term: TermListItem,
  resolved: ResolvedPromptTerm | undefined,
  locale: Locale,
  promptProfileId = DEFAULT_IMAGE_PROMPT_PROFILE_ID,
): CodexAssistTermInput {
  const fallbackExpression = resolveTermExpression(term, promptProfileId, locale) ?? term.modelExpressions[0];
  return {
    stableId: term.id,
    revisionId: term.termRevisionId,
    expressionRevisionId: resolved?.expressionRevisionId ?? fallbackExpression?.id ?? null,
    displayName: resolved?.label || localizedTermName(term, locale),
    promptFragment: resolved?.positiveExpression ?? fallbackExpression?.positive ?? '',
    negativeFragment: resolved?.negativeExpression ?? fallbackExpression?.negative ?? '',
  };
}

function contributionUsesRecipe(contribution: ResolvedPromptComposition['contributions'][number], useId: string) {
  return contribution.sourcePaths.some((path) =>
    path.segments.some((segment) => segment.kind === 'RECIPE_USE' && segment.useId === useId),
  );
}

/**
 * Builds the model-facing creator context without flattening recipe terms into
 * directly selected terms. A recipe remains one aggregate reference and keeps
 * its exact revision, parameters and reference-asset identities.
 */
export function buildCreatorAssistContext(
  resolution: CreatorPromptResolution,
  selectedTerms: readonly TermListItem[],
  locale: Locale,
): CreatorAssistContext {
  const directTerms = selectedTerms.map((term) =>
    creatorAssistantTermInput(
      term,
      resolution.effectiveTerms.find((item) => item.term.id === term.id && item.directSource)?.resolved,
      locale,
      resolution.promptProfileId,
    ),
  );
  const recipes = resolution.recipeSources.map(({ useId, reference }) => {
    const contributions = resolution.composition.contributions.filter(
      (contribution) => contribution.kind !== 'USER_INSTRUCTION' && contributionUsesRecipe(contribution, useId),
    );
    const parameters = reference.revision.parameters.map((parameter) => {
      const selectedValue = reference.parameterValues[parameter.stableKey] ?? '';
      const selectedOption = parameter.options.find((option) => option.value === selectedValue);
      return {
        stableId: parameter.id,
        revisionId: parameter.id,
        displayName: resolveWordPaletteParameterName(parameter, locale),
        selectedValue,
        selectedOptionId: selectedOption?.id ?? null,
        selectedOptionLabel: selectedOption ? resolveWordPaletteOptionLabel(selectedOption, locale) : '',
        promptFragment:
          renderPaletteParameters({ parameters: [parameter] }, reference.parameterValues, reference.promptLocale)[0] ??
          '',
      };
    });
    const internalTerms = [
      ...reference.revision.terms,
      ...reference.revision.parameters.flatMap((parameter) => {
        const option = parameter.options.find((item) => item.value === reference.parameterValues[parameter.stableKey]);
        return (option?.contents ?? []).flatMap((content) => (content.kind === 'TERM' ? [content.term] : []));
      }),
    ].filter((term, index, all) => all.findIndex((item) => item.id === term.id) === index);
    return {
      useId,
      stableId: reference.palette.id,
      revisionId: reference.revision.id,
      displayName: resolveLocalizedName(reference.revision, locale),
      promptLocale: reference.promptLocale,
      parameterValues: { ...reference.parameterValues },
      parameters,
      referenceAssets: reference.revision.referenceAssets.map((asset) => ({
        assetId: asset.id,
        kind: asset.kind,
        originType: asset.originType,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
      })),
      promptFragment: contributions
        .map((contribution) => contribution.positiveExpression)
        .filter(Boolean)
        .join(''),
      negativeFragment: contributions
        .map((contribution) => contribution.negativeExpression)
        .filter(Boolean)
        .join(''),
      internalTerms: internalTerms.map((term) =>
        creatorAssistantTermInput(
          term,
          resolution.effectiveTerms.find((item) => item.term.id === term.id && item.recipeUseIds.includes(useId))
            ?.resolved,
          locale,
          resolution.promptProfileId,
        ),
      ),
    };
  });
  return {
    prompt: resolution.composition.userInstruction,
    locale,
    directTerms,
    recipes,
  };
}

export function allAssets(series: PromptSeriesDto | undefined, options: { includeFailed?: boolean } = {}): AssetDto[] {
  const records = [
    ...(series?.versions ?? [])
      .flatMap((version) => version.runs)
      .flatMap((run) =>
        run.asset && (options.includeFailed || run.outputDisposition !== 'FAILED')
          ? [
              {
                id: run.id,
                asset: run.asset,
                createdAt: run.asset.createdAt || run.createdAt,
              },
            ]
          : [],
      ),
    ...(series?.importedOutputs ?? []).map((output) => ({
      id: output.id,
      asset: output.asset,
      createdAt: output.createdAt,
    })),
    ...(series?.transformedOutputs ?? []).map((output) => ({
      id: output.id,
      asset: output.asset,
      createdAt: output.createdAt,
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const seen = new Set<string>();
  return records.flatMap(({ asset }) => {
    if (seen.has(asset.id)) return [];
    seen.add(asset.id);
    return [asset];
  });
}

export function collectPromptTerms(
  selectedTerms: TermListItem[],
  appliedPalettes: AppliedWordPalette[],
): TermListItem[] {
  return resolveCreatorPrompt({ manualPrompt: '', selectedTerms, appliedPalettes }).effectiveTerms.map(
    (item) => item.term,
  );
}

export function composePrompt(
  manualPrompt: string,
  selectedTerms: TermListItem[],
  appliedPalettes: AppliedWordPalette[],
  termPromptLocale: Locale = 'en',
): string {
  return resolveCreatorPrompt({ manualPrompt, selectedTerms, appliedPalettes, termPromptLocale }).livePrompt;
}

function compactDiff(value: string, limit = 28) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

export function promptDiffSummary(previousPrompt: string, nextPrompt: string, locale: Locale) {
  const previous = previousPrompt.trim();
  const next = nextPrompt.trim();
  if (!previous) return locale === 'zh' ? '初始版本' : 'Initial';
  if (previous === next) return locale === 'zh' ? '重新生成' : 'Regenerate';

  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix += 1;

  const removed = compactDiff(previous.slice(prefix, previous.length - suffix));
  const added = compactDiff(next.slice(prefix, next.length - suffix));
  if (removed && added) return `${removed} → ${added}`;
  if (added) return `+ ${added}`;
  if (removed) return `− ${removed}`;
  return locale === 'zh' ? '调整 Prompt' : 'Prompt updated';
}

interface CreationDiffInput {
  locale: Locale;
  previousPrompt: string;
  nextPrompt: string;
  previousReferenceIds: string[];
  nextReferenceIds: string[];
  previousCanvasKey: string | null;
  nextCanvasKey: string | null;
  nextCanvasLabel: string;
  previousQuality: string | null;
  nextQuality: string;
}

export function creationDiffSummary(input: CreationDiffInput) {
  if (!input.previousPrompt.trim()) return input.locale === 'zh' ? '初始版本' : 'Initial';
  const changes: string[] = [];
  const prompt = promptDiffSummary(input.previousPrompt, input.nextPrompt, input.locale);
  if (prompt !== '重新生成' && prompt !== 'Regenerate') changes.push(prompt);

  const previousReferences = new Set(input.previousReferenceIds);
  const nextReferences = new Set(input.nextReferenceIds);
  const addedReferences = [...nextReferences].filter((id) => !previousReferences.has(id)).length;
  const removedReferences = [...previousReferences].filter((id) => !nextReferences.has(id)).length;
  if (addedReferences || removedReferences) {
    const label = input.locale === 'zh' ? '参考图' : 'References';
    changes.push(
      `${label}${addedReferences ? ` +${addedReferences}` : ''}${removedReferences ? ` −${removedReferences}` : ''}`,
    );
  }
  if (input.previousCanvasKey !== input.nextCanvasKey) {
    const canvas = input.nextCanvasKey
      ? input.nextCanvasLabel
      : input.locale === 'zh'
        ? '无比例要求'
        : 'No ratio requirement';
    changes.push(`${input.locale === 'zh' ? '画幅' : 'Canvas'} ${canvas}`);
  }
  if (input.previousQuality && input.previousQuality !== input.nextQuality) {
    const quality =
      input.locale === 'zh'
        ? input.nextQuality === 'low'
          ? '低'
          : input.nextQuality === 'medium'
            ? '中'
            : '高'
        : input.nextQuality;
    changes.push(`${input.locale === 'zh' ? '质量' : 'Quality'} ${quality}`);
  }
  return changes.join(' · ') || (input.locale === 'zh' ? '重新生成' : 'Regenerate');
}
