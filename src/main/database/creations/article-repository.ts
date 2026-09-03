import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  ArticleContentDto,
  ArticleContentInput,
  ArticleDto,
  ArticleMoveInput,
  ArticleRenameInput,
  ArticleSaveInput,
  ArticleSetArchivedInput,
  AssetDto,
} from '@/shared/contracts';
import {
  articleCommentAnchorUpdates,
  articleCommentAnchorUpdatesAreApplied,
  articleContentSchema,
  canonicalArticleContentJson,
  sameArticleElementPlacements,
  type ArticleCommentMutationInput,
  type ArticleCommentMutationResult,
  type ArticleCheckApplyInput,
  type ArticleCheckApplyResult,
  type ArticleFormAddInput,
  type ArticleFormCreateInput,
  type ArticleRevisionDto,
  type ArticleRevisionGetInput,
  type ArticleRevisionHistoryInput,
  type ArticleRevisionHistoryResult,
  type ArticleRevisionSummaryDto,
  type ArticleRevisionSaveInput,
  type ArticleRevisionSaveResult,
} from '@/shared/contracts/article';
import { removeUnboundArticleMarkdownImages } from '@/shared/article-wechat-renderer';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/core/values';
import type { ArticleRevisionContentLocator } from '@/main/database/creations/article-revision-pack-codec';
import { ArticleElementRepository } from '@/main/database/creations/article-element-repository';
import { ArticleCommentRepository } from '@/main/database/creations/article-comment-repository';
import { ArticleRevisionPackStore } from '@/main/database/creations/article-revision-pack-store';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import { ContentLifecycleRepository } from '@/main/database/recovery/content-lifecycle-repository';

function assetDto(row: JsonMap): AssetDto {
  const id = text(row.id);
  return {
    id,
    kind: text(row.kind) as AssetDto['kind'],
    originType: text(row.origin_type),
    width: Number(row.width),
    height: Number(row.height),
    mimeType: text(row.mime_type),
    byteSize: Number(row.byte_size),
    mediaUrl: mediaUrl(id),
    createdAt: text(row.created_at),
  };
}

function normalizedContent(input: ArticleContentInput): ArticleContentInput {
  const content = articleContentSchema.parse({
    ...input,
    mediaBindings: input.mediaBindings.map((binding) => ({ ...binding })),
  });
  const markdown = removeUnboundArticleMarkdownImages(
    content.markdown,
    content.mediaBindings.map((binding) => binding.path),
  );
  return markdown === content.markdown ? content : { ...content, markdown };
}

function contentHash(content: ArticleContentInput) {
  return createHash('sha256').update(canonicalArticleContentJson(content)).digest('hex');
}

export class ArticleRepository {
  private readonly creationItems: CreationItemRepository;
  private readonly elements: ArticleElementRepository;
  private readonly comments: ArticleCommentRepository;

  constructor(
    private readonly storage: LibraryStorage,
    private readonly revisionPacks: ArticleRevisionPackStore,
  ) {
    this.creationItems = new CreationItemRepository(storage);
    this.elements = new ArticleElementRepository(storage);
    this.comments = new ArticleCommentRepository(storage);
  }

  private get db() {
    return this.storage.db;
  }

  list(): ArticleDto[] {
    const rows = this.db
      .prepare(
        `SELECT article.*, revision.id AS revision_id, revision.revision_no,
          revision.article_id AS revision_article_id, revision.content_json, revision.content_hash,
          revision.content_pack_id, revision.content_pack_entry_index
        FROM articles article
        JOIN article_revisions revision ON revision.id = article.current_revision_id
        WHERE article.status = 'ACTIVE' AND article.deleted_at IS NULL
        ORDER BY article.updated_at DESC, article.id DESC`,
      )
      .all() as JsonMap[];
    const locators = rows.map((row) => this.contentLocator(row));
    const contentsByRevision = this.revisionPacks.readContents(locators);
    const revisions = rows.map((row) => ({ articleId: text(row.id), revisionId: text(row.revision_id) }));
    const placementsByRevision = this.elements.listPlacementsMany(revisions.map(({ revisionId }) => revisionId));
    const commentsByArticle = this.comments.listMany(revisions, placementsByRevision);
    const assetIds = [
      ...new Set(
        [...contentsByRevision.values()].flatMap((content) => content.mediaBindings.map((binding) => binding.assetId)),
      ),
    ];
    const assetsById = this.mediaAssetsById(assetIds);
    return rows.map((row) => {
      const articleId = text(row.id);
      const revisionId = text(row.revision_id);
      const content = contentsByRevision.get(revisionId);
      if (!content) throw new Error('Stored article revision content is unavailable');
      const mediaAssets = content.mediaBindings.flatMap((binding) => assetsById.get(binding.assetId) ?? []);
      return this.dtoFromParts(
        row,
        content,
        mediaAssets,
        placementsByRevision.get(revisionId) ?? [],
        commentsByArticle.get(articleId) ?? [],
      );
    });
  }

  get(id: string): ArticleDto {
    return this.dto(this.row(id));
  }

  revisionHistory(input: ArticleRevisionHistoryInput): ArticleRevisionHistoryResult {
    const article = this.db
      .prepare('SELECT current_revision_id FROM articles WHERE id = ? AND deleted_at IS NULL')
      .get(input.articleId) as JsonMap | undefined;
    if (!article) throw new Error('Article not found');

    const rows = this.db
      .prepare(
        `SELECT revision.id AS revision_id, revision.article_id, revision.revision_no,
          revision.content_hash, revision.created_at
        FROM article_revisions revision
        WHERE revision.article_id = ?
          AND (? IS NULL OR revision.revision_no < ?)
        ORDER BY revision.revision_no DESC
        LIMIT ?`,
      )
      .all(input.articleId, input.beforeRevisionNo, input.beforeRevisionNo, input.limit + 1) as JsonMap[];
    const hasMore = rows.length > input.limit;
    const revisions = rows.slice(0, input.limit).map((row): ArticleRevisionSummaryDto => ({
      articleId: text(row.article_id),
      revisionId: text(row.revision_id),
      revisionNo: Number(row.revision_no),
      contentHash: text(row.content_hash),
      createdAt: text(row.created_at),
    }));

    return {
      articleId: input.articleId,
      currentRevisionId: text(article.current_revision_id),
      revisions,
      nextBeforeRevisionNo: hasMore ? (revisions.at(-1)?.revisionNo ?? null) : null,
    };
  }

  getRevision(input: ArticleRevisionGetInput): ArticleRevisionDto {
    const row = this.db
      .prepare(
        `SELECT article.id, revision.id AS revision_id, revision.revision_no,
          revision.article_id AS revision_article_id, revision.content_json, revision.content_hash,
          revision.content_pack_id, revision.content_pack_entry_index,
          revision.created_at AS revision_created_at
        FROM articles article
        JOIN article_revisions revision ON revision.article_id = article.id
        WHERE article.id = ? AND revision.id = ? AND article.deleted_at IS NULL`,
      )
      .get(input.articleId, input.revisionId) as JsonMap | undefined;
    if (!row) throw new Error('Article revision not found');

    const content = this.storedContent(row);
    const assetIds = content.mediaBindings.map((binding) => binding.assetId);
    return {
      articleId: input.articleId,
      revisionId: text(row.revision_id),
      revisionNo: Number(row.revision_no),
      content: { ...content, mediaAssets: this.mediaAssets(assetIds) },
      contentHash: text(row.content_hash),
      elements: this.elements.listPlacements(text(row.revision_id)),
      createdAt: text(row.revision_created_at),
    };
  }

  save(input: ArticleSaveInput): ArticleDto {
    return this.db.transaction(() => {
      const content = normalizedContent(input.content);
      const assetIds = content.mediaBindings.map((binding) => binding.assetId);
      this.assertMediaAvailable(assetIds);
      const hash = contentHash(content);
      const timestamp = now();

      this.assertAlbumAvailable(input.albumId);
      this.assertSourceAvailable(input.sourceInspirationStashId);
      this.assertCreationDraftAvailable(input.consumeCreationDraftId);
      const id = ulid();
      this.db
        .prepare(
          `INSERT INTO articles
          (id, album_id, source_inspiration_stash_id, current_revision_id, status,
            created_at, updated_at, archived_at, deleted_at)
          VALUES (?, ?, ?, NULL, 'ACTIVE', ?, ?, NULL, NULL)`,
        )
        .run(id, input.albumId, input.sourceInspirationStashId, timestamp, timestamp);
      const revisionId = this.insertRevision(id, 1, content, hash, timestamp);
      this.db.prepare('UPDATE articles SET current_revision_id = ? WHERE id = ?').run(revisionId, id);
      const registration = this.creationItems.createWithForm({
        albumId: input.albumId,
        form: { role: 'ARTICLE', entity: { kind: 'ARTICLE', id }, anchorKey: null },
      });
      this.consumeCreationDraft(input.consumeCreationDraftId, timestamp, id);
      this.storage.recordChange(
        'ARTICLE',
        id,
        'CREATE',
        {
          albumId: input.albumId,
          creationItemId: registration.item.id,
          sourceInspirationStashId: input.sourceInspirationStashId,
          revisionId,
        },
        { affectsFileView: false },
      );
      return this.dto(this.row(id));
    })();
  }

  saveRevision(input: ArticleRevisionSaveInput): ArticleRevisionSaveResult {
    const save = (): ArticleRevisionSaveResult => {
      const content = normalizedContent(input.content);
      const assetIds = content.mediaBindings.map((binding) => binding.assetId);
      this.assertMediaAvailable(assetIds);
      const hash = contentHash(content);
      if (hash !== input.contentHash) throw new Error('Article content hash does not match the save snapshot');

      const existing = this.activeRow(input.articleId);
      const currentArticle = this.dto(existing);
      const contentMatches = text(existing.content_hash) === hash;
      const elementsMatch = !input.elements || sameArticleElementPlacements(input.elements, currentArticle.elements);
      const commentAnchorsMatch =
        !input.commentAnchors ||
        articleCommentAnchorUpdatesAreApplied(
          input.commentAnchors,
          articleCommentAnchorUpdates(currentArticle.comments),
        );
      if (contentMatches && elementsMatch && commentAnchorsMatch) {
        return {
          status: 'ACKNOWLEDGED' as const,
          requestId: input.requestId,
          sessionEpoch: input.sessionEpoch,
          draftSeq: input.draftSeq,
          contentHash: hash,
          createdRevision: false,
          article: currentArticle,
        };
      }
      if (text(existing.revision_id) !== input.expectedRevisionId) {
        return {
          status: 'CONFLICT' as const,
          requestId: input.requestId,
          sessionEpoch: input.sessionEpoch,
          draftSeq: input.draftSeq,
          expectedRevisionId: input.expectedRevisionId,
          reason: 'REVISION_CHANGED' as const,
          historicalRevisionId: null,
          historicalRevisionNo: null,
          currentArticle,
        };
      }

      const historicalRevision =
        input.cause === 'EDITOR' && !contentMatches
          ? (this.db
              .prepare(
                `SELECT id, revision_no FROM article_revisions
                WHERE article_id = ? AND id <> ? AND content_hash = ?
                ORDER BY revision_no DESC LIMIT 1`,
              )
              .get(input.articleId, input.expectedRevisionId, hash) as JsonMap | undefined)
          : undefined;
      if (historicalRevision) {
        return {
          status: 'CONFLICT' as const,
          requestId: input.requestId,
          sessionEpoch: input.sessionEpoch,
          draftSeq: input.draftSeq,
          expectedRevisionId: input.expectedRevisionId,
          reason: 'HISTORICAL_REPLAY' as const,
          historicalRevisionId: text(historicalRevision.id),
          historicalRevisionNo: Number(historicalRevision.revision_no),
          currentArticle,
        };
      }

      const timestamp = now();
      const revisionId = this.insertRevision(
        input.articleId,
        Number(existing.revision_no) + 1,
        content,
        hash,
        timestamp,
      );
      if (input.elements) {
        this.elements.savePlacements(input.articleId, revisionId, input.elements, timestamp);
      } else {
        this.elements.copyPlacements(input.articleId, text(existing.revision_id), revisionId, timestamp);
      }
      if (input.commentAnchors) this.comments.updateAnchors(input.articleId, input.commentAnchors);
      const update = this.db
        .prepare(
          `UPDATE articles SET current_revision_id = ?, updated_at = ?
            WHERE id = ? AND current_revision_id = ?`,
        )
        .run(revisionId, timestamp, input.articleId, input.expectedRevisionId);
      if (update.changes !== 1) throw new Error('Article revision changed while applying a save');

      this.creationItems.touchForEntity({ kind: 'ARTICLE', id: input.articleId }, timestamp);
      this.storage.recordChange(
        'ARTICLE',
        input.articleId,
        'UPDATE',
        {
          contentHash: hash,
          cause: input.cause,
          draftSeq: input.draftSeq,
          expectedRevisionId: input.expectedRevisionId,
          requestId: input.requestId,
          revisionId,
          sessionEpoch: input.sessionEpoch,
        },
        { affectsFileView: false },
      );
      return {
        status: 'ACKNOWLEDGED' as const,
        requestId: input.requestId,
        sessionEpoch: input.sessionEpoch,
        draftSeq: input.draftSeq,
        contentHash: hash,
        createdRevision: true,
        article: this.dto(this.row(input.articleId)),
      };
    };
    return this.db.inTransaction ? save() : this.db.transaction(save).immediate();
  }

  saveSystemRevision(input: {
    articleId: string;
    expectedRevisionId: string;
    requestId: string;
    content: ArticleContentInput;
  }): ArticleDto {
    const content = normalizedContent(input.content);
    const result = this.saveRevision({
      requestId: input.requestId,
      articleId: input.articleId,
      sessionEpoch: input.requestId,
      draftSeq: 0,
      cause: 'SYSTEM',
      expectedRevisionId: input.expectedRevisionId,
      contentHash: contentHash(content),
      content,
    });
    if (result.status === 'CONFLICT') throw new Error('The article changed while applying a system revision');
    return result.article;
  }

  mutateComment(input: ArticleCommentMutationInput): ArticleCommentMutationResult {
    return this.comments.mutate(input);
  }

  applyCheck(input: ArticleCheckApplyInput): ArticleCheckApplyResult {
    return this.comments.createMany(input);
  }

  addForm(input: ArticleFormAddInput): ArticleDto {
    return this.db
      .transaction(() => {
        const existing = this.creationItems.findForm(input.creationItemId, 'ARTICLE', null);
        if (existing) {
          if (existing.entity.kind !== 'ARTICLE') throw new Error('The article form binding is invalid');
          this.consumeCreationDraft(input.consumeCreationDraftId, now(), existing.entity.id, false);
          return this.get(existing.entity.id);
        }

        const item = this.creationItems.get(input.creationItemId);
        if (item.lifecycle !== 'ACTIVE') throw new Error('Archived creation items cannot be changed');
        this.assertAlbumAvailable(item.albumId);
        this.assertSourceAvailable(input.sourceInspirationStashId, item.id);
        this.assertCreationDraftAvailable(input.consumeCreationDraftId);

        const content = normalizedContent(input.content);
        this.assertMediaAvailable(content.mediaBindings.map((binding) => binding.assetId));
        const hash = contentHash(content);
        const timestamp = now();
        const id = ulid();
        this.db
          .prepare(
            `INSERT INTO articles
            (id, album_id, source_inspiration_stash_id, current_revision_id, status,
              created_at, updated_at, archived_at, deleted_at)
            VALUES (?, ?, ?, NULL, 'ACTIVE', ?, ?, NULL, NULL)`,
          )
          .run(id, item.albumId, input.sourceInspirationStashId, timestamp, timestamp);
        const revisionId = this.insertRevision(id, 1, content, hash, timestamp);
        this.db.prepare('UPDATE articles SET current_revision_id = ? WHERE id = ?').run(revisionId, id);
        const sourceFormId = input.sourceInspirationStashId
          ? (item.forms.find(
              (form) => form.entity.kind === 'INSPIRATION_STASH' && form.entity.id === input.sourceInspirationStashId,
            )?.id ?? null)
          : null;
        this.creationItems.addOrGetForm({
          creationItemId: item.id,
          sourceFormId,
          role: 'ARTICLE',
          entity: { kind: 'ARTICLE', id },
          anchorKey: null,
        });
        this.consumeCreationDraft(input.consumeCreationDraftId, timestamp, id);
        this.storage.recordChange(
          'ARTICLE',
          id,
          'CREATE',
          {
            albumId: item.albumId,
            creationItemId: item.id,
            sourceInspirationStashId: input.sourceInspirationStashId,
            revisionId,
          },
          { affectsFileView: false },
        );
        return this.dto(this.row(id));
      })
      .immediate();
  }

  createForm(input: ArticleFormCreateInput): ArticleDto {
    return this.db
      .transaction(() => {
        const sourceForm = this.creationItems.getForm(input.sourceFormId);
        const item = this.creationItems.get(sourceForm.creationItemId);
        if (item.lifecycle !== 'ACTIVE') throw new Error('Archived creation items cannot be changed');
        this.assertAlbumAvailable(item.albumId);
        this.assertSourceAvailable(input.sourceInspirationStashId, item.id);

        const content = normalizedContent(input.content);
        this.assertMediaAvailable(content.mediaBindings.map((binding) => binding.assetId));
        const hash = contentHash(content);
        const timestamp = now();
        const id = ulid();
        this.db
          .prepare(
            `INSERT INTO articles
            (id, album_id, source_inspiration_stash_id, current_revision_id, status,
              created_at, updated_at, archived_at, deleted_at)
            VALUES (?, ?, ?, NULL, 'ACTIVE', ?, ?, NULL, NULL)`,
          )
          .run(id, item.albumId, input.sourceInspirationStashId, timestamp, timestamp);
        const revisionId = this.insertRevision(id, 1, content, hash, timestamp);
        this.db.prepare('UPDATE articles SET current_revision_id = ? WHERE id = ?').run(revisionId, id);
        this.creationItems.addForm({
          creationItemId: item.id,
          sourceFormId: sourceForm.id,
          role: 'ARTICLE',
          entity: { kind: 'ARTICLE', id },
          anchorKey: null,
        });
        this.storage.recordChange(
          'ARTICLE',
          id,
          'CREATE',
          {
            albumId: item.albumId,
            creationItemId: item.id,
            sourceFormId: sourceForm.id,
            sourceInspirationStashId: input.sourceInspirationStashId,
            revisionId,
          },
          { affectsFileView: false },
        );
        return this.dto(this.row(id));
      })
      .immediate();
  }

  rename(input: ArticleRenameInput): ArticleDto {
    return this.db.transaction(() => {
      const existing = this.activeRow(input.id);
      const current = this.storedContent(existing);
      const content = normalizedContent({ ...current, title: input.title });
      const hash = contentHash(content);
      if (text(existing.content_hash) === hash) return this.dto(existing);
      const timestamp = now();
      const revisionId = this.insertRevision(input.id, Number(existing.revision_no) + 1, content, hash, timestamp);
      this.elements.copyPlacements(input.id, text(existing.revision_id), revisionId, timestamp);
      this.db
        .prepare('UPDATE articles SET current_revision_id = ?, updated_at = ? WHERE id = ?')
        .run(revisionId, timestamp, input.id);
      this.creationItems.touchForEntity({ kind: 'ARTICLE', id: input.id }, timestamp);
      this.storage.recordChange(
        'ARTICLE',
        input.id,
        'UPDATE',
        { contentHash: hash, revisionId },
        { affectsFileView: false },
      );
      return this.dto(this.row(input.id));
    })();
  }

  move(input: ArticleMoveInput): ArticleDto {
    return this.db.transaction(() => {
      this.activeRow(input.id);
      const item = this.creationItems.findForEntity({ kind: 'ARTICLE', id: input.id });
      if (!item) throw new Error('The article creation item is unavailable');
      this.creationItems.move({ creationItemId: item.id, albumId: input.albumId });
      return this.dto(this.row(input.id));
    })();
  }

  setArchived(input: ArticleSetArchivedInput): ArticleDto {
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT id FROM articles WHERE id = ? AND deleted_at IS NULL').get(input.id);
      if (!existing) throw new Error('Article not found');
      new ContentLifecycleRepository(this.storage, async () => undefined).setDirectArchived(
        { entityType: 'ARTICLE', entityId: input.id },
        input.archived,
      );
      return this.dto(this.row(input.id));
    })();
  }

  private assertCreationDraftAvailable(creationDraftId: string | null) {
    if (!creationDraftId) return;
    const draft = this.db
      .prepare('SELECT 1 FROM creation_drafts WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL')
      .get(creationDraftId);
    if (!draft) throw new Error('Creation input is no longer available');
  }

  private consumeCreationDraft(
    creationDraftId: string | null,
    timestamp: string,
    articleId: string,
    requireActive = true,
  ) {
    if (!creationDraftId) return;
    const result = this.db
      .prepare(
        `UPDATE creation_drafts SET consumed_at = ?, updated_at = ?
        WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
      )
      .run(timestamp, timestamp, creationDraftId);
    if (result.changes !== 1) {
      if (requireActive) throw new Error('Creation input is no longer available');
      return;
    }
    this.storage.recordChange(
      'CREATION_DRAFT',
      creationDraftId,
      'CONSUME_ARTICLE',
      { articleId },
      { affectsFileView: false },
    );
  }

  private insertRevision(
    articleId: string,
    revisionNo: number,
    content: ArticleContentInput,
    hash: string,
    createdAt: string,
  ) {
    const id = ulid();
    this.db
      .prepare(
        `INSERT INTO article_revisions
        (id, article_id, revision_no, content_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, articleId, revisionNo, canonicalArticleContentJson(content), hash, createdAt);
    this.storage.recordChange(
      'ARTICLE_REVISION',
      id,
      'CREATE',
      { articleId, revisionNo, contentHash: hash },
      { affectsFileView: false },
    );
    this.revisionPacks.schedule(articleId, revisionNo);
    return id;
  }

  private activeRow(id: string) {
    const row = this.db
      .prepare(
        `SELECT article.*, revision.id AS revision_id, revision.revision_no,
          revision.article_id AS revision_article_id, revision.content_json, revision.content_hash,
          revision.content_pack_id, revision.content_pack_entry_index
        FROM articles article
        JOIN article_revisions revision ON revision.id = article.current_revision_id
        WHERE article.id = ? AND article.status = 'ACTIVE' AND article.deleted_at IS NULL`,
      )
      .get(id) as JsonMap | undefined;
    if (!row) throw new Error('Article is no longer available');
    return row;
  }

  private row(id: string) {
    const row = this.db
      .prepare(
        `SELECT article.*, revision.id AS revision_id, revision.revision_no,
          revision.article_id AS revision_article_id, revision.content_json, revision.content_hash,
          revision.content_pack_id, revision.content_pack_entry_index
        FROM articles article
        JOIN article_revisions revision ON revision.id = article.current_revision_id
        WHERE article.id = ? AND article.deleted_at IS NULL`,
      )
      .get(id) as JsonMap | undefined;
    if (!row) throw new Error('Article not found');
    return row;
  }

  private assertAlbumAvailable(albumId: string | null) {
    if (!albumId) return;
    const album = this.db.prepare('SELECT archived_at FROM albums WHERE id = ? AND deleted_at IS NULL').get(albumId) as
      JsonMap | undefined;
    if (!album) throw new Error('Album is unavailable');
    const archivedAncestor = this.db
      .prepare(
        `WITH RECURSIVE lineage(id, archived_at) AS (
          SELECT id, archived_at FROM albums WHERE id = ? AND deleted_at IS NULL
          UNION
          SELECT parent.id, parent.archived_at
          FROM album_members member
          JOIN lineage child ON member.target_type = 'ALBUM' AND member.target_id = child.id
          JOIN albums parent ON parent.id = member.album_id AND parent.deleted_at IS NULL
          WHERE member.deleted_at IS NULL
        ) SELECT 1 FROM lineage WHERE archived_at IS NOT NULL LIMIT 1`,
      )
      .get(albumId);
    if (archivedAncestor) throw new Error('Album is unavailable');
  }

  private assertSourceAvailable(sourceId: string | null, creationItemId?: string) {
    if (!sourceId) return;
    const source = this.db
      .prepare("SELECT 1 FROM inspiration_stashes WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL")
      .get(sourceId);
    if (!source) throw new Error('The source inspiration is no longer available');
    if (
      creationItemId &&
      !this.db
        .prepare(
          `SELECT 1 FROM creation_forms
          WHERE creation_item_id = ? AND entity_type = 'INSPIRATION_STASH'
            AND entity_id = ? AND deleted_at IS NULL`,
        )
        .get(creationItemId, sourceId)
    ) {
      throw new Error('The source inspiration belongs to another creation item');
    }
  }

  private assertMediaAvailable(assetIds: readonly string[]) {
    if (!assetIds.length) return;
    const placeholders = assetIds.map(() => '?').join(', ');
    const count = Number(
      (
        this.db
          .prepare(
            `SELECT count(*) AS count FROM image_assets
            WHERE deleted_at IS NULL AND id IN (${placeholders})`,
          )
          .get(...assetIds) as JsonMap
      ).count,
    );
    if (count !== assetIds.length) throw new Error('An article image is no longer available');
  }

  private dto(row: JsonMap): ArticleDto {
    const content = this.storedContent(row);
    const assetIds = content.mediaBindings.map((binding) => binding.assetId);
    return this.dtoFromParts(
      row,
      content,
      this.mediaAssets(assetIds),
      this.elements.listPlacements(text(row.revision_id)),
      this.comments.list(text(row.id), text(row.revision_id)),
    );
  }

  private dtoFromParts(
    row: JsonMap,
    content: ArticleContentInput,
    mediaAssets: AssetDto[],
    elements: ArticleDto['elements'],
    comments: ArticleDto['comments'],
  ): ArticleDto {
    const hydrated: ArticleContentDto = { ...content, mediaAssets };
    return {
      id: text(row.id),
      albumId: row.album_id == null ? null : text(row.album_id),
      sourceInspirationStashId: row.source_inspiration_stash_id == null ? null : text(row.source_inspiration_stash_id),
      content: hydrated,
      contentHash: text(row.content_hash),
      revisionId: text(row.revision_id),
      revisionNo: Number(row.revision_no),
      elements,
      comments,
      status: text(row.status) as ArticleDto['status'],
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
  }

  private storedContent(row: JsonMap) {
    return this.revisionPacks.readContent(this.contentLocator(row));
  }

  private contentLocator(row: JsonMap): ArticleRevisionContentLocator {
    const articleId = text(row.id);
    const revisionArticleId = text(row.revision_article_id);
    if (articleId !== revisionArticleId) throw new Error('Stored article revision identity is invalid');
    return {
      articleId,
      revisionId: text(row.revision_id),
      revisionNo: Number(row.revision_no),
      contentJson: row.content_json,
      contentHash: text(row.content_hash),
      packId: row.content_pack_id == null ? null : text(row.content_pack_id),
      packEntryIndex: row.content_pack_entry_index == null ? null : Number(row.content_pack_entry_index),
    };
  }

  private mediaAssets(ids: readonly string[]) {
    const byId = this.mediaAssetsById(ids);
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  private mediaAssetsById(ids: readonly string[]) {
    const byId = new Map<string, AssetDto>();
    const uniqueIds = [...new Set(ids)];
    for (let offset = 0; offset < uniqueIds.length; offset += 400) {
      const chunk = uniqueIds.slice(offset, offset + 400);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = this.db
        .prepare(`SELECT * FROM image_assets WHERE deleted_at IS NULL AND id IN (${placeholders})`)
        .all(...chunk) as JsonMap[];
      for (const row of rows) byId.set(text(row.id), assetDto(row));
    }
    return byId;
  }
}
