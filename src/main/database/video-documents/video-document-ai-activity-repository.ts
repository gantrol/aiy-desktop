import type {
  VideoDocumentAiActivitiesListInput,
  VideoDocumentAiActivitiesPage,
  VideoDocumentAiActivityDto,
} from '@/shared/contracts/video-document-ai-activity';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';
import { videoDocumentGenerationRunDto } from '@/main/database/video-documents/video-document-generation-run-repository';
import { videoDocumentTranscriptionRunDto } from '@/main/database/video-documents/video-document-transcription-run-repository';
import { videoDocumentTranslationRunDto } from '@/main/database/video-documents/video-document-translation-run-repository';

interface ActivityIndexRow extends JsonMap {
  activity_type: 'ARTICLE_GENERATION' | 'TRANSCRIPT_RECOGNITION' | 'TRANSCRIPT_TRANSLATION';
}

function encodeOffsetCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeOffsetCursor(value: string | null | undefined) {
  if (!value) return 0;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const offset = parsed && typeof parsed === 'object' && 'offset' in parsed ? parsed.offset : undefined;
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error();
    return offset;
  } catch {
    throw new Error('Invalid video document AI activity cursor');
  }
}

function rowsById(
  db: LibraryStorage['db'],
  table: 'video_document_generation_runs' | 'video_document_transcription_runs' | 'video_document_translation_runs',
  ids: string[],
) {
  if (ids.length === 0) return new Map<string, JsonMap>();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders})`).all(...ids) as JsonMap[];
  return new Map(rows.map((row) => [text(row.id), row]));
}

export class VideoDocumentAiActivityRepository {
  constructor(private readonly storage: LibraryStorage) {}

  list(input: VideoDocumentAiActivitiesListInput): VideoDocumentAiActivitiesPage {
    const offset = decodeOffsetCursor(input.cursor);
    const limit = Math.min(input.limit ?? 100, 200);
    const rows = this.storage.db
      .prepare(
        `WITH activity_index AS (
          SELECT 'ARTICLE_GENERATION' AS activity_type, id, document_id, started_at
          FROM video_document_generation_runs
          UNION ALL
          SELECT 'TRANSCRIPT_RECOGNITION' AS activity_type, id, document_id, started_at
          FROM video_document_transcription_runs
          UNION ALL
          SELECT 'TRANSCRIPT_TRANSLATION' AS activity_type, id, document_id, started_at
          FROM video_document_translation_runs
        )
        SELECT activity.activity_type, activity.id, activity.document_id, activity.started_at,
          document.title AS document_title, placement.album_id
        FROM activity_index activity
        JOIN documents document ON document.id = activity.document_id AND document.deleted_at IS NULL
        LEFT JOIN album_members placement ON placement.target_type = 'DOCUMENT'
          AND placement.target_id = document.id AND placement.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM albums placement_album
            WHERE placement_album.id = placement.album_id AND placement_album.deleted_at IS NULL
          )
        ORDER BY activity.started_at DESC, activity.id DESC
        LIMIT ? OFFSET ?`,
      )
      .all(limit + 1, offset) as ActivityIndexRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const articleIds = pageRows.filter((row) => row.activity_type === 'ARTICLE_GENERATION').map((row) => text(row.id));
    const transcriptionIds = pageRows
      .filter((row) => row.activity_type === 'TRANSCRIPT_RECOGNITION')
      .map((row) => text(row.id));
    const translationIds = pageRows
      .filter((row) => row.activity_type === 'TRANSCRIPT_TRANSLATION')
      .map((row) => text(row.id));
    const articleRows = rowsById(this.storage.db, 'video_document_generation_runs', articleIds);
    const transcriptionRows = rowsById(this.storage.db, 'video_document_transcription_runs', transcriptionIds);
    const translationRows = rowsById(this.storage.db, 'video_document_translation_runs', translationIds);

    return {
      items: pageRows.map((row): VideoDocumentAiActivityDto => {
        const id = text(row.id);
        const source = {
          documentTitle: text(row.document_title),
          albumId: row.album_id ? text(row.album_id) : null,
        };
        if (row.activity_type === 'ARTICLE_GENERATION') {
          const run = articleRows.get(id);
          if (!run) throw new Error('Video document article activity is unavailable');
          return { type: 'ARTICLE_GENERATION', ...source, run: videoDocumentGenerationRunDto(run) };
        }
        if (row.activity_type === 'TRANSCRIPT_RECOGNITION') {
          const run = transcriptionRows.get(id);
          if (!run) throw new Error('Video document transcription activity is unavailable');
          return { type: 'TRANSCRIPT_RECOGNITION', ...source, run: videoDocumentTranscriptionRunDto(run) };
        }
        const run = translationRows.get(id);
        if (!run) throw new Error('Video document translation activity is unavailable');
        return { type: 'TRANSCRIPT_TRANSLATION', ...source, run: videoDocumentTranslationRunDto(run) };
      }),
      nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
    };
  }
}
