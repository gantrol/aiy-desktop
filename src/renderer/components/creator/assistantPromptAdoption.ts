import type {
  AssistantProposalAdoptionInput,
  AssistantProposalApplyValue,
  AssistantRunDto,
  AssetDto,
  CreationDictionaryScopeDto,
  GenerationQuality,
  GenerationTargetInput,
  Locale,
  TermListItem,
  WordPaletteReferenceInput,
} from '@/shared/contracts';
import {
  creatorPromptText,
  normalizeCreatorPromptNodes,
  replaceCreatorPromptText,
} from '@/renderer/components/creator/creatorPromptDocument';
import {
  creationDraftSaveSnapshot,
  type CreationDraftPromptSnapshot,
} from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import {
  buildCreatorAssistantContextKey,
  resolveCreatorPrompt,
  type AppliedWordPalette,
} from '@/renderer/components/creator/utils';

export type AssistantPromptAdoptionPersistence =
  | {
      kind: 'DRAFT';
      id: string;
      expectedUpdatedAt: string;
      targetAlbumId: string | null;
      title: string;
      dictionaryScope: CreationDictionaryScopeDto;
      quality: GenerationQuality;
      selectedModelKeys: readonly string[];
      repeatCount: number;
    }
  | { kind: 'SERIES'; id: string; title: string; titleLocale: Locale };

export interface AssistantPromptAdoptionSource {
  availablePalettes: readonly AppliedWordPalette[];
  availableTerms: readonly TermListItem[];
  canvasPresetKey: string | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
  currentPrompt: CreationDraftPromptSnapshot;
  defaultPromptLocale: Locale | null;
  generationTargets: readonly GenerationTargetInput[];
  persistence: AssistantPromptAdoptionPersistence | null;
  promptProfileId: string;
  referenceAssets: readonly AssetDto[];
  termPromptLocale: Locale;
}

export type AssistantPromptAdoptionFailure =
  'CONTEXT_CHANGED' | 'MATERIAL_REVISION_CHANGED' | 'PROPOSAL_UNAVAILABLE' | 'SCOPE_CHANGED';

export type AssistantPromptAdoptionPreparation =
  | { ok: false; reason: AssistantPromptAdoptionFailure }
  | {
      ok: true;
      identity: string;
      input: AssistantProposalAdoptionInput;
      prompt: CreationDraftPromptSnapshot;
    };

function paletteReferences(palettes: readonly AppliedWordPalette[]): WordPaletteReferenceInput[] {
  return palettes.map((reference) => ({
    paletteId: reference.palette.id,
    paletteRevisionId: reference.revision.id,
    parameterValues: { ...reference.parameterValues },
    promptLocale: reference.promptLocale,
  }));
}

function scopeMatches(run: AssistantRunDto, persistence: AssistantPromptAdoptionPersistence | null) {
  return Boolean(persistence && persistence.kind === run.scope.kind && persistence.id === run.scope.id);
}

function nextPromptNodes(value: AssistantProposalApplyValue, source: AssistantPromptAdoptionSource) {
  const currentTermPromptLocales = new Map(
    source.currentPrompt.nodes.flatMap((node) =>
      node.kind === 'TERM' ? [[node.termId, node.promptLocale ?? source.termPromptLocale] as const] : [],
    ),
  );
  return normalizeCreatorPromptNodes(
    value.kind === 'PROMPT_TEXT'
      ? replaceCreatorPromptText(source.currentPrompt.nodes, value.prompt)
      : value.draft.contentNodes.map((node) =>
          node.kind === 'TEXT'
            ? { kind: 'TEXT' as const, text: node.text }
            : node.kind === 'TERM'
              ? {
                  kind: 'TERM' as const,
                  termId: node.termId,
                  promptLocale:
                    currentTermPromptLocales.get(node.termId) ?? source.defaultPromptLocale ?? source.termPromptLocale,
                }
              : { kind: 'RECIPE' as const, paletteId: node.paletteId },
        ),
  );
}

function projectTerms(
  value: AssistantProposalApplyValue,
  source: AssistantPromptAdoptionSource,
  nodes: CreationDraftPromptSnapshot['nodes'],
) {
  const expectedRevisions = new Map(
    value.kind === 'PROMPT_DRAFT'
      ? value.draft.contentNodes.flatMap((node) =>
          node.kind === 'TERM' ? [[node.termId, node.termRevisionId] as const] : [],
        )
      : source.currentPrompt.selectedTerms.map((term) => [term.id, term.termRevisionId] as const),
  );
  const availableTerms = new Map(source.availableTerms.map((term) => [term.id, term]));
  return nodes.flatMap((node) => {
    if (node.kind !== 'TERM') return [];
    const term = availableTerms.get(node.termId);
    return term && expectedRevisions.get(node.termId) === term.termRevisionId ? [term] : [];
  });
}

function projectPalettes(
  value: AssistantProposalApplyValue,
  source: AssistantPromptAdoptionSource,
  nodes: CreationDraftPromptSnapshot['nodes'],
) {
  const expectedRevisions =
    value.kind === 'PROMPT_DRAFT'
      ? new Map(
          value.draft.contentNodes.flatMap((node) =>
            node.kind === 'RECIPE' ? [[node.paletteId, node.paletteRevisionId] as const] : [],
          ),
        )
      : null;
  const availablePalettes = new Map(source.availablePalettes.map((reference) => [reference.palette.id, reference]));
  return nodes.flatMap((node) => {
    if (node.kind !== 'RECIPE') return [];
    const reference = availablePalettes.get(node.paletteId);
    if (!reference) return [];
    if (expectedRevisions?.get(node.paletteId) !== undefined) {
      return expectedRevisions.get(node.paletteId) === reference.revision.id ? [reference] : [];
    }
    return expectedRevisions ? [] : [reference];
  });
}

function promptProjection(value: AssistantProposalApplyValue, source: AssistantPromptAdoptionSource) {
  const nodes = nextPromptNodes(value, source);
  const selectedTerms = projectTerms(value, source, nodes);
  const appliedPalettes = projectPalettes(value, source, nodes);
  const expectedTermCount = nodes.filter((node) => node.kind === 'TERM').length;
  const expectedRecipeCount = nodes.filter((node) => node.kind === 'RECIPE').length;
  if (selectedTerms.length !== expectedTermCount || appliedPalettes.length !== expectedRecipeCount) return null;
  return {
    nodes,
    manualPrompt: creatorPromptText(nodes),
    selectedTerms,
    appliedPalettes,
  } satisfies CreationDraftPromptSnapshot;
}

function adoptionPersistence(
  run: AssistantRunDto,
  source: AssistantPromptAdoptionSource,
  prompt: CreationDraftPromptSnapshot,
  livePrompt: string,
  resolvedPrompt: ReturnType<typeof resolveCreatorPrompt>['composition'],
): AssistantProposalAdoptionInput['persistence'] {
  const persistence = source.persistence!;
  const references = paletteReferences(prompt.appliedPalettes);
  if (persistence.kind === 'DRAFT') {
    return {
      kind: 'DRAFT',
      draft: {
        id: persistence.id,
        expectedUpdatedAt: persistence.expectedUpdatedAt,
        ...creationDraftSaveSnapshot({
          targetAlbumId: persistence.targetAlbumId,
          title: persistence.title,
          prompt,
          referenceAssetIds: source.referenceAssets.map((asset) => asset.id),
          termPromptLocale: source.termPromptLocale,
          dictionaryScope: persistence.dictionaryScope,
          canvasPresetKey: source.canvasPresetKey,
          quality: persistence.quality,
          selectedModelKeys: [...persistence.selectedModelKeys],
          repeatCount: persistence.repeatCount,
          generationTargets: source.generationTargets.map((target) => ({ ...target })),
        }),
      },
    };
  }
  return {
    kind: 'SERIES',
    version: {
      seriesId: run.scope.id,
      creationDraftId: null,
      title: persistence.title,
      titleLocale: persistence.titleLocale,
      manualPrompt: prompt.manualPrompt,
      promptNodes: prompt.nodes,
      prompt: livePrompt,
      resolvedPrompt,
      changeSummary: persistence.titleLocale === 'zh' ? '采用 AI 帮写' : 'Applied AI writing',
      referenceAssetIds: source.referenceAssets.map((asset) => asset.id),
      termPromptLocale: source.termPromptLocale,
      termIds: prompt.selectedTerms.map((term) => term.id),
      wordPaletteReferences: references,
      modelKey: source.generationTargets[0]?.modelKey ?? 'gpt-image-2',
      canvasPresetKey: source.canvasPresetKey,
      width: source.canvasWidth,
      height: source.canvasHeight,
      quality: source.generationTargets[0]?.quality ?? 'low',
    },
  };
}

function adoptionIdentity(
  source: AssistantPromptAdoptionSource,
  baseContextKey: string,
  resultContextKey: string,
  prompt: CreationDraftPromptSnapshot,
) {
  const persistence =
    source.persistence?.kind === 'DRAFT'
      ? {
          kind: source.persistence.kind,
          id: source.persistence.id,
          targetAlbumId: source.persistence.targetAlbumId,
          title: source.persistence.title,
          dictionaryScope: source.persistence.dictionaryScope,
          quality: source.persistence.quality,
          selectedModelKeys: source.persistence.selectedModelKeys,
          repeatCount: source.persistence.repeatCount,
        }
      : source.persistence;
  return JSON.stringify({
    baseContextKey,
    resultContextKey,
    currentPrompt: {
      nodes: normalizeCreatorPromptNodes(source.currentPrompt.nodes),
      manualPrompt: source.currentPrompt.manualPrompt,
      termRevisions: source.currentPrompt.selectedTerms.map((term) => [term.id, term.termRevisionId]),
      palettes: paletteReferences(source.currentPrompt.appliedPalettes),
    },
    resultPrompt: {
      nodes: prompt.nodes,
      termRevisions: prompt.selectedTerms.map((term) => [term.id, term.termRevisionId]),
      palettes: paletteReferences(prompt.appliedPalettes),
    },
    persistence,
    promptProfileId: source.promptProfileId,
    referenceAssets: source.referenceAssets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      originType: asset.originType ?? '',
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
      createdAt: asset.createdAt,
    })),
    termPromptLocale: source.termPromptLocale,
    canvasPresetKey: source.canvasPresetKey,
    canvasWidth: source.canvasWidth,
    canvasHeight: source.canvasHeight,
    generationTargets: source.generationTargets,
  });
}

export function prepareAssistantPromptAdoption(
  run: AssistantRunDto,
  value: AssistantProposalApplyValue,
  source: AssistantPromptAdoptionSource,
): AssistantPromptAdoptionPreparation {
  if (!run.proposal || run.proposal.status === 'CLOSED') return { ok: false, reason: 'PROPOSAL_UNAVAILABLE' };
  if (!scopeMatches(run, source.persistence)) return { ok: false, reason: 'SCOPE_CHANGED' };
  const prompt = promptProjection(value, source);
  if (!prompt) return { ok: false, reason: 'MATERIAL_REVISION_CHANGED' };
  const beforeResolution = resolveCreatorPrompt({
    manualPrompt: source.currentPrompt.manualPrompt,
    promptNodes: source.currentPrompt.nodes,
    selectedTerms: source.currentPrompt.selectedTerms,
    appliedPalettes: source.currentPrompt.appliedPalettes,
    termPromptLocale: source.termPromptLocale,
    promptProfileId: source.promptProfileId,
  });
  const afterResolution = resolveCreatorPrompt({
    manualPrompt: prompt.manualPrompt,
    promptNodes: prompt.nodes,
    selectedTerms: prompt.selectedTerms,
    appliedPalettes: prompt.appliedPalettes,
    termPromptLocale: source.termPromptLocale,
    promptProfileId: source.promptProfileId,
  });
  const contextInput = {
    referenceAssets: source.referenceAssets,
    canvasPresetKey: source.canvasPresetKey,
    canvasWidth: source.canvasWidth,
    canvasHeight: source.canvasHeight,
    generationTargets: source.generationTargets,
  };
  const baseContextKey = buildCreatorAssistantContextKey({ resolution: beforeResolution, ...contextInput });
  if (run.contextKey !== baseContextKey && run.proposal.adoptedContextKey !== baseContextKey) {
    return { ok: false, reason: 'CONTEXT_CHANGED' };
  }
  const resultContextKey = buildCreatorAssistantContextKey({ resolution: afterResolution, ...contextInput });
  const beforeDocument = {
    promptNodes: normalizeCreatorPromptNodes(source.currentPrompt.nodes),
    termIds: source.currentPrompt.selectedTerms.map((term) => term.id),
    wordPaletteReferences: paletteReferences(source.currentPrompt.appliedPalettes),
  };
  const afterDocument = {
    promptNodes: prompt.nodes,
    termIds: prompt.selectedTerms.map((term) => term.id),
    wordPaletteReferences: paletteReferences(prompt.appliedPalettes),
  };
  return {
    ok: true,
    identity: adoptionIdentity(source, baseContextKey, resultContextKey, prompt),
    input: {
      runId: run.id,
      baseContextKey,
      resultContextKey,
      authorizedContextKey: resultContextKey,
      beforePrompt: beforeResolution.livePrompt,
      afterPrompt: afterResolution.livePrompt,
      beforeDocument,
      afterDocument,
      persistence: adoptionPersistence(run, source, prompt, afterResolution.livePrompt, afterResolution.composition),
    },
    prompt,
  };
}
