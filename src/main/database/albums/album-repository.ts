import { ulid } from 'ulid';
import type {
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
  Locale,
} from '@/shared/contracts';
import { normalizeAlbumCreationDefaults, parseAlbumCreationDefaults } from '@/shared/album-creation-defaults';
import type { LibraryStorage } from '@/main/database/core/storage';
import {
  AlbumProjectionRepository,
  type AlbumProjectionSummary,
} from '@/main/database/albums/album-projection-repository';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';
import { albumMemberDtosByAlbum } from '@/main/database/albums/album-member-reader';
import {
  databaseBatches as batches,
  ensureImageMaterials as ensureImageMaterialBatch,
  sqlPlaceholders as placeholders,
} from '@/main/database/albums/image-material-batch';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { ContentLifecycleRepository } from '@/main/database/recovery/content-lifecycle-repository';
import {
  resolveStoredTitle,
  titleLocalizationsByOwner,
  writeLocalizedTitle,
} from '@/main/database/core/title-localization';

export class AlbumRepository {
  private readonly storage: LibraryStorage;
  private readonly projection: AlbumProjectionRepository;
  private readonly lifecycle: ContentLifecycleRepository;

  constructor(storage: LibraryStorage) {
    this.storage = storage;
    this.projection = new AlbumProjectionRepository(storage);
    this.lifecycle = new ContentLifecycleRepository(storage, async () => undefined);
  }

  private get db() {
    return this.storage.db;
  }

  list(locale: Locale = 'zh'): AlbumDto[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE unavailable_album(id) AS (
        SELECT id FROM albums WHERE deleted_at IS NOT NULL
        UNION
        SELECT member.target_id
        FROM unavailable_album unavailable
        JOIN album_members member ON member.album_id = unavailable.id
          AND member.target_type = 'ALBUM' AND member.deleted_at IS NULL
      )
      SELECT album.*,
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
        AND NOT EXISTS (SELECT 1 FROM unavailable_album unavailable WHERE unavailable.id = album.id)
      ORDER BY album.id`,
      )
      .all() as JsonMap[];
    if (rows.length === 0) return [];
    const albumIds = rows.map((row) => text(row.id));
    const titleLocalizations = titleLocalizationsByOwner(this.db, 'ALBUM', albumIds);
    const membersByAlbum = albumMemberDtosByAlbum(this.db, null, locale);
    const projectionsByAlbum = this.projection.listSummaries(albumIds);
    return rows
      .map((row) => {
        const albumId = text(row.id);
        const projection = projectionsByAlbum.get(albumId);
        if (!projection) throw new Error(`Album projection missing for ${albumId}`);
        return this.albumDto(row, {
          members: membersByAlbum.get(albumId) ?? [],
          projection,
          locale,
          titleLocalizations: titleLocalizations.get(albumId) ?? [],
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
      const titleLocale = input.titleLocale ?? 'zh';
      if (input.intent?.trim() === MATERIAL_LIBRARY_ALBUM_INTENT)
        throw new Error('Material library albums must use the material album API');
      if (input.parentAlbumId) this.assertAlbumAcceptsContent(input.parentAlbumId);
      const id = ulid();
      const timestamp = now();
      this.db
        .prepare(
          `INSERT INTO albums
        (id, title, title_locale, intent, defaults_json, pinned, created_at, updated_at, content_updated_at)
        VALUES (?, ?, ?, ?, '{}', 0, ?, ?, ?)`,
        )
        .run(id, input.title.trim(), titleLocale, input.intent?.trim() ?? '', timestamp, timestamp, timestamp);
      this.storage.recordChange('ALBUM', id, 'CREATE', { title: input.title });
      if (input.parentAlbumId) this.move({ albumId: id, parentAlbumId: input.parentAlbumId });
      return this.getAlbumDto(id, titleLocale);
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
        `WITH RECURSIVE lineage(id, archived_at, deleted_at) AS (
        SELECT id, archived_at, deleted_at FROM albums WHERE id = ?
        UNION
        SELECT parent.id, parent.archived_at, parent.deleted_at
        FROM lineage child
        JOIN album_members relation
          ON relation.target_type = 'ALBUM'
          AND relation.target_id = child.id
          AND relation.deleted_at IS NULL
        JOIN albums parent ON parent.id = relation.album_id
      )
      SELECT 1 FROM lineage WHERE archived_at IS NOT NULL OR deleted_at IS NOT NULL LIMIT 1`,
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
          `UPDATE albums SET defaults_json = ?, updated_at = ?, content_updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(JSON.stringify(defaults), timestamp, timestamp, input.albumId);
      this.storage.recordChange('ALBUM', input.albumId, 'UPDATE_CREATION_DEFAULTS', { defaults });
      return this.getAlbumDto(input.albumId);
    })();
  }

  rename(input: AlbumRenameInput): AlbumDto {
    return this.db.transaction(() => {
      const locale = input.locale ?? 'zh';
      const timestamp = now();
      writeLocalizedTitle(this.db, 'ALBUM', input.albumId, locale, input.title);
      this.db
        .prepare(
          `UPDATE albums SET updated_at = ?, content_updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(timestamp, timestamp, input.albumId);
      this.storage.recordChange('ALBUM', input.albumId, 'UPDATE', { title: input.title, locale });
      return this.getAlbumDto(input.albumId, locale);
    })();
  }

  delete(albumId: string): void {
    this.lifecycle.applyDirect('DELETE', { entityType: 'ALBUM', entityId: albumId });
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
    this.lifecycle.setDirectArchived({ entityType: 'ALBUM', entityId: input.albumId }, input.archived);
    return this.getAlbumDto(input.albumId);
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
        const loadExistingMemberships = (targetIds: readonly string[]) => {
          for (const batch of batches([...new Set(targetIds)])) {
            const rows = this.db
              .prepare(
                `SELECT id, target_type, target_id, deleted_at FROM album_members
              WHERE album_id = ? AND target_type = 'MATERIAL'
                AND target_id IN (${placeholders(batch.length)})`,
              )
              .all(input.albumId, ...batch) as JsonMap[];
            for (const row of rows) existingByTarget.set(`MATERIAL:${text(row.target_id)}`, row);
          }
        };
        loadExistingMemberships([...resolvedMaterialIds.values()]);
        for (const member of input.members) {
          if (member.targetType === 'ALBUM') continue;
          const targetType = 'MATERIAL' as const;
          // A MATERIAL member is addressed by materials.id; callers may hand us an
          // image_asset id, so promote it before recording the edge.
          const targetId = resolvedMaterialIds.get(member.targetId) as string;
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
        const member = this.db
          .prepare('SELECT target_type FROM album_members WHERE id = ? AND album_id = ? AND deleted_at IS NULL')
          .get(memberId, input.albumId) as JsonMap | undefined;
        if (!member) continue;
        if (text(member.target_type) !== 'MATERIAL') {
          throw new Error('Creation items and child albums must be moved through their owning aggregate');
        }
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
      const requestedMemberQueue = [...requestedMemberIds];
      const orderedMemberIds = activeMemberIds.map((memberId) =>
        requestedMemberIdSet.has(memberId) ? (requestedMemberQueue.shift() ?? memberId) : memberId,
      );
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
        SELECT 'CREATION_ITEM' AS target_type, item.id AS target_id, root_order.sort_order
        FROM creation_items item
        LEFT JOIN sidebar_root_order root_order
          ON root_order.scope = ?
          AND root_order.target_type = 'CREATION_ITEM' AND root_order.target_id = item.id
        WHERE ? = 'CREATOR' AND item.deleted_at IS NULL AND item.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM album_members member
            JOIN albums parent ON parent.id = member.album_id AND parent.deleted_at IS NULL
            WHERE member.target_type = 'CREATION_ITEM' AND member.target_id = item.id AND member.deleted_at IS NULL
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
        .prepare(
          `WITH RECURSIVE lineage(id, deleted_at, intent) AS (
            SELECT id, deleted_at, intent FROM albums WHERE id = ?
            UNION
            SELECT parent.id, parent.deleted_at, parent.intent
            FROM lineage child
            JOIN album_members relation ON relation.target_type = 'ALBUM'
              AND relation.target_id = child.id AND relation.deleted_at IS NULL
            JOIN albums parent ON parent.id = relation.album_id
          )
          SELECT 1
          FROM (
            SELECT COUNT(*) AS lineage_count,
              MAX(CASE WHEN id = ? AND intent <> ? THEN 1 ELSE 0 END) AS requested_album_is_available,
              SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted_album_count
            FROM lineage
          ) validation
          WHERE validation.lineage_count > 0
            AND validation.requested_album_is_available = 1
            AND validation.deleted_album_count = 0`,
        )
        .get(albumId, albumId, MATERIAL_LIBRARY_ALBUM_INTENT)
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

  private getAlbumDto(albumId: string, locale: Locale = 'zh'): AlbumDto {
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
    return this.albumDto(row, { locale });
  }

  private albumDto(
    row: JsonMap,
    preloaded?: {
      members?: AlbumMemberDto[];
      projection?: AlbumProjectionSummary;
      locale?: Locale;
      titleLocalizations?: Array<{ locale: string; title: string }>;
    },
  ): AlbumDto {
    const albumId = text(row.id);
    const locale = preloaded?.locale ?? 'zh';
    const members = preloaded?.members ?? albumMemberDtosByAlbum(this.db, albumId, locale).get(albumId) ?? [];
    const projection = preloaded?.projection ?? this.projection.summary(albumId);
    const localizations =
      preloaded?.titleLocalizations ?? titleLocalizationsByOwner(this.db, 'ALBUM', [albumId]).get(albumId) ?? [];
    return {
      id: albumId,
      title: resolveStoredTitle(row, locale, localizations),
      intent: text(row.intent),
      creationDefaults: parseAlbumCreationDefaults(text(row.defaults_json)),
      pinned: Boolean(row.pinned),
      materialCount: projection.materialCount,
      creationItemCount: projection.creationItemCount,
      previewAssets: projection.previewAssets,
      documentPreviewAssets: projection.documentPreviewAssets,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      activityAt: projection.activityAt,
      archivedAt: row.archived_at ? text(row.archived_at) : null,
      creatorRootSortOrder: row.creator_root_sort_order == null ? null : Number(row.creator_root_sort_order),
      galleryRootSortOrder: row.gallery_root_sort_order == null ? null : Number(row.gallery_root_sort_order),
      members,
    };
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
