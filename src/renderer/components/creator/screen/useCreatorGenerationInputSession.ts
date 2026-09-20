import { useMemo, useState } from 'react';
import { creatorInputScopeKey } from '@/renderer/components/creator/workflows/creatorInputScopeKey';
import type {
  AssistantRunDto,
  BootstrapDto,
  CreationDraftDto,
  CreatorImageImportContext,
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
import {
  creatorOutputImportTarget,
  useDerivedVisualOutputImportContext,
} from '@/renderer/components/creator/workflows/useDerivedVisualOutputImportContext';
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
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useI18n } from '@/renderer/i18n/useI18n';

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
  onCreationCommitted(target: { keepEditorOpen: boolean; seriesId: string; versionId: string }): void;
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

interface BrowserPromptSnapshot {
  draft: CreationDraftDto;
  captured: CreationDraftPromptSnapshot;
  referenceAssetIds: string[];
  text: string;
}

function commitBrowserPromptSnapshot(
  input: BrowserPromptSnapshot,
  target: {
    seriesId: string | null;
    baseVersionId: string | null;
    title: string;
  },
) {
  const { draft, captured, referenceAssetIds, text } = input;
  return window.desktopApi.creationDraftCommit({
    ...target,
    creationDraftId: draft.id,
    manualPrompt: captured.manualPrompt,
    document: captured.document,
    promptNodes: captured.nodes,
    prompt: text,
    changeSummary: 'MANUAL_PROMPT',
    referenceAssetIds,
    termPromptLocale: draft.termPromptLocale,
    termIds: captured.selectedTerms.map((term) => term.id),
    wordPaletteReferences: captured.appliedPalettes.map((reference) => ({
      paletteId: reference.palette.id,
      paletteRevisionId: reference.revision.id,
      parameterValues: { ...reference.parameterValues },
      promptLocale: reference.promptLocale,
    })),
  });
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
  onCreationCommitted,
  prompt,
  refresh,
  selection,
  series,
}: Options) {
  const visualCopy = useI18n().messages.creator.derivedVisual;
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
  const importTarget = creatorOutputImportTarget(
    data,
    creationMode,
    creationDraftSession.draftId,
    seriesId,
    creatorImportVersionId,
  );
  const creatorImportContextBase = {
    ...importTarget,
    title: creationMode === 'new' ? newTitle.trim() : (series?.title ?? ''),
    titleLocale: locale,
  };
  function creatorImportContext(source: RendererImageImportSource, sourceUrl = '') {
    return creatorReferenceImportContext(creatorImportContextBase, source, sourceUrl);
  }
  const inputScopeKey = creatorInputScopeKey({
    libraryKey: data.spaceName,
    sessionGeneration: creationDraftSession.captureAutosaveIdentity().sessionGeneration,
    inputSessionRevision,
    creationMode,
    seriesId,
    versionId: hydration.versionId,
  });
  const referenceImport = useCreatorReferenceImport({
    context: creatorImportContextBase,
    importFailedMessage: messages.importFailed,
    notify,
    scopeKey: inputScopeKey,
    updateReferenceAssets: promptDocument.updateReferenceAssets,
  });

  const prepareDerivedVisualOutputImportContext = useDerivedVisualOutputImportContext({
    creationDraftSession,
    creationMode,
    data,
    locale,
    newTitle,
    promptDocument,
    promptProfileId: configuration.promptProfileId,
  });
  const prepareOutputImportContext = useStableCallback(
    async (context: CreatorImageImportContext, requirePromptVersion = false) => {
      const prepared = await prepareDerivedVisualOutputImportContext(context, requirePromptVersion);
      const committed = prepared.committedDraft;
      if (committed && creationMode === 'new' && creationDraftSession.getDraftId() === committed.creationDraftId) {
        creationDraftSession.replaceDraftSession(null);
        selection.setCreationMode('existing');
        selection.setTargetAlbumId(null);
        selection.contentSelection.setSelectedInspirationStashId(null);
        selection.contentSelection.setSelectedIdeaCreationId(null);
        selection.setSeriesId(committed.seriesId);
        hydration.setVersionId(committed.versionId);
        onCreationCommitted(committed);
        void refresh().catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
      }
      return prepared;
    },
  );
  const outputImport = useCreatorOutputImport({
    createContext: creatorImportContext,
    prepareContext: prepareOutputImportContext,
    defaultPromptVersionId: creatorImportContextBase.versionId,
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
  async function prepareBrowserCompanionOutputTarget(input: BrowserPromptSnapshot) {
    const { draft } = input;
    if (creationDraftSession.getDraftId() !== draft.id) throw new Error(visualCopy.importContextChanged);
    const existingSeriesId = creationMode === 'existing' ? seriesId : importTarget.seriesId;
    const result = await commitBrowserPromptSnapshot(input, {
      seriesId: existingSeriesId,
      baseVersionId: existingSeriesId ? (hydration.version?.id ?? importTarget.versionId) : null,
      title: series?.title ?? (newTitle.trim() || visualCopy.untitled),
    });
    if (creationDraftSession.getDraftId() === draft.id) {
      creationDraftSession.replaceDraftSession(null);
      selection.setCreationMode('existing');
      selection.setSeriesId(result.seriesId);
      hydration.setVersionId(result.versionId);
      onCreationCommitted({ ...result, keepEditorOpen: Boolean(selection.workbenchProjection.editorDerivedVisual) });
    }
    void refresh().catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
    return { seriesId: result.seriesId, promptVersionId: result.versionId };
  }
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
    inputScopeKey,
    canvasPreset,
    canvasPresetKey,
    configuration,
    dictionaryCatalog,
    dictionaryMaterials,
    generationTargets,
    hydration,
    outputImport,
    prepareBrowserCompanionOutputTarget,
    promptDocument,
    promptResolution,
    quality,
    referenceImport,
    repeatCount,
    setCanvasPresetKey,
    setGenerationTargets,
    setTitle: setNewTitle,
    title: newTitle,
  };
}
