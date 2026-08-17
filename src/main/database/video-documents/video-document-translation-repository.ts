import type { LibraryStorage } from '@/main/database/core/storage';
import { VideoDocumentTranslationRunRepository } from '@/main/database/video-documents/video-document-translation-run-repository';
import type { VideoDocumentRevisionDto, VideoDocumentRevisionSaveInput } from '@/shared/contracts/video-document';
import type { VideoDocumentTranscriptTranslationExecution } from '@/shared/contracts/video-document-translation';

interface RevisionPersistence {
  write(input: VideoDocumentRevisionSaveInput): string;
  read(branchId: string, revisionId: string): VideoDocumentRevisionDto;
}

export class VideoDocumentTranslationRepository {
  private readonly runs: VideoDocumentTranslationRunRepository;

  constructor(
    private readonly storage: LibraryStorage,
    private readonly revisions: RevisionPersistence,
  ) {
    this.runs = new VideoDocumentTranslationRunRepository(storage);
  }

  private get db() {
    return this.storage.db;
  }

  start(input: {
    operationId: string;
    documentId: string;
    branchId: string;
    inputRevisionId: string | null;
    targetLocales: string[];
    execution: VideoDocumentTranscriptTranslationExecution;
  }) {
    if (
      this.db
        .prepare("SELECT 1 FROM video_document_generation_runs WHERE document_id = ? AND status = 'RUNNING' LIMIT 1")
        .get(input.documentId)
    ) {
      throw new Error('VIDEO_DOCUMENT_GENERATION_BUSY');
    }
    return this.runs.start(input);
  }

  updateProgress(input: Parameters<VideoDocumentTranslationRunRepository['updateProgress']>[0]) {
    return this.runs.updateProgress(input);
  }

  commit(input: {
    documentId: string;
    revision: VideoDocumentRevisionSaveInput;
    completion: Omit<Parameters<VideoDocumentTranslationRunRepository['completeInTransaction']>[0], 'outputRevisionId'>;
  }) {
    return this.db
      .transaction(() => {
        const ownership = this.db
          .prepare(
            `SELECT 1 FROM document_branches
            WHERE id = ? AND document_id = ? AND role = 'CLEAN_TRANSCRIPT' AND deleted_at IS NULL`,
          )
          .get(input.revision.branchId, input.documentId);
        if (!ownership) throw new Error('VIDEO_DOCUMENT_TRANSLATION_INPUT_CHANGED');
        const revisionId = this.revisions.write(input.revision);
        const run = this.runs.completeInTransaction({ ...input.completion, outputRevisionId: revisionId });
        return { revision: this.revisions.read(input.revision.branchId, revisionId), run };
      })
      .immediate();
  }

  fail(input: Parameters<VideoDocumentTranslationRunRepository['fail']>[0]) {
    return this.runs.fail(input);
  }

  interruptRunning() {
    return this.runs.interruptRunning();
  }
}
