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
import { articleContentSchema, type ArticleFormAddInput } from '@/shared/contracts/article';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/core/values';
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
  return articleContentSchema.parse({
    ...input,
    mediaBindings: input.mediaBindings.map((binding) => ({ ...binding })),
  });
}

function parseStoredContent(value: unknown) {
  if (typeof value !== 'string') throw new Error('Stored article is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Stored article is invalid');
  }
  return articleContentSchema.parse(parsed);
}

function canonicalContentJson(content: ArticleContentInput) {
  return JSON.stringify(content);
}

function contentHash(content: ArticleContentInput) {
  return createHash('sha256').update(canonicalContentJson(content)).digest('hex');
}

export class ArticleRepository {
  private readonly creationItems: CreationItemRepository;

  constructor(private readonly storage: LibraryStorage) {
    this.creationItems = new CreationItemRepository(storage);
  }

  private get db() {
    return this.storage.db;
  }

  list(): ArticleDto[] {
    const rows = this.db
      .prepare(
        `SELECT article.*, revision.id AS revision_id, revision.revision_no,
          revision.content_json, revision.content_hash
        FROM articles article
        JOIN article_revisions revision ON revision.id = article.current_revision_id
        WHERE article.status = 'ACTIVE' AND article.deleted_at IS NULL
        ORDER BY article.updated_at DESC, article.id DESC`,
      )
      .all() as JsonMap[];
    return rows.map((row) => this.dto(row));
  }

  get(id: string): ArticleDto {
    return this.dto(this.row(id));
  }

  save(input: ArticleSaveInput): ArticleDto {
    return this.db.transaction(() => {
      const content = normalizedContent(input.content);
      const assetIds = content.mediaBindings.map((binding) => binding.assetId);
      this.assertMediaAvailable(assetIds);
      const hash = contentHash(content);
      const timestamp = now();

      if (input.id) {
        if (input.consumeCreationDraftId) throw new Error('An existing article cannot consume another input');
        const existing = this.activeRow(input.id);
        const sourceId =
          existing.source_inspiration_stash_id == null ? null : text(existing.source_inspiration_stash_id);
        if (sourceId !== input.sourceInspirationStashId) throw new Error('An article source cannot be replaced');
        if (text(existing.content_hash) === hash) return this.dto(existing);
        const revisionId = this.insertRevision(input.id, Number(existing.revision_no) + 1, content, hash, timestamp);
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
      }

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
        this.creationItems.addOrGetForm({
          creationItemId: item.id,
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

  rename(input: ArticleRenameInput): ArticleDto {
    return this.db.transaction(() => {
      const existing = this.activeRow(input.id);
      const current = parseStoredContent(existing.content_json);
      const content = normalizedContent({ ...current, title: input.title });
      const hash = contentHash(content);
      if (text(existing.content_hash) === hash) return this.dto(existing);
      const timestamp = now();
      const revisionId = this.insertRevision(input.id, Number(existing.revision_no) + 1, content, hash, timestamp);
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
      .run(id, articleId, revisionNo, canonicalContentJson(content), hash, createdAt);
    this.storage.recordChange(
      'ARTICLE_REVISION',
      id,
      'CREATE',
      { articleId, revisionNo, contentHash: hash },
      { affectsFileView: false },
    );
    return id;
  }

  private activeRow(id: string) {
    const row = this.db
      .prepare(
        `SELECT article.*, revision.id AS revision_id, revision.revision_no,
          revision.content_json, revision.content_hash
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
          revision.content_json, revision.content_hash
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
    const content = parseStoredContent(row.content_json);
    const assetIds = content.mediaBindings.map((binding) => binding.assetId);
    const hydrated: ArticleContentDto = { ...content, mediaAssets: this.mediaAssets(assetIds) };
    return {
      id: text(row.id),
      albumId: row.album_id == null ? null : text(row.album_id),
      sourceInspirationStashId: row.source_inspiration_stash_id == null ? null : text(row.source_inspiration_stash_id),
      content: hydrated,
      contentHash: text(row.content_hash),
      revisionId: text(row.revision_id),
      revisionNo: Number(row.revision_no),
      status: text(row.status) as ArticleDto['status'],
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
  }

  private mediaAssets(ids: readonly string[]) {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM image_assets WHERE deleted_at IS NULL AND id IN (${placeholders})`)
      .all(...ids) as JsonMap[];
    const byId = new Map(rows.map((row) => [text(row.id), assetDto(row)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }
}
