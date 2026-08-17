import { ulid } from 'ulid';
import type { AlbumDictionarySourceDto } from '@/shared/contracts';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { PackInstallationRepository } from '@/main/database/packs/pack-installation-repository';
import {
  type ContextPackActivationRecord,
  type LinkPackReleaseItemInput,
  type LocalOverrideRecord,
  type PackObjectLinkRecord,
  type UpsertContextPackActivationInput,
  type UpsertLocalOverrideInput,
  activationRecord,
  json,
  objectLinkRecord,
  overrideRecord,
  required,
} from '@/main/database/packs/pack-records';

export * from '@/main/database/packs/pack-records';

export class PackRepository extends PackInstallationRepository {
  upsertContextPackActivation(input: UpsertContextPackActivationInput): ContextPackActivationRecord {
    const targetId = required(input.targetId, 'Activation target id');
    const packId = required(input.packId, 'Pack id');
    const releaseId = required(input.packReleaseId, 'Pack release id');
    const roles = [...new Set(input.roles.map((role) => required(role, 'Pack role')))];
    return this.db.transaction(() => {
      const spaceId = this.getLocalSpace().id;
      const installation = this.db
        .prepare(
          `SELECT * FROM pack_installations
          WHERE space_id = ? AND pack_id = ? AND selected_release_id IS NOT NULL AND deleted_at IS NULL`,
        )
        .get(spaceId, packId) as JsonMap | undefined;
      if (!installation) throw new Error('Pack is not installed in this local space');
      if ((input.state ?? 'EXPLICIT_ACTIVE') === 'EXPLICIT_ACTIVE' && text(installation.state) !== 'INSTALLED') {
        throw new Error('Pack installation is not enabled');
      }
      const release = this.db
        .prepare('SELECT pack_id FROM pack_releases WHERE id = ? AND sealed_at IS NOT NULL')
        .get(releaseId) as JsonMap | undefined;
      if (!release || text(release.pack_id) !== packId) throw new Error('Activation release does not belong to pack');
      const existing = this.db
        .prepare(
          `SELECT * FROM context_pack_activations
          WHERE space_id = ? AND target_type = ? AND target_id = ? AND pack_id = ? AND deleted_at IS NULL`,
        )
        .get(spaceId, input.targetType, targetId, packId) as JsonMap | undefined;
      if (input.id && existing && text(existing.id) !== input.id) {
        throw new Error('Activation identity conflicts with the active pack context');
      }
      const timestamp = now();
      const id = existing ? text(existing.id) : (input.id ?? ulid());
      if (existing) {
        this.db
          .prepare(
            `UPDATE context_pack_activations SET installation_id = ?, pack_release_id = ?,
            roles_json = ?, priority = ?, state = ?, activation_source = ?, change_reason = ?, updated_at = ?
            WHERE id = ?`,
          )
          .run(
            installation.id,
            releaseId,
            json(roles, []),
            input.priority ?? 0,
            input.state ?? 'EXPLICIT_ACTIVE',
            input.source,
            input.changeReason?.trim() ?? '',
            timestamp,
            id,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO context_pack_activations
            (id, space_id, target_type, target_id, installation_id, pack_id, pack_release_id, roles_json,
              priority, state, activation_source, change_reason, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            id,
            spaceId,
            input.targetType,
            targetId,
            installation.id,
            packId,
            releaseId,
            json(roles, []),
            input.priority ?? 0,
            input.state ?? 'EXPLICIT_ACTIVE',
            input.source,
            input.changeReason?.trim() ?? '',
            timestamp,
            timestamp,
          );
      }
      this.storage.recordChange('CONTEXT_PACK_ACTIVATION', id, existing ? 'UPDATE' : 'CREATE', {
        targetType: input.targetType,
        targetId,
        packId,
        releaseId,
      });
      return activationRecord(
        this.db.prepare('SELECT * FROM context_pack_activations WHERE id = ?').get(id) as JsonMap,
      );
    })();
  }

  listContextPackActivations(targetType: 'ALBUM' | 'CONVERSATION', targetId: string) {
    return (
      this.db
        .prepare(
          `SELECT * FROM context_pack_activations
        WHERE target_type = ? AND target_id = ? AND deleted_at IS NULL ORDER BY priority DESC, created_at, id`,
        )
        .all(targetType, targetId) as JsonMap[]
    ).map(activationRecord);
  }

  syncAlbumDictionarySources(albumId: string, sources: readonly AlbumDictionarySourceDto[]): void {
    const uniqueSources = sources.filter(
      (source, index, items) => items.findIndex((candidate) => candidate.packId === source.packId) === index,
    );
    this.db.transaction(() => {
      if (!this.db.prepare(`SELECT 1 FROM albums WHERE id = ? AND deleted_at IS NULL`).get(albumId)) {
        throw new Error('Album not found');
      }
      const existing = this.listContextPackActivations('ALBUM', albumId);
      for (const [index, source] of uniqueSources.entries()) {
        this.upsertContextPackActivation({
          targetType: 'ALBUM',
          targetId: albumId,
          packId: source.packId,
          packReleaseId: source.packReleaseId,
          roles: ['DICTIONARY'],
          priority: uniqueSources.length - index,
          state: 'EXPLICIT_ACTIVE',
          source: 'USER',
          changeReason: 'ALBUM_CREATION_DEFAULTS',
        });
      }
      const retainedPackIds = new Set(uniqueSources.map((source) => source.packId));
      for (const activation of existing) {
        if (!retainedPackIds.has(activation.packId)) this.deleteContextPackActivation(activation.id);
      }
    })();
  }

  clearAlbumDictionarySources(albumId: string): void {
    this.db.transaction(() => {
      for (const activation of this.listContextPackActivations('ALBUM', albumId)) {
        this.deleteContextPackActivation(activation.id);
      }
    })();
  }

  deleteContextPackActivation(activationId: string): void {
    this.softDelete('context_pack_activations', 'CONTEXT_PACK_ACTIVATION', activationId);
  }

  upsertLocalOverride(input: UpsertLocalOverrideInput): LocalOverrideRecord {
    const baseReleaseItemId = required(input.baseReleaseItemId, 'Base release item id');
    const scopeId = input.scopeType === 'SPACE' ? '' : required(input.scopeId ?? '', 'Override scope id');
    return this.db.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM pack_release_items WHERE id = ?').get(baseReleaseItemId)) {
        throw new Error('Base pack release item not found');
      }
      const spaceId = this.getLocalSpace().id;
      const existing = this.db
        .prepare(
          `SELECT * FROM local_overrides
          WHERE space_id = ? AND base_release_item_id = ? AND override_kind = ?
            AND scope_type = ? AND scope_id = ? AND deleted_at IS NULL`,
        )
        .get(spaceId, baseReleaseItemId, input.overrideKind, input.scopeType, scopeId) as JsonMap | undefined;
      if (input.id && existing && text(existing.id) !== input.id) {
        throw new Error('Local override identity conflicts with the active override');
      }
      const timestamp = now();
      const id = existing ? text(existing.id) : (input.id ?? ulid());
      const values = [
        input.localObjectType?.trim() ?? '',
        input.localRevisionId?.trim() ?? '',
        input.localContentHash?.trim() ?? '',
        json(input.patch, {}),
        input.state ?? 'ACTIVE',
      ] as const;
      if (existing) {
        this.db
          .prepare(
            `UPDATE local_overrides SET local_object_type = ?, local_revision_id = ?,
            local_content_hash = ?, patch_json = ?, state = ?, updated_at = ? WHERE id = ?`,
          )
          .run(...values, timestamp, id);
      } else {
        this.db
          .prepare(
            `INSERT INTO local_overrides
            (id, space_id, base_release_item_id, override_kind, local_object_type, local_revision_id,
              local_content_hash, patch_json, scope_type, scope_id, state, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            id,
            spaceId,
            baseReleaseItemId,
            input.overrideKind,
            ...values.slice(0, 4),
            input.scopeType,
            scopeId,
            values[4],
            timestamp,
            timestamp,
          );
      }
      this.storage.recordChange('LOCAL_OVERRIDE', id, existing ? 'UPDATE' : 'CREATE', {
        baseReleaseItemId,
        scopeType: input.scopeType,
        scopeId,
      });
      return overrideRecord(this.db.prepare('SELECT * FROM local_overrides WHERE id = ?').get(id) as JsonMap);
    })();
  }

  listLocalOverrides(includeDeleted = false): LocalOverrideRecord[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM local_overrides WHERE (? = 1 OR deleted_at IS NULL)
        ORDER BY created_at, id`,
        )
        .all(includeDeleted ? 1 : 0) as JsonMap[]
    ).map(overrideRecord);
  }

  deleteLocalOverride(overrideId: string): void {
    this.softDelete('local_overrides', 'LOCAL_OVERRIDE', overrideId);
  }

  linkPackReleaseItem(input: LinkPackReleaseItemInput): PackObjectLinkRecord {
    const releaseItemId = required(input.releaseItemId, 'Pack release item id');
    const localObjectType = required(input.localObjectType, 'Local object type');
    const localObjectId = required(input.localObjectId, 'Local object id');
    const localRevisionId = required(input.localRevisionId, 'Local revision id');
    return this.db.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM pack_release_items WHERE id = ?').get(releaseItemId)) {
        throw new Error('Pack release item not found');
      }
      const spaceId = this.getLocalSpace().id;
      const existing = this.db
        .prepare(
          `SELECT * FROM pack_object_links
          WHERE space_id = ? AND release_item_id = ? AND local_object_type = ?
            AND local_revision_id = ? AND deleted_at IS NULL`,
        )
        .get(spaceId, releaseItemId, localObjectType, localRevisionId) as JsonMap | undefined;
      if (existing) return objectLinkRecord(existing);
      const id = input.id ?? ulid();
      const timestamp = now();
      this.db
        .prepare(
          `INSERT INTO pack_object_links
          (id, space_id, release_item_id, local_object_type, local_object_id, local_revision_id,
            mapping_kind, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          spaceId,
          releaseItemId,
          localObjectType,
          localObjectId,
          localRevisionId,
          input.mappingKind,
          timestamp,
          timestamp,
        );
      this.storage.recordChange('PACK_OBJECT_LINK', id, 'CREATE', { releaseItemId, localRevisionId });
      return objectLinkRecord(this.db.prepare('SELECT * FROM pack_object_links WHERE id = ?').get(id) as JsonMap);
    })();
  }

  deletePackObjectLink(linkId: string): void {
    this.softDelete('pack_object_links', 'PACK_OBJECT_LINK', linkId);
  }

  private softDelete(
    table: 'context_pack_activations' | 'local_overrides' | 'pack_object_links',
    entityType: string,
    id: string,
  ) {
    this.db.transaction(() => {
      const timestamp = now();
      const result = this.db
        .prepare(
          `UPDATE ${table} SET deleted_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(timestamp, timestamp, id);
      if (!result.changes) throw new Error(`${entityType} not found`);
      this.addTombstone(entityType, id, timestamp);
      this.storage.recordChange(entityType, id, 'DELETE', {});
    })();
  }
}
