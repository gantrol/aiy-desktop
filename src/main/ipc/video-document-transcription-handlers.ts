import type { BrowserWindow } from 'electron';
import type { LibraryDatabase } from '@/main/database';
import type { LocalQwenAsrSidecarManager } from '@/main/extensions/local-qwen-asr/sidecar-manager';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import type { VideoDocumentTranscriptBackgroundTaskRegistry } from '@/main/video-transcript/background-task-registry';
import {
  VideoDocumentTranscriptRecognitionService,
  videoDocumentTranscriptRecognitionFailure,
} from '@/main/video-transcript/recognition-service';
import type { VideoDocumentTranscriptBackgroundTaskTerminal } from '@/shared/contracts';
import {
  videoDocumentTranscriptRecognitionOperationIdSchema,
  videoDocumentTranscriptRecognitionProgressSchema,
  videoDocumentTranscriptRecognitionResultSchema,
  videoDocumentTranscriptRecognizeInputSchema,
} from '@/shared/contracts/video-document';
import { videoDocumentTranscriptBackgroundTaskSnapshotSchema } from '@/shared/contracts/video-document-transcription';

interface Options {
  ipcMain: IpcHandlerRegistrar;
  database: LibraryDatabase;
  localQwenAsrSidecar: LocalQwenAsrSidecarManager;
  transcriptBackgroundTasks: VideoDocumentTranscriptBackgroundTaskRegistry;
  getWindow: () => BrowserWindow | null;
}

export function registerVideoDocumentTranscriptionIpc({
  ipcMain,
  database,
  localQwenAsrSidecar,
  transcriptBackgroundTasks,
  getWindow,
}: Options) {
  ipcMain.handle('video-document:transcript-recognize', async (_event, raw) => {
    const input = videoDocumentTranscriptRecognizeInputSchema.parse(raw);
    if (transcriptBackgroundTasks.activeCount > 0) {
      database.recordStoppedVideoDocumentTranscription({
        operationId: input.operationId,
        documentId: input.documentId,
        errorCode: 'LOCAL_MODEL_BUSY',
        retryable: true,
      });
      return videoDocumentTranscriptRecognitionResultSchema.parse({
        status: 'failed',
        code: 'LOCAL_MODEL_BUSY',
        retryable: true,
      });
    }
    const operationDatabase = Object.freeze({
      getVideoDocument: database.getVideoDocument,
      resolveAssetFile: database.resolveAssetFile,
      saveVideoDocumentRevision: database.saveVideoDocumentRevision,
      startVideoDocumentTranscription: database.startVideoDocumentTranscription,
      updateVideoDocumentTranscriptionProgress: database.updateVideoDocumentTranscriptionProgress,
      completeVideoDocumentTranscription: database.completeVideoDocumentTranscription,
      failVideoDocumentTranscription: database.failVideoDocumentTranscription,
    });
    const sourceDocument = operationDatabase.getVideoDocument(input.documentId);
    const controller = new AbortController();
    operationDatabase.startVideoDocumentTranscription({
      operationId: input.operationId,
      documentId: input.documentId,
    });
    let unregisterSidecarOperation: () => void = () => undefined;
    let terminal: VideoDocumentTranscriptBackgroundTaskTerminal = {
      operationId: input.operationId,
      documentId: input.documentId,
      status: 'failed',
      code: 'UNKNOWN',
      retryable: true,
      finishedAt: new Date().toISOString(),
    };
    try {
      transcriptBackgroundTasks.start({
        operationId: input.operationId,
        documentId: input.documentId,
        documentTitle: sourceDocument.title,
        controller,
      });
      unregisterSidecarOperation = localQwenAsrSidecar.registerOperation(controller);
      await localQwenAsrSidecar.ensureReady(controller.signal);
      const recognition = new VideoDocumentTranscriptRecognitionService(operationDatabase, localQwenAsrSidecar);
      const revision = await recognition.recognize(
        { documentId: input.documentId, providerKey: input.providerKey },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            const parsedProgress = videoDocumentTranscriptRecognitionProgressSchema.parse({
              ...progress,
              operationId: input.operationId,
            });
            operationDatabase.updateVideoDocumentTranscriptionProgress(parsedProgress);
            transcriptBackgroundTasks.updateProgress(parsedProgress);
            const window = getWindow();
            if (window && !window.isDestroyed()) {
              window.webContents.send('video-document:transcript-recognition-progress', parsedProgress);
            }
          },
        },
      );
      const result = videoDocumentTranscriptRecognitionResultSchema.parse({ status: 'succeeded', revision });
      const finishedAt = new Date().toISOString();
      operationDatabase.completeVideoDocumentTranscription({
        operationId: input.operationId,
        documentId: input.documentId,
        outputRevisionId: revision.id,
        finishedAt,
      });
      terminal = {
        operationId: input.operationId,
        documentId: input.documentId,
        status: 'succeeded',
        finishedAt,
      };
      return result;
    } catch (error) {
      const failure = videoDocumentTranscriptRecognitionFailure(error);
      console.error('[video-transcript] recognition failed', {
        operationId: input.operationId,
        documentId: input.documentId,
        ...failure,
        diagnostic: error instanceof Error ? error.message.slice(0, 500) : 'Unknown transcription failure',
      });
      const result = videoDocumentTranscriptRecognitionResultSchema.parse({ status: 'failed', ...failure });
      const finishedAt = new Date().toISOString();
      operationDatabase.failVideoDocumentTranscription({
        operationId: input.operationId,
        documentId: input.documentId,
        errorCode: failure.code,
        retryable: failure.retryable,
        finishedAt,
      });
      terminal = {
        operationId: input.operationId,
        documentId: input.documentId,
        status: 'failed',
        ...failure,
        finishedAt,
      };
      return result;
    } finally {
      unregisterSidecarOperation();
      transcriptBackgroundTasks.finish(input.operationId, terminal);
    }
  });
  ipcMain.handle('video-document:transcript-background-tasks-get', () =>
    videoDocumentTranscriptBackgroundTaskSnapshotSchema.parse(transcriptBackgroundTasks.snapshot()),
  );
  ipcMain.handle('video-document:transcript-recognition-cancel', (_event, rawOperationId) => {
    transcriptBackgroundTasks.cancel(videoDocumentTranscriptRecognitionOperationIdSchema.parse(rawOperationId));
    return undefined;
  });
}
