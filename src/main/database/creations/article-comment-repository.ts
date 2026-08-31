import { ulid } from 'ulid';
import {
  articleCheckCommentIdsSchema,
  articleCheckApplyInputSchema,
  articleCommentAnchorSchema,
  articleCommentModelAuthorSchema,
  articleCommentMutationInputSchema,
  articleCommentSchema,
  type ArticleCommentModelAuthor,
  type ArticleCommentDto,
  type ArticleCheckApplyInput,
  type ArticleCheckApplyResult,
  type ArticleCommentAnchorUpdateInput,
  type ArticleElementPlacementInput,
  type ArticleCommentMutationInput,
  type ArticleCommentMutationResult,
  type ArticleCommentReplyDto,
} from '@/shared/contracts/article';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';

function nullableText(value: unknown) {
  return value == null ? null : text(value);
}

function modelAuthorKey(articleId: string, commentId: string) {
  return `${articleId}\u0000${commentId}`;
}

function storedArticleCheckCommentIds(value: unknown) {
  if (typeof value !== 'string' || value.length > 25_000) {
    throw new Error('Stored article check comment identities are invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Stored article check comment identities are invalid');
  }
  const result = articleCheckCommentIdsSchema.safeParse(parsed);
  if (!result.success) throw new Error('Stored article check comment identities are invalid');
  return result.data;
}

function replyDto(row: JsonMap): ArticleCommentReplyDto {
  return {
    id: text(row.id),
    commentId: text(row.comment_id),
    body: text(row.body),
    authorId: nullableText(row.author_id),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function commentDto(
  row: JsonMap,
  replies: readonly ArticleCommentReplyDto[],
  targetResolution: ArticleCommentDto['targetResolution'],
  modelAuthor: ArticleCommentModelAuthor | null,
) {
  return articleCommentSchema.parse({
    id: text(row.id),
    articleId: text(row.article_id),
    createdRevisionId: text(row.created_revision_id),
    status: text(row.status),
    targetResolution,
    anchor: {
      kind: text(row.anchor_kind),
      startElementId: text(row.start_element_id),
      startOffset: Number(row.start_offset),
      endElementId: text(row.end_element_id),
      endOffset: Number(row.end_offset),
      startBlockIndex: Number(row.start_block_index),
      endBlockIndex: Number(row.end_block_index),
      exactQuote: text(row.exact_quote),
      prefix: text(row.prefix),
      suffix: text(row.suffix),
    },
    preview: text(row.created_preview),
    body: text(row.body),
    authorId: nullableText(row.author_id),
    modelAuthor,
    replies,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    resolvedAt: nullableText(row.resolved_at),
  });
}

export class ArticleCommentRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  private modelAuthors(articleIds: readonly string[]) {
    const authors = new Map<string, ArticleCommentModelAuthor>();
    for (let offset = 0; offset < articleIds.length; offset += 400) {
      const chunk = articleIds.slice(offset, offset + 400);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = this.db
        .prepare(
          `SELECT article_id, provider_key, requested_model, comment_ids_json
          FROM article_check_runs
          WHERE article_id IN (${placeholders}) AND status = 'SUCCEEDED' AND applied_at IS NOT NULL
          ORDER BY applied_at, id`,
        )
        .all(...chunk) as JsonMap[];
      for (const row of rows) {
        const articleId = text(row.article_id);
        const author = articleCommentModelAuthorSchema.parse({
          providerKey: text(row.provider_key),
          modelId: text(row.requested_model),
        });
        for (const commentId of storedArticleCheckCommentIds(row.comment_ids_json)) {
          const key = modelAuthorKey(articleId, commentId);
          if (authors.has(key)) throw new Error('Stored article check comment ownership is invalid');
          authors.set(key, author);
        }
      }
    }
    return authors;
  }

  list(articleId: string, revisionId: string): ArticleCommentDto[] {
    const modelAuthors = this.modelAuthors([articleId]);
    const replies = (
      this.db
        .prepare(
          `SELECT reply.*
          FROM article_comment_replies reply
          JOIN article_comments comment ON comment.id = reply.comment_id
          WHERE comment.article_id = ?
          ORDER BY reply.created_at, reply.id`,
        )
        .all(articleId) as JsonMap[]
    ).map(replyDto);
    const repliesByComment = new Map<string, ArticleCommentReplyDto[]>();
    for (const reply of replies) {
      const existing = repliesByComment.get(reply.commentId);
      if (existing) existing.push(reply);
      else repliesByComment.set(reply.commentId, [reply]);
    }
    return (
      this.db
        .prepare(
          `SELECT comment.*,
            start_placement.element_id AS available_start_element_id,
            end_placement.element_id AS available_end_element_id,
            EXISTS (
              SELECT 1 FROM article_revision_elements any_placement
              WHERE any_placement.revision_id = ? AND any_placement.article_id = comment.article_id
            ) AS has_any_placement
          FROM article_comments comment
          LEFT JOIN article_revision_elements start_placement
            ON start_placement.revision_id = ? AND start_placement.article_id = comment.article_id
              AND start_placement.element_id = comment.start_element_id
          LEFT JOIN article_revision_elements end_placement
            ON end_placement.revision_id = ? AND end_placement.article_id = comment.article_id
              AND end_placement.element_id = comment.end_element_id
          WHERE comment.article_id = ?
          ORDER BY CASE comment.status WHEN 'OPEN' THEN 0 ELSE 1 END,
            comment.updated_at DESC, comment.id`,
        )
        .all(revisionId, revisionId, revisionId, articleId) as JsonMap[]
    ).map((row) =>
      commentDto(
        row,
        repliesByComment.get(text(row.id)) ?? [],
        row.available_start_element_id != null && row.available_end_element_id != null
          ? 'AVAILABLE'
          : Number(row.has_any_placement)
            ? 'RELOCATED'
            : 'MISSING',
        modelAuthors.get(modelAuthorKey(articleId, text(row.id))) ?? null,
      ),
    );
  }

  listMany(
    revisions: readonly { articleId: string; revisionId: string }[],
    placementsByRevision: ReadonlyMap<string, readonly ArticleElementPlacementInput[]>,
  ) {
    const commentsByArticle = new Map<string, ArticleCommentDto[]>(revisions.map(({ articleId }) => [articleId, []]));
    if (!revisions.length) return commentsByArticle;
    const revisionByArticle = new Map(revisions.map(({ articleId, revisionId }) => [articleId, revisionId]));
    const elementIdsByRevision = new Map(
      revisions.map(({ revisionId }) => [
        revisionId,
        new Set((placementsByRevision.get(revisionId) ?? []).map(({ elementId }) => elementId)),
      ]),
    );
    const articleIds = [...revisionByArticle.keys()];
    const modelAuthors = this.modelAuthors(articleIds);
    const repliesByComment = new Map<string, ArticleCommentReplyDto[]>();
    const commentRows: JsonMap[] = [];
    for (let offset = 0; offset < articleIds.length; offset += 400) {
      const chunk = articleIds.slice(offset, offset + 400);
      const placeholders = chunk.map(() => '?').join(', ');
      const replies = this.db
        .prepare(
          `SELECT reply.*
          FROM article_comment_replies reply
          JOIN article_comments comment ON comment.id = reply.comment_id
          WHERE comment.article_id IN (${placeholders})
          ORDER BY comment.article_id, reply.created_at, reply.id`,
        )
        .all(...chunk) as JsonMap[];
      for (const row of replies) {
        const reply = replyDto(row);
        const existing = repliesByComment.get(reply.commentId);
        if (existing) existing.push(reply);
        else repliesByComment.set(reply.commentId, [reply]);
      }
      commentRows.push(
        ...(this.db
          .prepare(
            `SELECT comment.* FROM article_comments comment
            WHERE comment.article_id IN (${placeholders})
            ORDER BY comment.article_id, CASE comment.status WHEN 'OPEN' THEN 0 ELSE 1 END,
              comment.updated_at DESC, comment.id`,
          )
          .all(...chunk) as JsonMap[]),
      );
    }
    for (const row of commentRows) {
      const articleId = text(row.article_id);
      const revisionId = revisionByArticle.get(articleId);
      if (!revisionId) throw new Error('Article comment revision projection is unavailable');
      const elementIds = elementIdsByRevision.get(revisionId) ?? new Set<string>();
      const targetResolution =
        elementIds.has(text(row.start_element_id)) && elementIds.has(text(row.end_element_id))
          ? 'AVAILABLE'
          : elementIds.size
            ? 'RELOCATED'
            : 'MISSING';
      commentsByArticle
        .get(articleId)!
        .push(
          commentDto(
            row,
            repliesByComment.get(text(row.id)) ?? [],
            targetResolution,
            modelAuthors.get(modelAuthorKey(articleId, text(row.id))) ?? null,
          ),
        );
    }
    return commentsByArticle;
  }

  updateAnchors(articleId: string, updates: readonly ArticleCommentAnchorUpdateInput[]) {
    if (new Set(updates.map((update) => update.commentId)).size !== updates.length) {
      throw new Error('Article comment anchor identities must be unique');
    }
    for (const update of updates) {
      const anchor = articleCommentAnchorSchema.parse(update.anchor);
      const result = this.db
        .prepare(
          `UPDATE article_comments SET
            anchor_kind = ?, start_element_id = ?, start_offset = ?,
            end_element_id = ?, end_offset = ?, start_block_index = ?, end_block_index = ?,
            exact_quote = ?, prefix = ?, suffix = ?
          WHERE id = ? AND article_id = ?`,
        )
        .run(
          anchor.kind,
          anchor.startElementId,
          anchor.startOffset,
          anchor.endElementId,
          anchor.endOffset,
          anchor.startBlockIndex,
          anchor.endBlockIndex,
          anchor.exactQuote,
          anchor.prefix,
          anchor.suffix,
          update.commentId,
          articleId,
        );
      if (result.changes !== 1) throw new Error('Article comment changed before its anchor could be saved');
    }
  }

  mutate(rawInput: ArticleCommentMutationInput): ArticleCommentMutationResult {
    const input = articleCommentMutationInputSchema.parse(rawInput);
    const operation = () => {
      const article = this.db
        .prepare(
          `SELECT current_revision_id FROM articles
          WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`,
        )
        .get(input.articleId) as JsonMap | undefined;
      if (!article) throw new Error('Article is no longer available');
      const revisionId = text(article.current_revision_id);
      const timestamp = now();
      let entityId = input.operation === 'CREATE' ? ulid() : input.commentId;
      if (input.operation === 'CREATE') {
        if (revisionId !== input.expectedRevisionId) {
          throw new Error('The article changed before its comment could be added');
        }
        const anchor = articleCommentAnchorSchema.parse(input.anchor);
        this.db
          .prepare(
            `INSERT INTO article_comments (
              id, article_id, created_revision_id, status, anchor_kind,
              start_element_id, start_offset, end_element_id, end_offset,
              start_block_index, end_block_index, exact_quote, prefix, suffix,
              created_preview, body, author_id, created_at, updated_at, resolved_at
            ) VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
          )
          .run(
            entityId,
            input.articleId,
            revisionId,
            anchor.kind,
            anchor.startElementId,
            anchor.startOffset,
            anchor.endElementId,
            anchor.endOffset,
            anchor.startBlockIndex,
            anchor.endBlockIndex,
            anchor.exactQuote,
            anchor.prefix,
            anchor.suffix,
            input.preview,
            input.body,
            timestamp,
            timestamp,
          );
      } else {
        this.assertComment(input.articleId, input.commentId);
        if (input.operation === 'UPDATE_BODY') {
          this.db
            .prepare('UPDATE article_comments SET body = ?, updated_at = ? WHERE id = ? AND article_id = ?')
            .run(input.body, timestamp, input.commentId, input.articleId);
        } else if (input.operation === 'SET_STATUS') {
          this.db
            .prepare(
              `UPDATE article_comments
              SET status = ?, resolved_at = ?, updated_at = ?
              WHERE id = ? AND article_id = ?`,
            )
            .run(input.status, input.status === 'OPEN' ? null : timestamp, timestamp, input.commentId, input.articleId);
        } else if (input.operation === 'ADD_REPLY') {
          const body = input.body.trim();
          if (!body) throw new Error('Comment replies cannot be empty');
          entityId = ulid();
          this.db
            .prepare(
              `INSERT INTO article_comment_replies
              (id, comment_id, body, author_id, created_at, updated_at)
              VALUES (?, ?, ?, NULL, ?, ?)`,
            )
            .run(entityId, input.commentId, body, timestamp, timestamp);
          this.db
            .prepare('UPDATE article_comments SET updated_at = ? WHERE id = ? AND article_id = ?')
            .run(timestamp, input.commentId, input.articleId);
        } else {
          this.db
            .prepare('DELETE FROM article_comments WHERE id = ? AND article_id = ?')
            .run(input.commentId, input.articleId);
        }
      }
      this.storage.recordChange(
        'ARTICLE_COMMENT',
        entityId,
        input.operation,
        { articleId: input.articleId, revisionId },
        { affectsFileView: false },
      );
      return { articleId: input.articleId, revisionId, comments: this.list(input.articleId, revisionId) };
    };
    return this.db.inTransaction ? operation() : this.db.transaction(operation).immediate();
  }

  createMany(rawInput: ArticleCheckApplyInput): ArticleCheckApplyResult {
    const input = articleCheckApplyInputSchema.parse(rawInput);
    const operation = () => {
      const article = this.db
        .prepare(
          `SELECT current_revision_id FROM articles
          WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`,
        )
        .get(input.articleId) as JsonMap | undefined;
      if (!article) throw new Error('Article is no longer available');
      const revisionId = text(article.current_revision_id);
      if (revisionId !== input.expectedRevisionId) {
        throw new Error('The article changed before its check results could be added');
      }

      const timestamp = now();
      const createdCommentIds = input.findings.map((finding) => {
        const id = ulid();
        const anchor = articleCommentAnchorSchema.parse(finding.anchor);
        this.db
          .prepare(
            `INSERT INTO article_comments (
              id, article_id, created_revision_id, status, anchor_kind,
              start_element_id, start_offset, end_element_id, end_offset,
              start_block_index, end_block_index, exact_quote, prefix, suffix,
              created_preview, body, author_id, created_at, updated_at, resolved_at
            ) VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
          )
          .run(
            id,
            input.articleId,
            revisionId,
            anchor.kind,
            anchor.startElementId,
            anchor.startOffset,
            anchor.endElementId,
            anchor.endOffset,
            anchor.startBlockIndex,
            anchor.endBlockIndex,
            anchor.exactQuote,
            anchor.prefix,
            anchor.suffix,
            finding.preview,
            finding.body,
            timestamp,
            timestamp,
          );
        this.storage.recordChange(
          'ARTICLE_COMMENT',
          id,
          'CREATE',
          { articleId: input.articleId, revisionId, source: 'ARTICLE_CHECK' },
          { affectsFileView: false },
        );
        return id;
      });
      return {
        articleId: input.articleId,
        revisionId,
        createdCommentIds,
        comments: this.list(input.articleId, revisionId),
      };
    };
    return this.db.inTransaction ? operation() : this.db.transaction(operation).immediate();
  }

  private assertComment(articleId: string, commentId: string) {
    const row = this.db
      .prepare('SELECT 1 FROM article_comments WHERE id = ? AND article_id = ?')
      .get(commentId, articleId);
    if (!row) throw new Error('Article comment is no longer available');
  }
}
