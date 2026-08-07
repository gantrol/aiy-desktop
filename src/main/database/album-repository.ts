import { ulid } from 'ulid';
import type {
  AssetDto,
  AlbumDto,
  AlbumCreationDefaultsUpdateInput,
  AlbumMemberDto,
  AlbumCreateInput,
  AlbumRenameInput,
  AlbumAddMembersInput,
  AlbumRemoveMembersInput,
  AlbumReorderMembersInput,
  SidebarRootReorderInput,
  SidebarRootOrderTargetInput,
  AlbumSetPinnedInput,
  AlbumSetArchivedInput,
  AlbumMoveInput,
  AlbumMoveSeriesInput,
} from '@/shared/contracts';
import { normalizeAlbumCreationDefaults, parseAlbumCreationDefaults } from '@/shared/album-creation-defaults';
import { moveAlbumSeries } from '@/main/database/album-series-move';
import type { LibraryStorage } from '@/main/database/storage';
import { AlbumProjectionRepository, type AlbumProjectionSummary } from '@/main/database/album-projection-repository';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/album-intents';
import {
  databaseBatches as batches,
  ensureImageMaterials as ensureImageMaterialBatch,
  sqlPlaceholders as placeholders,
} from '@/main/database/image-material-batch';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/values';

function assetDto(row: JsonMap, prefix = ''): AssetDto {
  const id = text(row[`${prefix}id`]);
  return {
    id,
    kind: text(row[`${prefix}kind`]) as AssetDto['kind'],
    originType: text(row[`${prefix}origin_type`]),
    width: Number(row[`${prefix}width`]),
    height: Number(row[`${prefix}height`]),
    mimeType: text(row[`${prefix}mime_type`]),
    byteSize: Number(row[`${prefix}byte_size`]),
    mediaUrl: mediaUrl(id),
    createdAt: text(row[`${prefix}created_at`]),
  };
}

export class AlbumRepository {
  private readonly storage: LibraryStorage;
  private readonly projection: AlbumProjectionRepository;

  constructor(storage: LibraryStorage) {
    this.storage = storage;
    this.projection = new AlbumProjectionRepository(storage);
  }

  private get db() {
    return this.storage.db;
  }

  list(): AlbumDto[] {
    const rows = this.db
      .prepare(
        `SELECT album.*,
        creator_order.sort_order AS creator_root_sort_order,
        gallery_order.sort_order AS gallery_root_sort_order
      FROM albums album
      LEFT JOIN sidebar_root_order creator_order
        ON creator_order.scope = 'CREATOR'
        AND creator_order.target_type = 'ALBUM' AND creator_order.target_id = album.id
      LEFT JOIN sidebar_root_order gallery_order
        ON gallery_order.scope = 'GALLERY'
        AND gallery_order.target_type = 'ALBUM' AND gallery_order.target_id = album.id
      WHERE album.deleted_at IS NULL AND album.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
      ORDER BY album.id`,
      )
      .all() as JsonMap[];
    if (rows.length === 0) return [];
    const membersByAlbum = this.albumMemberDtosByAlbum();
    const projectionsByAlbum = this.projection.listSummaries();
    return rows
      .map((row) => {
        const albumId = text(row.id);
        const projection = projectionsByAlbum.get(albumId);
        if (!projection) throw new Error(`Album projection missing for ${albumId}`);
        return this.albumDto(row, {
          members: membersByAlbum.get(albumId) ?? [],
          projection,
        });
      })
      .sort(
        (left, right) =>
          Number(right.pinned) - Number(left.pinned) ||
          right.activityAt.localeCompare(left.activityAt) ||
          left.id.localeCompare(right.id),
      );
  }

  create(input: AlbumCreateInput): AlbumDto {
    return this.db.transaction(() => {
      if (input.intent?.trim() === MATERIAL_LIBRARY_ALBUM_INTENT)
        throw new Error('Material library albums must use the material album API');
      if (input.parentAlbumId) this.assertAlbumAcceptsContent(input.parentAlbumId);
      const id = ulid();
      const timestamp = now();
      this.db
        .prepare(
          `INSERT INTO albums
        (id, title, intent, defaults_json, pinned, created_at, updated_at, content_updated_at)
        VALUES (?, ?, ?, '{}', 0, ?, ?, ?)`,
        )
        .run(id, input.title.trim(), input.intent?.trim() ?? '', timestamp, timestamp, timestamp);
      this.storage.recordChange('ALBUM', id, 'CREATE', { title: input.title });
      if (input.parentAlbumId) this.move({ albumId: id, parentAlbumId: input.parentAlbumId });
      return this.getAlbumDto(id);
    })();
  }

  get(albumId: string): AlbumDto {
    return this.getAlbumDto(albumId);
  }

  getActive(albumId: string): AlbumDto {
    this.assertAlbumAcceptsContent(albumId);
    return this.getAlbumDto(albumId);
  }

  private assertAlbumAcceptsContent(albumId: string) {
    this.assertAlbumExists(albumId);
    const archived = this.db
      .prepare(
        `WITH RECURSIVE lineage(id, archived_at) AS (
        SELECT id, archived_at FROM albums WHERE id = ? AND deleted_at IS NULL
        UNION
        SELECT parent.id, parent.archived_at
        FROM lineage child
        JOIN album_members relation
          ON relation.target_type = 'ALBUM'
          AND relation.target_id = child.id
          AND relation.deleted_at IS NULL
        JOIN albums parent ON parent.id = relation.album_id AND parent.deleted_at IS NULL
      )
      SELECT 1 FROM lineage WHERE archived_at IS NOT NULL LIMIT 1`,
      )
      .get(albumId);
    if (archived) throw new Error('Archived albums cannot accept new content');
  }

  updateCreationDefaults(input: AlbumCreationDefaultsUpdateInput): AlbumDto {
    return this.db.transaction(() => {
      this.assertAlbumExists(input.albumId);
      const defaults = normalizeAlbumCreationDefaults(input.defaults);
      for (const reference of defaults.recipes) this.assertPaletteReference(reference);
      const timestamp = now();
      this.db
        .prepare(
          `UPDATE albums SET defaults_json = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(JSON.stringify(defaults), timestamp, input.albumId);
      this.storage.recordChange('ALBUM', input.albumId, 'UPDATE_CREATION_DEFAULTS', { defaults });
      return this.getAlbumDto(input.albumId);
    })();
  }

  rename(input: AlbumRenameInput): AlbumDto {
    return this.db.transaction(() => {
      const timestamp = now();
      this.db
        .prepare(
          `UPDATE albums SET title = ?, updated_at = ?, content_updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(input.title.trim(), timestamp, timestamp, input.albumId);
      this.storage.recordChange('ALBUM', input.albumId, 'UPDATE', { title: input.title });
      return this.getAlbumDto(input.albumId);
    })();
  }

  delete(albumId: string): void {
    this.db.transaction(() => {
      this.assertAlbumExists(albumId);
      const timestamp = now();
      const relationships = this.db
        .prepare(
          `SELECT id, album_id, target_type, target_id
        FROM album_members
        WHERE deleted_at IS NULL AND (
          album_id = ? OR (target_type = 'ALBUM' AND target_id = ?)
        )`,
        )
        .all(albumId, albumId) as JsonMap[];
      const parentAlbumIds = new Set<string>();
      for (const relationship of relationships) {
        const memberId = text(relationship.id);
        const ownerAlbumId = text(relationship.album_id);
        this.db
          .prepare('UPDATE album_members SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(timestamp, timestamp, memberId);
        this.db
          .prepare("INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')")
          .run(ulid(), memberId, timestamp);
        this.storage.recordChange('ALBUM_MEMBER', memberId, 'DELETE', {
          albumId: ownerAlbumId,
          targetType: text(relationship.target_type),
          targetId: text(relationship.target_id),
          reason: 'ALBUM_DELETE',
        });
        if (ownerAlbumId !== albumId) parentAlbumIds.add(ownerAlbumId);
      }
      this.db
        .prepare(
          `UPDATE albums SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(timestamp, timestamp, albumId);
      this.db.prepare("INSERT INTO tombstones VALUES (?, 'ALBUM', ?, ?, 'LOCAL_ONLY')").run(ulid(), albumId, timestamp);
      this.storage.recordChange('ALBUM', albumId, 'DELETE', {});
      for (const parentAlbumId of parentAlbumIds) this.touchAlbumContent(parentAlbumId, timestamp);
    })();
  }

  setPinned(input: AlbumSetPinnedInput): AlbumDto {
    return this.db.transaction(() => {
      const timestamp = now();
      this.db
        .prepare(
          `UPDATE albums SET pinned = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(input.pinned ? 1 : 0, timestamp, input.albumId);
      this.storage.recordChange('ALBUM', input.albumId, 'UPDATE', { pinned: input.pinned });
      return this.getAlbumDto(input.albumId);
    })();
  }

  archive(albumId: string): AlbumDto {
    return this.setArchived({ albumId, archived: true });
  }

  listTextMaterials(albumId: string) {
    if (!this.db.prepare('SELECT 1 FROM albums WHERE id = ? AND deleted_at IS NULL').get(albumId))
      throw new Error('Album not found');
    return this.projection.listTextMaterials(albumId);
  }

  setArchived(input: AlbumSetArchivedInput): AlbumDto {
    return this.db.transaction(() => {
      const timestamp = now();
      this.db
        .prepare(
          `UPDATE albums SET archived_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(input.archived ? timestamp : null, timestamp, input.albumId);
      this.storage.recordChange('ALBUM', input.albumId, 'UPDATE', { archived: input.archived });
      return this.getAlbumDto(input.albumId);
    })();
  }

  move(input: AlbumMoveInput): void {
    this.db.transaction(() => {
      this.assertAlbumExists(input.albumId);
      if (input.parentAlbumId === input.albumId) throw new Error('An album cannot contain itself');
      if (input.parentAlbumId) {
        this.assertAlbumAcceptsContent(input.parentAlbumId);
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
        if (descendant) throw new Error('An album cannot be moved into its descendant');
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
      for (const parent of oldParents) {
        const memberId = text(parent.id);
        this.db
          .prepare('UPDATE album_members SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(timestamp, timestamp, memberId);
        this.db
          .prepare("INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')")
          .run(ulid(), memberId, timestamp);
        this.storage.recordChange('ALBUM_MEMBER', memberId, 'DELETE', {
          albumId: text(parent.album_id),
          targetType: 'ALBUM',
          targetId: input.albumId,
        });
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
              `UPDATE album_members SET sort_order = ?, updated_at = ?, deleted_at = NULL
            WHERE id = ?`,
            )
            .run(nextOrder, timestamp, memberId);
          this.storage.recordChange('ALBUM_MEMBER', memberId, 'RESTORE', {
            albumId: input.parentAlbumId,
            targetType: 'ALBUM',
            targetId: input.albumId,
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
          });
        }
        this.touchAlbumContent(input.parentAlbumId, timestamp);
      }
      for (const parent of oldParents) this.touchAlbumContent(text(parent.album_id), timestamp);
      this.touchAlbumContent(input.albumId, timestamp);
      this.storage.recordChange('ALBUM', input.albumId, 'MOVE', { parentAlbumId: input.parentAlbumId });
    })();
  }

  moveSeries(input: AlbumMoveSeriesInput): void {
    moveAlbumSeries(this.storage, input);
  }

  addMembers(input: AlbumAddMembersInput): AlbumDto;
  addMembers(input: AlbumAddMembersInput, options: { returnDto: false }): void;
  addMembers(input: AlbumAddMembersInput, options?: { returnDto: false }): AlbumDto | void {
    return this.db
      .transaction(() => {
        this.assertAlbumAcceptsContent(input.albumId);
        const timestamp = now();
        for (const member of input.members) {
          if (member.targetType === 'ALBUM') {
            this.move({ albumId: member.targetId, parentAlbumId: input.albumId });
          }
        }
        const materialTargetIds = [
          ...new Set(input.members.flatMap((member) => (member.targetType === 'MATERIAL' ? [member.targetId] : []))),
        ];
        const resolvedMaterialIds = this.resolveMaterialIds(materialTargetIds);
        const maxOrder = Number(
          (
            this.db
              .prepare(
                `SELECT COALESCE(MAX(sort_order), -1) AS max_order
        FROM album_members WHERE album_id = ? AND deleted_at IS NULL`,
              )
              .get(input.albumId) as JsonMap
          ).max_order,
        );
        let nextOrder = maxOrder + 1;
        let membershipChanged = false;
        const existingByTarget = new Map<string, JsonMap>();
        const loadExistingMemberships = (targetType: 'MATERIAL' | 'SERIES', targetIds: readonly string[]) => {
          for (const batch of batches([...new Set(targetIds)])) {
            const rows = this.db
              .prepare(
                `SELECT id, target_type, target_id, deleted_at FROM album_members
              WHERE album_id = ? AND target_type = ?
                AND target_id IN (${placeholders(batch.length)})`,
              )
              .all(input.albumId, targetType, ...batch) as JsonMap[];
            for (const row of rows) existingByTarget.set(`${targetType}:${text(row.target_id)}`, row);
          }
        };
        loadExistingMemberships('MATERIAL', [...resolvedMaterialIds.values()]);
        loadExistingMemberships(
          'SERIES',
          input.members.flatMap((member) => (member.targetType === 'SERIES' ? [member.targetId] : [])),
        );
        for (const member of input.members) {
          if (member.targetType === 'ALBUM') continue;
          const targetType = member.targetType;
          // A MATERIAL member is addressed by materials.id; callers may hand us an
          // image_asset id, so promote it before recording the edge.
          const targetId =
            targetType === 'MATERIAL' ? (resolvedMaterialIds.get(member.targetId) as string) : member.targetId;
          if (targetType === 'SERIES') {
            if (
              !this.db
                .prepare(
                  `SELECT 1 FROM prompt_series
            WHERE id = ? AND deleted_at IS NULL`,
                )
                .get(targetId)
            )
              throw new Error('Creation not found');
            const oldMemberships = this.db
              .prepare(
                `SELECT id, album_id FROM album_members
            WHERE target_type = 'SERIES' AND target_id = ?
              AND album_id <> ? AND deleted_at IS NULL`,
              )
              .all(targetId, input.albumId) as JsonMap[];
            for (const oldMembership of oldMemberships) {
              const oldMemberId = text(oldMembership.id);
              const oldAlbumId = text(oldMembership.album_id);
              this.db
                .prepare(
                  `UPDATE album_members SET deleted_at = ?, updated_at = ?
              WHERE id = ?`,
                )
                .run(timestamp, timestamp, oldMemberId);
              this.db
                .prepare("INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')")
                .run(ulid(), oldMemberId, timestamp);
              this.storage.recordChange('ALBUM_MEMBER', oldMemberId, 'DELETE', {
                albumId: oldAlbumId,
                targetType,
                targetId,
                movedToAlbumId: input.albumId,
              });
              this.touchAlbumContent(oldAlbumId, timestamp);
              membershipChanged = true;
            }
          }
          const existing = existingByTarget.get(`${targetType}:${targetId}`);
          if (existing && !existing.deleted_at) continue;
          if (existing && existing.deleted_at) {
            this.db
              .prepare(
                `UPDATE album_members
            SET sort_order = ?, updated_at = ?, deleted_at = NULL
            WHERE id = ?`,
              )
              .run(nextOrder, timestamp, text(existing.id));
            this.storage.recordChange('ALBUM_MEMBER', text(existing.id), 'RESTORE', {
              albumId: input.albumId,
              targetType,
              targetId,
            });
            existing.deleted_at = null;
            membershipChanged = true;
          } else {
            const memberId = ulid();
            this.db
              .prepare(
                `INSERT INTO album_members
            (id, album_id, target_type, target_id, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(memberId, input.albumId, targetType, targetId, nextOrder, timestamp, timestamp);
            this.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
              albumId: input.albumId,
              targetType,
              targetId,
            });
            existingByTarget.set(`${targetType}:${targetId}`, {
              id: memberId,
              target_type: targetType,
              target_id: targetId,
              deleted_at: null,
            });
            membershipChanged = true;
          }
          nextOrder += 1;
        }
        if (membershipChanged) this.touchAlbumContent(input.albumId, timestamp);
        if (options?.returnDto === false) return;
        return this.getAlbumDto(input.albumId);
      })
      .immediate();
  }

  removeMembers(input: AlbumRemoveMembersInput): AlbumDto {
    return this.db.transaction(() => {
      this.assertAlbumExists(input.albumId);
      const timestamp = now();
      for (const memberId of input.memberIds) {
        const updated = this.db
          .prepare(
            `UPDATE album_members SET deleted_at = ?, updated_at = ?
          WHERE id = ? AND album_id = ? AND deleted_at IS NULL`,
          )
          .run(timestamp, timestamp, memberId, input.albumId);
        if (!updated.changes) continue;
        this.db
          .prepare("INSERT INTO tombstones VALUES (?, 'ALBUM_MEMBER', ?, ?, 'LOCAL_ONLY')")
          .run(ulid(), memberId, timestamp);
        this.storage.recordChange('ALBUM_MEMBER', memberId, 'DELETE', { albumId: input.albumId });
      }
      this.touchAlbumContent(input.albumId, timestamp);
      return this.getAlbumDto(input.albumId);
    })();
  }

  reorderMembers(input: AlbumReorderMembersInput): void {
    this.db.transaction(() => {
      this.assertAlbumExists(input.albumId);
      const activeMemberIds = (
        this.db
          .prepare(
            `SELECT id FROM album_members
          WHERE album_id = ? AND deleted_at IS NULL
          ORDER BY sort_order, id`,
          )
          .all(input.albumId) as JsonMap[]
      ).map((row) => text(row.id));
      const activeMemberIdSet = new Set(activeMemberIds);
      const requestedMemberIds = [...new Set(input.memberIds)].filter((memberId) => activeMemberIdSet.has(memberId));
      const requestedMemberIdSet = new Set(requestedMemberIds);
      const orderedMemberIds = [
        ...requestedMemberIds,
        ...activeMemberIds.filter((memberId) => !requestedMemberIdSet.has(memberId)),
      ];
      if (orderedMemberIds.every((memberId, index) => memberId === activeMemberIds[index])) {
        return;
      }
      const timestamp = now();
      for (let i = 0; i < orderedMemberIds.length; i++) {
        this.db
          .prepare(
            `UPDATE album_members SET sort_order = ?, updated_at = ?
          WHERE id = ? AND album_id = ? AND deleted_at IS NULL`,
          )
          .run(i, timestamp, orderedMemberIds[i], input.albumId);
      }
      this.touchAlbumContent(input.albumId, timestamp);
      this.storage.recordChange('ALBUM', input.albumId, 'REORDER_MEMBERS', { memberIds: orderedMemberIds });
    })();
  }

  reorderRoot(input: SidebarRootReorderInput): void {
    this.db.transaction(() => {
      const activeTargets = this.db
        .prepare(
          `WITH active_targets AS (
        SELECT 'ALBUM' AS target_type, album.id AS target_id, root_order.sort_order
        FROM albums album
        LEFT JOIN sidebar_root_order root_order
          ON root_order.scope = ?
          AND root_order.target_type = 'ALBUM' AND root_order.target_id = album.id
        WHERE album.deleted_at IS NULL AND album.archived_at IS NULL
          AND album.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
          AND NOT EXISTS (
            SELECT 1 FROM album_members member
            JOIN albums parent ON parent.id = member.album_id AND parent.deleted_at IS NULL
            WHERE member.target_type = 'ALBUM' AND member.target_id = album.id AND member.deleted_at IS NULL
          )
        UNION ALL
        SELECT 'SERIES' AS target_type, series.id AS target_id, root_order.sort_order
        FROM prompt_series series
        LEFT JOIN sidebar_root_order root_order
          ON root_order.scope = ?
          AND root_order.target_type = 'SERIES' AND root_order.target_id = series.id
        WHERE ? = 'CREATOR' AND series.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM album_members member
            JOIN albums parent ON parent.id = member.album_id AND parent.deleted_at IS NULL
            WHERE member.target_type = 'SERIES' AND member.target_id = series.id AND member.deleted_at IS NULL
          )
        )
        SELECT * FROM active_targets
        ORDER BY sort_order IS NULL, sort_order, target_type, target_id`,
        )
        .all(input.scope, input.scope, input.scope) as JsonMap[];
      const targetByKey = new Map<string, SidebarRootOrderTargetInput>();
      for (const row of activeTargets) {
        const target = {
          targetType: text(row.target_type) as SidebarRootOrderTargetInput['targetType'],
          targetId: text(row.target_id),
        };
        targetByKey.set(`${target.targetType}:${target.targetId}`, target);
      }
      const requested: SidebarRootOrderTargetInput[] = [];
      const requestedKeys = new Set<string>();
      for (const target of input.targets) {
        const key = `${target.targetType}:${target.targetId}`;
        const active = targetByKey.get(key);
        if (!active || requestedKeys.has(key)) continue;
        requested.push(active);
        requestedKeys.add(key);
      }
      const ordered = [
        ...requested,
        ...[...targetByKey].flatMap(([key, target]) => (requestedKeys.has(key) ? [] : [target])),
      ];
      const currentKeys = activeTargets.map((row) => `${text(row.target_type)}:${text(row.target_id)}`);
      const nextKeys = ordered.map((target) => `${target.targetType}:${target.targetId}`);
      const hasCompleteOrder = activeTargets.every((row) => row.sort_order !== null && row.sort_order !== undefined);
      if (hasCompleteOrder && nextKeys.every((key, index) => key === currentKeys[index])) return;

      const timestamp = now();
      const upsert = this.db.prepare(
        `INSERT INTO sidebar_root_order(scope, target_type, target_id, sort_order, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(scope, target_type, target_id) DO UPDATE SET
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at`,
      );
      ordered.forEach((target, index) => upsert.run(input.scope, target.targetType, target.targetId, index, timestamp));
      this.storage.recordChange('SIDEBAR_ROOT_ORDER', input.scope, 'REORDER', { targets: ordered });
    })();
  }

  ensureImageMaterial(imageAssetId: string): string {
    return this.ensureImageMaterials([imageAssetId])[0]!;
  }

  ensureImageMaterials(imageAssetIdsInput: readonly string[]): string[] {
    return ensureImageMaterialBatch(this.storage, imageAssetIdsInput);
  }

  private resolveMaterialIds(targetIds: readonly string[]) {
    const resolved = new Map<string, string>();
    for (const batch of batches(targetIds)) {
      const rows = this.db
        .prepare(
          `SELECT id FROM materials
          WHERE id IN (${placeholders(batch.length)}) AND deleted_at IS NULL`,
        )
        .all(...batch) as JsonMap[];
      for (const row of rows) resolved.set(text(row.id), text(row.id));
    }
    const unresolved = targetIds.filter((targetId) => !resolved.has(targetId));
    const promoted = this.ensureImageMaterials(unresolved);
    unresolved.forEach((targetId, index) => resolved.set(targetId, promoted[index]!));
    return resolved;
  }

  private assertAlbumExists(albumId: string) {
    if (
      !this.db
        .prepare(`SELECT 1 FROM albums WHERE id = ? AND deleted_at IS NULL AND intent <> ?`)
        .get(albumId, MATERIAL_LIBRARY_ALBUM_INTENT)
    ) {
      throw new Error('Album not found');
    }
  }

  private assertPaletteReference(reference: AlbumCreationDefaultsUpdateInput['defaults']['recipes'][number]) {
    if (
      !this.db
        .prepare(
          `SELECT 1 FROM word_palettes palette
      JOIN word_palette_revisions revision ON revision.palette_id = palette.id
      WHERE palette.id = ? AND revision.id = ?
        AND palette.archived_at IS NULL AND palette.deleted_at IS NULL`,
        )
        .get(reference.paletteId, reference.paletteRevisionId)
    ) {
      throw new Error('Default recipe is unavailable');
    }
    const parameters = this.db
      .prepare(
        `SELECT id, stable_key, required
      FROM word_palette_revision_parameters WHERE palette_revision_id = ?`,
      )
      .all(reference.paletteRevisionId) as JsonMap[];
    for (const parameter of parameters) {
      const stableKey = text(parameter.stable_key);
      const value = reference.parameterValues[stableKey] ?? '';
      if (parameter.required && !value) throw new Error(`Missing default recipe parameter: ${stableKey}`);
      if (
        value &&
        !this.db
          .prepare(
            `SELECT 1 FROM word_palette_revision_parameter_options
        WHERE parameter_revision_id = ? AND value_key = ?`,
          )
          .get(parameter.id, value)
      ) {
        throw new Error(`Invalid default recipe parameter: ${stableKey}`);
      }
    }
  }

  private getAlbumDto(albumId: string): AlbumDto {
    const row = this.db
      .prepare(
        `SELECT album.*,
        creator_order.sort_order AS creator_root_sort_order,
        gallery_order.sort_order AS gallery_root_sort_order
      FROM albums album
      LEFT JOIN sidebar_root_order creator_order
        ON creator_order.scope = 'CREATOR'
        AND creator_order.target_type = 'ALBUM' AND creator_order.target_id = album.id
      LEFT JOIN sidebar_root_order gallery_order
        ON gallery_order.scope = 'GALLERY'
        AND gallery_order.target_type = 'ALBUM' AND gallery_order.target_id = album.id
      WHERE album.id = ? AND album.deleted_at IS NULL AND album.intent <> ?`,
      )
      .get(albumId, MATERIAL_LIBRARY_ALBUM_INTENT) as JsonMap | undefined;
    if (!row) throw new Error('Album not found');
    return this.albumDto(row);
  }

  private albumDto(
    row: JsonMap,
    preloaded?: {
      members: AlbumMemberDto[];
      projection: AlbumProjectionSummary;
    },
  ): AlbumDto {
    const albumId = text(row.id);
    const members = preloaded?.members ?? this.albumMemberDtos(albumId);
    const projection = preloaded?.projection ?? this.projection.summary(albumId);
    return {
      id: albumId,
      title: text(row.title),
      intent: text(row.intent),
      creationDefaults: parseAlbumCreationDefaults(text(row.defaults_json)),
      pinned: Boolean(row.pinned),
      materialCount: projection.materialCount,
      seriesCount: projection.seriesCount,
      previewAssets: projection.previewAssets,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      activityAt: projection.activityAt,
      archivedAt: row.archived_at ? text(row.archived_at) : null,
      creatorRootSortOrder: row.creator_root_sort_order == null ? null : Number(row.creator_root_sort_order),
      galleryRootSortOrder: row.gallery_root_sort_order == null ? null : Number(row.gallery_root_sort_order),
      members,
    };
  }

  private albumMemberDtos(albumId: string): AlbumMemberDto[] {
    return this.albumMemberDtosByAlbum(albumId).get(albumId) ?? [];
  }

  private albumMemberDtosByAlbum(albumId: string | null = null): Map<string, AlbumMemberDto[]> {
    const rows = this.db
      .prepare(
        `SELECT member.*,
        material.kind AS material_kind,
        material.text_content AS material_text,
        asset.id AS asset_id, asset.kind AS asset_kind, asset.origin_type AS asset_origin_type,
        asset.width AS asset_width, asset.height AS asset_height, asset.mime_type AS asset_mime_type,
        asset.byte_size AS asset_byte_size, asset.created_at AS asset_created_at,
        series.title AS series_title, series.title_zh AS series_title_zh, series.title_en AS series_title_en,
        child_album.title AS child_album_title
      FROM album_members member
      LEFT JOIN materials material ON member.target_type = 'MATERIAL'
        AND material.id = member.target_id AND material.deleted_at IS NULL
      LEFT JOIN image_assets asset ON material.kind = 'IMAGE'
        AND asset.id = material.image_asset_id AND asset.deleted_at IS NULL
      LEFT JOIN prompt_series series ON member.target_type = 'SERIES'
        AND series.id = member.target_id AND series.deleted_at IS NULL
      LEFT JOIN albums child_album ON member.target_type = 'ALBUM'
        AND child_album.id = member.target_id AND child_album.deleted_at IS NULL
      JOIN albums owner_album ON owner_album.id = member.album_id AND owner_album.deleted_at IS NULL
      WHERE (? IS NULL OR member.album_id = ?) AND member.deleted_at IS NULL
        AND (
          (member.target_type = 'MATERIAL' AND material.id IS NOT NULL
            AND (material.kind = 'TEXT' OR asset.id IS NOT NULL))
          OR (member.target_type = 'SERIES' AND series.id IS NOT NULL)
          OR (member.target_type = 'ALBUM' AND child_album.id IS NOT NULL)
        )
      ORDER BY member.album_id, member.sort_order, member.id`,
      )
      .all(albumId, albumId) as JsonMap[];
    const membersByAlbum = new Map<string, AlbumMemberDto[]>();
    for (const row of rows) {
      const targetType = text(row.target_type) as AlbumMemberDto['targetType'];
      const memberAlbumId = text(row.album_id);
      const member: AlbumMemberDto = {
        id: text(row.id),
        albumId: memberAlbumId,
        targetType,
        targetId: text(row.target_id),
        sortOrder: Number(row.sort_order),
        imageAsset: targetType === 'MATERIAL' && text(row.material_kind) === 'IMAGE' ? assetDto(row, 'asset_') : null,
        materialText: targetType === 'MATERIAL' && text(row.material_kind) === 'TEXT' ? text(row.material_text) : null,
        seriesTitle: targetType === 'SERIES' ? text(row.series_title) : null,
        childAlbumTitle: targetType === 'ALBUM' ? text(row.child_album_title) : null,
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      };
      const albumMembers = membersByAlbum.get(memberAlbumId);
      if (albumMembers) albumMembers.push(member);
      else membersByAlbum.set(memberAlbumId, [member]);
    }
    return membersByAlbum;
  }

  private touchAlbumContent(albumId: string, timestamp = now()) {
    this.db
      .prepare(
        `UPDATE albums
      SET updated_at = ?, content_updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(timestamp, timestamp, albumId);
  }
}
