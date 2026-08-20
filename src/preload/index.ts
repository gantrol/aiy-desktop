import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import {
  generationProcessEventPageInputSchema,
  generationProcessEventPageSchema,
  generationProcessSummarySchema,
} from '@/shared/contracts/generation-process';
import { appUpdateStateSchema } from '@/shared/contracts/app-update';
import { appSupportDestinationSchema } from '@/shared/contracts/app-support';
import { appWindowStateSchema, desktopPlatformSchema } from '@/shared/contracts/app-window';
import {
  transitionShowcaseExportImageIdsSchema,
  transitionShowcaseExportImageSnapshotsSchema,
} from '@/shared/contracts/transition-showcase';
import { creatorOutputsOrganizeResultSchema } from '@/shared/contracts/creation-output-organization';
import {
  promptSeriesCoverSetInputSchema,
  promptSeriesOutputPresentationResultSchema,
  promptSeriesOutputRemoveInputSchema,
} from '@/shared/contracts/creation-output-presentation';
import { promptVersionCreateResultSchema } from '@/shared/contracts/prompt-version-create';
import {
  legacyLocalSpaceCandidateListSchema,
  localSpaceExportResultSchema,
  localSpaceImportResultSchema,
  localSpaceMigrationProgressEventSchema,
  localSpaceMigrationResultSchema,
  localSpaceRegistrySchema,
  localSpaceSwitchResultSchema,
  localSpaceTransferProgressEventSchema,
  localSpaceTransitionEventSchema,
  transitionPreviewListSchema,
  transitionPreviewRefreshEventSchema,
  type TransitionPreviewDto,
} from '@/shared/contracts/local-space';
import {
  termIllustrationAdoptInputSchema,
  termIllustrationDecisionResultSchema,
  termIllustrationDismissInputSchema,
  termIllustrationListInputSchema,
  termIllustrationListSchema,
  termIllustrationStartInputSchema,
  termIllustrationStartResultSchema,
} from '@/shared/contracts/term-illustration';
import {
  localQwenAsrSidecarSchema,
  videoDocumentArticleGenerateInputSchema,
  videoDocumentArticleGenerateResultSchema,
  videoDocumentAudioProbeInputSchema,
  videoDocumentCreateInputSchema,
  videoDocumentExportInputSchema,
  videoDocumentExportResultSchema,
  videoDocumentFrameCaptureInputSchema,
  videoDocumentFrameCaptureResultSchema,
  videoDocumentGenerationRunsListInputSchema,
  videoDocumentGenerationRunsPageSchema,
  videoDocumentListInputSchema,
  videoDocumentListPageSchema,
  videoDocumentMoveInputSchema,
  videoDocumentNavigationListInputSchema,
  videoDocumentNavigationPageSchema,
  videoDocumentNavigationReorderInputSchema,
  videoDocumentRenameInputSchema,
  videoDocumentRevealExportInputSchema,
  videoDocumentRevisionSaveInputSchema,
  videoDocumentRevisionSchema,
  videoDocumentSchema,
  videoDocumentSourceReplaceInputSchema,
  videoDocumentTranscriptRecognitionCancelResultSchema,
  videoDocumentTranscriptRecognitionOperationIdSchema,
  videoDocumentTranscriptRecognitionProgressSchema,
  videoDocumentTranscriptRecognitionResultSchema,
  videoDocumentTranscriptRecognizeInputSchema,
} from '@/shared/contracts/video-document';
import {
  videoDocumentTranscriptBackgroundTaskSnapshotSchema,
  videoDocumentTranscriptBackgroundTasksChangedEventSchema,
} from '@/shared/contracts/video-document-transcription';
import {
  videoDocumentAiActivitiesListInputSchema,
  videoDocumentAiActivitiesPageSchema,
} from '@/shared/contracts/video-document-ai-activity';
import {
  videoDocumentTranscriptTranslationOperationIdSchema,
  videoDocumentTranscriptTranslationResultSchema,
  videoDocumentTranscriptTranslationStartInputSchema,
} from '@/shared/contracts/video-document-translation';
import { videoKeyChangeExtractInputSchema, videoKeyChangeResultSchema } from '@/shared/contracts/video-key-changes';

let loadingPreviewsInFlight: Promise<TransitionPreviewDto[]> | null = null;

function appLoadingPreviews() {
  if (loadingPreviewsInFlight) return loadingPreviewsInFlight;
  const request = ipcRenderer.invoke('app:loading-previews').then((value) => transitionPreviewListSchema.parse(value));
  loadingPreviewsInFlight = request;
  const clearInFlight = () => {
    if (loadingPreviewsInFlight === request) loadingPreviewsInFlight = null;
  };
  void request.then(clearInFlight, clearInFlight);
  return request;
}

const api: DesktopApi = {
  appPlatform: desktopPlatformSchema.parse(process.platform),
  appLoadingPreviews,
  transitionShowcaseExportImages: async (assetIds) =>
    transitionShowcaseExportImageSnapshotsSchema.parse(
      await ipcRenderer.invoke(
        'transition-showcase:export-images',
        transitionShowcaseExportImageIdsSchema.parse(assetIds),
      ),
    ),
  onAppLoadingPreviewsRefreshed: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) =>
      callback(transitionPreviewRefreshEventSchema.parse(value));
    ipcRenderer.on('app:loading-previews-refreshed', listener);
    return () => ipcRenderer.removeListener('app:loading-previews-refreshed', listener);
  },
  bootstrap: (locale) => ipcRenderer.invoke('app:bootstrap', locale),
  generationProjection: (locale) => ipcRenderer.invoke('generation:projection', locale),
  appWindowGetState: async () => appWindowStateSchema.parse(await ipcRenderer.invoke('app-window:get-state')),
  appWindowMinimize: () => ipcRenderer.invoke('app-window:minimize'),
  appWindowToggleMaximized: async () =>
    appWindowStateSchema.parse(await ipcRenderer.invoke('app-window:toggle-maximized')),
  appWindowClose: () => ipcRenderer.invoke('app-window:close'),
  appSupportOpen: (destination) =>
    ipcRenderer.invoke('app-support:open', appSupportDestinationSchema.parse(destination)),
  onAppWindowStateChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(appWindowStateSchema.parse(value));
    ipcRenderer.on('app-window:state-changed', listener);
    return () => ipcRenderer.removeListener('app-window:state-changed', listener);
  },
  appRequestQuit: () => ipcRenderer.invoke('app:request-quit'),
  appUpdateGetState: async () => appUpdateStateSchema.parse(await ipcRenderer.invoke('app-update:get-state')),
  appUpdateCheck: async () => appUpdateStateSchema.parse(await ipcRenderer.invoke('app-update:check')),
  appUpdateDownload: async () => appUpdateStateSchema.parse(await ipcRenderer.invoke('app-update:download')),
  appUpdateInstall: async () => appUpdateStateSchema.parse(await ipcRenderer.invoke('app-update:install')),
  extensionsList: () => ipcRenderer.invoke('extensions:list'),
  extensionLanguagePacksList: () => ipcRenderer.invoke('extension-language-packs:list'),
  extensionInstallLocal: () => ipcRenderer.invoke('extension:install-local'),
  extensionUninstallLocal: (extensionId) => ipcRenderer.invoke('extension:uninstall-local', extensionId),
  extensionSetEnabled: (input) => ipcRenderer.invoke('extension:set-enabled', input),
  extensionSetPermission: (input) => ipcRenderer.invoke('extension:set-permission', input),
  codexGeneratedImagesList: (input) => ipcRenderer.invoke('codex-generated-images:list', input),
  codexGeneratedImagesImport: (input) => ipcRenderer.invoke('codex-generated-images:import', input),
  codexGeneratedImagesRecover: (input) => ipcRenderer.invoke('codex-generated-images:recover', input),
  openAiImageApiGet: () => ipcRenderer.invoke('openai-image-api:get'),
  openAiImageApiSave: (input) => ipcRenderer.invoke('openai-image-api:save', input),
  openAiImageApiTest: () => ipcRenderer.invoke('openai-image-api:test'),
  openAiImageApiClear: () => ipcRenderer.invoke('openai-image-api:clear'),
  deepSeekApiGet: () => ipcRenderer.invoke('deepseek-api:get'),
  deepSeekApiSave: (input) => ipcRenderer.invoke('deepseek-api:save', input),
  deepSeekApiTest: () => ipcRenderer.invoke('deepseek-api:test'),
  deepSeekApiClear: () => ipcRenderer.invoke('deepseek-api:clear'),
  localQwenAsrSidecarGet: async () =>
    localQwenAsrSidecarSchema.parse(await ipcRenderer.invoke('local-qwen-asr-sidecar:get')),
  assistantRoutingGet: () => ipcRenderer.invoke('assistant-routing:get'),
  assistantRoutingSave: (input) => ipcRenderer.invoke('assistant-routing:save', input),
  imageGenerationConcurrencySave: (input) => ipcRenderer.invoke('image-generation-concurrency:save', input),
  externalImageApiGet: (extensionId) => ipcRenderer.invoke('external-image-api:get', extensionId),
  externalImageApiSave: (input) => ipcRenderer.invoke('external-image-api:save', input),
  externalImageApiTest: (extensionId) => ipcRenderer.invoke('external-image-api:test', extensionId),
  externalImageApiClear: (extensionId) => ipcRenderer.invoke('external-image-api:clear', extensionId),
  antigravityCliGet: () => ipcRenderer.invoke('antigravity-cli:get'),
  antigravityCliRefresh: () => ipcRenderer.invoke('antigravity-cli:refresh'),
  localSpacesList: async () => localSpaceRegistrySchema.parse(await ipcRenderer.invoke('local-spaces:list')),
  localSpacesDiscoverLegacy: async () =>
    legacyLocalSpaceCandidateListSchema.parse(await ipcRenderer.invoke('local-spaces:discover-legacy')),
  localSpacesMigrateLegacy: async (candidateId) =>
    localSpaceMigrationResultSchema.parse(await ipcRenderer.invoke('local-spaces:migrate-legacy', candidateId)),
  localSpacesCancelLegacyMigration: () => ipcRenderer.invoke('local-spaces:cancel-legacy-migration'),
  localSpacesExportCurrent: async () =>
    localSpaceExportResultSchema.parse(await ipcRenderer.invoke('local-spaces:export-current')),
  localSpacesImportArchive: async () =>
    localSpaceImportResultSchema.parse(await ipcRenderer.invoke('local-spaces:import-archive')),
  localSpacesCancelTransfer: () => ipcRenderer.invoke('local-spaces:cancel-transfer'),
  localSpacesOpen: async () => localSpaceSwitchResultSchema.parse(await ipcRenderer.invoke('local-spaces:open')),
  localSpacesSwitch: async (spaceId) =>
    localSpaceSwitchResultSchema.parse(await ipcRenderer.invoke('local-spaces:switch', spaceId)),
  localSpacesCreate: async (name) =>
    localSpaceSwitchResultSchema.parse(await ipcRenderer.invoke('local-spaces:create', name)),
  localSpacesChooseCover: (spaceId) => ipcRenderer.invoke('local-spaces:choose-cover', spaceId),
  localSpacesRemoveCover: (spaceId) => ipcRenderer.invoke('local-spaces:remove-cover', spaceId),
  onLocalSpaceTransition: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, transition: unknown) =>
      callback(localSpaceTransitionEventSchema.parse(transition));
    ipcRenderer.on('local-space:transition', listener);
    return () => ipcRenderer.removeListener('local-space:transition', listener);
  },
  onLocalSpaceMigrationProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) =>
      callback(localSpaceMigrationProgressEventSchema.parse(progress));
    ipcRenderer.on('local-space:migration-progress', listener);
    return () => ipcRenderer.removeListener('local-space:migration-progress', listener);
  },
  onLocalSpaceTransferProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) =>
      callback(localSpaceTransferProgressEventSchema.parse(progress));
    ipcRenderer.on('local-space:transfer-progress', listener);
    return () => ipcRenderer.removeListener('local-space:transfer-progress', listener);
  },
  packsList: () => ipcRenderer.invoke('packs:list'),
  packImportLocal: () => ipcRenderer.invoke('content-pack:import-local'),
  packImportStarter: () => ipcRenderer.invoke('content-pack:import-starter'),
  packReleaseGet: (releaseId) => ipcRenderer.invoke('pack-release:get', releaseId),
  packInstallExact: (input) => ipcRenderer.invoke('pack:install-exact', input),
  packSetDisabled: (packId, disabled) => ipcRenderer.invoke('pack:set-disabled', packId, disabled),
  packRemove: (packId) => ipcRenderer.invoke('pack:remove', packId),
  intakeCommit: (input) => ipcRenderer.invoke('intake:commit', input),
  videoDocumentsList: async (input) =>
    videoDocumentListPageSchema.parse(
      await ipcRenderer.invoke('video-documents:list', videoDocumentListInputSchema.parse(input)),
    ),
  videoDocumentNavigationList: async (input) =>
    videoDocumentNavigationPageSchema.parse(
      await ipcRenderer.invoke('video-documents:navigation-list', videoDocumentNavigationListInputSchema.parse(input)),
    ),
  videoDocumentNavigationReorder: async (input) => {
    await ipcRenderer.invoke(
      'video-documents:navigation-reorder',
      videoDocumentNavigationReorderInputSchema.parse(input),
    );
  },
  videoDocumentGet: async (documentId) =>
    videoDocumentSchema.parse(await ipcRenderer.invoke('video-document:get', documentId)),
  videoDocumentAudioProbe: async (input) =>
    videoDocumentSchema.parse(
      await ipcRenderer.invoke('video-document:audio-probe', videoDocumentAudioProbeInputSchema.parse(input)),
    ),
  videoDocumentCreate: async (input) =>
    videoDocumentSchema.parse(
      await ipcRenderer.invoke('video-document:create', videoDocumentCreateInputSchema.parse(input)),
    ),
  videoDocumentRename: async (input) =>
    videoDocumentSchema.parse(
      await ipcRenderer.invoke('video-document:rename', videoDocumentRenameInputSchema.parse(input)),
    ),
  videoDocumentMove: async (input) =>
    videoDocumentSchema.parse(
      await ipcRenderer.invoke('video-document:move', videoDocumentMoveInputSchema.parse(input)),
    ),
  videoDocumentSourceReplace: async (input) =>
    videoDocumentSchema.parse(
      await ipcRenderer.invoke('video-document:source-replace', videoDocumentSourceReplaceInputSchema.parse(input)),
    ),
  videoDocumentRevisionGet: async (branchId, revisionId) =>
    videoDocumentRevisionSchema
      .nullable()
      .parse(
        revisionId
          ? await ipcRenderer.invoke('video-document:revision-get', branchId, revisionId)
          : await ipcRenderer.invoke('video-document:revision-get', branchId),
      ),
  videoDocumentRevisionSave: async (input) =>
    videoDocumentRevisionSchema.parse(
      await ipcRenderer.invoke('video-document:revision-save', videoDocumentRevisionSaveInputSchema.parse(input)),
    ),
  videoDocumentTranscriptImport: async (documentId) =>
    videoDocumentRevisionSchema
      .nullable()
      .parse(await ipcRenderer.invoke('video-document:transcript-import', documentId)),
  videoDocumentTranscriptRecognize: async (input) =>
    videoDocumentTranscriptRecognitionResultSchema.parse(
      await ipcRenderer.invoke(
        'video-document:transcript-recognize',
        videoDocumentTranscriptRecognizeInputSchema.parse(input),
      ),
    ),
  videoDocumentTranscriptBackgroundTasksGet: async () =>
    videoDocumentTranscriptBackgroundTaskSnapshotSchema.parse(
      await ipcRenderer.invoke('video-document:transcript-background-tasks-get'),
    ),
  videoDocumentTranscriptRecognitionCancel: async (operationId) =>
    videoDocumentTranscriptRecognitionCancelResultSchema.parse(
      await ipcRenderer.invoke(
        'video-document:transcript-recognition-cancel',
        videoDocumentTranscriptRecognitionOperationIdSchema.parse(operationId),
      ),
    ),
  videoDocumentTranscriptTranslate: async (input) =>
    videoDocumentTranscriptTranslationResultSchema.parse(
      await ipcRenderer.invoke(
        'video-document:transcript-translate',
        videoDocumentTranscriptTranslationStartInputSchema.parse(input),
      ),
    ),
  videoDocumentTranscriptTranslationCancel: async (operationId) =>
    void (await ipcRenderer.invoke(
      'video-document:transcript-translation-cancel',
      videoDocumentTranscriptTranslationOperationIdSchema.parse(operationId),
    )),
  onVideoDocumentTranscriptRecognitionProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) =>
      callback(videoDocumentTranscriptRecognitionProgressSchema.parse(progress));
    ipcRenderer.on('video-document:transcript-recognition-progress', listener);
    return () => ipcRenderer.removeListener('video-document:transcript-recognition-progress', listener);
  },
  onVideoDocumentTranscriptBackgroundTasksChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) =>
      callback(videoDocumentTranscriptBackgroundTasksChangedEventSchema.parse(value));
    ipcRenderer.on('video-document:transcript-background-tasks-changed', listener);
    return () => ipcRenderer.removeListener('video-document:transcript-background-tasks-changed', listener);
  },
  videoDocumentArticleGenerate: async (input) =>
    videoDocumentArticleGenerateResultSchema.parse(
      await ipcRenderer.invoke('video-document:article-generate', videoDocumentArticleGenerateInputSchema.parse(input)),
    ),
  videoDocumentGenerationRunsList: async (input) =>
    videoDocumentGenerationRunsPageSchema.parse(
      await ipcRenderer.invoke(
        'video-document:generation-runs-list',
        videoDocumentGenerationRunsListInputSchema.parse(input),
      ),
    ),
  videoDocumentAiActivitiesList: async (input) =>
    videoDocumentAiActivitiesPageSchema.parse(
      await ipcRenderer.invoke(
        'video-document:ai-activities-list',
        videoDocumentAiActivitiesListInputSchema.parse(input),
      ),
    ),
  videoDocumentExport: async (input) =>
    videoDocumentExportResultSchema.parse(
      await ipcRenderer.invoke('video-document:export', videoDocumentExportInputSchema.parse(input)),
    ),
  videoDocumentRevealExport: async (input) => {
    await ipcRenderer.invoke('video-document:reveal-export', videoDocumentRevealExportInputSchema.parse(input));
  },
  videoDocumentKeyChangesGet: async (documentId) =>
    videoKeyChangeResultSchema.nullable().parse(await ipcRenderer.invoke('video-document:key-changes-get', documentId)),
  videoDocumentKeyChangesExtract: async (input) =>
    videoKeyChangeResultSchema.parse(
      await ipcRenderer.invoke('video-document:key-changes-extract', videoKeyChangeExtractInputSchema.parse(input)),
    ),
  videoDocumentFrameCapture: async (input) =>
    videoDocumentFrameCaptureResultSchema.parse(
      await ipcRenderer.invoke('video-document:frame-capture', videoDocumentFrameCaptureInputSchema.parse(input)),
    ),
  creatorReferencesImport: (input) => ipcRenderer.invoke('creator:references-import', input),
  creatorOutputsImport: (input) => ipcRenderer.invoke('creator:outputs-import', input),
  creatorNewExternalCreationImport: (input) => ipcRenderer.invoke('creator:new-external-creation-import', input),
  creatorOutputsStage: (items) => ipcRenderer.invoke('creator:outputs-stage', items),
  creatorOutputsChoose: (input) => ipcRenderer.invoke('creator:outputs-choose', input),
  creatorOutputsDiscard: (stageIds) => ipcRenderer.invoke('creator:outputs-discard', stageIds),
  creatorOutputUpdate: (input) => ipcRenderer.invoke('creator:output-update', input),
  creatorOutputsOrganize: async (input) =>
    creatorOutputsOrganizeResultSchema.parse(await ipcRenderer.invoke('creator:outputs-organize', input)),
  promptSeriesOutputRemove: async (input) =>
    promptSeriesOutputPresentationResultSchema.parse(
      await ipcRenderer.invoke('prompt-series:output-remove', promptSeriesOutputRemoveInputSchema.parse(input)),
    ),
  promptSeriesCoverSet: async (input) =>
    promptSeriesOutputPresentationResultSchema.parse(
      await ipcRenderer.invoke('prompt-series:cover-set', promptSeriesCoverSetInputSchema.parse(input)),
    ),
  promptVersionCreate: async (input) =>
    promptVersionCreateResultSchema.parse(await ipcRenderer.invoke('prompt-version:create', input)),
  creationDraftStart: (input) => ipcRenderer.invoke('creation-draft:start', input),
  creationDraftSave: (input) => ipcRenderer.invoke('creation-draft:save', input),
  creationDraftCommit: (input) => ipcRenderer.invoke('creation-draft:commit', input),
  creationInputStashesList: (scope) => ipcRenderer.invoke('creation-input-stashes:list', scope),
  creationInputStashCreate: (input) => ipcRenderer.invoke('creation-input-stash:create', input),
  creationsDelete: (creationId) => ipcRenderer.invoke('creations:delete', creationId),
  dictionarySearch: (input) => ipcRenderer.invoke('dictionary:search', input),
  dictionarySearchPage: (input) => ipcRenderer.invoke('dictionary:search-page', input),
  dictionaryScopeResolve: (input) => ipcRenderer.invoke('dictionary:scope-resolve', input),
  dictionaryGet: (termId, locale) => ipcRenderer.invoke('dictionary:get', termId, locale),
  dictionaryCreate: (input) => ipcRenderer.invoke('dictionary:create', input),
  dictionarySaveDraft: (input) => ipcRenderer.invoke('dictionary:save-draft', input),
  dictionaryApprove: (termId, locale) => ipcRenderer.invoke('dictionary:approve', termId, locale),
  dictionaryWithdrawApproval: (termId, locale) => ipcRenderer.invoke('dictionary:withdraw-approval', termId, locale),
  dictionarySetArchived: (termId, archived, locale) =>
    ipcRenderer.invoke('dictionary:set-archived', termId, archived, locale),
  dictionaryAddMedia: (input) => ipcRenderer.invoke('dictionary:add-media', input),
  dictionarySetMediaCover: (mediaId) => ipcRenderer.invoke('dictionary:set-media-cover', mediaId),
  dictionaryRemoveMedia: (mediaId) => ipcRenderer.invoke('dictionary:remove-media', mediaId),
  dictionaryReorderMedia: (input) => ipcRenderer.invoke('dictionary:reorder-media', input),
  termIllustrationsList: async (input) => {
    const parsedInput = termIllustrationListInputSchema.parse(input);
    return termIllustrationListSchema.parse(await ipcRenderer.invoke('term-illustrations:list', parsedInput));
  },
  termIllustrationsStart: async (input) => {
    const parsedInput = termIllustrationStartInputSchema.parse(input);
    return termIllustrationStartResultSchema.parse(await ipcRenderer.invoke('term-illustrations:start', parsedInput));
  },
  termIllustrationsAdopt: async (input) => {
    const parsedInput = termIllustrationAdoptInputSchema.parse(input);
    return termIllustrationDecisionResultSchema.parse(
      await ipcRenderer.invoke('term-illustrations:adopt', parsedInput),
    );
  },
  termIllustrationsDismiss: async (input) => {
    const parsedInput = termIllustrationDismissInputSchema.parse(input);
    return termIllustrationDecisionResultSchema.parse(
      await ipcRenderer.invoke('term-illustrations:dismiss', parsedInput),
    );
  },
  dictionaryClassificationsTree: (locale) => ipcRenderer.invoke('dictionary-classifications:tree', locale),
  dictionaryClassificationsTerms: (input) => ipcRenderer.invoke('dictionary-classifications:terms', input),
  dictionaryClassificationCreate: (input) => ipcRenderer.invoke('dictionary-classification:create', input),
  dictionaryClassificationUpdate: (input) => ipcRenderer.invoke('dictionary-classification:update', input),
  dictionaryClassificationRestoreSource: (input) =>
    ipcRenderer.invoke('dictionary-classification:restore-source', input),
  dictionaryClassificationMovePreview: (input) => ipcRenderer.invoke('dictionary-classification:move-preview', input),
  dictionaryClassificationMove: (input) => ipcRenderer.invoke('dictionary-classification:move', input),
  dictionaryClassificationReorder: (input) => ipcRenderer.invoke('dictionary-classifications:reorder', input),
  dictionaryClassificationSetState: (input) => ipcRenderer.invoke('dictionary-classification:set-state', input),
  dictionaryClassificationMergePreview: (input) => ipcRenderer.invoke('dictionary-classification:merge-preview', input),
  dictionaryClassificationMerge: (input) => ipcRenderer.invoke('dictionary-classification:merge', input),
  materialsAddToDestinations: (input) => ipcRenderer.invoke('materials:add-to-destinations', input),
  dictionaryChooseImport: () => ipcRenderer.invoke('dictionary:choose-import'),
  dictionaryCommitImport: (batchId) => ipcRenderer.invoke('dictionary:commit-import', batchId),
  wordPaletteCreate: (input) => ipcRenderer.invoke('word-palette:create', input),
  wordPaletteUpdate: (input) => ipcRenderer.invoke('word-palette:update', input),
  wordPaletteSetArchived: (paletteId, archived) => ipcRenderer.invoke('word-palette:set-archived', paletteId, archived),
  wordPaletteDelete: (paletteId) => ipcRenderer.invoke('word-palette:delete', paletteId),
  assetsChooseReferences: () => ipcRenderer.invoke('assets:choose-references'),
  codexHealth: () => ipcRenderer.invoke('codex:health'),
  codexOpenThread: (threadId) => ipcRenderer.invoke('codex:open-thread', threadId),
  agentHistory: (input) => ipcRenderer.invoke('agent:history', input),
  agentChat: (input) => ipcRenderer.invoke('agent:chat', input),
  agentAssist: (input) => ipcRenderer.invoke('agent:assist', input),
  assistantProposalExpire: (runId, currentContextKey) =>
    ipcRenderer.invoke('assistant-proposal:expire', runId, currentContextKey),
  assistantProposalRevalidate: (runId, currentContextKey) =>
    ipcRenderer.invoke('assistant-proposal:revalidate', runId, currentContextKey),
  assistantProposalAdopt: (input) => ipcRenderer.invoke('assistant-proposal:adopt', input),
  assistantProposalClose: (runId) => ipcRenderer.invoke('assistant-proposal:close', runId),
  assistantRunDismiss: (runId) => ipcRenderer.invoke('assistant-run:dismiss', runId),
  codexSuggestTitles: (input) => ipcRenderer.invoke('codex:suggest-titles', input),
  promptSeriesRename: (input) => ipcRenderer.invoke('prompt-series:rename', input),
  promptSeriesDelete: (input) => ipcRenderer.invoke('prompt-series:delete', input),
  creationGroupsRename: (input) => ipcRenderer.invoke('creation-groups:rename', input),
  materialCollectionsCreateFromSource: (input) => ipcRenderer.invoke('material-collections:create-from-source', input),
  materialAlbumsList: (input) => ipcRenderer.invoke('material-albums:list', input),
  materialAlbumsCreate: (input) => ipcRenderer.invoke('material-albums:create', input),
  materialAlbumsRename: (input) => ipcRenderer.invoke('material-albums:rename', input),
  materialAlbumsDelete: (albumId) => ipcRenderer.invoke('material-albums:delete', albumId),
  materialAlbumsAddMany: (input) => ipcRenderer.invoke('material-albums:add-many', input),
  materialAlbumsRemove: (input) => ipcRenderer.invoke('material-albums:remove', input),
  albumsList: (locale) => ipcRenderer.invoke('albums:list', locale),
  albumsListTextMaterials: (albumId) => ipcRenderer.invoke('albums:list-text-materials', albumId),
  albumsCreate: (input) => ipcRenderer.invoke('albums:create', input),
  albumsCreateFromMaterials: (input) => ipcRenderer.invoke('albums:create-from-materials', input),
  albumsRename: (input) => ipcRenderer.invoke('albums:rename', input),
  albumsUpdateCreationDefaults: (input) => ipcRenderer.invoke('albums:update-creation-defaults', input),
  albumsDelete: (albumId) => ipcRenderer.invoke('albums:delete', albumId),
  albumsSetPinned: (input) => ipcRenderer.invoke('albums:set-pinned', input),
  albumsArchive: (albumId) => ipcRenderer.invoke('albums:archive', albumId),
  albumsSetArchived: (input) => ipcRenderer.invoke('albums:set-archived', input),
  albumsMove: (input) => ipcRenderer.invoke('albums:move', input),
  albumsMoveSeries: (input) => ipcRenderer.invoke('albums:move-series', input),
  albumsAddMembers: (input) => ipcRenderer.invoke('albums:add-members', input),
  albumsRemoveMembers: (input) => ipcRenderer.invoke('albums:remove-members', input),
  albumsReorderMembers: (input) => ipcRenderer.invoke('albums:reorder-members', input),
  albumsReorderRoot: (input) => ipcRenderer.invoke('albums:reorder-root', input),
  materialMetadataUpdate: (input) => ipcRenderer.invoke('material-metadata:update', input),
  materialProvenanceSuggestions: () => ipcRenderer.invoke('material-provenance:suggestions'),
  generationStart: (input) => ipcRenderer.invoke('generation:start', input),
  generationStartBatch: (input) => ipcRenderer.invoke('generation:start-batch', input),
  imageEditStart: (input) => ipcRenderer.invoke('image-edit:start', input),
  imageEditStartBatch: (input) => ipcRenderer.invoke('image-edit:start-batch', input),
  imageCrop: (input) => ipcRenderer.invoke('image-transform:crop', input),
  imageReframeStart: (input) => ipcRenderer.invoke('image-transform:reframe-start', input),
  codexImageRefinementStart: (input) => ipcRenderer.invoke('codex:image-refinement-start', input),
  styleExplorationStart: (input) => ipcRenderer.invoke('style-exploration:start', input),
  styleExplorationProposeAdjacent: (slotId) => ipcRenderer.invoke('style-exploration:propose-adjacent', slotId),
  styleExplorationCancel: (batchId) => ipcRenderer.invoke('style-exploration:cancel', batchId),
  styleExplorationRetrySlot: (slotId) => ipcRenderer.invoke('style-exploration:retry-slot', slotId),
  knowledgeDistillationList: (sourceAssetId) => ipcRenderer.invoke('knowledge-distillation:list', sourceAssetId),
  knowledgeDistillationCreate: (input) => ipcRenderer.invoke('knowledge-distillation:create', input),
  knowledgeDistillationAccept: (input) => ipcRenderer.invoke('knowledge-distillation:accept', input),
  historicalTermRecommendationsList: (input) => ipcRenderer.invoke('historical-term-recommendations:list', input),
  historicalTermRecommendationsCreate: (input) => ipcRenderer.invoke('historical-term-recommendations:create', input),
  dictionaryMaintenanceList: (input) => ipcRenderer.invoke('dictionary-maintenance:list', input),
  dictionaryMaintenanceCreate: (input) => ipcRenderer.invoke('dictionary-maintenance:create', input),
  generationStartVersion: (input) => ipcRenderer.invoke('generation:start-version', input),
  generationRetry: (runId) => ipcRenderer.invoke('generation:retry', runId),
  generationCancel: (runId) => ipcRenderer.invoke('generation:cancel', runId),
  generationProcessSummary: async (runId) =>
    generationProcessSummarySchema.nullable().parse(await ipcRenderer.invoke('generation:process-summary', runId)),
  generationProcessEvents: async (input) => {
    const parsedInput = generationProcessEventPageInputSchema.parse(input);
    return generationProcessEventPageSchema
      .nullable()
      .parse(await ipcRenderer.invoke('generation:process-events', parsedInput));
  },
  generationExecutionRequest: (runId) => ipcRenderer.invoke('generation:execution-request', runId),
  generationOutputSetFailed: (input) => ipcRenderer.invoke('generation:output-set-failed', input),
  annotationsList: (assetId) => ipcRenderer.invoke('annotations:list', assetId),
  annotationsAdd: (input) => ipcRenderer.invoke('annotations:add', input),
  annotationsUpdate: (input) => ipcRenderer.invoke('annotations:update', input),
  annotationsReuseHistory: (input) => ipcRenderer.invoke('annotations:reuse-history', input),
  annotationsSetStatus: (input) => ipcRenderer.invoke('annotations:set-status', input),
  galleryList: (input) => ipcRenderer.invoke('gallery:list', input),
  assetRelationshipGet: (assetId, locale) => ipcRenderer.invoke('asset-relationship:get', assetId, locale),
  assetFileAvailability: (assetId) => ipcRenderer.invoke('asset-file:availability', assetId),
  assetFileCopy: (assetId) => ipcRenderer.invoke('asset-file:copy', assetId),
  assetFileSaveAs: (assetId) => ipcRenderer.invoke('asset-file:save-as', assetId),
  assetFileRevealTargets: (assetId, context) => ipcRenderer.invoke('asset-file:reveal-targets', assetId, context),
  assetFileReveal: (assetId, context) => ipcRenderer.invoke('asset-file:reveal', assetId, context),
  assetFileOpen: (assetId) => ipcRenderer.invoke('asset-file:open', assetId),
  assetDelete: (assetId) => ipcRenderer.invoke('asset:delete', assetId),
  favoriteTextsList: () => ipcRenderer.invoke('favorites:text-list'),
  favoriteAdd: (target) => ipcRenderer.invoke('favorites:add', target),
  favoriteRemove: (materialId) => ipcRenderer.invoke('favorites:remove', materialId),
  imageRatingSet: (imageAssetId, dimension, score) =>
    ipcRenderer.invoke('image-rating:set', imageAssetId, dimension, score),
  onCodexGeneratedImagesChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('codex-generated-images:changed', listener);
    return () => ipcRenderer.removeListener('codex-generated-images:changed', listener);
  },
  onGenerationChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, generationEvent: Parameters<typeof callback>[0]) =>
      callback(generationEvent);
    ipcRenderer.on('generation:changed', listener);
    return () => ipcRenderer.removeListener('generation:changed', listener);
  },
  onAssistantProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progressEvent: Parameters<typeof callback>[0]) =>
      callback(progressEvent);
    ipcRenderer.on('assistant-run:progress', listener);
    return () => ipcRenderer.removeListener('assistant-run:progress', listener);
  },
  onModelWorkerChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status);
    ipcRenderer.on('model-worker:changed', listener);
    return () => ipcRenderer.removeListener('model-worker:changed', listener);
  },
  onNavigationCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: Parameters<typeof callback>[0]) => callback(command);
    ipcRenderer.on('app:navigation-command', listener);
    return () => ipcRenderer.removeListener('app:navigation-command', listener);
  },
  onAppUpdateChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, rawState: unknown) =>
      callback(appUpdateStateSchema.parse(rawState));
    ipcRenderer.on('app-update:changed', listener);
    return () => ipcRenderer.removeListener('app-update:changed', listener);
  },
};

contextBridge.exposeInMainWorld('desktopApi', api);
