import { ulid } from 'ulid';
import type {
  CreateMaterialCollectionFromSourceInput,
  CreateMaterialCollectionFromSourceResult,
  CreationAlbumDto,
  MaterialAlbumAddManyInput,
  MaterialAlbumCreateInput,
  MaterialAlbumDto,
  MaterialAlbumMoveInput,
  MaterialAlbumRemoveInput,
  MaterialAlbumRenameInput,
  MaterialCollectionDto,
  RenameCreationAlbumInput,
} from '@/shared/contracts';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';
import {
  databaseBatches as batches,
  ensureImageMaterials,
  sqlPlaceholders as placeholders,
} from '@/main/database/albums/image-material-batch';
import { MaterialAlbumReader } from '@/main/database/albums/material-album-reader';
import {
  MATERIAL_ALBUM_CREATION_ROOT_ID,
  MATERIAL_ALBUM_DICTIONARY_ID,
  MATERIAL_ALBUM_DICTIONARY_UNCATEGORIZED_ID,
  isSystemMaterialAlbumId,
  materialAlbumAssetFilter,
  materialAlbumCreationAlbumId,
  materialAlbumCreationAlbumSourceId,
  materialAlbumDictionaryDomainSourceId,
  normalizeCreationAlbumTitle,
  normalizeTitle,
  promptSeriesAssetPredicate,
} from '@/main/database/albums/material-album-scopes';
import {
  resolveStoredTitle,
  titleLocalizationsByOwner,
  writeLocalizedTitle,
} from '@/main/database/core/title-localization';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { ContentLifecycleRepository } from '@/main/database/recovery/content-lifecycle-repository';

export {
  MATERIAL_ALBUM_CREATION_ROOT_ID,
  MATERIAL_ALBUM_CREATION_UNASSIGNED_ID,
  MATERIAL_ALBUM_DICTIONARY_ID,
  isSystemMaterialAlbumId,
  materialAlbumAssetFilter,
  materialAlbumCreationAlbumId,
  materialAlbumCreationAlbumSourceId,
  materialAlbumCreationSeriesId,
  materialAlbumCreationSeriesSourceId,
  materialAlbumDictionaryDomainId,
  materialAlbumDictionaryDomainSourceId,
} from '@/main/database/albums/material-album-scopes';

export class MaterialAlbumRepository extends MaterialAlbumReader {
  create(input: MaterialAlbumCreateInput): MaterialAlbumDto {
    const title = normalizeTitle(input.title);
    const locale = input.locale ?? 'zh';
    const id = ulid();
    const timestamp = now();
    this.db
      .transaction(() => {
        if (input.parentAlbumId) this.assertMutableAlbum(input.parentAlbumId);
        this.db
          .prepare(
            `INSERT INTO albums
          (id, title, title_locale, intent, defaults_json, pinned, created_at, updated_at)
          VALUES (?, ?, ?, ?, '{}', 0, ?, ?)`,
          )
          .run(id, title, locale, MATERIAL_LIBRARY_ALBUM_INTENT, timestamp, timestamp);
        this.storage.recordChange('ALBUM', id, 'CREATE', { title, locale });
        if (input.parentAlbumId) {
          this.attachChildAlbum(input.parentAlbumId, id, timestamp);
        }
      })
      .immediate();
    return this.getUserAlbumDto(id, locale);
  }

  createCollectionFromSource(
    input: CreateMaterialCollectionFromSourceInput,
    snapshotAssetIds: readonly string[],
  ): CreateMaterialCollectionFromSourceResult {
    const source = this.resolveCollectionSource(input);
    const title = input.title === undefined ? source.title : normalizeTitle(input.title);
    const imageAssetIds = [...new Set(snapshotAssetIds)];
    if (imageAssetIds.length === 0) throw new Error('Material collection source has no materials');

    const collectionId = this.db
      .transaction(() => {
        this.assertAssetsMatchSource(imageAssetIds, source.filter);
        const materialIds = ensureImageMaterials(this.storage, imageAssetIds);
        const collectionId = ulid();
        const timestamp = now();
        this.db
          .prepare(
            `INSERT INTO albums
          (id, title, title_locale, intent, defaults_json, pinned, created_at, updated_at)
          VALUES (?, ?, ?, ?, '{}', 0, ?, ?)`,
          )
          .run(collectionId, title, input.locale, MATERIAL_LIBRARY_ALBUM_INTENT, timestamp, timestamp);
        this.storage.recordChange('ALBUM', collectionId, 'CREATE', {
          title,
          source: input.source,
        });

        const insertMember = this.db.prepare(
          `INSERT INTO album_members
          (id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
          VALUES (?, ?, 'MATERIAL', ?, ?, ?, ?, NULL)`,
        );
        for (const [sortOrder, materialId] of materialIds.entries()) {
          const memberId = ulid();
          insertMember.run(memberId, collectionId, materialId, sortOrder, timestamp, timestamp);
          this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
            albumId: collectionId,
            materialId,
            sortOrder,
          });
        }
        return collectionId;
      })
      .immediate();

    return {
      source: input.source,
      collection: this.getUserAlbumDto(collectionId, input.locale) as MaterialCollectionDto,
      capturedMaterialCount: imageAssetIds.length,
    };
  }

  renameCreationAlbum(input: RenameCreationAlbumInput): CreationAlbumDto {
    const locale = input.locale ?? 'zh';
    return this.db
      .transaction(() => {
        const existing = this.db
          .prepare(
            `SELECT title FROM albums
          WHERE id = ? AND deleted_at IS NULL`,
          )
          .get(input.creationAlbumId) as JsonMap | undefined;
        if (!existing) throw new Error('Creation album not found');
        const title = normalizeCreationAlbumTitle(input.title);
        if (text(existing.title) !== title) {
          this.albums.rename({ albumId: input.creationAlbumId, title, locale });
        }
        return this.getCreationAlbumDto(input.creationAlbumId, locale);
      })
      .immediate();
  }

  rename(input: MaterialAlbumRenameInput): MaterialAlbumDto {
    const title = normalizeTitle(input.title);
    const locale = input.locale ?? 'zh';
    this.assertMutableAlbum(input.albumId);
    this.db
      .transaction(() => {
        const timestamp = now();
        writeLocalizedTitle(this.db, 'ALBUM', input.albumId, locale, title);
        this.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(timestamp, input.albumId);
        this.storage.recordChange('ALBUM', input.albumId, 'RENAME', { title, locale });
      })
      .immediate();
    return this.getUserAlbumDto(input.albumId, locale);
  }

  move(input: MaterialAlbumMoveInput): MaterialAlbumDto {
    const locale = input.locale ?? 'zh';
    this.db
      .transaction(() => {
        this.assertMutableAlbum(input.albumId);
        if (input.parentAlbumId === input.albumId) throw new Error('A material album cannot contain itself');
        if (input.parentAlbumId) {
          this.assertMutableAlbum(input.parentAlbumId);
          const descendant = this.db
            .prepare(
              `WITH RECURSIVE descendants(id) AS (
                SELECT target_id FROM album_members
                WHERE album_id = ? AND target_type = 'ALBUM' AND deleted_at IS NULL
                UNION
                SELECT member.target_id FROM album_members member
                JOIN descendants parent ON member.album_id = parent.id
                WHERE member.target_type = 'ALBUM' AND member.deleted_at IS NULL
              ) SELECT 1 FROM descendants WHERE id = ? LIMIT 1`,
            )
            .get(input.albumId, input.parentAlbumId);
          if (descendant) throw new Error('A material album cannot be moved into its descendant');
        }

        const oldParents = this.db
          .prepare(
            `SELECT id, album_id FROM album_members
              WHERE target_type = 'ALBUM' AND target_id = ? AND deleted_at IS NULL`,
          )
          .all(input.albumId) as JsonMap[];
        const alreadyAtTarget = input.parentAlbumId
          ? oldParents.length === 1 && text(oldParents[0].album_id) === input.parentAlbumId
          : oldParents.length === 0;
        if (alreadyAtTarget) return;

        const timestamp = now();
        const touchedAlbumIds = new Set<string>([input.albumId]);
        for (const parent of oldParents) {
          const memberId = text(parent.id);
          const parentAlbumId = text(parent.album_id);
          this.db
            .prepare('UPDATE album_members SET deleted_at = ?, updated_at = ? WHERE id = ?')
            .run(timestamp, timestamp, memberId);
          this.db
            .prepare("INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')")
            .run(ulid(), memberId, timestamp);
          this.storage.recordChange('ALBUM_MEMBER', memberId, 'DELETE', {
            albumId: parentAlbumId,
            targetType: 'ALBUM',
            targetId: input.albumId,
          });
          touchedAlbumIds.add(parentAlbumId);
        }

        if (input.parentAlbumId) {
          const existing = this.db
            .prepare(
              `SELECT id FROM album_members
                WHERE album_id = ? AND target_type = 'ALBUM' AND target_id = ?`,
            )
            .get(input.parentAlbumId, input.albumId) as JsonMap | undefined;
          const nextOrder = Number(
            (
              this.db
                .prepare(
                  `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
                    FROM album_members WHERE album_id = ? AND deleted_at IS NULL`,
                )
                .get(input.parentAlbumId) as JsonMap
            ).next_order,
          );
          if (existing) {
            const memberId = text(existing.id);
            this.db
              .prepare(
                `UPDATE album_members
                  SET sort_order = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`,
              )
              .run(nextOrder, timestamp, memberId);
            this.storage.recordChange('ALBUM_MEMBER', memberId, 'RESTORE', {
              albumId: input.parentAlbumId,
              targetType: 'ALBUM',
              targetId: input.albumId,
              sortOrder: nextOrder,
            });
          } else {
            const memberId = ulid();
            this.db
              .prepare(
                `INSERT INTO album_members
                  (id, album_id, target_type, target_id, sort_order, created_at, updated_at)
                  VALUES (?, ?, 'ALBUM', ?, ?, ?, ?)`,
              )
              .run(memberId, input.parentAlbumId, input.albumId, nextOrder, timestamp, timestamp);
            this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
              albumId: input.parentAlbumId,
              targetType: 'ALBUM',
              targetId: input.albumId,
              sortOrder: nextOrder,
            });
          }
          touchedAlbumIds.add(input.parentAlbumId);
        }

        const touchAlbum = this.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ? AND deleted_at IS NULL');
        for (const albumId of touchedAlbumIds) touchAlbum.run(timestamp, albumId);
        this.storage.recordChange('ALBUM', input.albumId, 'MOVE', { parentAlbumId: input.parentAlbumId });
      })
      .immediate();
    return this.getUserAlbumDto(input.albumId, locale);
  }

  delete(albumId: string): void {
    this.assertMutableAlbum(albumId);
    new ContentLifecycleRepository(this.storage, async () => undefined).applyDirect('DELETE', {
      entityType: 'ALBUM',
      entityId: albumId,
    });
  }

  addMany(input: MaterialAlbumAddManyInput): MaterialAlbumDto;

  addMany(input: MaterialAlbumAddManyInput, options: { returnDto: false }): void;

  addMany(input: MaterialAlbumAddManyInput, options?: { returnDto: false }): MaterialAlbumDto | void {
    const locale = input.locale ?? 'zh';
    this.assertMutableAlbum(input.albumId);
    return this.db
      .transaction(() => {
        const requestedMaterialIds = [
          ...new Set(input.targets.flatMap((target) => (target.kind === 'MATERIAL' ? [target.materialId] : []))),
        ];
        const requestedAssetIds = [
          ...new Set(input.targets.flatMap((target) => (target.kind === 'IMAGE_ASSET' ? [target.imageAssetId] : []))),
        ];
        this.requireMaterials(requestedMaterialIds);
        const assetMaterialIds = ensureImageMaterials(this.storage, requestedAssetIds);
        const materialByAssetId = new Map(
          requestedAssetIds.map((assetId, index) => [assetId, assetMaterialIds[index]]),
        );
        const materialIds: string[] = [];
        const seen = new Set<string>();
        for (const target of input.targets) {
          const materialId =
            target.kind === 'MATERIAL' ? target.materialId : (materialByAssetId.get(target.imageAssetId) as string);
          if (seen.has(materialId)) continue;
          seen.add(materialId);
          materialIds.push(materialId);
        }
        let sortOrder = Number(
          (
            this.db
              .prepare(
                `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
          FROM album_members WHERE album_id = ? AND deleted_at IS NULL`,
              )
              .get(input.albumId) as JsonMap
          ).next_order,
        );
        const membershipsByMaterialId = new Map<string, JsonMap>();
        for (const batch of batches(materialIds)) {
          const rows = this.db
            .prepare(
              `SELECT id, target_id, deleted_at FROM album_members
              WHERE album_id = ? AND target_type = 'MATERIAL'
                AND target_id IN (${placeholders(batch.length)})`,
            )
            .all(input.albumId, ...batch) as JsonMap[];
          for (const row of rows) membershipsByMaterialId.set(text(row.target_id), row);
        }
        const restoreMembership = this.db.prepare(
          `UPDATE album_members
          SET sort_order = ?, updated_at = ?, deleted_at = NULL WHERE id = ?`,
        );
        const insertMembership = this.db.prepare(
          `INSERT INTO album_members
          (id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at)
          VALUES (?, ?, 'MATERIAL', ?, ?, ?, ?, NULL)`,
        );
        for (const materialId of materialIds) {
          const existing = membershipsByMaterialId.get(materialId);
          if (existing && !existing.deleted_at) continue;
          const timestamp = now();
          if (existing) {
            const memberId = text(existing.id);
            restoreMembership.run(sortOrder, timestamp, memberId);
            this.storage.recordChange('ALBUM_MEMBER', memberId, 'RESTORE', {
              albumId: input.albumId,
              materialId,
              sortOrder,
            });
          } else {
            const memberId = ulid();
            insertMembership.run(memberId, input.albumId, materialId, sortOrder, timestamp, timestamp);
            this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
              albumId: input.albumId,
              materialId,
              sortOrder,
            });
          }
          sortOrder += 1;
        }
        this.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), input.albumId);
        if (options?.returnDto === false) return;
        return this.getUserAlbumDto(input.albumId, locale);
      })
      .immediate();
  }

  remove(input: MaterialAlbumRemoveInput): MaterialAlbumDto {
    const locale = input.locale ?? 'zh';
    this.assertMutableAlbum(input.albumId);
    return this.db
      .transaction(() => {
        const materialIds = [...new Set(input.materialIds)];
        const membershipsByMaterialId = new Map<string, string>();
        for (const batch of batches(materialIds)) {
          const rows = this.db
            .prepare(
              `SELECT id, target_id FROM album_members
                WHERE album_id = ? AND target_type = 'MATERIAL'
                  AND target_id IN (${placeholders(batch.length)}) AND deleted_at IS NULL`,
            )
            .all(input.albumId, ...batch) as JsonMap[];
          for (const row of rows) membershipsByMaterialId.set(text(row.target_id), text(row.id));
        }
        const deleteMembership = this.db.prepare(
          'UPDATE album_members SET updated_at = ?, deleted_at = ? WHERE id = ?',
        );
        const insertTombstone = this.db.prepare(
          "INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')",
        );
        for (const materialId of materialIds) {
          const memberId = membershipsByMaterialId.get(materialId);
          if (!memberId) continue;
          const deletedAt = now();
          deleteMembership.run(deletedAt, deletedAt, memberId);
          insertTombstone.run(ulid(), memberId, deletedAt);
          this.storage.recordChange('ALBUM_MEMBER', memberId, 'DELETE', {
            albumId: input.albumId,
            materialId,
          });
        }
        this.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), input.albumId);
        return this.getUserAlbumDto(input.albumId, locale);
      })
      .immediate();
  }

  private assertAssetsMatchSource(
    imageAssetIds: readonly string[],
    filter: { predicate: string; parameters: readonly string[] },
  ) {
    const matched = new Set<string>();
    for (const batch of batches(imageAssetIds)) {
      const rows = this.db
        .prepare(
          `SELECT asset.id FROM image_assets asset
            WHERE asset.id IN (${placeholders(batch.length)})
              AND asset.deleted_at IS NULL AND ${filter.predicate}`,
        )
        .all(...batch, ...filter.parameters) as JsonMap[];
      for (const row of rows) matched.add(text(row.id));
    }
    if (matched.size !== imageAssetIds.length) {
      throw new Error('Material collection snapshot contains an asset outside its source');
    }
  }

  private resolveCollectionSource(input: CreateMaterialCollectionFromSourceInput) {
    if (input.source.kind === 'MATERIAL_VIEW') {
      const viewId = input.source.viewId;
      if (viewId === MATERIAL_ALBUM_CREATION_ROOT_ID) {
        return { title: input.locale === 'zh' ? '创作' : 'Creation', filter: materialAlbumAssetFilter(viewId) };
      }
      if (viewId === MATERIAL_ALBUM_DICTIONARY_ID) {
        return { title: input.locale === 'zh' ? '词典' : 'Dictionary', filter: materialAlbumAssetFilter(viewId) };
      }
      if (viewId === MATERIAL_ALBUM_DICTIONARY_UNCATEGORIZED_ID) {
        return { title: input.locale === 'zh' ? '未分类' : 'Uncategorized', filter: materialAlbumAssetFilter(viewId) };
      }
      const domainId = materialAlbumDictionaryDomainSourceId(viewId);
      if (domainId) {
        const nameColumn = input.locale === 'zh' ? 'name_zh' : 'name_en';
        const domain = this.db
          .prepare(
            `SELECT value.${nameColumn} AS title FROM facet_values value
              JOIN facet_definitions definition ON definition.id = value.definition_id
              WHERE value.id = ? AND definition.system_role = 'PRIMARY_CLASSIFICATION'`,
          )
          .get(domainId) as JsonMap | undefined;
        if (!domain) throw new Error('Material view not found');
        return { title: text(domain.title), filter: materialAlbumAssetFilter(viewId) };
      }
      const sourceAlbumId = materialAlbumCreationAlbumSourceId(viewId);
      if (sourceAlbumId) {
        const sourceAlbum = this.db
          .prepare('SELECT id, title, title_locale FROM albums WHERE id = ? AND deleted_at IS NULL')
          .get(sourceAlbumId) as JsonMap | undefined;
        if (!sourceAlbum) throw new Error('Material view not found');
        return {
          title: resolveStoredTitle(
            sourceAlbum,
            input.locale,
            titleLocalizationsByOwner(this.db, 'ALBUM', [sourceAlbumId]).get(sourceAlbumId) ?? [],
          ),
          filter: materialAlbumAssetFilter(viewId),
        };
      }
      throw new Error('Material view not found');
    }
    if (input.source.kind === 'CREATION_ALBUM' || input.source.kind === 'CREATION_GROUP') {
      const creationAlbumId =
        input.source.kind === 'CREATION_ALBUM' ? input.source.creationAlbumId : input.source.creationGroupId;
      const creationAlbum = this.db
        .prepare(
          `SELECT id, title, title_locale FROM albums
          WHERE id = ? AND deleted_at IS NULL`,
        )
        .get(creationAlbumId) as JsonMap | undefined;
      if (!creationAlbum) throw new Error('Creation album not found');
      const viewId = materialAlbumCreationAlbumId(text(creationAlbum.id));
      return {
        title: resolveStoredTitle(
          creationAlbum,
          input.locale,
          titleLocalizationsByOwner(this.db, 'ALBUM', [text(creationAlbum.id)]).get(text(creationAlbum.id)) ?? [],
        ),
        filter: materialAlbumAssetFilter(viewId),
      };
    }
    const series = this.db
      .prepare(
        `SELECT id, title, title_locale FROM prompt_series
        WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(input.source.seriesId) as JsonMap | undefined;
    if (!series) throw new Error('Prompt series not found');
    const title = resolveStoredTitle(
      series,
      input.locale,
      titleLocalizationsByOwner(this.db, 'PROMPT_SERIES', [text(series.id)]).get(text(series.id)) ?? [],
    );
    return {
      title,
      filter: {
        predicate: promptSeriesAssetPredicate,
        parameters: [text(series.id)],
      },
    };
  }

  private assertMutableAlbum(albumId: string) {
    if (isSystemMaterialAlbumId(albumId)) throw new Error('System material albums are read-only');
    if (
      !this.db
        .prepare(
          `WITH RECURSIVE lineage(id, deleted_at) AS (
            SELECT id, deleted_at FROM albums WHERE id = ? AND intent = ?
            UNION
            SELECT parent.id, parent.deleted_at
            FROM lineage child
            JOIN album_members relation ON relation.target_type = 'ALBUM'
              AND relation.target_id = child.id AND relation.deleted_at IS NULL
            JOIN albums parent ON parent.id = relation.album_id
          )
          SELECT 1
          FROM (
            SELECT COUNT(*) AS lineage_count,
              SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted_album_count
            FROM lineage
          ) validation
          WHERE validation.lineage_count > 0
            AND validation.deleted_album_count = 0`,
        )
        .get(albumId, MATERIAL_LIBRARY_ALBUM_INTENT)
    ) {
      throw new Error('Material album not found');
    }
  }

  private attachChildAlbum(parentAlbumId: string, childAlbumId: string, timestamp: string) {
    const nextOrder = Number(
      (
        this.db
          .prepare(
            `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
            FROM album_members WHERE album_id = ? AND deleted_at IS NULL`,
          )
          .get(parentAlbumId) as JsonMap
      ).next_order,
    );
    const memberId = ulid();
    this.db
      .prepare(
        `INSERT INTO album_members
          (id, album_id, target_type, target_id, sort_order, created_at, updated_at)
          VALUES (?, ?, 'ALBUM', ?, ?, ?, ?)`,
      )
      .run(memberId, parentAlbumId, childAlbumId, nextOrder, timestamp, timestamp);
    this.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(timestamp, parentAlbumId);
    this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
      albumId: parentAlbumId,
      targetType: 'ALBUM',
      targetId: childAlbumId,
    });
  }

  private requireMaterials(materialIds: readonly string[]) {
    const found = new Set<string>();
    for (const batch of batches(materialIds)) {
      const rows = this.db
        .prepare(
          `SELECT material.id FROM materials material
            LEFT JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
            WHERE material.id IN (${placeholders(batch.length)})
              AND material.deleted_at IS NULL AND material.archived_at IS NULL
              AND (material.kind = 'TEXT' OR (material.kind IN ('IMAGE', 'VIDEO') AND asset.id IS NOT NULL))`,
        )
        .all(...batch) as JsonMap[];
      for (const row of rows) found.add(text(row.id));
    }
    if (found.size !== materialIds.length) throw new Error('Material not found');
  }
}
