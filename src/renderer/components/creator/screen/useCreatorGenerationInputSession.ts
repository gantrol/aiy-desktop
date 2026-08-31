import { useMemo, useState } from 'react';
import type {
  AssistantRunDto,
  BootstrapDto,
  CreationDraftDto,
  GenerationTargetInput,
  Locale,
  PromptSeriesDto,
} from '@/shared/contracts';
import type { RendererImageImportSource } from '@/renderer/components/creator/imageImport';
import type { CreatorLocation } from '@/renderer/components/app/app-navigation';
import {
  initialGenerationTargets,
  latestVersionGenerationTargets,
} from '@/renderer/components/creator/generationTargetDefaults';
import { useCreatorOutputImport } from '@/renderer/components/creator/useCreatorOutputImport';
import type { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import type { useCreatorPromptSession } from '@/renderer/components/creator/screen/useCreatorPromptSession';
import { useCreatorDictionaryMaterials } from '@/renderer/components/creator/workflows/useCreatorDictionaryMaterials';
import { useCreatorGenerationConfiguration } from '@/renderer/components/creator/workflows/useCreatorGenerationConfiguration';
import { useCreatorInputHydration } from '@/renderer/components/creator/workflows/useCreatorInputHydration';
import {
  creatorReferenceImportContext,
  useCreatorReferenceImport,
} from '@/renderer/components/creator/workflows/useCreatorReferenceImport';
import {
  buildCreatorAssistantContextKey,
  creatorInputMatchesVersion,
  resolveCreatorPrompt,
} from '@/renderer/components/creator/utils';

type SelectionSession = ReturnType<typeof useCreatorSelectionSession>;
type PromptSession = ReturnType<typeof useCreatorPromptSession>;

interface Options {
  applyImportedOutputs: Parameters<typeof useCreatorOutputImport>[0]['applyImportedOutputs'];
  data: BootstrapDto;
  defaultPromptLocale: Locale | null;
  initialAssistantRun: AssistantRunDto | null;
  initialDraft: CreationDraftDto | null;
  locale: Locale;
  location: CreatorLocation;
  messages: {
    duplicates: string;
    importDraftLimit: string;
    importFailed: string;
    imported: string;
    recipeApplied: string;
    recipeSaved: string;
  };
  notify(message: string): void;
  prompt: PromptSession;
  refresh(): Promise<void>;
  selection: SelectionSession;
  series: PromptSeriesDto | undefined;
}

function initialTargetHint(
  run: AssistantRunDto | null,
  version: PromptSeriesDto['versions'][number] | undefined,
  series: PromptSeriesDto | undefined,
) {
  const assistantTargets =
    run?.proposal && ['READY', 'ADOPTED'].includes(run.proposal.status) ? run.input.generationTargets : [];
  return assistantTargets.length ? assistantTargets : latestVersionGenerationTargets(version, series?.versions ?? []);
}

function matchingImportVersionId(
  creationMode: SelectionSession['creationMode'],
  version: ReturnType<typeof useCreatorInputHydration>['version'],
  promptDocument: PromptSession['promptDocument'],
) {
  if (creationMode !== 'existing') return null;
  return creatorInputMatchesVersion({
    version,
    manualPrompt: promptDocument.manualPrompt,
    promptNodes: promptDocument.promptNodes,
    selectedTerms: promptDocument.selectedTerms,
    appliedPalettes: promptDocument.appliedPalettes,
    termPromptLocale: promptDocument.termPromptLocale,
    referenceAssets: promptDocument.referenceAssets,
  })
    ? (version?.id ?? null)
    : null;
}

export function useCreatorGenerationInputSession({
  applyImportedOutputs,
  data,
  defaultPromptLocale,
  initialAssistantRun,
  initialDraft,
  locale,
  location,
  messages,
  notify,
  prompt,
  refresh,
  selection,
  series,
}: Options) {
  const { creationDraftSession, creationMode, inputSessionRevision, seriesId, setTargetAlbumId } = selection;
  const { dictionaryCatalog, initialVersion, initialVersionId, newTitle, promptDocument, setNewTitle } = prompt;
  const initialGenerationTargetHint = initialTargetHint(initialAssistantRun, initialVersion, series);
  const [generationTargets, setGenerationTargets] = useState<GenerationTargetInput[]>(() =>
    initialGenerationTargets(
      { creationDraft: initialDraft, imageGenerationRoutes: data.imageGenerationRoutes },
      initialGenerationTargetHint,
    ),
  );
  const [canvasPresetKey, setCanvasPresetKey] = useState(initialDraft?.canvasPresetKey ?? '');
  const hydration = useCreatorInputHydration({
    creationMode,
    data,
    defaultPromptLocale,
    initialVersionId,
    locale,
    locationVersionId:
      location.surface === 'existing-creation' && location.seriesId === series?.id
        ? (location.versionId ?? null)
        : null,
    patchSavedDraftTitle: creationDraftSession.patchSavedDraftTitle,
    replaceDraftSession: creationDraftSession.replaceDraftSession,
    replacePromptDocument: promptDocument.replaceDocument,
    series,
    setCanvasPresetKey,
    setDictionaryScope: dictionaryCatalog.setDictionaryScope,
    setGenerationTargets,
    setNewTitle,
    setTargetAlbumId,
  });
  const canvasPreset = data.canvasPresets.find((preset) => preset.stableKey === canvasPresetKey);
  const configuration = useCreatorGenerationConfiguration({
    codex: data.codex,
    creationMode,
    defaultPromptLocale,
    generationTargets,
    locale,
    routes: data.imageGenerationRoutes,
    selectedTermCount: promptDocument.selectedTerms.length,
    setGenerationTargets,
    setTermPromptLocale: promptDocument.setTermPromptLocale,
  });
  const creatorImportVersionId = matchingImportVersionId(creationMode, hydration.version, promptDocument);
  const creatorImportContextBase = {
    seriesId: creationMode === 'existing' ? seriesId : null,
    versionId: creatorImportVersionId,
    title: creationMode === 'new' ? newTitle.trim() : (series?.title ?? ''),
    titleLocale: locale,
  };
  function creatorImportContext(source: RendererImageImportSource, sourceUrl = '') {
    return creatorReferenceImportContext(creatorImportContextBase, source, sourceUrl);
  }
  const referenceImport = useCreatorReferenceImport({
    context: creatorImportContextBase,
    importFailedMessage: messages.importFailed,
    notify,
    scopeKey:
      creationMode === 'existing'
        ? `series:${seriesId ?? ''}:version:${hydration.versionId}:session:${inputSessionRevision}`
        : `draft:${creationDraftSession.draftId ?? 'new'}:session:${inputSessionRevision}`,
    updateReferenceAssets: promptDocument.updateReferenceAssets,
  });
  const outputImport = useCreatorOutputImport({
    createContext: creatorImportContext,
    defaultPromptVersionId: creationMode === 'existing' ? (hydration.version?.id ?? null) : null,
    applyImportedOutputs,
    refresh,
    notify,
    messages: {
      importFailed: messages.importFailed,
      imported: messages.imported,
      duplicates: messages.duplicates,
      tooManyImages: messages.importDraftLimit,
    },
  });
  const quality = generationTargets[0]?.quality ?? 'low';
  const repeatCount = generationTargets[0]?.count ?? 1;
  const promptResolution = useMemo(
    () =>
      resolveCreatorPrompt({
        manualPrompt: promptDocument.manualPrompt,
        promptNodes: promptDocument.promptNodes,
        selectedTerms: promptDocument.selectedTerms,
        appliedPalettes: promptDocument.appliedPalettes,
        termPromptLocale: promptDocument.termPromptLocale,
        promptProfileId: configuration.promptProfileId,
      }),
    [
      promptDocument.manualPrompt,
      promptDocument.promptNodes,
      promptDocument.selectedTerms,
      promptDocument.appliedPalettes,
      promptDocument.termPromptLocale,
      configuration.promptProfileId,
    ],
  );
  const assistantContextKey = useMemo(
    () =>
      buildCreatorAssistantContextKey({
        resolution: promptResolution,
        referenceAssets: promptDocument.referenceAssets,
        canvasPresetKey: canvasPreset?.stableKey ?? null,
        canvasWidth: canvasPreset?.width ?? null,
        canvasHeight: canvasPreset?.height ?? null,
        generationTargets,
      }),
    [
      promptResolution,
      promptDocument.referenceAssets,
      canvasPreset?.stableKey,
      canvasPreset?.width,
      canvasPreset?.height,
      generationTargets,
    ],
  );
  const dictionaryMaterials = useCreatorDictionaryMaterials({
    defaultPromptLocale,
    effectiveTermIds: promptResolution.effectiveTerms.map((item) => item.term.id),
    locale,
    materialsRef: promptDocument.materialsRef,
    notify,
    onPaletteSaved(palette) {
      dictionaryCatalog.rememberPalette(palette);
      void refresh();
    },
    promptComposerRef: promptDocument.promptComposerRef,
    promptNodes: promptDocument.promptNodes,
    recipeAppliedMessage: messages.recipeApplied,
    recipeSavedMessage: messages.recipeSaved,
    setTermQuery: dictionaryCatalog.setQuery,
    termPromptLocale: promptDocument.termPromptLocale,
    terms: data.terms,
    updateMaterials: promptDocument.updateMaterials,
    updatePromptDocument: promptDocument.updatePromptDocument,
  });

  return {
    assistantContextKey,
    canvasPreset,
    canvasPresetKey,
    configuration,
    dictionaryCatalog,
    dictionaryMaterials,
    generationTargets,
    hydration,
    outputImport,
    promptDocument,
    promptResolution,
    quality,
    referenceImport,
    repeatCount,
    setCanvasPresetKey,
    setGenerationTargets,
    title: newTitle,
  };
}
