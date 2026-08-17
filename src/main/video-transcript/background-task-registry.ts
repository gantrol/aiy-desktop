import { LOCAL_QWEN_ASR_MODEL_ID } from '@/main/extensions/local-qwen-asr/sidecar-manager';
import type {
  VideoDocumentTranscriptBackgroundTask,
  VideoDocumentTranscriptBackgroundTaskSnapshot,
  VideoDocumentTranscriptBackgroundTaskTerminal,
  VideoDocumentTranscriptBackgroundTasksChangedEvent,
} from '@/shared/contracts/video-document-transcription';
import {
  videoDocumentTranscriptBackgroundTaskSchema,
  videoDocumentTranscriptBackgroundTaskSnapshotSchema,
  videoDocumentTranscriptBackgroundTasksChangedEventSchema,
} from '@/shared/contracts/video-document-transcription';
import type { VideoDocumentTranscriptRecognitionProgress } from '@/shared/contracts/video-document';

const CANCEL_WAIT_TIMEOUT_MS = 15_000;

interface StartTaskInput {
  operationId: string;
  documentId: string;
  documentTitle: string;
  controller: AbortController;
}

type ChangedListener = (event: VideoDocumentTranscriptBackgroundTasksChangedEvent) => void;

export class VideoDocumentTranscriptBackgroundTaskRegistry {
  private readonly tasksByOperationId = new Map<string, VideoDocumentTranscriptBackgroundTask>();
  private readonly controllersByOperationId = new Map<string, AbortController>();
  private readonly changedListeners = new Set<ChangedListener>();
  private readonly idleWaiters = new Set<() => void>();
  private currentRevision = 0;

  get activeCount() {
    return this.tasksByOperationId.size;
  }

  snapshot(): VideoDocumentTranscriptBackgroundTaskSnapshot {
    return videoDocumentTranscriptBackgroundTaskSnapshotSchema.parse({
      revision: this.currentRevision,
      tasks: this.sortedTasks(),
    });
  }

  onChanged(listener: ChangedListener) {
    this.changedListeners.add(listener);
    return () => this.changedListeners.delete(listener);
  }

  start(input: StartTaskInput) {
    if (this.tasksByOperationId.size > 0) throw new Error('LOCAL_MODEL_BUSY');
    const task = videoDocumentTranscriptBackgroundTaskSchema.parse({
      operationId: input.operationId,
      documentId: input.documentId,
      documentTitle: input.documentTitle,
      providerKey: 'qwen-local',
      modelId: LOCAL_QWEN_ASR_MODEL_ID,
      status: 'STARTING',
      completedChunks: 0,
      totalChunks: null,
      startedAt: new Date().toISOString(),
    });
    this.tasksByOperationId.set(task.operationId, task);
    this.controllersByOperationId.set(task.operationId, input.controller);
    this.emitChanged(null);
    return task;
  }

  updateProgress(progress: VideoDocumentTranscriptRecognitionProgress) {
    const current = this.tasksByOperationId.get(progress.operationId);
    if (!current) return;
    this.tasksByOperationId.set(
      progress.operationId,
      videoDocumentTranscriptBackgroundTaskSchema.parse({
        ...current,
        status: current.status === 'CANCELLING' ? current.status : 'TRANSCRIBING',
        completedChunks: progress.completedChunks,
        totalChunks: progress.totalChunks,
      }),
    );
    this.emitChanged(null);
  }

  cancel(operationId: string) {
    const task = this.tasksByOperationId.get(operationId);
    const controller = this.controllersByOperationId.get(operationId);
    if (!task || !controller) return;
    if (task.status !== 'CANCELLING') {
      this.tasksByOperationId.set(
        operationId,
        videoDocumentTranscriptBackgroundTaskSchema.parse({ ...task, status: 'CANCELLING' }),
      );
      this.emitChanged(null);
    }
    controller.abort();
  }

  abortAll() {
    let changed = false;
    for (const [operationId, task] of this.tasksByOperationId) {
      if (task.status !== 'CANCELLING') {
        this.tasksByOperationId.set(
          operationId,
          videoDocumentTranscriptBackgroundTaskSchema.parse({ ...task, status: 'CANCELLING' }),
        );
        changed = true;
      }
      this.controllersByOperationId.get(operationId)?.abort();
    }
    if (changed) this.emitChanged(null);
  }

  async cancelAll() {
    this.abortAll();
    await this.waitForIdle();
  }

  finish(operationId: string, terminal: VideoDocumentTranscriptBackgroundTaskTerminal) {
    const existed = this.tasksByOperationId.delete(operationId);
    this.controllersByOperationId.delete(operationId);
    if (!existed) return;
    this.emitChanged(terminal);
    if (this.tasksByOperationId.size !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  private sortedTasks() {
    return [...this.tasksByOperationId.values()].sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) || left.operationId.localeCompare(right.operationId),
    );
  }

  private emitChanged(terminal: VideoDocumentTranscriptBackgroundTaskTerminal | null) {
    this.currentRevision += 1;
    const event = videoDocumentTranscriptBackgroundTasksChangedEventSchema.parse({
      revision: this.currentRevision,
      tasks: this.sortedTasks(),
      terminal,
    });
    for (const listener of this.changedListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[video-transcript] background task listener failed', error);
      }
    }
  }

  private waitForIdle() {
    if (this.tasksByOperationId.size === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.idleWaiters.delete(onIdle);
        if (error) reject(error);
        else resolve();
      };
      const onIdle = () => finish();
      const timeout = setTimeout(
        () => finish(new Error('Timed out while cancelling local transcription tasks')),
        CANCEL_WAIT_TIMEOUT_MS,
      );
      timeout.unref?.();
      this.idleWaiters.add(onIdle);
    });
  }
}
