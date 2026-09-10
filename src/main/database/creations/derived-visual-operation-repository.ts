import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ArticleDto, DerivedVisualAdoptInput, DerivedVisualDto, SocialPostDto } from '@/shared/contracts';
import {
  derivedVisualOperationRequestSchema,
  derivedVisualOperationSchema,
  type DerivedVisualOperationDetails,
  type DerivedVisualOperationDto,
  type DerivedVisualOperationIdentity,
  type DerivedVisualOperationRequest,
  type DerivedVisualOperationsListInput,
  type DerivedVisualOperationsPage,
  type DerivedVisualRevisionSnapshot,
} from '@/shared/contracts/derived-visual-operations';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now, text, type JsonMap } from '@/main/database/core/values';
import type { ArticleRepository } from '@/main/database/creations/article-repository';
import type { SocialPostRepository } from '@/main/database/creations/social-post-repository';
import { ArticleVisualPositionError } from '@/main/database/creations/article-inline-visual-adoption';

const visualSelectionSchema = z
  .object({ selectedImageAssetId: z.string().nullable(), adoptedAt: z.string().nullable() })
  .strict();
function visualSelection(visual: DerivedVisualDto) {
  return { selectedImageAssetId: visual.selectedImageAssetId, adoptedAt: visual.adoptedAt };
}
interface AdoptionTarget {
  article: ArticleDto | null;
  socialPost: SocialPostDto | null;
}
interface VisualAccess {
  get(id: string): DerivedVisualDto;
  apply(input: DerivedVisualAdoptInput, current: ArticleDto | SocialPostDto): AdoptionTarget;
}

/** Requests and their content writes are local to this database; history stores revision references, not body copies. */
export class DerivedVisualOperationRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly articles: ArticleRepository,
    private readonly posts: SocialPostRepository,
    private readonly visuals: VisualAccess,
  ) {}
  private get db() {
    return this.storage.db;
  }
  private row(requestId: string) {
    return this.db.prepare('SELECT * FROM derived_visual_operations WHERE request_id = ?').get(requestId) as
      JsonMap | undefined;
  }
  private dto(row: JsonMap): DerivedVisualOperationDto {
    return derivedVisualOperationSchema.parse({
      sequence: Number(row.sequence),
      request: JSON.parse(text(row.request_json)),
      status: row.status,
      target: { kind: row.target_kind, id: row.target_id },
      beforeRevisionId: row.before_revision_id,
      resultRevisionId: row.result_revision_id,
      observedRevisionId: row.observed_revision_id,
      conflictReason: row.conflict_reason,
      undoneByRequestId: row.undone_by_request_id,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    });
  }
  private scopedRow(input: DerivedVisualOperationIdentity) {
    const row = this.row(input.requestId);
    if (!row) return null;
    const request = this.dto(row).request;
    if (request.id !== input.id || request.spaceId !== input.spaceId)
      throw new Error('DERIVED_VISUAL_REQUEST_SCOPE_MISMATCH');
    return row;
  }
  list(input: DerivedVisualOperationsListInput): DerivedVisualOperationsPage {
    const rows = this.db
      .prepare(
        `SELECT * FROM derived_visual_operations WHERE visual_id = ?
      AND (? IS NULL OR sequence < ?) ORDER BY sequence DESC LIMIT ?`,
      )
      .all(input.id, input.beforeSequence, input.beforeSequence, input.limit + 1) as JsonMap[];
    const operations = rows.slice(0, input.limit).map((row) => this.dto(row));
    return { operations, nextBeforeSequence: rows.length > input.limit ? operations.at(-1)!.sequence : null };
  }
  private revision(
    target: DerivedVisualOperationDto['target'],
    revisionId: string | null,
  ): DerivedVisualRevisionSnapshot | null {
    if (!revisionId) return null;
    try {
      if (target.kind === 'ARTICLE')
        return { kind: 'ARTICLE', revision: this.articles.getRevision({ articleId: target.id, revisionId }) };
      return { kind: 'SOCIAL_POST', post: this.posts.getRevision(target.id, revisionId) };
    } catch {
      return null;
    }
  }
  get(input: DerivedVisualOperationIdentity): DerivedVisualOperationDetails | null {
    const row = this.scopedRow(input);
    if (!row) return null;
    const operation = this.dto(row);
    const before = this.revision(operation.target, operation.beforeRevisionId);
    return {
      operation,
      before,
      after:
        operation.resultRevisionId === operation.beforeRevisionId
          ? before
          : this.revision(operation.target, operation.resultRevisionId),
      observed: this.revision(operation.target, operation.observedRevisionId),
    };
  }
  cancel(input: DerivedVisualOperationRequest): DerivedVisualOperationDto {
    // Record cancellation even if the original IPC never arrived, preventing a delayed execution from reviving it.
    this.prepare(input);
    return this.db
      .transaction(() => {
        const row = this.row(input.requestId)!;
        if (row.status === 'PENDING')
          this.db
            .prepare(
              `UPDATE derived_visual_operations SET status = 'CANCELLED',
        finished_at = ? WHERE request_id = ? AND status = 'PENDING'`,
            )
            .run(now(), input.requestId);
        return this.dto(this.row(input.requestId)!);
      })
      .immediate();
  }
  private prepare(raw: DerivedVisualOperationRequest) {
    const request = derivedVisualOperationRequestSchema.parse(raw);
    const json = JSON.stringify(request);
    const hash = createHash('sha256').update(json).digest('hex');
    return this.db
      .transaction(() => {
        const existing = this.row(request.requestId);
        if (existing) {
          if (existing.request_hash !== hash) throw new Error('DERIVED_VISUAL_REQUEST_REUSED');
          return this.dto(existing);
        }
        if (
          this.db
            .prepare("SELECT 1 FROM derived_visual_operations WHERE visual_id = ? AND status = 'PENDING'")
            .get(request.id)
        )
          throw new Error('DERIVED_VISUAL_OPERATION_PENDING');
        const visual = this.visuals.get(request.id);
        const target = visual.articleId
          ? { kind: 'ARTICLE', id: visual.articleId }
          : { kind: 'SOCIAL_POST', id: visual.socialPostId };
        if (!target.id) throw new Error('DERIVED_VISUAL_TARGET_UNAVAILABLE');
        if (request.kind === 'UNDO') {
          const originalRow = this.row(request.adoptionRequestId);
          if (!originalRow) throw new Error('DERIVED_VISUAL_ADOPTION_UNAVAILABLE');
          const original = this.dto(originalRow);
          if (
            original.status !== 'SUCCEEDED' ||
            original.request.kind !== 'ADOPT' ||
            original.request.id !== request.id ||
            original.target.kind !== target.kind ||
            original.target.id !== target.id ||
            original.resultRevisionId !== request.expectedRevisionId
          )
            throw new Error('DERIVED_VISUAL_UNDO_IDENTITY_MISMATCH');
        }
        // Commit intent before executing it. A crash or failed content write leaves an inspectable pending request.
        this.db
          .prepare(
            `INSERT INTO derived_visual_operations (request_id, request_hash, request_json, visual_id, kind, status,
        target_kind, target_id, before_revision_id, created_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
          )
          .run(
            request.requestId,
            hash,
            json,
            request.id,
            request.kind,
            target.kind,
            target.id,
            request.expectedRevisionId,
            now(),
          );
        return this.dto(this.row(request.requestId)!);
      })
      .immediate();
  }
  execute(raw: DerivedVisualOperationRequest): DerivedVisualOperationDto {
    const prepared = this.prepare(raw);
    if (prepared.status !== 'PENDING') return prepared;
    return this.db
      .transaction(() => {
        const operation = this.dto(this.row(prepared.request.requestId)!);
        if (operation.status !== 'PENDING') return operation;
        const request = operation.request;
        const current =
          operation.target.kind === 'ARTICLE'
            ? this.articles.get(operation.target.id)
            : this.posts.get(operation.target.id);
        if (current.status !== 'ACTIVE') throw new Error('DERIVED_VISUAL_TARGET_UNAVAILABLE');
        if (current.revisionId !== request.expectedRevisionId)
          return this.conflict(operation, current.revisionId, 'TARGET_CHANGED');
        const beforeVisual = this.visuals.get(request.id);
        let resultRevisionId: string;
        if (request.kind === 'ADOPT') {
          const { kind: _kind, ...adopt } = request;
          let target: AdoptionTarget;
          try {
            target = this.visuals.apply(adopt, current);
          } catch (reason) {
            if (reason instanceof ArticleVisualPositionError)
              return this.conflict(operation, current.revisionId, 'VISUAL_CHANGED');
            throw reason;
          }
          const result = target.article ?? target.socialPost;
          if (!result) throw new Error('DERIVED_VISUAL_TARGET_UNAVAILABLE');
          resultRevisionId = result.revisionId;
        } else {
          const originalRow = this.row(request.adoptionRequestId)!;
          const original = this.dto(originalRow);
          if (original.undoneByRequestId) return this.conflict(operation, current.revisionId, 'ALREADY_UNDONE');
          // A later successful adoption also protects a deliberate no-op that did not produce a new content revision.
          const later = this.db
            .prepare(
              `SELECT 1 FROM derived_visual_operations WHERE target_kind = ? AND target_id = ?
          AND sequence > ? AND status = 'SUCCEEDED' LIMIT 1`,
            )
            .get(operation.target.kind, operation.target.id, original.sequence);
          if (later) return this.conflict(operation, current.revisionId, 'TARGET_CHANGED');
          const afterSelection = visualSelectionSchema.parse(JSON.parse(text(originalRow.after_visual_json)));
          if (JSON.stringify(visualSelection(beforeVisual)) !== JSON.stringify(afterSelection))
            return this.conflict(operation, current.revisionId, 'VISUAL_CHANGED');
          resultRevisionId = this.restoreBefore(original, current, request.requestId);
          const previousSelection = visualSelectionSchema.parse(JSON.parse(text(originalRow.before_visual_json)));
          this.db
            .prepare(
              'UPDATE derived_visuals SET selected_image_asset_id = ?, adopted_at = ?, updated_at = ? WHERE id = ?',
            )
            .run(previousSelection.selectedImageAssetId, previousSelection.adoptedAt, now(), request.id);
          this.db
            .prepare('UPDATE derived_visual_operations SET undone_by_request_id = ? WHERE request_id = ?')
            .run(request.requestId, request.adoptionRequestId);
          this.storage.recordChange('DERIVED_VISUAL', request.id, 'UNDO_ADOPTION', {
            requestId: request.requestId,
            adoptionRequestId: request.adoptionRequestId,
            resultRevisionId,
          });
        }
        this.db
          .prepare(
            `UPDATE derived_visual_operations SET status = 'SUCCEEDED', result_revision_id = ?,
        before_visual_json = ?, after_visual_json = ?, finished_at = ? WHERE request_id = ?`,
          )
          .run(
            resultRevisionId,
            JSON.stringify(visualSelection(beforeVisual)),
            JSON.stringify(visualSelection(this.visuals.get(request.id))),
            now(),
            request.requestId,
          );
        return this.dto(this.row(request.requestId)!);
      })
      .immediate();
  }
  private conflict(
    operation: DerivedVisualOperationDto,
    revisionId: string,
    reason: DerivedVisualOperationDto['conflictReason'],
  ) {
    this.db
      .prepare(
        `UPDATE derived_visual_operations SET status = 'CONFLICT', observed_revision_id = ?,
      conflict_reason = ?, finished_at = ? WHERE request_id = ?`,
      )
      .run(revisionId, reason, now(), operation.request.requestId);
    return this.dto(this.row(operation.request.requestId)!);
  }
  private restoreBefore(original: DerivedVisualOperationDto, current: ArticleDto | SocialPostDto, requestId: string) {
    if (original.target.kind === 'ARTICLE') {
      const revision = this.articles.getRevision({ articleId: current.id, revisionId: original.beforeRevisionId });
      const { mediaAssets: _assets, ...content } = revision.content;
      return this.articles.saveSystemRevision({
        articleId: current.id,
        expectedRevisionId: current.revisionId,
        requestId,
        content,
        elements: revision.elements,
      }).revisionId;
    }
    const before = this.posts.getRevision(current.id, original.beforeRevisionId);
    const { mediaAssets: _assets, ...content } = before.content;
    return this.posts.save({
      id: current.id,
      expectedRevisionId: current.revisionId,
      albumId: current.albumId,
      sourceInspirationStashId: current.sourceInspirationStashId,
      consumeCreationDraftId: null,
      content,
    }).revisionId;
  }
}
