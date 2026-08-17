import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { VideoDocumentRepository } from '@/main/database/video-documents/video-document-repository';
import type {
  VideoDocumentCreateInput,
  VideoDocumentListInput,
  VideoDocumentMoveInput,
  VideoDocumentRenameInput,
  VideoDocumentRevisionOrigin,
  VideoDocumentRevisionSaveInput,
  VideoDocumentSourceReplaceInput,
} from '@/shared/contracts';

export function createVideoDocumentApi(repositories: Pick<LibraryDatabaseRepositories, 'videoDocuments'>) {
  return {
    listVideoDocuments(input: VideoDocumentListInput) {
      return repositories.videoDocuments.list(input);
    },

    listVideoDocumentNavigation(input: Parameters<VideoDocumentRepository['listNavigation']>[0]) {
      return repositories.videoDocuments.listNavigation(input);
    },

    reorderVideoDocumentNavigation(input: Parameters<VideoDocumentRepository['reorderNavigation']>[0]) {
      return repositories.videoDocuments.reorderNavigation(input);
    },

    listVideoDocumentGenerationRuns(input: Parameters<VideoDocumentRepository['listGenerationRuns']>[0]) {
      return repositories.videoDocuments.listGenerationRuns(input);
    },

    listVideoDocumentAiActivities(input: Parameters<VideoDocumentRepository['listAiActivities']>[0]) {
      return repositories.videoDocuments.listAiActivities(input);
    },

    recordStoppedVideoDocumentTranscription(
      input: Parameters<VideoDocumentRepository['recordStoppedTranscription']>[0],
    ) {
      return repositories.videoDocuments.recordStoppedTranscription(input);
    },

    startVideoDocumentTranscription(input: Parameters<VideoDocumentRepository['startTranscription']>[0]) {
      return repositories.videoDocuments.startTranscription(input);
    },

    updateVideoDocumentTranscriptionProgress(
      input: Parameters<VideoDocumentRepository['updateTranscriptionProgress']>[0],
    ) {
      return repositories.videoDocuments.updateTranscriptionProgress(input);
    },

    completeVideoDocumentTranscription(input: Parameters<VideoDocumentRepository['completeTranscription']>[0]) {
      return repositories.videoDocuments.completeTranscription(input);
    },

    failVideoDocumentTranscription(input: Parameters<VideoDocumentRepository['failTranscription']>[0]) {
      return repositories.videoDocuments.failTranscription(input);
    },

    interruptVideoDocumentTranscriptions() {
      return repositories.videoDocuments.interruptRunningTranscriptions();
    },

    startVideoDocumentTranslation(input: Parameters<VideoDocumentRepository['startTranslation']>[0]) {
      return repositories.videoDocuments.startTranslation(input);
    },

    updateVideoDocumentTranslationProgress(input: Parameters<VideoDocumentRepository['updateTranslationProgress']>[0]) {
      return repositories.videoDocuments.updateTranslationProgress(input);
    },

    commitVideoDocumentTranslation(input: Parameters<VideoDocumentRepository['commitTranslation']>[0]) {
      return repositories.videoDocuments.commitTranslation(input);
    },

    failVideoDocumentTranslation(input: Parameters<VideoDocumentRepository['failTranslation']>[0]) {
      return repositories.videoDocuments.failTranslation(input);
    },

    interruptVideoDocumentTranslations() {
      return repositories.videoDocuments.interruptRunningTranslations();
    },

    getVideoDocument(documentId: string) {
      return repositories.videoDocuments.get(documentId);
    },

    createVideoDocument(input: VideoDocumentCreateInput) {
      return repositories.videoDocuments.create(input);
    },

    renameVideoDocument(input: VideoDocumentRenameInput) {
      return repositories.videoDocuments.rename(input);
    },

    moveVideoDocument(input: VideoDocumentMoveInput) {
      return repositories.videoDocuments.move(input);
    },

    replaceVideoDocumentSource(input: VideoDocumentSourceReplaceInput) {
      return repositories.videoDocuments.replaceSource(input);
    },

    getLatestVideoDocumentRevision(branchId: string) {
      return repositories.videoDocuments.getLatestRevision(branchId);
    },

    getVideoDocumentRevision(branchId: string, revisionId: string) {
      return repositories.videoDocuments.getRevision(branchId, revisionId);
    },

    saveVideoDocumentRevision(input: VideoDocumentRevisionSaveInput, origin: VideoDocumentRevisionOrigin = 'HUMAN') {
      return repositories.videoDocuments.saveRevision(input, origin);
    },

    startVideoDocumentArticleGeneration(input: Parameters<VideoDocumentRepository['startArticleGeneration']>[0]) {
      return repositories.videoDocuments.startArticleGeneration(input);
    },

    recordStoppedVideoDocumentArticleGeneration(
      input: Parameters<VideoDocumentRepository['recordStoppedGeneration']>[0],
    ) {
      return repositories.videoDocuments.recordStoppedGeneration(input);
    },

    commitVideoDocumentArticleGeneration(input: Parameters<VideoDocumentRepository['commitArticleGeneration']>[0]) {
      return repositories.videoDocuments.commitArticleGeneration(input);
    },

    failVideoDocumentArticleGeneration(
      runId: string,
      reason: unknown,
      result?: Parameters<VideoDocumentRepository['failArticleGeneration']>[2],
    ) {
      return repositories.videoDocuments.failArticleGeneration(runId, reason, result);
    },

    interruptVideoDocumentGenerations() {
      return repositories.videoDocuments.interruptRunningGenerations();
    },

    ensurePrivateVideoDocumentEvidenceImage(
      input: Parameters<VideoDocumentRepository['ensurePrivateEvidenceImage']>[0],
    ) {
      return repositories.videoDocuments.ensurePrivateEvidenceImage(input);
    },

    setVideoDocumentThumbnail(documentId: string, assetId: string) {
      return repositories.videoDocuments.setThumbnail(documentId, assetId);
    },

    updateVideoDocumentAudioInfo(
      sourceAssetId: string,
      audio: Parameters<VideoDocumentRepository['updateAudioInfo']>[1],
    ) {
      return repositories.videoDocuments.updateAudioInfo(sourceAssetId, audio);
    },
  };
}

export type VideoDocumentApi = ReturnType<typeof createVideoDocumentApi>;
