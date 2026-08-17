import { createHash } from 'node:crypto';
import path from 'node:path';
import { ulid } from 'ulid';
import type {
  VideoDocumentBranchDto,
  VideoDocumentAiActivitiesListInput,
  VideoDocumentAiActivitiesPage,
  VideoDocumentAudioInfo,
  VideoDocumentCreateInput,
  VideoDocumentDto,
  VideoDocumentGenerationRunsListInput,
  VideoDocumentGenerationRunsPage,
  VideoDocumentListInput,
  VideoDocumentListPageDto,
  VideoDocumentMoveInput,
  VideoDocumentNavigationListInput,
  VideoDocumentNavigationPage,
  VideoDocumentNavigationReorderInput,
  VideoDocumentRenameInput,
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
  VideoDocumentRevisionOrigin,
  VideoDocumentRevisionSaveInput,
  VideoDocumentSourceReplaceInput,
  VideoDocumentTokenUsage,
} from '@/shared/contracts';
import {
  VIDEO_DOCUMENT_SOURCE_REPLACEMENT_MAX_DURATION_DELTA_MS,
  videoDocumentRevisionContentSchema,
} from '@/shared/contracts/video-document';
import { VideoDocumentGenerationRunRepository } from '@/main/database/video-documents/video-document-generation-run-repository';
import { VideoDocumentAiActivityRepository } from '@/main/database/video-documents/video-document-ai-activity-repository';
import { VideoDocumentNavigationRepository } from '@/main/database/video-documents/video-document-navigation-repository';
import { VideoDocumentTranscriptionRunRepository } from '@/main/database/video-documents/video-document-transcription-run-repository';
import { VideoDocumentTranslationRepository } from '@/main/database/video-documents/video-document-translation-repository';
import {
  decodeVideoDocumentCursor,
  encodeVideoDocumentCursor,
  escapeVideoDocumentLikePattern,
  videoDocumentFileStem,
} from '@/main/database/video-documents/video-document-list-values';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/core/values';
import { videoDocumentSelect, videoDocumentSummaryDto } from '@/main/database/video-documents/video-document-values';

function parseRevisionContent(value: unknown) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(value));
  } catch {
    throw new Error('Document revision content is invalid');
  }
  return videoDocumentRevisionContentSchema.parse(parsed);
}

export class VideoDocumentRepository {
  private readonly generationRuns: VideoDocumentGenerationRunRepository;
  private readonly navigation: VideoDocumentNavigationRepository;
  private readonly aiActivities: VideoDocumentAiActivityRepository;
  private readonly transcriptionRuns: VideoDocumentTranscriptionRunRepository;
  private readonly translations: VideoDocumentTranslationRepository;

  constructor(private readonly storage: LibraryStorage) {
    this.generationRuns = new VideoDocumentGenerationRunRepository(storage);
    this.navigation = new VideoDocumentNavigationRepository(storage);
    this.aiActivities = new VideoDocumentAiActivityRepository(storage);
    this.transcriptionRuns = new VideoDocumentTranscriptionRunRepository(storage);
    this.translations = new VideoDocumentTranslationRepository(storage, {
      write: (input) => this.writeRevision(input, 'AGENT'),
      read: (branchId, revisionId) => this.readSavedRevision(branchId, revisionId),
    });
  }

  private get db() {
    return this.storage.db;
  }

  list(input: VideoDocumentListInput): VideoDocumentListPageDto {
    const cursor = decodeVideoDocumentCursor(input.cursor);
    const query = input.query?.trim().toLocaleLowerCase() ?? '';
    const conditions = ['document.deleted_at IS NULL'];
    const parameters: unknown[] = [];
    if (query) {
      const pattern = `%${escapeVideoDocumentLikePattern(query)}%`;
      conditions.push(`(
        LOWER(document.title) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(metadata.display_name, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(metadata.original_name, '')) LIKE ? ESCAPE '\\'
      )`);
      parameters.push(pattern, pattern, pattern);
    }
    if (input.albumId && input.includeDescendants !== false) {
      conditions.push(`placement.album_id IN (
          WITH RECURSIVE projected_albums(id) AS (
            SELECT id FROM albums WHERE id = ? AND deleted_at IS NULL
            UNION
            SELECT member.target_id
            FROM album_members member
            JOIN projected_albums parent ON parent.id = member.album_id
            JOIN albums child ON child.id = member.target_id AND child.deleted_at IS NULL
            WHERE member.target_type = 'ALBUM' AND member.deleted_at IS NULL
          )
          SELECT id FROM projected_albums
        )`);
      parameters.push(input.albumId);
    } else if (input.albumId) {
      conditions.push('placement.album_id = ?');
      parameters.push(input.albumId);
    } else if (input.unfiledOnly) {
      conditions.push('placement.album_id IS NULL');
    }
    const countConditions = [...conditions];
    const countParameters = [...parameters];
    if (cursor) {
      conditions.push('(document.updated_at < ? OR (document.updated_at = ? AND document.id < ?))');
      parameters.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const limit = input.limit ?? 40;
    const rows = this.db
      .prepare(
        `${videoDocumentSelect}
        WHERE ${conditions.join(' AND ')}
        ORDER BY document.updated_at DESC, document.id DESC
        LIMIT ?`,
      )
      .all(...parameters, limit + 1) as JsonMap[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM (${videoDocumentSelect} WHERE ${countConditions.join(' AND ')}) listed`)
      .get(...countParameters) as JsonMap;
    return {
      items: pageRows.map(videoDocumentSummaryDto),
      total: Number(countRow.total),
      nextCursor:
        hasMore && last ? encodeVideoDocumentCursor({ updatedAt: text(last.updated_at), id: text(last.id) }) : null,
    };
  }

  listAiActivities(input: VideoDocumentAiActivitiesListInput): VideoDocumentAiActivitiesPage {
    return this.aiActivities.list(input);
  }

  listNavigation(input: VideoDocumentNavigationListInput): VideoDocumentNavigationPage {
    return this.navigation.list(input);
  }

  reorderNavigation(input: VideoDocumentNavigationReorderInput) {
    return this.navigation.reorder(input);
  }

  listGenerationRuns(input: VideoDocumentGenerationRunsListInput): VideoDocumentGenerationRunsPage {
    return this.generationRuns.list(input);
  }

  recordStoppedTranscription(input: Parameters<VideoDocumentTranscriptionRunRepository['recordStopped']>[0]) {
    return this.transcriptionRuns.recordStopped(input);
  }

  startTranscription(input: Parameters<VideoDocumentTranscriptionRunRepository['start']>[0]) {
    return this.transcriptionRuns.start(input);
  }

  updateTranscriptionProgress(input: Parameters<VideoDocumentTranscriptionRunRepository['updateProgress']>[0]) {
    return this.transcriptionRuns.updateProgress(input);
  }

  completeTranscription(input: Parameters<VideoDocumentTranscriptionRunRepository['complete']>[0]) {
    return this.transcriptionRuns.complete(input);
  }

  failTranscription(input: Parameters<VideoDocumentTranscriptionRunRepository['fail']>[0]) {
    return this.transcriptionRuns.fail(input);
  }

  interruptRunningTranscriptions() {
    return this.transcriptionRuns.interruptRunning();
  }

  startTranslation(input: Parameters<VideoDocumentTranslationRepository['start']>[0]) {
    return this.translations.start(input);
  }

  updateTranslationProgress(input: Parameters<VideoDocumentTranslationRepository['updateProgress']>[0]) {
    return this.translations.updateProgress(input);
  }

  commitTranslation(input: Parameters<VideoDocumentTranslationRepository['commit']>[0]) {
    return this.translations.commit(input);
  }

  failTranslation(input: Parameters<VideoDocumentTranslationRepository['fail']>[0]) {
    return this.translations.fail(input);
  }

  interruptRunningTranslations() {
    return this.translations.interruptRunning();
  }

  recordStoppedGeneration(input: {
    documentId: string;
    branchId: string;
    inputRevisionId: string | null;
    requestedModel: string;
    status: 'BLOCKED' | 'NOT_STARTED';
    reason: unknown;
  }) {
    return this.generationRuns.recordStopped(input);
  }

  get(documentId: string): VideoDocumentDto {
    const row = this.db
      .prepare(`${videoDocumentSelect} WHERE document.id = ? AND document.deleted_at IS NULL`)
      .get(documentId) as JsonMap | undefined;
    if (!row) throw new Error('Document not found');
    return { ...videoDocumentSummaryDto(row), branches: this.branchDtos(documentId) };
  }

  create(input: VideoDocumentCreateInput): VideoDocumentDto {
    const existing = this.db
      .prepare(
        `SELECT document.id
        FROM document_source_relations source
        JOIN documents document ON document.id = source.document_id AND document.deleted_at IS NULL
        WHERE source.material_id = ? AND source.role = 'PRIMARY_VIDEO'
        ORDER BY document.updated_at DESC, document.id DESC
        LIMIT 1`,
      )
      .get(input.videoMaterialId) as JsonMap | undefined;
    if (existing) return this.get(text(existing.id));

    const source = this.db
      .prepare(
        `SELECT material.id, asset.id AS asset_id,
          metadata.display_name, metadata.original_name
        FROM materials material
        JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
        JOIN video_assets video ON video.image_asset_id = asset.id
        LEFT JOIN external_material_metadata metadata ON metadata.material_id = material.id
        WHERE material.id = ? AND material.kind = 'VIDEO' AND material.deleted_at IS NULL`,
      )
      .get(input.videoMaterialId) as JsonMap | undefined;
    if (!source) throw new Error('Video material not found');
    const fallbackName = text(source.display_name) || text(source.original_name);
    const title =
      (input.title ?? '').trim() ||
      videoDocumentFileStem(fallbackName) ||
      (input.titleLocale === 'zh' ? '视频文稿' : 'Video document');

    const documentId = this.db
      .transaction(() => {
        const timestamp = now();
        if (input.albumId) this.requireAlbum(input.albumId);
        const id = ulid();
        this.db
          .prepare(
            `INSERT INTO documents
            (id, origin, title, title_locale, status, created_at, updated_at, archived_at, deleted_at)
            VALUES (?, 'VIDEO', ?, ?, 'ACTIVE', ?, ?, NULL, NULL)`,
          )
          .run(id, title, input.titleLocale, timestamp, timestamp);
        const sourceRelationId = ulid();
        this.db
          .prepare(
            `INSERT INTO document_source_relations(id, document_id, material_id, role, created_at)
            VALUES (?, ?, ?, 'PRIMARY_VIDEO', ?)`,
          )
          .run(sourceRelationId, id, input.videoMaterialId, timestamp);
        this.storage.recordChange('DOCUMENT', id, 'CREATE', {
          origin: 'VIDEO',
          sourceMaterialId: input.videoMaterialId,
        });
        this.storage.recordChange('DOCUMENT_SOURCE_RELATION', sourceRelationId, 'CREATE', {
          documentId: id,
          materialId: input.videoMaterialId,
          role: 'PRIMARY_VIDEO',
        });
        this.createBranch(id, 'CLEAN_TRANSCRIPT', 'NONE', timestamp);
        this.createBranch(id, 'ARTICLE', 'NONE', timestamp);
        this.createBranch(id, 'NOTES', 'NONE', timestamp);
        if (input.albumId) this.placeDocument(id, input.albumId, timestamp);
        return id;
      })
      .immediate();
    return this.get(documentId);
  }

  rename(input: VideoDocumentRenameInput): VideoDocumentDto {
    const title = input.title.trim();
    const updatedAt = now();
    const result = this.db
      .prepare('UPDATE documents SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(title, updatedAt, input.documentId);
    if (!result.changes) throw new Error('Document not found');
    this.storage.recordChange('DOCUMENT', input.documentId, 'UPDATE', { title });
    return this.get(input.documentId);
  }

  move(input: VideoDocumentMoveInput): VideoDocumentDto {
    this.db
      .transaction(() => {
        this.requireDocument(input.documentId);
        if (input.albumId) this.requireAlbum(input.albumId);
        const timestamp = now();
        const current = this.db
          .prepare(
            `SELECT id, album_id FROM album_members
            WHERE target_type = 'DOCUMENT' AND target_id = ? AND deleted_at IS NULL`,
          )
          .get(input.documentId) as JsonMap | undefined;
        if ((current ? text(current.album_id) : null) === input.albumId) return;
        if (current) {
          const memberId = text(current.id);
          const oldAlbumId = text(current.album_id);
          this.db
            .prepare('UPDATE album_members SET deleted_at = ?, updated_at = ? WHERE id = ?')
            .run(timestamp, timestamp, memberId);
          this.db
            .prepare("INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')")
            .run(ulid(), memberId, timestamp);
          this.storage.recordChange('ALBUM_MEMBER', memberId, 'DELETE', {
            albumId: oldAlbumId,
            targetType: 'DOCUMENT',
            targetId: input.documentId,
            movedToAlbumId: input.albumId,
          });
          this.db
            .prepare('UPDATE albums SET content_updated_at = ?, updated_at = ? WHERE id = ?')
            .run(timestamp, timestamp, oldAlbumId);
        }
        if (input.albumId) this.placeDocument(input.documentId, input.albumId, timestamp);
        this.db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run(timestamp, input.documentId);
        this.storage.recordChange('DOCUMENT', input.documentId, 'MOVE', { albumId: input.albumId });
      })
      .immediate();
    return this.get(input.documentId);
  }

  replaceSource(input: VideoDocumentSourceReplaceInput): VideoDocumentDto {
    const document = this.get(input.documentId);
    if (document.source.materialId === input.videoMaterialId) return document;

    const replacement = this.db
      .prepare(
        `SELECT material.id, asset.id AS asset_id, asset.width, asset.height, video.duration_ms
        FROM materials material
        JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
        JOIN video_assets video ON video.image_asset_id = asset.id
        WHERE material.id = ? AND material.kind = 'VIDEO' AND material.deleted_at IS NULL`,
      )
      .get(input.videoMaterialId) as JsonMap | undefined;
    if (!replacement) throw new Error('VIDEO_DOCUMENT_SOURCE_REPLACEMENT_NOT_FOUND');

    const replacementDurationMs = Number(replacement.duration_ms);
    if (
      Number(replacement.width) !== document.source.asset.width ||
      Number(replacement.height) !== document.source.asset.height ||
      Math.abs(replacementDurationMs - document.source.asset.durationMs) >
        VIDEO_DOCUMENT_SOURCE_REPLACEMENT_MAX_DURATION_DELTA_MS
    ) {
      throw new Error('VIDEO_DOCUMENT_SOURCE_REPLACEMENT_INCOMPATIBLE');
    }

    const conflictingDocument = this.db
      .prepare(
        `SELECT source.document_id
        FROM document_source_relations source
        JOIN documents document ON document.id = source.document_id AND document.deleted_at IS NULL
        WHERE source.material_id = ? AND source.role = 'PRIMARY_VIDEO' AND source.document_id <> ?
        LIMIT 1`,
      )
      .get(input.videoMaterialId, input.documentId) as JsonMap | undefined;
    if (conflictingDocument) throw new Error('VIDEO_DOCUMENT_SOURCE_REPLACEMENT_ALREADY_USED');

    this.db
      .transaction(() => {
        const runningGeneration = this.db
          .prepare("SELECT 1 FROM video_document_generation_runs WHERE document_id = ? AND status = 'RUNNING' LIMIT 1")
          .get(input.documentId);
        if (runningGeneration) throw new Error('VIDEO_DOCUMENT_GENERATION_BUSY');
        const timestamp = now();
        const result = this.db
          .prepare(
            `UPDATE document_source_relations SET material_id = ?
            WHERE id = ? AND document_id = ? AND role = 'PRIMARY_VIDEO' AND material_id = ?`,
          )
          .run(input.videoMaterialId, document.source.relationId, input.documentId, document.source.materialId);
        if (result.changes !== 1) throw new Error('VIDEO_DOCUMENT_SOURCE_REPLACEMENT_CONFLICT');
        this.db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run(timestamp, input.documentId);
        this.storage.recordChange('DOCUMENT_SOURCE_RELATION', document.source.relationId, 'REPLACE', {
          documentId: input.documentId,
          previousMaterialId: document.source.materialId,
          materialId: input.videoMaterialId,
        });
        this.storage.recordChange('DOCUMENT', input.documentId, 'SOURCE_REPLACE', {
          previousAssetId: document.source.asset.id,
          assetId: text(replacement.asset_id),
        });
      })
      .immediate();
    return this.get(input.documentId);
  }

  getLatestRevision(branchId: string): VideoDocumentRevisionDto | null {
    const row = this.db
      .prepare(
        `SELECT revision.*, draft.branch_id
        FROM document_drafts draft
        JOIN document_branches branch ON branch.id = draft.branch_id AND branch.deleted_at IS NULL
        JOIN document_draft_revisions revision ON revision.draft_id = draft.id
        WHERE draft.branch_id = ? AND draft.deleted_at IS NULL
        ORDER BY revision.revision_no DESC
        LIMIT 1`,
      )
      .get(branchId) as JsonMap | undefined;
    return row ? this.revisionDto(row) : null;
  }

  getRevision(branchId: string, revisionId: string): VideoDocumentRevisionDto | null {
    const row = this.db
      .prepare(
        `SELECT revision.*, draft.branch_id
        FROM document_drafts draft
        JOIN document_branches branch ON branch.id = draft.branch_id AND branch.deleted_at IS NULL
        JOIN document_draft_revisions revision ON revision.draft_id = draft.id
        WHERE draft.branch_id = ? AND draft.deleted_at IS NULL AND revision.id = ?
        LIMIT 1`,
      )
      .get(branchId, revisionId) as JsonMap | undefined;
    return row ? this.revisionDto(row) : null;
  }

  private revisionDto(row: JsonMap): VideoDocumentRevisionDto {
    const content = parseRevisionContent(row.content_json);
    const assetIds = this.revisionAssetIds(content);
    return {
      id: text(row.id),
      branchId: text(row.branch_id),
      draftId: text(row.draft_id),
      parentRevisionId: row.parent_revision_id ? text(row.parent_revision_id) : null,
      revisionNo: Number(row.revision_no),
      content,
      contentHash: text(row.content_hash),
      origin: text(row.origin) as VideoDocumentRevisionOrigin,
      media: this.revisionMedia(assetIds),
      createdAt: text(row.created_at),
    };
  }

  saveRevision(
    input: VideoDocumentRevisionSaveInput,
    origin: VideoDocumentRevisionOrigin = 'HUMAN',
  ): VideoDocumentRevisionDto {
    return this.db
      .transaction(() => {
        const revisionId = this.writeRevision(input, origin);
        return this.readSavedRevision(input.branchId, revisionId);
      })
      .immediate();
  }

  private writeRevision(input: VideoDocumentRevisionSaveInput, origin: VideoDocumentRevisionOrigin) {
    const content = videoDocumentRevisionContentSchema.parse(input.content);
    const contentJson = JSON.stringify(content);
    const contentHash = createHash('sha256').update(contentJson, 'utf8').digest('hex');
    const revisionId = ulid();
    const branch = this.db
      .prepare(
        `SELECT branch.id, branch.document_id, draft.id AS draft_id
        FROM document_branches branch
        JOIN document_drafts draft ON draft.branch_id = branch.id AND draft.deleted_at IS NULL
        WHERE branch.id = ? AND branch.deleted_at IS NULL`,
      )
      .get(input.branchId) as JsonMap | undefined;
    if (!branch) throw new Error('Document branch not found');
    const current = this.db
      .prepare(
        `SELECT id, revision_no FROM document_draft_revisions
        WHERE draft_id = ? ORDER BY revision_no DESC LIMIT 1`,
      )
      .get(text(branch.draft_id)) as JsonMap | undefined;
    const parentRevisionId = current ? text(current.id) : null;
    if (parentRevisionId !== input.expectedParentRevisionId) {
      throw new Error('Document revision changed before it could be saved');
    }
    this.assertRevisionMedia(content);
    const revisionNo = current ? Number(current.revision_no) + 1 : 1;
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO document_draft_revisions
        (id, draft_id, parent_revision_id, revision_no, content_json, content_hash, origin, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId,
        text(branch.draft_id),
        parentRevisionId,
        revisionNo,
        contentJson,
        contentHash,
        origin,
        timestamp,
      );
    this.db.prepare('UPDATE document_drafts SET updated_at = ? WHERE id = ?').run(timestamp, text(branch.draft_id));
    this.db
      .prepare("UPDATE document_branches SET status = 'EDITABLE', updated_at = ? WHERE id = ?")
      .run(timestamp, input.branchId);
    this.db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run(timestamp, text(branch.document_id));
    this.storage.recordChange('DOCUMENT_DRAFT_REVISION', revisionId, 'CREATE', {
      branchId: input.branchId,
      draftId: text(branch.draft_id),
      parentRevisionId,
      revisionNo,
      contentHash,
      origin,
    });
    this.storage.recordChange('DOCUMENT_BRANCH', input.branchId, 'UPDATE', {
      status: 'EDITABLE',
      latestDraftRevisionId: revisionId,
    });
    this.storage.recordChange('DOCUMENT', text(branch.document_id), 'UPDATE', {
      latestDraftRevisionId: revisionId,
    });
    return revisionId;
  }

  private readSavedRevision(branchId: string, revisionId: string | null) {
    if (!revisionId) throw new Error('Document revision could not be saved');
    const saved = this.getLatestRevision(branchId);
    if (!saved || saved.id !== revisionId) throw new Error('Document revision could not be read after saving');
    return saved;
  }

  startArticleGeneration(input: {
    documentId: string;
    branchId: string;
    inputRevisionId: string | null;
    requestedModel: string;
  }) {
    if (
      this.db
        .prepare("SELECT 1 FROM video_document_translation_runs WHERE document_id = ? AND status = 'RUNNING' LIMIT 1")
        .get(input.documentId)
    ) {
      throw new Error('VIDEO_DOCUMENT_GENERATION_BUSY');
    }
    return this.generationRuns.start(input);
  }

  commitArticleGeneration(input: {
    documentId: string;
    thumbnailAssetId: string | null;
    revision: VideoDocumentRevisionSaveInput;
    completion: {
      runId: string;
      actualModel: string | null;
      usage: VideoDocumentTokenUsage | null;
      finishedAt: string;
    };
  }) {
    return this.db
      .transaction(() => {
        const ownership = this.db
          .prepare(
            `SELECT 1 FROM document_branches
            WHERE id = ? AND document_id = ? AND role = 'ARTICLE' AND deleted_at IS NULL`,
          )
          .get(input.revision.branchId, input.documentId);
        if (!ownership) throw new Error('VIDEO_DOCUMENT_GENERATION_INPUT_CHANGED');
        const revisionId = this.writeRevision(input.revision, 'AGENT');
        if (input.thumbnailAssetId) this.upsertThumbnail(input.documentId, input.thumbnailAssetId);
        const run = this.generationRuns.completeInTransaction({
          ...input.completion,
          outputRevisionId: revisionId,
        });
        const revision = this.readSavedRevision(input.revision.branchId, revisionId);
        return { revision, run };
      })
      .immediate();
  }

  failArticleGeneration(
    runId: string,
    reason: unknown,
    providerResult: { actualModel?: string | null; usage?: VideoDocumentTokenUsage | null } = {},
  ) {
    return this.generationRuns.fail(runId, reason, providerResult);
  }

  interruptRunningGenerations() {
    return this.generationRuns.interruptRunning();
  }

  async ensurePrivateEvidenceImage(input: { documentId: string; candidateId: string; sourcePath: string }) {
    this.requireDocument(input.documentId);
    if (path.extname(input.sourcePath).toLocaleLowerCase() !== '.jpg') {
      throw new Error('VIDEO_DOCUMENT_EVIDENCE_FORMAT_UNSUPPORTED');
    }
    const stored = await this.storage.copyIntoObjectStoreAsync(input.sourcePath);
    if (stored.width <= 0 || stored.height <= 0 || stored.byteSize <= 0 || stored.byteSize > 4 * 1024 * 1024) {
      throw new Error('VIDEO_DOCUMENT_EVIDENCE_INVALID');
    }
    const existing = this.db
      .prepare(
        `SELECT id FROM image_assets
        WHERE object_hash = ? AND mime_type = 'image/jpeg' AND deleted_at IS NULL
        ORDER BY created_at, id LIMIT 1`,
      )
      .get(stored.hash) as JsonMap | undefined;
    if (existing) return text(existing.id);

    const assetId = ulid();
    // Evidence stays standalone and private to document revisions. Cross-feature consumers
    // must require a user-facing relationship instead of treating origin_type as visibility.
    this.db
      .prepare(
        `INSERT INTO image_assets
        (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
        VALUES (?, 'REFERENCE', 'VIDEO_DOCUMENT_DERIVED', ?, ?, ?, ?, 'image/jpeg', ?, ?, NULL)`,
      )
      .run(assetId, stored.hash, stored.relativePath, stored.width, stored.height, stored.byteSize, now());
    this.storage.recordChange(
      'IMAGE_ASSET',
      assetId,
      'VIDEO_DOCUMENT_DERIVE',
      { documentId: input.documentId, candidateId: input.candidateId },
      { affectsFileView: false },
    );
    return assetId;
  }

  setThumbnail(documentId: string, assetId: string) {
    this.db.transaction(() => this.upsertThumbnail(documentId, assetId)).immediate();
  }

  private upsertThumbnail(documentId: string, assetId: string) {
    const timestamp = now();
    this.requireDocument(documentId);
    const image = this.db
      .prepare("SELECT id FROM image_assets WHERE id = ? AND mime_type LIKE 'image/%' AND deleted_at IS NULL")
      .get(assetId);
    if (!image) throw new Error('VIDEO_DOCUMENT_THUMBNAIL_UNAVAILABLE');
    this.db
      .prepare(
        `INSERT INTO document_thumbnails(document_id, image_asset_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET image_asset_id = excluded.image_asset_id, updated_at = excluded.updated_at`,
      )
      .run(documentId, assetId, timestamp, timestamp);
    this.storage.recordChange('DOCUMENT_THUMBNAIL', documentId, 'UPSERT', { assetId });
  }

  private revisionAssetIds(content: VideoDocumentRevisionContent) {
    const bindings =
      content.format === 'MARKDOWN'
        ? content.mediaBindings
        : content.format === 'NOTE_COLLECTION'
          ? content.notes.flatMap((note) => note.mediaBindings)
          : [];
    return [
      ...new Set(bindings.flatMap((binding) => [binding.assetId, binding.posterAssetId].filter(Boolean) as string[])),
    ];
  }

  private assertRevisionMedia(content: VideoDocumentRevisionContent) {
    const bindings =
      content.format === 'MARKDOWN'
        ? content.mediaBindings
        : content.format === 'NOTE_COLLECTION'
          ? content.notes.flatMap((note) => note.mediaBindings)
          : [];
    const assetIds = this.revisionAssetIds(content);
    if (!assetIds.length) return;
    const rows = this.db
      .prepare(
        `SELECT id, mime_type FROM image_assets
        WHERE id IN (${assetIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
      )
      .all(...assetIds) as JsonMap[];
    const mimeTypeById = new Map(rows.map((row) => [text(row.id), text(row.mime_type)]));
    if (mimeTypeById.size !== assetIds.length) throw new Error('Document revision references unavailable media');
    for (const binding of bindings) {
      const mimeType = mimeTypeById.get(binding.assetId)!;
      if (
        (binding.kind === 'IMAGE' && !mimeType.startsWith('image/')) ||
        (binding.kind === 'VIDEO' && !mimeType.startsWith('video/'))
      ) {
        throw new Error('Document revision media kind does not match its asset');
      }
      if (binding.posterAssetId && !mimeTypeById.get(binding.posterAssetId)?.startsWith('image/')) {
        throw new Error('Document revision video poster must be an image');
      }
    }
  }

  private revisionMedia(assetIds: string[]): VideoDocumentRevisionDto['media'] {
    if (!assetIds.length) return [];
    const rows = this.db
      .prepare(
        `SELECT asset.id, asset.mime_type, asset.width, asset.height, asset.byte_size, video.duration_ms
        FROM image_assets asset
        LEFT JOIN video_assets video ON video.image_asset_id = asset.id
        WHERE asset.id IN (${assetIds.map(() => '?').join(',')}) AND asset.deleted_at IS NULL`,
      )
      .all(...assetIds) as JsonMap[];
    const rowById = new Map(rows.map((row) => [text(row.id), row]));
    return assetIds.flatMap((assetId) => {
      const row = rowById.get(assetId);
      if (!row) return [];
      return [
        {
          assetId,
          mediaUrl: mediaUrl(assetId),
          mimeType: text(row.mime_type) as VideoDocumentRevisionDto['media'][number]['mimeType'],
          width: Number(row.width),
          height: Number(row.height),
          byteSize: Number(row.byte_size),
          durationMs: row.duration_ms ? Number(row.duration_ms) : null,
        },
      ];
    });
  }

  private branchDtos(documentId: string): VideoDocumentBranchDto[] {
    const rows = this.db
      .prepare(
        `SELECT branch.*, draft.id AS draft_id,
          (SELECT revision.id FROM document_draft_revisions revision
            WHERE revision.draft_id = draft.id
            ORDER BY revision.revision_no DESC LIMIT 1) AS latest_revision_id
        FROM document_branches branch
        JOIN document_drafts draft ON draft.branch_id = branch.id AND draft.deleted_at IS NULL
        WHERE branch.document_id = ? AND branch.deleted_at IS NULL
        ORDER BY CASE branch.role
          WHEN 'CLEAN_TRANSCRIPT' THEN 0
          WHEN 'ARTICLE' THEN 1
          WHEN 'NOTES' THEN 2
          WHEN 'STORY_NO_SPOILER' THEN 3
          ELSE 4 END, branch.id`,
      )
      .all(documentId) as JsonMap[];
    return rows.map((row) => ({
      id: text(row.id),
      role: text(row.role) as VideoDocumentBranchDto['role'],
      spoilerLevel: text(row.spoiler_level) === 'FULL' ? 'FULL' : 'NONE',
      status: text(row.status) as VideoDocumentBranchDto['status'],
      draftId: text(row.draft_id),
      latestDraftRevisionId: row.latest_revision_id ? text(row.latest_revision_id) : null,
      updatedAt: text(row.updated_at),
    }));
  }

  private createBranch(
    documentId: string,
    role: VideoDocumentBranchDto['role'],
    spoilerLevel: VideoDocumentBranchDto['spoilerLevel'],
    timestamp: string,
  ) {
    const branchId = ulid();
    const draftId = ulid();
    this.db
      .prepare(
        `INSERT INTO document_branches
        (id, document_id, role, spoiler_level, status, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, 'EMPTY', ?, ?, NULL)`,
      )
      .run(branchId, documentId, role, spoilerLevel, timestamp, timestamp);
    this.db
      .prepare(
        `INSERT INTO document_drafts(id, branch_id, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, NULL)`,
      )
      .run(draftId, branchId, timestamp, timestamp);
    this.storage.recordChange('DOCUMENT_BRANCH', branchId, 'CREATE', { documentId, role, spoilerLevel });
    this.storage.recordChange('DOCUMENT_DRAFT', draftId, 'CREATE', { branchId });
  }

  private placeDocument(documentId: string, albumId: string, timestamp: string) {
    const existing = this.db
      .prepare(
        `SELECT id, deleted_at FROM album_members
        WHERE album_id = ? AND target_type = 'DOCUMENT' AND target_id = ?`,
      )
      .get(albumId, documentId) as JsonMap | undefined;
    const sortOrder = Number(
      (
        this.db
          .prepare(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM album_members WHERE album_id = ? AND deleted_at IS NULL',
          )
          .get(albumId) as JsonMap
      ).next_order,
    );
    if (existing) {
      this.db
        .prepare('UPDATE album_members SET sort_order = ?, updated_at = ?, deleted_at = NULL WHERE id = ?')
        .run(sortOrder, timestamp, text(existing.id));
      this.storage.recordChange('ALBUM_MEMBER', text(existing.id), 'RESTORE', {
        albumId,
        targetType: 'DOCUMENT',
        targetId: documentId,
      });
    } else {
      const memberId = ulid();
      this.db
        .prepare(
          `INSERT INTO album_members
          (id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
          VALUES (?, ?, 'DOCUMENT', ?, ?, ?, ?, NULL)`,
        )
        .run(memberId, albumId, documentId, sortOrder, timestamp, timestamp);
      this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
        albumId,
        targetType: 'DOCUMENT',
        targetId: documentId,
      });
    }
    this.db
      .prepare('UPDATE albums SET content_updated_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, timestamp, albumId);
  }

  updateAudioInfo(sourceAssetId: string, audio: VideoDocumentAudioInfo) {
    const result = this.db
      .prepare(
        `UPDATE video_assets SET
          audio_status = ?, audio_track_count = ?, audio_primary_codec = ?,
          audio_detected_at = ?, audio_error_code = ?
        WHERE image_asset_id = ?`,
      )
      .run(audio.status, audio.trackCount, audio.primaryCodec, audio.detectedAt, audio.errorCode, sourceAssetId);
    if (result.changes !== 1) throw new Error('VIDEO_DOCUMENT_AUDIO_ASSET_NOT_FOUND');
    this.storage.recordChange('VIDEO_ASSET', sourceAssetId, 'AUDIO_PROBE', audio, { affectsFileView: false });
  }

  private requireDocument(documentId: string) {
    const found = this.db.prepare('SELECT 1 FROM documents WHERE id = ? AND deleted_at IS NULL').get(documentId);
    if (!found) throw new Error('Document not found');
  }

  private requireAlbum(albumId: string) {
    const album = this.db.prepare('SELECT archived_at FROM albums WHERE id = ? AND deleted_at IS NULL').get(albumId) as
      JsonMap | undefined;
    if (!album) throw new Error('Album not found');
    if (album.archived_at) throw new Error('Archived albums cannot receive documents');
  }
}
