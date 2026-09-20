import type { Dispatch, SetStateAction } from 'react';
import type { BootstrapDto, Locale } from '@/shared/contracts';
import type { CreatorLocation } from '@/renderer/components/app/app-navigation';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import type { useCreatorDraftInputSession } from '@/renderer/components/creator/screen/useCreatorDraftInputSession';
import type { useCreatorGenerationInputSession } from '@/renderer/components/creator/screen/useCreatorGenerationInputSession';
import type { useCreatorGenerationRuntime } from '@/renderer/components/creator/screen/useCreatorGenerationRuntime';
import type { useCreatorScreenProjection } from '@/renderer/components/creator/screen/useCreatorScreenProjection';
import type { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import type { useCreatorWorkbenchProjection } from '@/renderer/components/creator/screen/useCreatorWorkbenchProjection';
import type { useCreatorWorkflowRuntime } from '@/renderer/components/creator/screen/useCreatorWorkflowRuntime';
import { initialGenerationTargets } from '@/renderer/components/creator/generationTargetDefaults';
import { creationDraftSnapshotHasMeaningfulInput } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { creationItemByFormEntity } from '@/renderer/components/creator/creationFormEntities';
import { useCreatorNavigationWorkflows } from '@/renderer/components/creator/workflows/useCreatorNavigationWorkflows';

type DraftInputSession = ReturnType<typeof useCreatorDraftInputSession>;
type GenerationInputSession = ReturnType<typeof useCreatorGenerationInputSession>;
type GenerationRuntime = ReturnType<typeof useCreatorGenerationRuntime>;
type ScreenProjection = ReturnType<typeof useCreatorScreenProjection>;
type SelectionSession = ReturnType<typeof useCreatorSelectionSession>;
type WorkbenchProjection = ReturnType<typeof useCreatorWorkbenchProjection>;
type WorkflowRuntime = ReturnType<typeof useCreatorWorkflowRuntime>;

interface Options {
  active: boolean;
  data: BootstrapDto;
  defaultPromptLocale: Locale | null;
  draftInput: DraftInputSession;
  generation: GenerationInputSession;
  generationRuntime: GenerationRuntime;
  locale: Locale;
  location: CreatorLocation;
  messages: {
    externalImported: string;
    restartRequired: string;
    versionCreated: string;
    versionUnavailable: string;
  };
  notify(message: string): void;
  onActiveAlbumChange(albumId: string | null): void;
  onComparisonFullWindowChange(open: boolean): void;
  onPromptFullWindowChange(open: boolean): void;
  onSelectDocument(id: string, albumId: string | null): void;
  outputMode: CreationOutputMode;
  projection: ScreenProjection;
  refresh(): Promise<void>;
  refreshAlbums(): Promise<void>;
  requestedAssetId: string | null;
  selectedDocumentId: string | null;
  selection: SelectionSession;
  setOutputGalleryOpen: Dispatch<SetStateAction<boolean>>;
  setOutputMode: Dispatch<SetStateAction<CreationOutputMode>>;
  setRenameOpen: Dispatch<SetStateAction<boolean>>;
  setRequestedAssetId(assetId: string | null): void;
  starting: boolean;
  workbench: WorkbenchProjection;
  workflow: WorkflowRuntime;
}

export function useCreatorNavigationRuntime({
  active,
  data,
  defaultPromptLocale,
  draftInput,
  generation,
  generationRuntime,
  locale,
  location,
  messages,
  notify,
  onActiveAlbumChange,
  onComparisonFullWindowChange,
  onPromptFullWindowChange,
  onSelectDocument,
  outputMode,
  projection,
  refresh,
  refreshAlbums,
  requestedAssetId,
  selectedDocumentId,
  selection,
  setOutputGalleryOpen,
  setOutputMode,
  setRenameOpen,
  setRequestedAssetId,
  starting,
  workbench,
  workflow,
}: Options) {
  const selected = selection.contentSelection;
  const document = generation.promptDocument;
  return useCreatorNavigationWorkflows({
    onSelectDocument,
    active,
    activeAlbumContextId:
      projection.creatorSurface === 'animation' && location.surface === 'animation'
        ? (creationItemByFormEntity(data.creationItems, 'GIF_DOCUMENT', location.documentId)?.albumId ?? null)
        : workbench.activeAlbumContextId,
    activeDerivedVisualId: workbench.activeDerivedVisual?.id ?? null,
    activeIdeaCreation: projection.activeIdeaCreation,
    activeSessionSeries: workbench.activeCreationSession?.memberSeries ?? [],
    albumTree: selection.albumTree,
    appendPromptText: document.appendText,
    locationApplicationRef: draftInput.navigation.locationApplicationRef,
    automaticChangeSummary: projection.automaticChangeSummary,
    capturePrompt: document.capture,
    chooseDerivedVisual: workflow.content.derivedVisual.resumeDerivedVisual,
    clearAssistantError: workflow.assistant.workflows.request.clearError,
    clearSavedInspiration: workflow.inspiration.clearSavedContent,
    clearSelection: selected.clearSelection,
    commit: draftInput.navigation.commit,
    creationDraftId: selection.creationDraftSession.getDraftId(),
    creationMode: selection.creationMode,
    creationSessions: selection.creationSessions,
    data,
    defaultPromptLocale,
    detachDraftIdentity: selection.creationDraftSession.detachDraftIdentity,
    derivedDraftParentLocation: selection.initial.derivedDraftParentLocation,
    editorDerivedVisual: workbench.editorDerivedVisual,
    generationRequestIdentity: generationRuntime.requestIdentity,
    initialDraft: selection.initial.initialDraft,
    initialSeriesId: selection.initial.initialSeriesId,
    invalidateAutosaves: selection.creationDraftSession.invalidateAutosaves,
    locale,
    location,
    manualPrompt: document.manualPrompt,
    meaningfulDraftInput: creationDraftSnapshotHasMeaningfulInput(
      draftInput.draftProjection.snapshotForPrompt({
        document: document.document,
        nodes: document.promptNodes,
        manualPrompt: document.manualPrompt,
        selectedTerms: document.selectedTerms,
        appliedPalettes: document.appliedPalettes,
      }),
      selection.targetAlbum?.creationDefaults ?? null,
      initialGenerationTargets({ creationDraft: null, imageGenerationRoutes: data.imageGenerationRoutes }),
    ),
    newTitle: generation.title,
    notify,
    onActiveAlbumChange,
    onComparisonFullWindowChange,
    onPromptFullWindowChange,
    outputMode,
    outputSeriesAvailable: Boolean(workbench.outputSeries),
    panes: projection.panes,
    preserveParentSelection: Boolean(selected.selectedArticle || selected.selectedSocialPost),
    hasPendingInput: () => document.promptComposerRef.current?.hasPendingInput() ?? false,
    getSavedDraft: selection.creationDraftSession.getSavedDraft,
    isDraftInputSaved: selection.creationDraftSession.isCurrentInputSaved,
    preserveWorkingInput: draftInput.recovery.flush,
    promptNodesRef: document.promptNodesRef,
    promptProfileId: generation.configuration.promptProfileId,
    referenceAssetCount: document.referenceAssets.length,
    referenceAssets: document.referenceAssets,
    refresh,
    refreshAlbums,
    rememberSavedDraft: selection.creationDraftSession.rememberSavedDraft,
    replaceDraftSession: selection.creationDraftSession.replaceDraftSession,
    requestAssistant: workflow.assistant.workflows.request.request,
    requestedAssetId,
    resetInputs: workflow.resetInputs,
    restoreAssistant: workflow.assistant.workflows.restoreScope,
    restoreDraft: generation.hydration.restoreDraft,
    restoreInspiration: workflow.inspiration.restore,
    restoreVersion: generation.hydration.restoreVersion,
    saveDraft: selection.creationDraftSession.saveDraftNow,
    selected: {
      albumId: selected.selectedAlbumId,
      articleId: selected.selectedArticleId,
      documentId: selectedDocumentId,
      evaluationSuiteId: selected.selectedEvaluationSuiteId,
      ideaCreationId: selected.selectedIdeaCreationId,
      imageBreakdownId: selected.selectedImageBreakdownId,
      inspirationStashId: selected.selectedInspirationStashId,
      socialPostId: selected.selectedSocialPostId,
    },
    selectedArticle: selected.selectedArticle,
    selectedContent: Boolean(
      selected.selectedEvaluationSuiteId ||
      selected.selectedImageBreakdownId ||
      (!workbench.editorDerivedVisual && (selected.selectedSocialPostId || selected.selectedArticleId)),
    ),
    selectedIdeaCreation: selected.selectedIdeaCreation,
    selectedSocialPost: selected.selectedSocialPost,
    selectedTermCount: document.selectedTerms.length,
    selection: selected.selection,
    series: workbench.series ?? null,
    seriesId: selection.seriesId,
    setCanvasPresetKey: generation.setCanvasPresetKey,
    setCreationMode: selection.setCreationMode,
    setDictionaryScope: generation.dictionaryCatalog.setDictionaryScope,
    setDismissedDerivedVisualId: workbench.setDismissedDerivedVisualId,
    setOutputGalleryOpen,
    setOutputMode,
    setOutputSeriesId: workbench.setOutputSeriesId,
    setRenameOpen,
    setRequestedAssetId,
    setSelectedAlbumId: selected.setSelectedAlbumId,
    setSelectedArticleId: selected.setSelectedArticleId,
    setSelectedEvaluationSuiteId: selected.setSelectedEvaluationSuiteId,
    setSelectedIdeaCreationId: selected.setSelectedIdeaCreationId,
    setSelectedImageBreakdownId: selected.setSelectedImageBreakdownId,
    setSelectedInspirationStashId: selected.setSelectedInspirationStashId,
    setSelectedSocialPostId: selected.setSelectedSocialPostId,
    setSeriesId: selection.setSeriesId,
    setTargetAlbumId: selection.setTargetAlbumId,
    setVersionId: generation.hydration.setVersionId,
    setVideoCreationRequest: selection.setVideoCreationRequest,
    startNewSession: generation.hydration.startNewSession,
    startNewSaveBlocked: Boolean(
      selected.selectedEvaluationSuiteId ||
      (!workbench.editorDerivedVisual && (selected.selectedSocialPostId || selected.selectedArticleId)),
    ),
    starting: starting || draftInput.recovery.state.status === 'loading',
    synchronizePrompt: document.synchronize,
    targetAlbumId: selection.targetAlbumId,
    targetAlbumUnavailable: selection.targetAlbumUnavailable,
    termPromptLocale: document.termPromptLocale,
    updatePromptDocument: document.updatePromptDocument,
    versionId: generation.hydration.version?.id ?? null,
    workbenchLocation: draftInput.navigation.workbenchLocation,
    messages,
  });
}
