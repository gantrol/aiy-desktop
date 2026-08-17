import type {
  VideoDocumentTranscriptRecognitionErrorCode,
  VideoDocumentTranscriptRecognitionProgress,
} from '@/shared/contracts/video-document';
import type { VideoDocumentTranscriptionRunDto } from '@/shared/contracts/video-document-ai-activity';
import { videoDocumentTranscriptionRunSchema } from '@/shared/contracts/video-document-ai-activity';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';

const LOCAL_QWEN_ASR_MODEL_ID = 'Qwen/Qwen3-ASR-0.6B' as const;

export function videoDocumentTranscriptionRunDto(row: JsonMap): VideoDocumentTranscriptionRunDto {
  return videoDocumentTranscriptionRunSchema.parse({
    id: text(row.id),
    documentId: text(row.document_id),
    outputRevisionId: row.output_revision_id ? text(row.output_revision_id) : null,
    status: text(row.status),
    providerKey: 'qwen-local',
    modelId: LOCAL_QWEN_ASR_MODEL_ID,
    completedChunks: Number(row.completed_chunks),
    totalChunks: row.total_chunks === null ? null : Number(row.total_chunks),
    errorCode: row.error_code ? text(row.error_code) : null,
    retryable: row.retryable === null ? null : Boolean(row.retryable),
    startedAt: text(row.started_at),
    finishedAt: row.finished_at ? text(row.finished_at) : null,
  });
}

export class VideoDocumentTranscriptionRunRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  recordStopped(input: {
    operationId: string;
    documentId: string;
    errorCode: VideoDocumentTranscriptRecognitionErrorCode;
    retryable: boolean;
  }) {
    this.requireDocument(input.documentId);
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO video_document_transcription_runs
        (id, document_id, output_revision_id, status, provider_key, model_id,
          completed_chunks, total_chunks, error_code, retryable, started_at, finished_at)
        VALUES (?, ?, NULL, 'NOT_STARTED', 'qwen-local', ?, 0, NULL, ?, ?, ?, ?)`,
      )
      .run(
        input.operationId,
        input.documentId,
        LOCAL_QWEN_ASR_MODEL_ID,
        input.errorCode,
        Number(input.retryable),
        timestamp,
        timestamp,
      );
    this.storage.recordChange('VIDEO_DOCUMENT_TRANSCRIPTION_RUN', input.operationId, 'NOT_STARTED', {
      documentId: input.documentId,
      errorCode: input.errorCode,
    });
    return this.get(input.operationId);
  }

  start(input: { operationId: string; documentId: string }) {
    this.requireDocument(input.documentId);
    const startedAt = now();
    this.db
      .prepare(
        `INSERT INTO video_document_transcription_runs
        (id, document_id, output_revision_id, status, provider_key, model_id,
          completed_chunks, total_chunks, error_code, retryable, started_at, finished_at)
        VALUES (?, ?, NULL, 'RUNNING', 'qwen-local', ?, 0, NULL, NULL, NULL, ?, NULL)`,
      )
      .run(input.operationId, input.documentId, LOCAL_QWEN_ASR_MODEL_ID, startedAt);
    this.storage.recordChange('VIDEO_DOCUMENT_TRANSCRIPTION_RUN', input.operationId, 'CREATE', {
      documentId: input.documentId,
    });
    return this.get(input.operationId);
  }

  updateProgress(progress: VideoDocumentTranscriptRecognitionProgress) {
    const result = this.db
      .prepare(
        `UPDATE video_document_transcription_runs
        SET completed_chunks = ?, total_chunks = ?
        WHERE id = ? AND document_id = ? AND status = 'RUNNING'`,
      )
      .run(progress.completedChunks, progress.totalChunks, progress.operationId, progress.documentId);
    if (result.changes === 1) {
      this.storage.recordChange('VIDEO_DOCUMENT_TRANSCRIPTION_RUN', progress.operationId, 'PROGRESS', {
        completedChunks: progress.completedChunks,
        totalChunks: progress.totalChunks,
      });
    }
  }

  complete(input: { operationId: string; documentId: string; outputRevisionId: string; finishedAt: string }) {
    this.db
      .transaction(() => {
        const output = this.db
          .prepare(
            `SELECT revision.id
            FROM document_draft_revisions revision
            JOIN document_drafts draft ON draft.id = revision.draft_id AND draft.deleted_at IS NULL
            JOIN document_branches branch ON branch.id = draft.branch_id AND branch.deleted_at IS NULL
            WHERE revision.id = ? AND branch.document_id = ? AND branch.role = 'CLEAN_TRANSCRIPT'`,
          )
          .get(input.outputRevisionId, input.documentId);
        if (!output) throw new Error('VIDEO_DOCUMENT_TRANSCRIPTION_OUTPUT_UNAVAILABLE');
        const result = this.db
          .prepare(
            `UPDATE video_document_transcription_runs
            SET status = 'SUCCEEDED', output_revision_id = ?, error_code = NULL,
              retryable = NULL, finished_at = ?
            WHERE id = ? AND document_id = ? AND status = 'RUNNING'`,
          )
          .run(input.outputRevisionId, input.finishedAt, input.operationId, input.documentId);
        if (result.changes !== 1) throw new Error('VIDEO_DOCUMENT_TRANSCRIPTION_STATE_CHANGED');
        this.storage.recordChange('VIDEO_DOCUMENT_TRANSCRIPTION_RUN', input.operationId, 'SUCCEED', {
          outputRevisionId: input.outputRevisionId,
        });
      })
      .immediate();
    return this.get(input.operationId);
  }

  fail(input: {
    operationId: string;
    documentId: string;
    errorCode: VideoDocumentTranscriptRecognitionErrorCode;
    retryable: boolean;
    finishedAt: string;
  }) {
    const status = input.errorCode === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    const result = this.db
      .prepare(
        `UPDATE video_document_transcription_runs
        SET status = ?, error_code = ?, retryable = ?, finished_at = ?
        WHERE id = ? AND document_id = ? AND status = 'RUNNING'`,
      )
      .run(status, input.errorCode, Number(input.retryable), input.finishedAt, input.operationId, input.documentId);
    if (result.changes === 1) {
      this.storage.recordChange('VIDEO_DOCUMENT_TRANSCRIPTION_RUN', input.operationId, status, {
        errorCode: input.errorCode,
        retryable: input.retryable,
      });
    }
    return this.get(input.operationId);
  }

  interruptRunning() {
    const rows = this.db
      .prepare("SELECT id, document_id FROM video_document_transcription_runs WHERE status = 'RUNNING'")
      .all() as JsonMap[];
    const finishedAt = now();
    for (const row of rows) {
      const operationId = text(row.id);
      this.db
        .prepare(
          `UPDATE video_document_transcription_runs
          SET status = 'INTERRUPTED', error_code = 'UNKNOWN', retryable = 1, finished_at = ?
          WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(finishedAt, operationId);
      this.storage.recordChange('VIDEO_DOCUMENT_TRANSCRIPTION_RUN', operationId, 'INTERRUPTED', {
        documentId: text(row.document_id),
      });
    }
    return rows.length;
  }

  private get(operationId: string) {
    const row = this.db.prepare('SELECT * FROM video_document_transcription_runs WHERE id = ?').get(operationId) as
      JsonMap | undefined;
    if (!row) throw new Error('Video document transcription run not found');
    return videoDocumentTranscriptionRunDto(row);
  }

  private requireDocument(documentId: string) {
    if (!this.db.prepare('SELECT 1 FROM documents WHERE id = ? AND deleted_at IS NULL').get(documentId)) {
      throw new Error('Document not found');
    }
  }
}
