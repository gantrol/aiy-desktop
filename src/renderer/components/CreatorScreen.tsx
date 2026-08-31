import { CreatorScreenView } from '@/renderer/components/creator/screen/CreatorScreenView';
import type { CreatorScreenProps } from '@/renderer/components/creator/screen/creatorScreenTypes';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { useCreatorDraftInputSession } from '@/renderer/components/creator/screen/useCreatorDraftInputSession';
import { useCreatorGenerationInputSession } from '@/renderer/components/creator/screen/useCreatorGenerationInputSession';
import { useCreatorGenerationRuntime } from '@/renderer/components/creator/screen/useCreatorGenerationRuntime';
import { useCreatorLibraryRuntime } from '@/renderer/components/creator/screen/useCreatorLibraryRuntime';
import { useCreatorNavigationRuntime } from '@/renderer/components/creator/screen/useCreatorNavigationRuntime';
import { useCreatorOutputUiState } from '@/renderer/components/creator/screen/useCreatorOutputUiState';
import { useCreatorPromptSession } from '@/renderer/components/creator/screen/useCreatorPromptSession';
import { useCreatorScreenProjection } from '@/renderer/components/creator/screen/useCreatorScreenProjection';
import { useCreatorSelectionSession } from '@/renderer/components/creator/screen/useCreatorSelectionSession';
import { useCreatorWorkflowRuntime } from '@/renderer/components/creator/screen/useCreatorWorkflowRuntime';
import { useI18n } from '@/renderer/i18n/useI18n';

export function CreatorScreen(props: CreatorScreenProps) {
  const { messages } = useI18n();
  const c = messages.creator.workbench;
  const selection = useCreatorSelectionSession({
    data: props.data,
    documentWorkspaceActive: props.documentWorkspaceActive,
    locale: props.locale,
    location: props.location,
  });
  const outputUi = useCreatorOutputUiState(props.location);
  const prompt = useCreatorPromptSession({
    active: props.active,
    capturePersistedPaletteReferences: () => [
      ...(generation.hydration.version?.wordPaletteReferences ?? []),
      ...(selection.creationDraftSession.getSavedDraft()?.wordPaletteReferences ?? []),
    ],
    data: props.data,
    defaultPromptLocale: props.defaultPromptLocale,
    initialDraft: selection.initial.initialDraft,
    loadDictionaryFailedMessage: messages.dictionary.editor.loadFailed,
    locale: props.locale,
    location: props.location,
    notify: props.notify,
    series: selection.workbenchProjection.series,
  });
  const library = useCreatorLibraryRuntime({
    albumCreated: async (albumId, destination) => {
      if (destination === 'NEW_CREATION') await draftInput.navigation.changeNewCreationAlbum(albumId);
      else await navigation.content.chooseAlbum(albumId);
    },
    data: props.data.series,
    locale: props.locale,
    messages: {
      albumMemberAdded: messages.gallery.albums.added,
      albumMemberRemoved: messages.gallery.albums.removed,
      albumMoved: messages.gallery.albums.moved,
      albumRenamed: messages.creator.album.albumRenamed,
      operationFailed: messages.gallery.albums.operationFailed,
      titleGenerated: c.titleGenerated,
      titleGenerationFailed: c.titleGenerationFailed,
    },
    notify: props.notify,
    onDocumentRenamed: (document) => props.onDocumentsChange(document, false),
    onFinishLifecycle: (request) => navigation.finishContentLifecycleAction(request),
    refresh: props.refresh,
    refreshAlbums: props.refreshAlbums,
  });
  const generation = useCreatorGenerationInputSession({
    applyImportedOutputs: (result) => navigation.output.applyImportedOutputs(result),
    data: props.data,
    defaultPromptLocale: props.defaultPromptLocale,
    initialAssistantRun: selection.initial.initialAssistantRun,
    initialDraft: selection.initial.initialDraft,
    locale: props.locale,
    location: props.location,
    messages: {
      duplicates: c.duplicates,
      importDraftLimit: c.importDraftLimit,
      importFailed: c.importFailed,
      imported: c.imported,
      recipeApplied: c.recipeApplied,
      recipeSaved: c.recipeSaved,
    },
    notify: props.notify,
    prompt,
    refresh: props.refresh,
    selection,
    series: selection.workbenchProjection.series,
  });
  const draftInput = useCreatorDraftInputSession({
    generation,
    locale: props.locale,
    location: props.location,
    notify: props.notify,
    onNavigate: props.onNavigate,
    onPromptFullWindowChange: props.onPromptFullWindowChange,
    prompt,
    requestedAssetId: outputUi.requestedAssetId,
    selection,
    series: selection.workbenchProjection.series,
    sessionHostSeries: selection.workbenchProjection.sessionHostSeries ?? null,
    setRequestedAssetId: outputUi.setRequestedAssetId,
  });
  const projection = useCreatorScreenProjection({
    comparisonFullWindow: props.comparisonFullWindow,
    documentWorkspaceActive: props.documentWorkspaceActive,
    generation,
    locale: props.locale,
    outputMode: outputUi.mode,
    promptFullWindow: props.promptFullWindow,
    selection,
    workbench: selection.workbenchProjection,
  });
  const generationRuntime = useCreatorGenerationRuntime({
    active: props.active,
    annotationRefinementState: outputUi.annotationRefinement,
    blocked: () => navigation.promptVersion.creating || workflow.content.outcome.starting,
    clearSavedInspiration: () => workflow.inspiration.clearSavedContent(),
    draftInput,
    generation,
    locale: props.locale,
    messages: { failed: c.generationFailed, started: c.generationStarted },
    notify: props.notify,
    projection,
    refresh: props.refresh,
    scheduleAutoTitle: library.autoTitle.scheduleAutoTitle,
    selection,
    setOutputMode: outputUi.setMode,
    workbench: selection.workbenchProjection,
  });
  const workflow = useCreatorWorkflowRuntime({
    active: props.active,
    configurationRequiredMessage: messages.creator.starter.deepSeekConfigurationRequired,
    data: props.data,
    defaultPromptLocale: props.defaultPromptLocale,
    draftInput,
    generation,
    generationRuntime,
    generationStarting: generationRuntime.launch.starting,
    locale: props.locale,
    notify: props.notify,
    onOpenDerivedVisualWorkspace: (result) => navigation.derivedVisual.openWorkspace(result),
    onPromptFullWindowChange: props.onPromptFullWindowChange,
    preserveBeforeNavigation: () => navigation.creation.preserveBeforeNavigation(),
    projection,
    promptFullWindow: props.promptFullWindow,
    refresh: props.refresh,
    restartNewCreation: (albumId) => navigation.creation.startNewCreation(albumId, 'replace', false),
    selection,
    setDistilledPalette: library.setDistilledPalette,
    setOutputMode: outputUi.setMode,
    setRenameOpen: library.setRenameSeriesOpen,
    setRequestedAssetId: outputUi.setRequestedAssetId,
    successMessage: c.promptApplied,
    workbench: selection.workbenchProjection,
  });
  const navigation = useCreatorNavigationRuntime({
    active: props.active,
    data: props.data,
    defaultPromptLocale: props.defaultPromptLocale,
    draftInput,
    generation,
    generationRuntime,
    locale: props.locale,
    location: props.location,
    messages: {
      externalImported: messages.creator.externalCreationImport.imported,
      restartRequired: messages.creator.resultsOrganizer.restartRequired,
      versionCreated: c.versionCreated,
      versionUnavailable: messages.creator.resultsOrganizer.versionUnavailable,
    },
    notify: props.notify,
    onActiveAlbumChange: props.onActiveAlbumChange,
    onComparisonFullWindowChange: props.onComparisonFullWindowChange,
    onPromptFullWindowChange: props.onPromptFullWindowChange,
    outputMode: outputUi.mode,
    projection,
    refresh: props.refresh,
    refreshAlbums: props.refreshAlbums,
    requestedAssetId: outputUi.requestedAssetId,
    selectedDocumentId: props.selectedDocumentId,
    selection,
    setOutputGalleryOpen: outputUi.setGalleryOpen,
    setOutputMode: outputUi.setMode,
    setRenameOpen: library.setRenameSeriesOpen,
    setRequestedAssetId: outputUi.setRequestedAssetId,
    starting: workflow.starting,
    workbench: selection.workbenchProjection,
    workflow,
  });
  const viewModel: CreatorScreenViewModel = {
    app: props,
    draftInput,
    generation,
    generationRuntime,
    library,
    navigation,
    outputUi,
    projection,
    prompt,
    selection,
    workbench: selection.workbenchProjection,
    workflow,
  };
  return <CreatorScreenView model={viewModel} />;
}
