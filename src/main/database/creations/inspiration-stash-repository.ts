import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  AssetDto,
  InspirationStashContentDto,
  InspirationStashContentInput,
  InspirationStashDto,
  InspirationStashMoveInput,
  InspirationStashSaveInput,
  InspirationStashSetArchivedInput,
} from '@/shared/contracts';
import { inspirationStashContentSchema } from '@/shared/contracts/inspiration-stash';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/core/values';
import { ContentLifecycleRepository } from '@/main/database/recovery/content-lifecycle-repository';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';

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

function normalizedContent(input: InspirationStashContentInput): InspirationStashContentInput {
  return inspirationStashContentSchema.parse({
    ...input,
    promptNodes: input.promptNodes.map((node) => ({ ...node })),
    referenceAssetIds: [...input.referenceAssetIds],
    termIds: [...input.termIds],
    wordPaletteReferences: input.wordPaletteReferences.map((reference) => ({
      ...reference,
      parameterValues: { ...reference.parameterValues },
    })),
  });
}

function parseStoredContent(value: unknown) {
  if (typeof value !== 'string') throw new Error('Stored inspiration stash is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Stored inspiration stash is invalid');
  }
  return inspirationStashContentSchema.parse(parsed);
}

function canonicalContentJson(content: InspirationStashContentInput) {
  return JSON.stringify(content);
}

function contentHash(content: InspirationStashContentInput) {
  return createHash('sha256').update(canonicalContentJson(content)).digest('hex');
}

function compactTitle(content: InspirationStashContentInput) {
  const normalized = content.manualPrompt.replace(/\s+/g, ' ').trim();
  return normalized ? Array.from(normalized).slice(0, 48).join('') : '灵感暂存';
}

export function rehomeInspirationStashesForAlbum(storage: LibraryStorage, albumId: string) {
  const rows = storage.db
    .prepare(
      `SELECT id FROM inspiration_stashes
      WHERE album_id = ? AND deleted_at IS NULL`,
    )
    .all(albumId) as JsonMap[];
  if (rows.length === 0) return;
  const updatedAt = now();
  storage.db
    .prepare(
      `UPDATE inspiration_stashes
      SET album_id = NULL, updated_at = ?
      WHERE album_id = ? AND deleted_at IS NULL`,
    )
    .run(updatedAt, albumId);
  for (const row of rows) {
    storage.recordChange('INSPIRATION_STASH', text(row.id), 'REHOME_ALBUM', { albumId: null });
  }
}

export class InspirationStashRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  list(): InspirationStashDto[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM inspiration_stashes
        WHERE status = 'ACTIVE' AND deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC`,
      )
      .all() as JsonMap[];
    return rows.map((row) => this.dto(row));
  }

  get(id: string): InspirationStashDto {
    return this.dto(this.row(id));
  }

  save(input: InspirationStashSaveInput): InspirationStashDto {
    return this.db.transaction(() => {
      const creationItems = new CreationItemRepository(this.storage);
      const targetItem = input.mode === 'ADD_FORM' ? creationItems.get(input.creationItemId) : null;
      if (targetItem) {
        if (targetItem.lifecycle !== 'ACTIVE') throw new Error('Archived creation items cannot be changed');
        const existingForm = creationItems.findForm(targetItem.id, 'INSPIRATION', null);
        if (existingForm) {
          if (existingForm.entity.kind !== 'INSPIRATION_STASH') {
            throw new Error('The existing inspiration form has an invalid entity');
          }
          return this.get(existingForm.entity.id);
        }
      }
      const content = normalizedContent(input.content);
      this.assertReferencesAvailable(content.referenceAssetIds);
      const hash = contentHash(content);
      const contentJson = canonicalContentJson(content);
      const updatedAt = now();

      if (input.mode === 'UPDATE') {
        const existing = this.db
          .prepare(
            `SELECT * FROM inspiration_stashes
            WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`,
          )
          .get(input.id) as JsonMap | undefined;
        if (!existing) throw new Error('Inspiration stash is no longer available');
        if (text(existing.content_hash) === hash) return this.dto(existing);
        this.db
          .prepare(
            `UPDATE inspiration_stashes
            SET input_json = ?, content_hash = ?, updated_at = ?
            WHERE id = ?`,
          )
          .run(contentJson, hash, updatedAt, input.id);
        const item = creationItems.findForEntity({ kind: 'INSPIRATION_STASH', id: input.id });
        if (!item) throw new Error('The inspiration creation item is unavailable');
        creationItems.touchForEntity({ kind: 'INSPIRATION_STASH', id: input.id }, updatedAt);
        this.storage.recordChange('INSPIRATION_STASH', input.id, 'UPDATE', {
          contentHash: hash,
        });
        return this.dto(this.row(input.id));
      }

      const albumId = input.mode === 'ADD_FORM' ? targetItem!.albumId : input.albumId;
      this.assertAlbumAvailable(albumId);
      const duplicate = this.db
        .prepare(
          `SELECT * FROM inspiration_stashes
          WHERE status = 'ACTIVE' AND deleted_at IS NULL
            AND content_hash = ? AND album_id IS ?
          ORDER BY updated_at DESC, id DESC LIMIT 1`,
        )
        .get(hash, albumId) as JsonMap | undefined;
      if (duplicate && !targetItem) return this.dto(duplicate);

      const id = ulid();
      this.db
        .prepare(
          `INSERT INTO inspiration_stashes
          (id, album_id, input_json, content_hash, status,
            created_at, updated_at, archived_at, deleted_at)
          VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, NULL, NULL)`,
        )
        .run(id, albumId, contentJson, hash, updatedAt, updatedAt);
      if (targetItem) {
        creationItems.addOrGetForm({
          creationItemId: targetItem.id,
          role: 'INSPIRATION',
          entity: { kind: 'INSPIRATION_STASH', id },
          anchorKey: null,
        });
      } else {
        creationItems.createWithForm({
          albumId,
          form: {
            role: 'INSPIRATION',
            entity: { kind: 'INSPIRATION_STASH', id },
            anchorKey: null,
          },
        });
      }
      this.storage.recordChange('INSPIRATION_STASH', id, 'CREATE', {
        albumId,
        creationItemId: targetItem?.id ?? null,
        contentHash: hash,
      });
      return this.dto(this.row(id));
    })();
  }

  move(input: InspirationStashMoveInput): InspirationStashDto {
    return this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT * FROM inspiration_stashes
          WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`,
        )
        .get(input.id) as JsonMap | undefined;
      if (!existing) throw new Error('Inspiration stash is no longer available');
      const creationItems = new CreationItemRepository(this.storage);
      const item = creationItems.findForEntity({ kind: 'INSPIRATION_STASH', id: input.id });
      if (!item) throw new Error('The inspiration creation item is unavailable');
      creationItems.move({ creationItemId: item.id, albumId: input.albumId });
      return this.dto(this.row(input.id));
    })();
  }

  setArchived(input: InspirationStashSetArchivedInput): InspirationStashDto {
    return this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM inspiration_stashes WHERE id = ? AND deleted_at IS NULL')
        .get(input.id) as JsonMap | undefined;
      if (!existing) throw new Error('Inspiration stash not found');
      new ContentLifecycleRepository(this.storage, async () => undefined).setDirectArchived(
        { entityType: 'INSPIRATION_STASH', entityId: input.id },
        input.archived,
      );
      return this.dto(this.row(input.id));
    })();
  }

  private row(id: string) {
    const row = this.db.prepare('SELECT * FROM inspiration_stashes WHERE id = ?').get(id) as JsonMap | undefined;
    if (!row) throw new Error('Inspiration stash not found');
    return row;
  }

  private assertAlbumAvailable(albumId: string | null) {
    if (albumId) {
      const album = this.db
        .prepare('SELECT archived_at FROM albums WHERE id = ? AND deleted_at IS NULL')
        .get(albumId) as JsonMap | undefined;
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
          )
          SELECT 1 FROM lineage WHERE archived_at IS NOT NULL LIMIT 1`,
        )
        .get(albumId);
      if (archivedAncestor) throw new Error('Album is unavailable');
    }
  }

  private assertReferencesAvailable(referenceAssetIds: readonly string[]) {
    if (!referenceAssetIds.length) return;
    const uniqueIds = [...new Set(referenceAssetIds)];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const count = Number(
      (
        this.db
          .prepare(
            `SELECT count(*) AS count FROM image_assets
            WHERE deleted_at IS NULL AND id IN (${placeholders})`,
          )
          .get(...uniqueIds) as JsonMap
      ).count,
    );
    if (count !== uniqueIds.length) throw new Error('A reference image is no longer available');
  }

  private dto(row: JsonMap): InspirationStashDto {
    const content = parseStoredContent(row.input_json);
    const hydrated: InspirationStashContentDto = {
      ...content,
      referenceAssets: this.referenceAssets(content.referenceAssetIds),
    };
    return {
      id: text(row.id),
      albumId: row.album_id == null ? null : text(row.album_id),
      title: compactTitle(content),
      content: hydrated,
      contentHash: text(row.content_hash),
      status: text(row.status) as InspirationStashDto['status'],
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
  }

  private referenceAssets(ids: readonly string[]) {
    if (!ids.length) return [];
    const uniqueIds = [...new Set(ids)];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT * FROM image_assets
        WHERE deleted_at IS NULL AND id IN (${placeholders})`,
      )
      .all(...uniqueIds) as JsonMap[];
    const byId = new Map(rows.map((row) => [text(row.id), assetDto(row)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }
}
