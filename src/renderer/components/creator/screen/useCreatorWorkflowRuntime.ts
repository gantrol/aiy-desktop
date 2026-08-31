import type { Dispatch, SetStateAction } from 'react';
import type { BootstrapDto, DerivedVisualWorkspaceOpenResult, Locale, WordPaletteDto } from '@/shared/contracts';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import type { useCreatorDraftInputSession } from '@/renderer/components/creator/screen/useCreatorDraftInputSession';
import type { useCreatorGenerationInputSession } from '@/renderer/components/creator/screen/useCreatorGenerationInputSession';
import type { useCreatorGenerationRuntime } from '@/renderer/components/creator/screen/useCreatorGenerationRuntime';
import type { useCreatorScreenProjection } from '@/renderer/components/creator/screen/useCreatorScreenProjection';
import type { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import type { useCreatorWorkbenchProjection } from '@/renderer/components/creator/screen/useCreatorWorkbenchProjection';
import { useCreatorAssistantRuntime } from '@/renderer/components/creator/screen/useCreatorAssistantRuntime';
import { initialGenerationTargets } from '@/renderer/components/creator/generationTargetDefaults';
import { creationDraftSnapshotHasMeaningfulInput } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useCreationDraftAutosave } from '@/renderer/components/creator/workflows/useCreationDraftSession';
import { useCreatorContentWorkflows } from '@/renderer/components/creator/workflows/useCreatorContentWorkflows';
import { useCreatorInspirationSession } from '@/renderer/components/creator/workflows/useCreatorInspirationSession';

type DraftInputSession = ReturnType<typeof useCreatorDraftInputSession>;
type GenerationInputSession = ReturnType<typeof useCreatorGenerationInputSession>;
type GenerationRuntime = ReturnType<typeof useCreatorGenerationRuntime>;
type ScreenProjection = ReturnType<typeof useCreatorScreenProjection>;
type SelectionSession = ReturnType<typeof useCreatorSelectionSession>;
type WorkbenchProjection = ReturnType<typeof useCreatorWorkbenchProjection>;

interface Options {
  active: boolean;
  configurationRequiredMessage: string;
  data: BootstrapDto;
  defaultPromptLocale: Locale | null;
  draftInput: DraftInputSession;
  generation: GenerationInputSession;
  generationRuntime: GenerationRuntime;
  generationStarting: boolean;
  locale: Locale;
  notify(message: string): void;
  onOpenDerivedVisualWorkspace(result: DerivedVisualWorkspaceOpenResult): void;
  onPromptFullWindowChange(open: boolean): void;
  preserveBeforeNavigation(): Promise<boolean>;
  projection: ScreenProjection;
  promptFullWindow: boolean;
  refresh(): Promise<void>;
  restartNewCreation(albumId: string | null): Promise<boolean>;
  selection: SelectionSession;
  setDistilledPalette(palette: WordPaletteDto | null): void;
  setOutputMode: Dispatch<SetStateAction<CreationOutputMode>>;
  setRequestedAssetId(assetId: string | null): void;
  setRenameOpen(open: boolean): void;
  successMessage: string;
  workbench: WorkbenchProjection;
}

export function useCreatorWorkflowRuntime({
  active,
  configurationRequiredMessage,
  data,
  defaultPromptLocale,
  draftInput,
  generation,
  generationRuntime,
  generationStarting,
  locale,
  notify,
  onOpenDerivedVisualWorkspace,
  onPromptFullWindowChange,
  preserveBeforeNavigation,
  projection,
  promptFullWindow,
  refresh,
  restartNewCreation,
  selection,
  setDistilledPalette,
  setOutputMode,
  setRequestedAssetId,
  setRenameOpen,
  successMessage,
  workbench,
}: Options) {
  const document = generation.promptDocument;
  const draftSession = selection.creationDraftSession;
  const navigation = draftInput.navigation;
  const inspiration = useCreatorInspirationSession({
    capturePrompt: document.capture,
    creationItems: data.creationItems,
    creationMode: selection.creationMode,
    currentSeriesId: selection.creationMode === 'existing' ? (workbench.sessionHostSeries?.id ?? null) : null,
    getCreationDraftId: draftSession.getDraftId,
    locale,
    manualPrompt: document.manualPrompt,
    notify,
    onOpenStash(stash) {
      selection.contentSelection.setSelectedInspirationStashId(stash.id);
      selection.contentSelection.setSelectedIdeaCreationId(null);
      selection.contentSelection.setSelectedAlbumId(null);
      projection.panes.setCompactPanel('creator');
      navigation.commit({ surface: 'inspiration-stash', stashId: stash.id }, 'replace');
    },
    palettes: data.wordPalettes,
    promptNodes: document.promptNodes,
    referenceAssetIds: document.referenceAssets.map((asset) => asset.id),
    refresh,
    replacePromptDocument: document.replaceDocument,
    restartNewCreation,
    saveCreationDraft: (prompt) => draftSession.saveDraftNow(undefined, prompt),
    selectedStashId: selection.contentSelection.selectedInspirationStashId,
    selectedTerms: document.selectedTerms,
    synchronizePrompt: document.synchronize,
    targetAlbumId: selection.targetAlbumId,
    termPromptLocale: document.termPromptLocale,
    terms: data.terms,
    wordPaletteReferences: document.appliedPalettes.map((reference) => ({
      paletteId: reference.palette.id,
      paletteRevisionId: reference.revision.id,
      parameterValues: reference.parameterValues,
      promptLocale: reference.promptLocale,
    })),
  });
  const content = useCreatorContentWorkflows({
    automaticChangeSummary: projection.automaticChangeSummary,
    captureDraftCommitIdentity: draftInput.draftProjection.captureCommitIdentity,
    captureDraftSaveSnapshot: (prompt) => draftInput.draftProjection.captureDraft(undefined, prompt),
    capturePrompt: document.capture,
    clearSavedInspiration: inspiration.clearSavedContent,
    commit: navigation.commit,
    data,
    editorSocialCoverVisualId: workbench.editorSocialCoverVisual?.id ?? null,
    generationRequestIdentity: generationRuntime.requestIdentity,
    getSavedDraftTitle: () => draftSession.getSavedDraft()?.title.trim() ?? '',
    invalidateAutosaves: draftSession.invalidateAutosaves,
    locale,
    newTitle: generation.title,
    notify,
    onOpenDerivedVisualWorkspace,
    preserveBeforeNavigation,
    promptProfileId: generation.configuration.promptProfileId,
    referenceAssets: document.referenceAssets,
    refresh,
    replaceDraftSession: draftSession.replaceDraftSession,
    resetInputs,
    restoreDraft: generation.hydration.restoreDraft,
    saveCapturedDraft: draftSession.saveCapturedSnapshot,
    saveDraft: (prompt) => draftSession.saveDraftNow(undefined, prompt),
    selectedInspirationStashId: selection.contentSelection.selectedInspirationStashId,
    setCompactPanel: projection.panes.setCompactPanel,
    setCreationMode: selection.setCreationMode,
    setOutputCollapsed: projection.panes.setOutputCollapsed,
    setOutputMode,
    setOutputSeriesId: workbench.setOutputSeriesId,
    setRequestedAssetId,
    setSelectedAlbumId: selection.contentSelection.setSelectedAlbumId,
    setSelectedArticleId: selection.contentSelection.setSelectedArticleId,
    setSelectedIdeaCreationId: selection.contentSelection.setSelectedIdeaCreationId,
    setSelectedInspirationStashId: selection.contentSelection.setSelectedInspirationStashId,
    setSelectedSocialPostId: selection.contentSelection.setSelectedSocialPostId,
    setSeriesId: selection.setSeriesId,
    setTargetAlbumId: selection.setTargetAlbumId,
    setVersionId: generation.hydration.setVersionId,
    synchronizePrompt: document.synchronize,
    targetAlbumId: selection.targetAlbumId,
    termPromptLocale: document.termPromptLocale,
  });
  const assistant = useCreatorAssistantRuntime({
    active,
    configurationRequiredMessage,
    data,
    defaultPromptLocale,
    draftInput,
    generation,
    locale,
    notify,
    projection,
    promptFullWindow,
    refresh,
    selection,
    setDistilledPalette,
    setOutputMode,
    successMessage,
    workbench,
  });
  const starting = generationStarting || content.outcome.starting;
  const autosaveSnapshot = draftInput.draftProjection.snapshotForPrompt({
    nodes: document.promptNodes,
    manualPrompt: document.manualPrompt,
    selectedTerms: document.selectedTerms,
    appliedPalettes: document.appliedPalettes,
  });
  const hasDraftContent = creationDraftSnapshotHasMeaningfulInput(
    autosaveSnapshot,
    selection.targetAlbum?.creationDefaults ?? null,
    initialGenerationTargets({ creationDraft: null, imageGenerationRoutes: data.imageGenerationRoutes }),
  );
  useCreationDraftAutosave({
    autosaveKey: `${locale}:${JSON.stringify(autosaveSnapshot)}`,
    draftId: draftSession.draftId,
    enabled: autosaveEnabled(selection, assistant.workflows.adoption.busy, starting),
    hasContent: hasDraftContent,
    captureIdentity: draftSession.captureAutosaveIdentity,
    saveIfCurrent: draftSession.saveAutosaveIfCurrent,
    onError(reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    },
  });

  function resetInputs() {
    draftSession.invalidateAutosaves();
    selection.setInputSessionRevision((revision) => revision + 1);
    generation.hydration.resetHydration();
    document.promptNodesRef.current = [];
    document.setManualPrompt('');
    document.setPromptNodes([]);
    document.replaceMaterials({
      ...document.materialsRef.current,
      referenceAssets: [],
      selectedTerms: [],
      appliedPalettes: [],
    });
    generation.dictionaryMaterials.closeDictionary();
    onPromptFullWindowChange(false);
    assistant.workflows.reset();
    setRenameOpen(false);
    draftInput.inputStashes.reset();
  }

  return { assistant, content, inspiration, resetInputs, starting };
}

function autosaveEnabled(selection: SelectionSession, adoptionBusy: boolean, starting: boolean) {
  const selected = selection.contentSelection;
  return Boolean(
    selection.creationMode === 'new' &&
    !selected.selectedEvaluationSuiteId &&
    !selected.selectedImageBreakdownId &&
    !selected.selectedInspirationStashId &&
    !selected.selectedSocialPostId &&
    !selected.selectedArticleId &&
    !adoptionBusy &&
    !starting,
  );
}
