import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  ArticleDto,
  AssetDto,
  BootstrapDto,
  CreationDictionaryScopeDto,
  CreationDraftDto,
  CreationDto,
  CreatorAgentScope,
  CreatorPromptNodeInput,
  DerivedVisualDto,
  InspirationStashDto,
  Locale,
  PromptSeriesDto,
  SocialPostDto,
} from '@/shared/contracts';
import type { AlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import type { CreatorLocation, NavigationMode } from '@/renderer/components/app/app-navigation';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import type { CreationOutputMode } from '@/renderer/components/creator/CreationOutputTabs';
import type { useCreatorPanes } from '@/renderer/components/creator/useCreatorPanes';
import { useCreatorContentLifecycleCompletion } from '@/renderer/components/creator/workflows/useCreatorContentLifecycleCompletion';
import { useCreatorContentNavigation } from '@/renderer/components/creator/workflows/useCreatorContentNavigation';
import { useCreatorCreationNavigation } from '@/renderer/components/creator/workflows/useCreatorCreationNavigation';
import { useCreatorExternalCreationImport } from '@/renderer/components/creator/workflows/useCreatorExternalCreationImport';
import { useCreatorIdeaNavigation } from '@/renderer/components/creator/workflows/useCreatorIdeaNavigation';
import { useCreatorLocationSynchronization } from '@/renderer/components/creator/screen/useCreatorLocationSynchronization';
import type { CreatorLocationApplication } from '@/renderer/components/creator/screen/useCreatorNavigationCore';
import { useCreatorOutputNavigation } from '@/renderer/components/creator/workflows/useCreatorOutputNavigation';
import { useCreatorPromptVersionCreation } from '@/renderer/components/creator/workflows/useCreatorPromptVersionCreation';
import { useDerivedVisualWorkspaceNavigation } from '@/renderer/components/creator/workflows/useDerivedVisualWorkspaceNavigation';
import type { DerivedVisualWorkspaceViewState } from '@/renderer/components/creator/derivedVisualWorkspace';
import type {
  CreationDraftPromptSnapshot,
  CreationDraftSaveSnapshot,
} from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import type { useCreatorAssistantRequest } from '@/renderer/components/creator/workflows/useCreatorAssistantRequest';
import type { useCreatorInputHydration } from '@/renderer/components/creator/workflows/useCreatorInputHydration';
import type { useCreatorLocationSelection } from '@/renderer/components/creator/screen/useCreatorLocationSelection';
import type { VideoDocumentCreationRequest } from '@/renderer/features/video-documents/VideoDocumentCreationStarter';

type Panes = ReturnType<typeof useCreatorPanes>;
type Hydration = ReturnType<typeof useCreatorInputHydration>;
type Selection = ReturnType<typeof useCreatorLocationSelection>;

interface Options {
  active: boolean;
  activeAlbumContextId: string | null;
  activeDerivedVisualId: string | null;
  activeIdeaCreation: CreationDto | null;
  activeSessionSeries: readonly PromptSeriesDto[];
  albumTree: AlbumTreeIndex;
  locationApplicationRef: MutableRefObject<CreatorLocationApplication>;
  appendPromptText(value: string): void;
  automaticChangeSummary: string;
  captureDraft(): CreationDraftSaveSnapshot;
  capturePrompt(): CreationDraftPromptSnapshot;
  chooseDerivedVisual(visualId: string, view?: DerivedVisualWorkspaceViewState): Promise<void>;
  clearAssistantError(): void;
  clearSavedInspiration(): void;
  clearSelection(): void;
  commit(location: CreatorLocation, mode?: NavigationMode): void;
  creationDraftId: string | null;
  creationMode: 'existing' | 'new';
  creationSessions: readonly CreationSessionProjection[];
  data: BootstrapDto;
  defaultPromptLocale: Locale | null;
  derivedDraftParentLocation: CreatorLocation | null;
  detachDraftIdentity(): void;
  editorDerivedVisual: DerivedVisualDto | null;
  generationRequestIdentity: string;
  initialDraft: CreationDraftDto | null;
  initialSeriesId: string | null;
  invalidateAutosaves(): void;
  locale: Locale;
  location: CreatorLocation;
  manualPrompt: string;
  meaningfulDraftInput: boolean;
  newTitle: string;
  notify(message: string): void;
  onActiveAlbumChange(albumId: string | null): void;
  onComparisonFullWindowChange(open: boolean): void;
  onPromptFullWindowChange(open: boolean): void;
  onSelectDocument(id: string, albumId: string | null): void;
  outputMode: CreationOutputMode;
  outputSeriesAvailable: boolean;
  panes: Panes;
  preserveParentSelection: boolean;
  preserveCapturedDraft(snapshot: CreationDraftSaveSnapshot): Promise<unknown>;
  preserveWorkingInput(): Promise<boolean>;
  promptNodesRef: MutableRefObject<CreatorPromptNodeInput[]>;
  promptProfileId: string;
  referenceAssetCount: number;
  referenceAssets: readonly AssetDto[];
  refresh(): Promise<void>;
  refreshAlbums(): Promise<void>;
  rememberSavedDraft(draft: CreationDraftDto | null): void;
  replaceDraftSession(draft: CreationDraftDto | null): void;
  requestAssistant: ReturnType<typeof useCreatorAssistantRequest>['request'];
  requestedAssetId: string | null;
  resetInputs(): void;
  restoreAssistant(scope: CreatorAgentScope | null): void;
  restoreDraft: Hydration['restoreDraft'];
  restoreInspiration(stash: InspirationStashDto): void;
  restoreVersion: Hydration['restoreVersion'];
  saveDraft(albumId?: string | null, prompt?: CreationDraftPromptSnapshot): Promise<CreationDraftDto>;
  selected: {
    albumId: string | null;
    articleId: string | null;
    documentId: string | null;
    evaluationSuiteId: string | null;
    ideaCreationId: string | null;
    imageBreakdownId: string | null;
    inspirationStashId: string | null;
    socialPostId: string | null;
  };
  selectedArticle: ArticleDto | null;
  selectedContent: boolean;
  selectedIdeaCreation: CreationDto | null;
  selectedSocialPost: SocialPostDto | null;
  selectedTermCount: number;
  selection: Selection['selection'];
  series: BootstrapDto['series'][number] | null;
  seriesId: string | null;
  setCanvasPresetKey(key: string): void;
  setCreationMode(mode: 'existing' | 'new'): void;
  setDictionaryScope: Dispatch<SetStateAction<CreationDictionaryScopeDto>>;
  setDismissedDerivedVisualId(id: string | null): void;
  setOutputGalleryOpen(open: boolean): void;
  setOutputMode(mode: CreationOutputMode): void;
  setOutputSeriesId(id: string | null): void;
  setRenameOpen(open: boolean): void;
  setRequestedAssetId(id: string | null): void;
  setSelectedAlbumId(id: string | null): void;
  setSelectedArticleId(id: string | null): void;
  setSelectedEvaluationSuiteId(id: string | null): void;
  setSelectedIdeaCreationId(id: string | null): void;
  setSelectedImageBreakdownId(id: string | null): void;
  setSelectedInspirationStashId(id: string | null): void;
  setSelectedSocialPostId(id: string | null): void;
  setSeriesId(id: string | null): void;
  setTargetAlbumId(id: string | null): void;
  setVersionId(id: string): void;
  setVideoCreationRequest(request: VideoDocumentCreationRequest | null): void;
  startNewSession(albumId: string | null): void;
  startNewSaveBlocked: boolean;
  starting: boolean;
  synchronizePrompt(prompt: CreationDraftPromptSnapshot): void;
  targetAlbumId: string | null;
  targetAlbumUnavailable: boolean;
  termPromptLocale: Locale;
  updatePromptDocument(nodes: CreatorPromptNodeInput[]): void;
  versionId: string | null;
  workbenchLocation(): CreatorLocation;
  messages: {
    externalImported: string;
    restartRequired: string;
    versionCreated: string;
    versionUnavailable: string;
  };
}

function usePrimaryNavigation(options: Options) {
  const creation = useCreatorCreationNavigation({
    albumTree: options.albumTree,
    captureDraft: options.captureDraft,
    clearSavedInspiration: options.clearSavedInspiration,
    clearSelection: options.clearSelection,
    commit: options.commit,
    creationDraftId: options.creationDraftId,
    creationMode: options.creationMode,
    creationSessions: options.creationSessions,
    defaultPromptLocale: options.defaultPromptLocale,
    detachDraftIdentity: options.detachDraftIdentity,
    invalidateAutosaves: options.invalidateAutosaves,
    locale: options.locale,
    location: options.location,
    manualPrompt: options.manualPrompt,
    meaningfulDraftInput: options.meaningfulDraftInput,
    newTitle: options.newTitle,
    notify: options.notify,
    onComparisonFullWindowChange: options.onComparisonFullWindowChange,
    preserveCapturedDraft: options.preserveCapturedDraft,
    preserveWorkingInput: options.preserveWorkingInput,
    referenceAssetCount: options.referenceAssetCount,
    resetInputs: options.resetInputs,
    restoreAssistant: options.restoreAssistant,
    restoreDraft: options.restoreDraft,
    restoreVersion: options.restoreVersion,
    saveDraft: options.saveDraft,
    selectedAlbumId: options.selected.albumId,
    selectedContent: options.selectedContent,
    selectedTermCount: options.selectedTermCount,
    series: options.data.series,
    seriesId: options.seriesId,
    setCompactPanel: options.panes.setCompactPanel,
    setCreationMode: options.setCreationMode,
    setDictionaryScope: options.setDictionaryScope,
    setOutputCollapsed: options.panes.setOutputCollapsed,
    setOutputGalleryOpen: options.setOutputGalleryOpen,
    setOutputMode: (mode) => options.setOutputMode(mode),
    setOutputSeriesId: options.setOutputSeriesId,
    setRequestedAssetId: options.setRequestedAssetId,
    setSeriesId: options.setSeriesId,
    setTargetAlbumId: options.setTargetAlbumId,
    setVersionId: options.setVersionId,
    setVideoCreationRequest: options.setVideoCreationRequest,
    startNewSession: options.startNewSession,
    startNewSaveBlocked: options.startNewSaveBlocked,
    targetAlbumId: options.targetAlbumId,
    targetAlbumUnavailable: options.targetAlbumUnavailable,
  });
  const external = useCreatorExternalCreationImport({
    preserveWorkingInput: options.preserveWorkingInput,
    clearSavedInspiration: options.clearSavedInspiration,
    clearSelection: options.clearSelection,
    commit: options.commit,
    creationMode: options.creationMode,
    hasDraftState: creation.hasDraftState,
    importedMessage: options.messages.externalImported,
    locale: options.locale,
    notify: options.notify,
    onComparisonFullWindowChange: options.onComparisonFullWindowChange,
    refresh: options.refresh,
    saveDraft: options.saveDraft,
    setCompactPanel: options.panes.setCompactPanel,
    setCreationMode: options.setCreationMode,
    setOutputGalleryOpen: options.setOutputGalleryOpen,
    setOutputMode: (mode) => options.setOutputMode(mode),
    setOutputSeriesId: options.setOutputSeriesId,
    setRequestedAssetId: options.setRequestedAssetId,
    setSeriesId: options.setSeriesId,
    setTargetAlbumId: options.setTargetAlbumId,
    setVersionId: options.setVersionId,
  });
  const derivedVisual = useDerivedVisualWorkspaceNavigation({
    clearSavedInspiration: options.clearSavedInspiration,
    clearSelection: options.clearSelection,
    commit: options.commit,
    data: options.data,
    editorDerivedVisual: options.editorDerivedVisual,
    locale: options.locale,
    notify: options.notify,
    onComparisonFullWindowChange: options.onComparisonFullWindowChange,
    preserveParentSelection: options.preserveParentSelection,
    promptNodesRef: options.promptNodesRef,
    replaceDraftSession: options.replaceDraftSession,
    resetInputs: options.resetInputs,
    restoreAssistant: options.restoreAssistant,
    restoreDraft: options.restoreDraft,
    restoreVersion: options.restoreVersion,
    selectedArticle: options.selectedArticle,
    selectedSocialPost: options.selectedSocialPost,
    selectArticle: options.setSelectedArticleId,
    selectSocialPost: options.setSelectedSocialPostId,
    setCanvasPresetKey: options.setCanvasPresetKey,
    setCompactPanel: options.panes.setCompactPanel,
    setCreationMode: options.setCreationMode,
    setDictionaryScope: options.setDictionaryScope,
    setDismissedDerivedVisualId: options.setDismissedDerivedVisualId,
    setOutputCollapsed: options.panes.setOutputCollapsed,
    setOutputGalleryOpen: options.setOutputGalleryOpen,
    setOutputMode: (mode) => options.setOutputMode(mode),
    setOutputSeriesId: options.setOutputSeriesId,
    setRequestedAssetId: options.setRequestedAssetId,
    setSeriesId: options.setSeriesId,
    setTargetAlbumId: options.setTargetAlbumId,
    setVersionId: options.setVersionId,
    setVideoCreationRequest: options.setVideoCreationRequest,
    updatePromptDocument: options.updatePromptDocument,
  });
  const promptVersion = useCreatorPromptVersionCreation({
    preserveWorkingInput: options.preserveWorkingInput,
    automaticChangeSummary: options.automaticChangeSummary,
    baseVersionId: options.versionId,
    capturePrompt: options.capturePrompt,
    creatingBlocked: options.starting,
    locale: options.locale,
    notify: options.notify,
    promptProfileId: options.promptProfileId,
    referenceAssets: options.referenceAssets,
    refresh: options.refresh,
    requestIdentity: options.generationRequestIdentity,
    restartRequiredMessage: options.messages.restartRequired,
    series: options.series,
    setOutputSeriesId: options.setOutputSeriesId,
    setVersionId: options.setVersionId,
    synchronizePrompt: options.synchronizePrompt,
    termPromptLocale: options.termPromptLocale,
    unavailableMessage: options.messages.versionUnavailable,
    versionCreatedMessage: options.messages.versionCreated,
  });
  return { creation, derivedVisual, external, promptVersion };
}

function useSecondaryNavigation(options: Options, primary: ReturnType<typeof usePrimaryNavigation>) {
  const openParentEditor = () => {
    options.setDismissedDerivedVisualId(options.activeDerivedVisualId);
    options.setCreationMode('new');
    options.setSeriesId(null);
    options.setOutputSeriesId(null);
    options.setVersionId('');
  };
  const content = useCreatorContentNavigation({
    onSelectDocument: options.onSelectDocument,
    chooseSeries: primary.creation.chooseSeries,
    clearSavedInspiration: options.clearSavedInspiration,
    commit: options.commit,
    data: options.data,
    locale: options.locale,
    notify: options.notify,
    onComparisonFullWindowChange: options.onComparisonFullWindowChange,
    onPromptFullWindowChange: options.onPromptFullWindowChange,
    openParentEditor,
    preserveBeforeNavigation: primary.creation.preserveBeforeNavigation,
    refresh: options.refresh,
    restoreInspiration: options.restoreInspiration,
    resumeDerivedVisual: options.chooseDerivedVisual,
    selectAlbum: options.setSelectedAlbumId,
    selectArticle: options.setSelectedArticleId,
    selectEvaluationSuite: options.setSelectedEvaluationSuiteId,
    selectImageBreakdown: options.setSelectedImageBreakdownId,
    selectInspirationStash: options.setSelectedInspirationStashId,
    selectSocialPost: options.setSelectedSocialPostId,
    setCompactPanel: options.panes.setCompactPanel,
    setOutputGalleryOpen: options.setOutputGalleryOpen,
    setOutputMode: (mode) => options.setOutputMode(mode),
    setRequestedAssetId: options.setRequestedAssetId,
    startNewCreation: primary.creation.startNewCreation,
  });
  const idea = useCreatorIdeaNavigation({
    activeIdeaCreation: options.activeIdeaCreation,
    activeSessionSeries: options.activeSessionSeries,
    chooseSeries: primary.creation.chooseSeries,
    clearAssistantError: options.clearAssistantError,
    clearSavedInspiration: options.clearSavedInspiration,
    clearSelection: options.clearSelection,
    commit: options.commit,
    creationDraft: options.data.creationDraft ?? null,
    creationDraftId: options.creationDraftId,
    creationMode: options.creationMode,
    creations: options.data.creations,
    onComparisonFullWindowChange: options.onComparisonFullWindowChange,
    outputMode: options.outputMode,
    outputSeriesAvailable: options.outputSeriesAvailable,
    preserveBeforeNavigation: primary.creation.preserveBeforeNavigation,
    rememberSavedDraft: options.rememberSavedDraft,
    requestAssistant: options.requestAssistant,
    requestedAssetId: options.requestedAssetId,
    resetInputs: options.resetInputs,
    restoreAssistant: options.restoreAssistant,
    restoreDraft: options.restoreDraft,
    selectedIdeaCreation: options.selectedIdeaCreation,
    seriesId: options.seriesId,
    setCompactPanel: options.panes.setCompactPanel,
    setCreationMode: options.setCreationMode,
    setIdeaCreation: options.setSelectedIdeaCreationId,
    setOutputCollapsed: options.panes.setOutputCollapsed,
    setOutputGalleryOpen: options.setOutputGalleryOpen,
    setOutputMode: options.setOutputMode,
    setOutputSeriesId: options.setOutputSeriesId,
    setRequestedAssetId: options.setRequestedAssetId,
    setSeriesId: options.setSeriesId,
    setTargetAlbumId: options.setTargetAlbumId,
    targetAlbumId: options.targetAlbumId,
  });
  useCreatorLocationSynchronization({
    actions: {
      ...content,
      chooseIdeaCreation: idea.chooseIdeaCreation,
      resumeDerivedVisual: options.chooseDerivedVisual,
      chooseSeries: primary.creation.chooseSeries,
      resumeCreationDraft: primary.creation.resumeCreationDraft,
      startNewCreation: primary.creation.startNewCreation,
    },
    active: options.active,
    activeAlbumContextId: options.activeAlbumContextId,
    locationApplicationRef: options.locationApplicationRef,
    clearSavedInspiration: options.clearSavedInspiration,
    clearSelection: options.clearSelection,
    commit: options.commit,
    creationDraftId: options.creationDraftId,
    creationMode: options.creationMode,
    data: options.data,
    derivedDraftParentLocation: options.derivedDraftParentLocation,
    initialDraft: options.initialDraft,
    initialSeriesId: options.initialSeriesId,
    location: options.location,
    onActiveAlbumChange: options.onActiveAlbumChange,
    onPromptFullWindowChange: options.onPromptFullWindowChange,
    requestedAssetId: options.requestedAssetId,
    selection: options.selection,
    seriesId: options.seriesId,
    setOutputModeToResults: () => options.setOutputMode('results'),
    targetAlbumId: options.targetAlbumId,
    workbenchLocation: options.workbenchLocation,
  });
  const output = useCreatorOutputNavigation({
    preserveWorkingInput: options.preserveWorkingInput,
    appendPromptText: options.appendPromptText,
    chooseSeries: primary.creation.chooseSeries,
    commit: options.commit,
    creationMode: options.creationMode,
    data: options.data,
    locale: options.locale,
    notify: options.notify,
    restoreVersion: options.restoreVersion,
    selectedAlbumId: options.selected.albumId,
    seriesId: options.seriesId,
    setCompactPanel: options.panes.setCompactPanel,
    setOutputCollapsed: options.panes.setOutputCollapsed,
    setOutputGalleryOpen: options.setOutputGalleryOpen,
    setOutputSeriesId: options.setOutputSeriesId,
    setRenameOpen: options.setRenameOpen,
    setRequestedAssetId: options.setRequestedAssetId,
    setVersionId: options.setVersionId,
  });
  const finishContentLifecycleAction = useCreatorContentLifecycleCompletion({
    albumTree: options.albumTree,
    clearSavedInspiration: options.clearSavedInspiration,
    clearSelection: options.clearSelection,
    commit: options.commit,
    data: options.data,
    detachDraftFromUnavailableAlbum: primary.creation.detachDraftFromUnavailableAlbum,
    refresh: options.refresh,
    refreshAlbums: options.refreshAlbums,
    selected: { ...options.selected, seriesId: options.seriesId },
    setOutputModeToResults: () => options.setOutputMode('results'),
    startNewCreation: primary.creation.startNewCreation,
    workbenchLocation: options.workbenchLocation,
  });
  return { content, finishContentLifecycleAction, idea, output };
}

export function useCreatorNavigationWorkflows(options: Options) {
  const primary = usePrimaryNavigation(options);
  const secondary = useSecondaryNavigation(options, primary);
  return { ...primary, ...secondary };
}
