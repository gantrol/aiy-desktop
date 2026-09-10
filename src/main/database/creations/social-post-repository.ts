import type { LibraryStorage } from '@/main/database/core/storage';
import { mediaUrl, now, text, type JsonMap } from '@/main/database/core/values';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import { ContentLifecycleRepository } from '@/main/database/recovery/content-lifecycle-repository';
import type {
  AssetDto,
  SocialPostContentDto,
  SocialPostContentInput,
  SocialPostDto,
  SocialPostMoveInput,
  SocialPostSaveInput,
  SocialPostSetArchivedInput,
} from '@/shared/contracts';
import { assertBlockDocumentReady } from '@/shared/contracts/block-document';
import {
  canonicalSocialPostContentJson,
  socialPostContentSchema,
  socialPostRevisionSaveInputSchema,
  socialPostStoredContentSchema,
  type SocialPostFormAddInput,
  type SocialPostFormCreateInput,
  type SocialPostRevisionSaveInput,
  type SocialPostRevisionSaveResult,
} from '@/shared/contracts/social-post';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';

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

function normalizedContent(input: SocialPostContentInput): SocialPostContentInput {
  assertBlockDocumentReady(input.document);
  return socialPostContentSchema.parse({
    ...input,
    mediaAssetIds: [...input.mediaAssetIds],
  });
}

function parseStoredContent(value: unknown) {
  if (typeof value !== 'string') throw new Error('Stored social post is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Stored social post is invalid');
  }
  return socialPostStoredContentSchema.parse(parsed);
}

function canonicalContentJson(content: SocialPostContentInput) {
  return canonicalSocialPostContentJson(content);
}

function contentHash(content: SocialPostContentInput) {
  return createHash('sha256').update(canonicalContentJson(content)).digest('hex');
}

export class SocialPostRepository {
  private readonly creationItems: CreationItemRepository;

  constructor(private readonly storage: LibraryStorage) {
    this.creationItems = new CreationItemRepository(storage);
  }

  private get db() {
    return this.storage.db;
  }

  list(): SocialPostDto[] {
    const rows = this.db
      .prepare(
        `SELECT draft.*, revision.id AS revision_id, revision.revision_no,
          revision.content_json, revision.content_hash
        FROM social_post_drafts draft
        JOIN social_post_revisions revision ON revision.id = draft.current_revision_id
        WHERE draft.status = 'ACTIVE' AND draft.deleted_at IS NULL
        ORDER BY draft.updated_at DESC, draft.id DESC`,
      )
      .all() as JsonMap[];
    return rows.map((row) => this.dto(row));
  }

  get(id: string): SocialPostDto {
    return this.dto(this.row(id));
  }

  save(input: SocialPostSaveInput): SocialPostDto {
    return this.db.transaction(() => {
      const content = normalizedContent(input.content);
      this.assertMediaAvailable(content.mediaAssetIds);
      const hash = contentHash(content);
      const timestamp = now();

      if (input.id) {
        if (input.consumeCreationDraftId) throw new Error('An existing social post cannot consume another input');
        const existing = this.activeRow(input.id);
        if (parseStoredContent(existing.content_json).document && !content.document)
          throw new Error('BLOCK_DOCUMENT_REQUIRED');
        if (!input.expectedRevisionId || text(existing.revision_id) !== input.expectedRevisionId) {
          throw new Error('The social post changed or no reviewed revision was supplied; the saved content was kept');
        }
        const sourceId =
          existing.source_inspiration_stash_id == null ? null : text(existing.source_inspiration_stash_id);
        if (sourceId !== input.sourceInspirationStashId) throw new Error('A social post source cannot be replaced');
        if (text(existing.content_hash) === hash) return this.dto(existing);
        let revisionId = text(existing.revision_id);
        if (text(existing.content_hash) !== hash) {
          revisionId = this.insertRevision(input.id, Number(existing.revision_no) + 1, content, hash, timestamp);
        }
        const updated = this.db
          .prepare(
            `UPDATE social_post_drafts
            SET current_revision_id = ?, updated_at = ? WHERE id = ? AND current_revision_id = ?`,
          )
          .run(revisionId, timestamp, input.id, input.expectedRevisionId);
        if (updated.changes !== 1) throw new Error('The social post changed during save; the saved content was kept');
        this.creationItems.touchForEntity({ kind: 'SOCIAL_POST', id: input.id }, timestamp);
        this.storage.recordChange(
          'SOCIAL_POST_DRAFT',
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
          `INSERT INTO social_post_drafts
          (id, album_id, source_inspiration_stash_id, current_revision_id, status,
            created_at, updated_at, archived_at, deleted_at)
          VALUES (?, ?, ?, NULL, 'ACTIVE', ?, ?, NULL, NULL)`,
        )
        .run(id, input.albumId, input.sourceInspirationStashId, timestamp, timestamp);
      const revisionId = this.insertRevision(id, 1, content, hash, timestamp);
      this.db.prepare('UPDATE social_post_drafts SET current_revision_id = ? WHERE id = ?').run(revisionId, id);
      const registration = this.creationItems.createWithForm({
        albumId: input.albumId,
        form: { role: 'SOCIAL_POST', entity: { kind: 'SOCIAL_POST', id }, anchorKey: null },
      });
      this.consumeCreationDraft(input.consumeCreationDraftId, timestamp, id);
      this.storage.recordChange(
        'SOCIAL_POST_DRAFT',
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

  saveRevision(raw: SocialPostRevisionSaveInput): SocialPostRevisionSaveResult {
    const input = socialPostRevisionSaveInputSchema.parse(raw);
    const hash = createHash('sha256').update(canonicalSocialPostContentJson(input.content)).digest('hex');
    if (hash !== input.contentHash) throw new Error('Social post content hash does not match the save snapshot');
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const identity = {
      postId: input.postId,
      requestId: input.requestId,
      sessionEpoch: input.sessionEpoch,
      draftSeq: input.draftSeq,
    };
    return this.db
      .transaction((): SocialPostRevisionSaveResult => {
        const receipt = this.db
          .prepare('SELECT * FROM social_post_save_receipts WHERE request_id = ?')
          .get(input.requestId) as JsonMap | undefined;
        if (receipt) {
          if (text(receipt.request_hash) !== requestHash) throw new Error('SOCIAL_POST_REQUEST_REUSED');
          const row = this.db
            .prepare(
              `SELECT draft.*, revision.id AS revision_id, revision.revision_no,
            revision.content_json, revision.content_hash
          FROM social_post_drafts draft JOIN social_post_revisions revision ON revision.draft_id = draft.id
          WHERE draft.id = ? AND revision.id = ?`,
            )
            .get(input.postId, text(receipt.revision_id)) as JsonMap | undefined;
          if (!row) throw new Error('The saved social post revision is unavailable');
          return {
            ...identity,
            status: 'ACKNOWLEDGED',
            contentHash: hash,
            createdRevision: false,
            post: this.dto(row),
          };
        }
        const currentPost = this.get(input.postId);
        if (currentPost.status !== 'ACTIVE') throw new Error('The social post is no longer available');
        if (currentPost.revisionId !== input.expectedRevisionId) {
          return { ...identity, status: 'CONFLICT', expectedRevisionId: input.expectedRevisionId, currentPost };
        }
        const post = this.save({
          id: currentPost.id,
          expectedRevisionId: input.expectedRevisionId,
          albumId: currentPost.albumId,
          sourceInspirationStashId: currentPost.sourceInspirationStashId,
          consumeCreationDraftId: null,
          content: input.content,
        });
        const createdRevision = post.revisionId !== currentPost.revisionId;
        this.db
          .prepare(
            `INSERT INTO social_post_save_receipts
        (request_id, request_hash, post_id, revision_id, created_revision) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(input.requestId, requestHash, post.id, post.revisionId, Number(createdRevision));
        return { ...identity, status: 'ACKNOWLEDGED', contentHash: hash, createdRevision, post };
      })
      .immediate();
  }

  addForm(input: SocialPostFormAddInput): SocialPostDto {
    return this.db
      .transaction(() => {
        const existing = this.creationItems.findForm(input.creationItemId, 'SOCIAL_POST', null);
        if (existing) {
          if (existing.entity.kind !== 'SOCIAL_POST') throw new Error('The social post form binding is invalid');
          this.consumeCreationDraft(input.consumeCreationDraftId, now(), existing.entity.id, false);
          return this.get(existing.entity.id);
        }

        const item = this.creationItems.get(input.creationItemId);
        if (item.lifecycle !== 'ACTIVE') throw new Error('Archived creation items cannot be changed');
        this.assertAlbumAvailable(item.albumId);
        this.assertSourceAvailable(input.sourceInspirationStashId, item.id);
        this.assertCreationDraftAvailable(input.consumeCreationDraftId);

        const content = normalizedContent(input.content);
        this.assertMediaAvailable(content.mediaAssetIds);
        const hash = contentHash(content);
        const timestamp = now();
        const id = ulid();
        this.db
          .prepare(
            `INSERT INTO social_post_drafts
            (id, album_id, source_inspiration_stash_id, current_revision_id, status,
              created_at, updated_at, archived_at, deleted_at)
            VALUES (?, ?, ?, NULL, 'ACTIVE', ?, ?, NULL, NULL)`,
          )
          .run(id, item.albumId, input.sourceInspirationStashId, timestamp, timestamp);
        const revisionId = this.insertRevision(id, 1, content, hash, timestamp);
        this.db.prepare('UPDATE social_post_drafts SET current_revision_id = ? WHERE id = ?').run(revisionId, id);
        const sourceFormId = input.sourceInspirationStashId
          ? (item.forms.find(
              (form) => form.entity.kind === 'INSPIRATION_STASH' && form.entity.id === input.sourceInspirationStashId,
            )?.id ?? null)
          : null;
        this.creationItems.addOrGetForm({
          creationItemId: item.id,
          sourceFormId,
          role: 'SOCIAL_POST',
          entity: { kind: 'SOCIAL_POST', id },
          anchorKey: null,
        });
        this.consumeCreationDraft(input.consumeCreationDraftId, timestamp, id);
        this.storage.recordChange(
          'SOCIAL_POST_DRAFT',
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

  createForm(input: SocialPostFormCreateInput): SocialPostDto {
    return this.db
      .transaction(() => {
        const sourceForm = this.creationItems.getForm(input.sourceFormId);
        const item = this.creationItems.get(sourceForm.creationItemId);
        if (item.lifecycle !== 'ACTIVE') throw new Error('Archived creation items cannot be changed');
        this.assertAlbumAvailable(item.albumId);
        this.assertSourceAvailable(input.sourceInspirationStashId, item.id);

        const content = normalizedContent(input.content);
        this.assertMediaAvailable(content.mediaAssetIds);
        const hash = contentHash(content);
        const timestamp = now();
        const id = ulid();
        this.db
          .prepare(
            `INSERT INTO social_post_drafts
            (id, album_id, source_inspiration_stash_id, current_revision_id, status,
              created_at, updated_at, archived_at, deleted_at)
            VALUES (?, ?, ?, NULL, 'ACTIVE', ?, ?, NULL, NULL)`,
          )
          .run(id, item.albumId, input.sourceInspirationStashId, timestamp, timestamp);
        const revisionId = this.insertRevision(id, 1, content, hash, timestamp);
        this.db.prepare('UPDATE social_post_drafts SET current_revision_id = ? WHERE id = ?').run(revisionId, id);
        this.creationItems.addForm({
          creationItemId: item.id,
          sourceFormId: sourceForm.id,
          role: 'SOCIAL_POST',
          entity: { kind: 'SOCIAL_POST', id },
          anchorKey: null,
        });
        this.storage.recordChange(
          'SOCIAL_POST_DRAFT',
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

  move(input: SocialPostMoveInput): SocialPostDto {
    return this.db.transaction(() => {
      this.activeRow(input.id);
      const item = this.creationItems.findForEntity({ kind: 'SOCIAL_POST', id: input.id });
      if (!item) throw new Error('The social post creation item is unavailable');
      this.creationItems.move({ creationItemId: item.id, albumId: input.albumId });
      return this.dto(this.row(input.id));
    })();
  }

  setArchived(input: SocialPostSetArchivedInput): SocialPostDto {
    return this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT id FROM social_post_drafts WHERE id = ? AND deleted_at IS NULL')
        .get(input.id);
      if (!existing) throw new Error('Social post not found');
      new ContentLifecycleRepository(this.storage, async () => undefined).setDirectArchived(
        { entityType: 'SOCIAL_POST', entityId: input.id },
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
    socialPostId: string,
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
      'CONSUME_SOCIAL_POST',
      { socialPostId },
      { affectsFileView: false },
    );
  }

  private insertRevision(
    draftId: string,
    revisionNo: number,
    content: SocialPostContentInput,
    hash: string,
    createdAt: string,
  ) {
    const id = ulid();
    this.db
      .prepare(
        `INSERT INTO social_post_revisions
        (id, draft_id, revision_no, content_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, draftId, revisionNo, canonicalContentJson(content), hash, createdAt);
    this.storage.recordChange(
      'SOCIAL_POST_REVISION',
      id,
      'CREATE',
      { draftId, revisionNo, contentHash: hash },
      { affectsFileView: false },
    );
    return id;
  }

  private activeRow(id: string) {
    const row = this.db
      .prepare(
        `SELECT draft.*, revision.id AS revision_id, revision.revision_no,
          revision.content_json, revision.content_hash
        FROM social_post_drafts draft
        JOIN social_post_revisions revision ON revision.id = draft.current_revision_id
        WHERE draft.id = ? AND draft.status = 'ACTIVE' AND draft.deleted_at IS NULL`,
      )
      .get(id) as JsonMap | undefined;
    if (!row) throw new Error('Social post is no longer available');
    return row;
  }

  getRevision(postId: string, revisionId: string): SocialPostDto {
    const row = this.db
      .prepare(
        `SELECT draft.*, revision.id AS revision_id, revision.revision_no,
      revision.content_json, revision.content_hash FROM social_post_drafts draft
      JOIN social_post_revisions revision ON revision.draft_id = draft.id
      WHERE draft.id = ? AND revision.id = ? AND draft.deleted_at IS NULL`,
      )
      .get(postId, revisionId) as JsonMap | undefined;
    if (!row) throw new Error('Social post revision not found');
    return this.dto(row);
  }

  private row(id: string) {
    const row = this.db
      .prepare(
        `SELECT draft.*, revision.id AS revision_id, revision.revision_no,
          revision.content_json, revision.content_hash
        FROM social_post_drafts draft
        JOIN social_post_revisions revision ON revision.id = draft.current_revision_id
        WHERE draft.id = ? AND draft.deleted_at IS NULL`,
      )
      .get(id) as JsonMap | undefined;
    if (!row) throw new Error('Social post not found');
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
      .prepare(
        `SELECT 1 FROM inspiration_stashes
        WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`,
      )
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
    if (count !== assetIds.length) throw new Error('A post image is no longer available');
  }

  private dto(row: JsonMap): SocialPostDto {
    const content = parseStoredContent(row.content_json);
    const hydrated: SocialPostContentDto = { ...content, mediaAssets: this.mediaAssets(content.mediaAssetIds) };
    return {
      id: text(row.id),
      albumId: row.album_id == null ? null : text(row.album_id),
      sourceInspirationStashId: row.source_inspiration_stash_id == null ? null : text(row.source_inspiration_stash_id),
      content: hydrated,
      contentHash: text(row.content_hash),
      revisionId: text(row.revision_id),
      revisionNo: Number(row.revision_no),
      status: text(row.status) as SocialPostDto['status'],
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
