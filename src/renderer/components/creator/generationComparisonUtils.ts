import type {
  ImageGenerationRouteDto,
  GenerationRunDto,
  ImportedCreationOutputDto,
  Locale,
  PromptVersionDto,
  TermListItem,
  WordPaletteDto,
} from '@/shared/contracts';
import { resolveTermTitle } from '@/shared/term-localization';
import { resolveLocalizedName } from '@/shared/word-palette-localization';

export type PromptDiffPart = {
  type: 'equal' | 'added' | 'removed';
  value: string;
};

const maximumLcsTextLength = 50_000;
const maximumLcsTokensPerPrompt = 2_000;
const maximumLcsCells = 400_000;
const promptTokenPattern = /\s+|[\p{L}\p{N}\p{M}_]+(?:\s+)?|[^\s\p{L}\p{N}\p{M}_](?:\s+)?/gu;

function appendPart(parts: PromptDiffPart[], type: PromptDiffPart['type'], value: string) {
  if (!value) return;
  const previous = parts.at(-1);
  if (previous?.type === type) {
    previous.value += value;
    return;
  }
  parts.push({ type, value });
}

function fallbackPromptDiff(previous: string, next: string): PromptDiffPart[] {
  const sharedLength = Math.min(previous.length, next.length);
  let prefixLength = 0;
  while (prefixLength < sharedLength && previous[prefixLength] === next[prefixLength]) {
    prefixLength += 1;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > prefixLength && nextEnd > prefixLength && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  const parts: PromptDiffPart[] = [];
  appendPart(parts, 'equal', previous.slice(0, prefixLength));
  appendPart(parts, 'removed', previous.slice(prefixLength, previousEnd));
  appendPart(parts, 'added', next.slice(prefixLength, nextEnd));
  appendPart(parts, 'equal', previous.slice(previousEnd));
  return parts;
}

function promptTokens(value: string) {
  return value.match(promptTokenPattern) ?? [];
}

export function diffPromptText(previous: string, next: string): PromptDiffPart[] {
  if (previous === next) return previous ? [{ type: 'equal', value: previous }] : [];
  if (!previous) return next ? [{ type: 'added', value: next }] : [];
  if (!next) return [{ type: 'removed', value: previous }];

  if (previous.length + next.length > maximumLcsTextLength) {
    return fallbackPromptDiff(previous, next);
  }

  const previousTokens = promptTokens(previous);
  const nextTokens = promptTokens(next);
  if (
    previousTokens.length > maximumLcsTokensPerPrompt ||
    nextTokens.length > maximumLcsTokensPerPrompt ||
    (previousTokens.length > 0 && nextTokens.length > Math.floor(maximumLcsCells / previousTokens.length))
  ) {
    return fallbackPromptDiff(previous, next);
  }

  const columnCount = nextTokens.length + 1;
  const lcsLengths = new Uint32Array((previousTokens.length + 1) * columnCount);
  for (let previousIndex = previousTokens.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let nextIndex = nextTokens.length - 1; nextIndex >= 0; nextIndex -= 1) {
      const index = previousIndex * columnCount + nextIndex;
      lcsLengths[index] =
        previousTokens[previousIndex] === nextTokens[nextIndex]
          ? lcsLengths[(previousIndex + 1) * columnCount + nextIndex + 1] + 1
          : Math.max(lcsLengths[(previousIndex + 1) * columnCount + nextIndex], lcsLengths[index + 1]);
    }
  }

  const parts: PromptDiffPart[] = [];
  let previousIndex = 0;
  let nextIndex = 0;
  while (previousIndex < previousTokens.length || nextIndex < nextTokens.length) {
    if (
      previousIndex < previousTokens.length &&
      nextIndex < nextTokens.length &&
      previousTokens[previousIndex] === nextTokens[nextIndex]
    ) {
      appendPart(parts, 'equal', previousTokens[previousIndex]);
      previousIndex += 1;
      nextIndex += 1;
      continue;
    }

    const removeLength =
      previousIndex < previousTokens.length ? lcsLengths[(previousIndex + 1) * columnCount + nextIndex] : -1;
    const addLength = nextIndex < nextTokens.length ? lcsLengths[previousIndex * columnCount + nextIndex + 1] : -1;
    if (previousIndex < previousTokens.length && removeLength >= addLength) {
      appendPart(parts, 'removed', previousTokens[previousIndex]);
      previousIndex += 1;
    } else {
      appendPart(parts, 'added', nextTokens[nextIndex]);
      nextIndex += 1;
    }
  }

  return parts;
}

export function filterKnownComparisonModels(
  routes: readonly ImageGenerationRouteDto[],
  visibleKeys: ReadonlySet<string>,
): ImageGenerationRouteDto[] {
  return routes.filter((model) => visibleKeys.has(model.key));
}

export function collectVisibleComparisonModelKeys(
  runs: readonly GenerationRunDto[],
  activeModelKeys: readonly string[],
  explicitModelKeys: readonly string[],
): string[] {
  return [
    ...new Set([...runs.flatMap((run) => (run.asset ? [run.modelKey] : [])), ...activeModelKeys, ...explicitModelKeys]),
  ];
}

function normalizedParameters(parameters: Record<string, string>) {
  return Object.fromEntries(Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)));
}

export function normalizedComparisonPrompt(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function comparisonImportedPromptRowId(prompt: string) {
  return `imported-prompt:${normalizedComparisonPrompt(prompt)}`;
}

export function comparisonLinkedImportedPromptRowId(versionId: string, prompt: string) {
  return `linked-imported-prompt:${versionId}:${normalizedComparisonPrompt(prompt)}`;
}

export function comparisonVersionGroupRowId(group: readonly PromptVersionDto[]) {
  const representative = [...group].sort((left, right) => left.versionNo - right.versionNo)[0];
  return representative ? `version-group:${representative.id}` : 'version-group:empty';
}

/**
 * Returns only top-level references shown on a historical Prompt row. Recipe
 * internals remain in the immutable snapshot and are deliberately not
 * projected as separate chips here.
 */
export function comparisonVersionReferenceNames(
  version: PromptVersionDto,
  locale: Locale,
  terms: readonly TermListItem[],
  wordPalettes: readonly WordPaletteDto[],
) {
  const termById = new Map(terms.map((term) => [term.id, term]));
  const directTerms = [...new Set(version.termIds)].flatMap((termId) => {
    const term = termById.get(termId);
    if (!term) return [];
    return [resolveTermTitle(term, locale)];
  });

  const frozenRecipes = version.promptInputSnapshot?.commonInput.recipes ?? [];
  const recipeKeys = new Set<string>();
  const recipes = [
    ...frozenRecipes.map((recipe) => ({
      paletteId: recipe.paletteId,
      paletteRevisionId: recipe.paletteRevisionId,
      frozen: recipe,
    })),
    ...version.wordPaletteReferences.map((reference) => ({
      paletteId: reference.paletteId,
      paletteRevisionId: reference.paletteRevisionId,
      frozen: frozenRecipes.find(
        (recipe) =>
          recipe.paletteId === reference.paletteId && recipe.paletteRevisionId === reference.paletteRevisionId,
      ),
    })),
  ].flatMap((reference) => {
    const key = `${reference.paletteId}\u0000${reference.paletteRevisionId}`;
    if (recipeKeys.has(key)) return [];
    recipeKeys.add(key);

    const frozenName = reference.frozen ? resolveLocalizedName(reference.frozen, locale) : '';
    if (frozenName) return [frozenName];

    const palette = wordPalettes.find((item) => item.id === reference.paletteId);
    const revision = palette?.revisions.find((item) => item.id === reference.paletteRevisionId);
    const revisionName = revision ? resolveLocalizedName(revision, locale) : '';
    return [revisionName || reference.paletteId];
  });

  return [...directTerms, ...recipes];
}

export function promptVersionComparisonKey(version: PromptVersionDto) {
  if (version.promptInputSnapshot) return `prompt-input:${version.promptInputSnapshot.contentHash}`;
  return JSON.stringify({
    isStructured: version.isStructured,
    manualPrompt: version.manualPrompt.trim(),
    finalPrompt: version.finalPrompt.trim(),
    termPromptLocale: version.termPromptLocale,
    termIds: version.termIds,
    wordPaletteReferences: version.wordPaletteReferences.map((reference) => ({
      paletteId: reference.paletteId,
      paletteRevisionId: reference.paletteRevisionId,
      promptLocale: reference.promptLocale,
      parameterValues: normalizedParameters(reference.parameterValues),
    })),
    referenceAssetIds: version.referenceAssets.map((asset) => asset.id),
  });
}

export function groupEquivalentPromptVersions(versions: readonly PromptVersionDto[]) {
  const groups: PromptVersionDto[][] = [];
  const groupByKey = new Map<string, PromptVersionDto[]>();
  for (const version of [...versions].sort((left, right) => left.versionNo - right.versionNo)) {
    const key = promptVersionComparisonKey(version);
    const existing = groupByKey.get(key);
    if (existing) {
      existing.push(version);
      continue;
    }
    const group = [version];
    groupByKey.set(key, group);
    groups.push(group);
  }
  return groups.sort((left, right) => left.at(-1)!.versionNo - right.at(-1)!.versionNo);
}

export function importedExactPrompt(output: ImportedCreationOutputDto) {
  return output.aiGeneratedStatus === 'YES' && output.generationTextType === 'EXACT_PROMPT'
    ? output.generationText.trim()
    : '';
}

function newestRunsFirst(version: PromptVersionDto, modelKey: string | null) {
  return [...version.runs].sort((left, right) => {
    const leftMatches = Boolean(modelKey && left.modelKey === modelKey);
    const rightMatches = Boolean(modelKey && right.modelKey === modelKey);
    return (
      Number(rightMatches) - Number(leftMatches) ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id)
    );
  });
}

function executionPromptCandidates(version: PromptVersionDto, modelKey: string | null) {
  return newestRunsFirst(version, modelKey).flatMap((run) => {
    const summary = run.executionSummary;
    if (summary) {
      return [summary.resolvedPrompt, summary.clientRequestText ?? ''].map((value) => value.trim()).filter(Boolean);
    }
    const execution = run.executionInputSnapshot;
    if (!execution) return [];
    return [execution.commonInput.resolvedPrompt.commonExpression, execution.clientRequestText ?? '']
      .map((value) => value.trim())
      .filter(Boolean);
  });
}

/** Returns the frozen prompt used to compare an imported exact prompt. */
export function comparisonPromptForVersion(version: PromptVersionDto, modelKey: string | null = null) {
  const executionPrompt = executionPromptCandidates(version, modelKey)[0];
  if (executionPrompt) return executionPrompt;
  const snapshot = version.promptInputSnapshot;
  if (snapshot.sourceKind === 'FLAT_INPUT') {
    return (snapshot.commonInput.flatResolvedPrompt?.commonExpression ?? snapshot.commonInput.flatPrompt ?? '').trim();
  }
  return version.finalPrompt.trim();
}

export type ImportedPromptPlacement =
  | { kind: 'VERSION'; versionId: string }
  | { kind: 'LINKED_VARIANT'; versionId: string; prompt: string; baselinePrompt: string }
  | { kind: 'STANDALONE'; prompt: string }
  | { kind: 'UNBOUND' };

export function linkedPromptVersion(output: ImportedCreationOutputDto, versions: readonly PromptVersionDto[]) {
  return output.promptVersionId ? versions.find((version) => version.id === output.promptVersionId) : undefined;
}

function importedExecutionRouteKey(output: ImportedCreationOutputDto) {
  return output.executionRouteKey ?? output.modelKey ?? null;
}

function versionMatchesExactPrompt(version: PromptVersionDto, normalizedPrompt: string, modelKey: string | null) {
  const candidates = [...executionPromptCandidates(version, modelKey), comparisonPromptForVersion(version, modelKey)];
  return candidates.some((candidate) => normalizedComparisonPrompt(candidate) === normalizedPrompt);
}

export function importedPromptPlacement(
  output: ImportedCreationOutputDto,
  versions: readonly PromptVersionDto[],
): ImportedPromptPlacement {
  const exactPrompt = importedExactPrompt(output);
  const linkedVersion = linkedPromptVersion(output, versions);

  // An explicit relationship is provenance. Exact Prompt text may describe a
  // model-side variant of that input, but must never silently relink the output
  // to another version merely because its flattened text happens to match.
  if (linkedVersion) {
    if (!exactPrompt) return { kind: 'VERSION', versionId: linkedVersion.id };
    const normalized = normalizedComparisonPrompt(exactPrompt);
    const executionRouteKey = importedExecutionRouteKey(output);
    if (versionMatchesExactPrompt(linkedVersion, normalized, executionRouteKey)) {
      return { kind: 'VERSION', versionId: linkedVersion.id };
    }
    return {
      kind: 'LINKED_VARIANT',
      versionId: linkedVersion.id,
      prompt: exactPrompt,
      baselinePrompt: comparisonPromptForVersion(linkedVersion, executionRouteKey),
    };
  }

  if (exactPrompt) {
    const normalized = normalizedComparisonPrompt(exactPrompt);
    const executionRouteKey = importedExecutionRouteKey(output);
    const matchingVersion = [...versions]
      .sort((left, right) => right.versionNo - left.versionNo)
      .find((version) => versionMatchesExactPrompt(version, normalized, executionRouteKey));
    return matchingVersion
      ? { kind: 'VERSION', versionId: matchingVersion.id }
      : { kind: 'STANDALONE', prompt: exactPrompt };
  }
  return { kind: 'UNBOUND' };
}
