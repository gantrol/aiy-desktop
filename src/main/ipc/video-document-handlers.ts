import { dialog, shell, type BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryDatabase } from '@/main/database';
import type { LocalQwenAsrSidecarManager } from '@/main/extensions/local-qwen-asr/sidecar-manager';
import type { AssistantRoutingConfiguration } from '@/main/assistant/assistant-routing';
import type { GenerationService } from '@/main/generation/service';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { id } from '@/main/ipc/schemas';
import { extractEmbeddedTimedSubtitles } from '@/main/video-transcript/embedded';
import type { VideoDocumentTranscriptBackgroundTaskRegistry } from '@/main/video-transcript/background-task-registry';
import { parseSrt } from '@/main/video-transcript/srt';
import { parseWebVtt } from '@/main/video-transcript/vtt';
import type { VideoDocumentAudioProbeService } from '@/main/video-documents/audio-probe-service';
import { videoDocumentExportFailure } from '@/main/video-documents/export-errors';
import type { VideoDocumentExportService } from '@/main/video-documents/export-service';
import type { VideoKeyChangeService } from '@/main/video-documents/key-change-service';
import { registerVideoDocumentTranscriptionIpc } from '@/main/ipc/video-document-transcription-handlers';
import type {
  VideoDocumentArticleGenerateInput,
  VideoDocumentArticleGenerateResult,
  VideoDocumentTranscriptTranslationResult,
  VideoDocumentTranscriptTranslationWorkerInput,
} from '@/shared/contracts';
import {
  localQwenAsrSidecarSchema,
  videoDocumentArticleGenerateInputSchema,
  videoDocumentAudioProbeInputSchema,
  videoDocumentCreateInputSchema,
  videoDocumentExportInputSchema,
  videoDocumentFrameCaptureInputSchema,
  videoDocumentFrameCaptureResultSchema,
  videoDocumentGenerationRunsListInputSchema,
  videoDocumentListInputSchema,
  videoDocumentMoveInputSchema,
  videoDocumentNavigationListInputSchema,
  videoDocumentNavigationReorderInputSchema,
  videoDocumentRenameInputSchema,
  videoDocumentRevealExportInputSchema,
  videoDocumentRevisionSaveInputSchema,
  videoDocumentSourceReplaceInputSchema,
} from '@/shared/contracts/video-document';
import {
  videoDocumentAiActivitiesListInputSchema,
  videoDocumentAiActivitiesPageSchema,
} from '@/shared/contracts/video-document-ai-activity';
import {
  videoDocumentTranscriptTranslationOperationIdSchema,
  videoDocumentTranscriptTranslationResultSchema,
  videoDocumentTranscriptTranslationStartInputSchema,
} from '@/shared/contracts/video-document-translation';
import { videoKeyChangeExtractInputSchema } from '@/shared/contracts/video-key-changes';

export interface VideoDocumentGenerationApi {
  generateVideoDocumentArticle(
    input: VideoDocumentArticleGenerateInput,
    signal?: AbortSignal,
  ): Promise<VideoDocumentArticleGenerateResult>;
  translateVideoDocumentTranscript(
    input: VideoDocumentTranscriptTranslationWorkerInput,
    signal?: AbortSignal,
  ): Promise<VideoDocumentTranscriptTranslationResult>;
}

interface VideoDocumentIpcOptions {
  ipcMain: IpcHandlerRegistrar;
  database: LibraryDatabase;
  generation: GenerationService & VideoDocumentGenerationApi;
  videoKeyChanges: VideoKeyChangeService;
  videoDocumentAudio: VideoDocumentAudioProbeService;
  videoDocumentExports: VideoDocumentExportService;
  localQwenAsrSidecar: LocalQwenAsrSidecarManager;
  transcriptBackgroundTasks: VideoDocumentTranscriptBackgroundTaskRegistry;
  assistantRouting: AssistantRoutingConfiguration;
  getWindow: () => BrowserWindow | null;
}

function registerVideoDocumentFrameCaptureIpc(ipcMain: IpcHandlerRegistrar, videoKeyChanges: VideoKeyChangeService) {
  ipcMain.handle('video-document:frame-capture', async (event, raw) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    event.sender.once('destroyed', cancel);
    try {
      return videoDocumentFrameCaptureResultSchema.parse(
        await videoKeyChanges.captureFrame(videoDocumentFrameCaptureInputSchema.parse(raw), controller.signal),
      );
    } finally {
      event.sender.removeListener('destroyed', cancel);
    }
  });
}

function registerVideoDocumentKeyChangeExtractionIpc(
  ipcMain: IpcHandlerRegistrar,
  videoKeyChanges: VideoKeyChangeService,
) {
  ipcMain.handle('video-document:key-changes-extract', async (event, raw) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    event.sender.once('destroyed', cancel);
    try {
      return await videoKeyChanges.extract(videoKeyChangeExtractInputSchema.parse(raw), controller.signal);
    } finally {
      event.sender.removeListener('destroyed', cancel);
    }
  });
}

export function registerVideoDocumentIpc({
  ipcMain,
  database,
  generation,
  videoKeyChanges,
  videoDocumentAudio,
  videoDocumentExports,
  localQwenAsrSidecar,
  transcriptBackgroundTasks,
  assistantRouting,
  getWindow,
}: VideoDocumentIpcOptions) {
  const activeTranslationControllers = new Map<string, AbortController>();
  const pendingTranslationCancellations = new Map<string, ReturnType<typeof setTimeout>>();

  ipcMain.handle('local-qwen-asr-sidecar:get', async () =>
    localQwenAsrSidecarSchema.parse(await localQwenAsrSidecar.inspect()),
  );

  ipcMain.handle('video-documents:list', (_event, raw) =>
    database.listVideoDocuments(videoDocumentListInputSchema.parse(raw)),
  );
  ipcMain.handle('video-documents:navigation-list', (_event, raw) =>
    database.listVideoDocumentNavigation(videoDocumentNavigationListInputSchema.parse(raw)),
  );
  ipcMain.handle('video-documents:navigation-reorder', (_event, raw) =>
    database.reorderVideoDocumentNavigation(videoDocumentNavigationReorderInputSchema.parse(raw)),
  );
  ipcMain.handle('video-document:generation-runs-list', (_event, raw) =>
    database.listVideoDocumentGenerationRuns(videoDocumentGenerationRunsListInputSchema.parse(raw)),
  );
  ipcMain.handle('video-document:ai-activities-list', (_event, raw) =>
    videoDocumentAiActivitiesPageSchema.parse(
      database.listVideoDocumentAiActivities(videoDocumentAiActivitiesListInputSchema.parse(raw)),
    ),
  );
  ipcMain.handle('video-document:get', (_event, rawDocumentId) => videoDocumentAudio.ensure(id.parse(rawDocumentId)));
  ipcMain.handle('video-document:create', async (_event, raw) => {
    const document = database.createVideoDocument(videoDocumentCreateInputSchema.parse(raw));
    const branch = document.branches.find((candidate) => candidate.role === 'CLEAN_TRANSCRIPT');
    if (branch && !branch.latestDraftRevisionId) {
      const embedded = await extractEmbeddedTimedSubtitles(database, document.id);
      if (embedded) {
        database.saveVideoDocumentRevision(
          {
            branchId: branch.id,
            expectedParentRevisionId: null,
            content: {
              schemaVersion: 1,
              format: 'TIMED_TRANSCRIPT',
              transcriptBasis: 'EMBEDDED_SUBTITLES',
              textTreatment: 'VERBATIM',
              sourceFileName: embedded.sourceFileName,
              sourceHash: createHash('sha256').update(embedded.rawText, 'utf8').digest('hex'),
              rawText: embedded.rawText,
              cues: embedded.cues,
            },
          },
          'SYSTEM',
        );
      }
    }
    return videoDocumentAudio.ensure(document.id);
  });
  ipcMain.handle('video-document:audio-probe', (_event, raw) => {
    const input = videoDocumentAudioProbeInputSchema.parse(raw);
    return videoDocumentAudio.ensure(input.documentId, input.force);
  });
  ipcMain.handle('video-document:rename', (_event, raw) =>
    database.renameVideoDocument(videoDocumentRenameInputSchema.parse(raw)),
  );
  ipcMain.handle('video-document:move', (_event, raw) =>
    database.moveVideoDocument(videoDocumentMoveInputSchema.parse(raw)),
  );
  ipcMain.handle('video-document:source-replace', (_event, raw) => {
    const document = database.replaceVideoDocumentSource(videoDocumentSourceReplaceInputSchema.parse(raw));
    return videoDocumentAudio.ensure(document.id, true);
  });
  ipcMain.handle('video-document:revision-get', (_event, rawBranchId, rawRevisionId) => {
    const branchId = id.parse(rawBranchId);
    return rawRevisionId === undefined
      ? database.getLatestVideoDocumentRevision(branchId)
      : database.getVideoDocumentRevision(branchId, id.parse(rawRevisionId));
  });
  ipcMain.handle('video-document:revision-save', (_event, raw) =>
    database.saveVideoDocumentRevision(videoDocumentRevisionSaveInputSchema.parse(raw), 'HUMAN'),
  );
  ipcMain.handle('video-document:transcript-import', async (_event, rawDocumentId) => {
    const documentId = id.parse(rawDocumentId);
    const owner = getWindow();
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Timed subtitles', extensions: ['srt', 'vtt'] }],
    };
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    const filePath = selection.filePaths[0];
    if (selection.canceled || !filePath) return null;
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > 8 * 1024 * 1024) {
      throw new Error('VIDEO_DOCUMENT_SUBTITLE_INVALID');
    }
    const rawText = await readFile(filePath, 'utf8');
    const extension = path.extname(filePath).toLocaleLowerCase();
    const cues = extension === '.vtt' ? parseWebVtt(rawText) : parseSrt(rawText);
    const document = database.getVideoDocument(documentId);
    const branch = document.branches.find((candidate) => candidate.role === 'CLEAN_TRANSCRIPT');
    if (!branch) throw new Error('VIDEO_DOCUMENT_TRANSCRIPT_BRANCH_MISSING');
    return database.saveVideoDocumentRevision(
      {
        branchId: branch.id,
        expectedParentRevisionId: branch.latestDraftRevisionId,
        content: {
          schemaVersion: 1,
          format: 'TIMED_TRANSCRIPT',
          transcriptBasis: 'EXTERNAL_SUBTITLES',
          textTreatment: 'VERBATIM',
          sourceFileName: path.basename(filePath),
          sourceHash: createHash('sha256').update(rawText, 'utf8').digest('hex'),
          rawText,
          cues,
        },
      },
      'HUMAN',
    );
  });
  registerVideoDocumentTranscriptionIpc({
    ipcMain,
    database,
    localQwenAsrSidecar,
    transcriptBackgroundTasks,
    getWindow,
  });
  ipcMain.handle('video-document:transcript-translate', async (_event, raw) => {
    const input = videoDocumentTranscriptTranslationStartInputSchema.parse(raw);
    if (activeTranslationControllers.has(input.operationId)) {
      throw new Error('Subtitle translation operation is already running');
    }
    const route = assistantRouting.resolve('subtitleTranslation');
    if (route.providerKey !== 'codex') {
      throw new Error(`Unsupported subtitle translation provider: ${route.providerKey}`);
    }
    const controller = new AbortController();
    activeTranslationControllers.set(input.operationId, controller);
    const pendingCancellation = pendingTranslationCancellations.get(input.operationId);
    if (pendingCancellation) {
      clearTimeout(pendingCancellation);
      pendingTranslationCancellations.delete(input.operationId);
      controller.abort();
    }
    try {
      return videoDocumentTranscriptTranslationResultSchema.parse(
        await generation.translateVideoDocumentTranscript(
          {
            ...input,
            execution: {
              providerKey: 'codex',
              modelKey: route.modelKey,
              reasoningEffort: route.reasoningEffort ?? 'medium',
            },
          },
          controller.signal,
        ),
      );
    } finally {
      if (activeTranslationControllers.get(input.operationId) === controller) {
        activeTranslationControllers.delete(input.operationId);
      }
      const staleCancellation = pendingTranslationCancellations.get(input.operationId);
      if (staleCancellation) {
        clearTimeout(staleCancellation);
        pendingTranslationCancellations.delete(input.operationId);
      }
    }
  });
  ipcMain.handle('video-document:transcript-translation-cancel', (_event, rawOperationId) => {
    const operationId = videoDocumentTranscriptTranslationOperationIdSchema.parse(rawOperationId);
    const active = activeTranslationControllers.get(operationId);
    if (active) active.abort();
    else if (!pendingTranslationCancellations.has(operationId)) {
      const expiry = setTimeout(() => pendingTranslationCancellations.delete(operationId), 30_000);
      expiry.unref?.();
      pendingTranslationCancellations.set(operationId, expiry);
    }
    return undefined;
  });
  ipcMain.handle('video-document:article-generate', (_event, raw) =>
    generation.generateVideoDocumentArticle(videoDocumentArticleGenerateInputSchema.parse(raw)),
  );
  ipcMain.handle('video-document:export', async (_event, raw) => {
    try {
      return await videoDocumentExports.export(videoDocumentExportInputSchema.parse(raw));
    } catch (error) {
      return { status: 'failed' as const, ...videoDocumentExportFailure(error) };
    }
  });
  ipcMain.handle('video-document:reveal-export', (_event, raw) => {
    const input = videoDocumentRevealExportInputSchema.parse(raw);
    shell.showItemInFolder(path.resolve(input.outputPath));
  });
  ipcMain.handle('video-document:key-changes-get', (_event, rawDocumentId) =>
    videoKeyChanges.get(id.parse(rawDocumentId)),
  );
  registerVideoDocumentKeyChangeExtractionIpc(ipcMain, videoKeyChanges);
  registerVideoDocumentFrameCaptureIpc(ipcMain, videoKeyChanges);
}
