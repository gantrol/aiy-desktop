import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import {
  type LocalSpaceRecord,
  type PackDependencyInput,
  type PackRecord,
  type PackReleaseRecord,
  type RegisterPackInput,
  type RegisterPackReleaseInput,
  type SynchronizeLocalSpaceIdentityInput,
  dependencyRecord,
  json,
  localSpaceRecord,
  nullableText,
  packRecord,
  parseObject,
  parseStrings,
  releaseItemRecord,
  required,
} from '@/main/database/packs/pack-records';

export class PackCatalogRepository {
  protected readonly db: LibraryStorage['db'];

  constructor(protected readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  getLocalSpace(): LocalSpaceRecord {
    const row = this.db.prepare('SELECT * FROM local_spaces WHERE singleton_key = 1').get() as JsonMap | undefined;
    if (!row) throw new Error('Local space is not initialized');
    return localSpaceRecord(row);
  }

  renameLocalSpace(name: string): LocalSpaceRecord {
    const normalized = required(name, 'Local space name');
    return this.db.transaction(() => {
      const current = this.getLocalSpace();
      if (current.name === normalized) return current;
      const timestamp = now();
      this.db
        .prepare('UPDATE local_spaces SET name = ?, updated_at = ? WHERE id = ?')
        .run(normalized, timestamp, current.id);
      this.db
        .prepare(
          "INSERT INTO app_meta(key, value) VALUES ('library_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(normalized);
      this.storage.recordChange('LOCAL_SPACE', current.id, 'RENAME', { name: normalized });
      return this.getLocalSpace();
    })();
  }

  synchronizeLocalSpaceIdentity(input: SynchronizeLocalSpaceIdentityInput): LocalSpaceRecord {
    const id = required(input.id, 'Local space registry id');
    const name = input.name === undefined ? null : required(input.name, 'Local space name');
    return this.db.transaction(() => {
      const current = this.getLocalSpace();
      const metadata = new Map(
        (
          this.db
            .prepare("SELECT key, value FROM app_meta WHERE key IN ('local_space_id', 'library_name')")
            .all() as JsonMap[]
        ).map((row) => [text(row.key), text(row.value)]),
      );
      const idChanged = current.id !== id;
      const nameChanged = name !== null && current.name !== name;
      const createdAtChanged = input.createdAt !== undefined && current.createdAt !== input.createdAt;
      const idMetadataChanged = metadata.get('local_space_id') !== id;
      const nameMetadataChanged = name !== null && metadata.get('library_name') !== name;
      if (!idChanged && !nameChanged && !createdAtChanged && !idMetadataChanged && !nameMetadataChanged) {
        return current;
      }

      const timestamp = now();
      if (idChanged) {
        const conflict = this.db.prepare('SELECT 1 FROM local_spaces WHERE id = ?').get(id);
        if (conflict) throw new Error('Local space registry id is already in use');
      }

      if (idChanged || nameChanged || createdAtChanged) {
        this.db
          .prepare(
            `UPDATE local_spaces
            SET id = ?, name = ?, created_at = ?, updated_at = ?
            WHERE id = ?`,
          )
          .run(id, name ?? current.name, input.createdAt ?? current.createdAt, timestamp, current.id);
      }
      if (idChanged) {
        // Keep registry identity alignment application-managed and atomic so
        // every local-space reference changes with its owning record.
        for (const table of [
          'pack_installations',
          'context_pack_activations',
          'local_overrides',
          'pack_object_links',
        ]) {
          this.db.prepare(`UPDATE ${table} SET space_id = ? WHERE space_id = ?`).run(id, current.id);
        }
      }
      if (idMetadataChanged) {
        this.db
          .prepare(
            `INSERT INTO app_meta(key, value) VALUES ('local_space_id', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          )
          .run(id);
      }
      if (name !== null && nameMetadataChanged) {
        this.db
          .prepare(
            `INSERT INTO app_meta(key, value) VALUES ('library_name', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          )
          .run(name);
      }
      this.storage.recordChange('LOCAL_SPACE', id, 'ALIGN_REGISTRY_IDENTITY', {
        previousId: current.id,
        registryId: id,
      });
      return this.getLocalSpace();
    })();
  }

  registerPack(input: RegisterPackInput): PackRecord {
    const id = required(input.id, 'Pack id');
    const displayName = required(input.displayName, 'Pack display name');
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM packs WHERE id = ?').get(id) as JsonMap | undefined;
      const timestamp = now();
      if (existing) {
        if (text(existing.kind) !== input.kind) throw new Error('Pack kind is immutable');
        this.db
          .prepare(
            `UPDATE packs SET display_name = ?, description = ?, content_kinds_json = ?,
            updated_at = ?, retired_at = NULL WHERE id = ?`,
          )
          .run(displayName, input.description?.trim() ?? '', json(input.contentKinds, []), timestamp, id);
        this.storage.recordChange('PACK', id, 'UPDATE_METADATA', {});
      } else {
        this.db
          .prepare(
            `INSERT INTO packs
            (id, kind, display_name, description, content_kinds_json, created_at, updated_at, retired_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(
            id,
            input.kind,
            displayName,
            input.description?.trim() ?? '',
            json(input.contentKinds, []),
            timestamp,
            timestamp,
          );
        this.storage.recordChange('PACK', id, 'CREATE', { kind: input.kind });
      }
      return packRecord(this.db.prepare('SELECT * FROM packs WHERE id = ?').get(id) as JsonMap);
    })();
  }

  listPacks(): PackRecord[] {
    return (this.db.prepare('SELECT * FROM packs ORDER BY created_at, id').all() as JsonMap[]).map(packRecord);
  }

  registerPackRelease(input: RegisterPackReleaseInput): PackReleaseRecord {
    const releaseId = required(input.id, 'Pack release id');
    const packId = required(input.packId, 'Pack id');
    const version = required(input.version, 'Pack release version');
    const contentHash = required(input.contentHash, 'Pack release content hash');
    if (!Number.isInteger(input.manifestVersion) || input.manifestVersion <= 0) {
      throw new Error('Manifest version must be a positive integer');
    }
    const items = input.items ?? [];
    const dependencies = input.dependencies ?? [];
    this.assertUnique(
      items.map((item) => required(item.itemKey, 'Pack release item key')),
      'release item key',
    );
    this.assertUnique(
      dependencies.map((dependency) => required(dependency.targetPackId, 'Dependency pack id')),
      'dependency pack',
    );

    return this.db.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM packs WHERE id = ?').get(packId)) throw new Error('Pack not found');
      const byId = this.db.prepare('SELECT * FROM pack_releases WHERE id = ?').get(releaseId) as JsonMap | undefined;
      const byVersion = this.db
        .prepare('SELECT * FROM pack_releases WHERE pack_id = ? AND version = ?')
        .get(packId, version) as JsonMap | undefined;
      const existing = byId ?? byVersion;
      if (existing) {
        if (
          text(existing.id) !== releaseId ||
          text(existing.pack_id) !== packId ||
          text(existing.version) !== version
        ) {
          throw new Error('Pack release id or version is already registered to another release');
        }
        this.assertReleaseMatches(existing, input);
        return this.getPackRelease(releaseId);
      }

      this.validateDependencies(packId, dependencies);
      const timestamp = now();
      this.db
        .prepare(
          `INSERT INTO pack_releases
          (id, pack_id, version, manifest_version, content_hash, manifest_json, compatibility_json,
            default_roles_json, license_summary, provenance_json, published_at, created_at, sealed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          releaseId,
          packId,
          version,
          input.manifestVersion,
          contentHash,
          json(input.manifest, {}),
          json(input.compatibility, {}),
          json(input.defaultRoles, []),
          input.licenseSummary?.trim() ?? '',
          json(input.provenance, {}),
          input.publishedAt ?? null,
          timestamp,
        );
      items.forEach((item, sortOrder) => {
        this.db
          .prepare(
            `INSERT INTO pack_release_items
            (id, release_id, item_key, object_type, object_revision_id, content_hash, inclusion_kind,
              visibility, rights_status, metadata_json, provenance_json, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            item.id ?? ulid(),
            releaseId,
            required(item.itemKey, 'Pack release item key'),
            required(item.objectType, 'Pack release item object type'),
            required(item.objectRevisionId, 'Pack release item revision id'),
            required(item.contentHash, 'Pack release item content hash'),
            item.inclusionKind ?? 'CORE',
            item.visibility ?? 'VISIBLE',
            item.rightsStatus?.trim() || 'UNKNOWN',
            json(item.metadata, {}),
            json(item.provenance, {}),
            sortOrder,
            timestamp,
          );
      });
      dependencies.forEach((dependency, sortOrder) => {
        this.db
          .prepare(
            `INSERT INTO pack_dependencies
            (id, release_id, target_pack_id, dependency_kind, version_range, locked_release_id,
              suggested_roles_json, capability_key, metadata_json, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            dependency.id ?? ulid(),
            releaseId,
            required(dependency.targetPackId, 'Dependency pack id'),
            dependency.kind,
            required(dependency.versionRange, 'Dependency version range'),
            dependency.lockedReleaseId ?? null,
            json(dependency.suggestedRoles, []),
            dependency.capabilityKey?.trim() ?? '',
            json(dependency.metadata, {}),
            sortOrder,
            timestamp,
          );
      });
      this.db.prepare('UPDATE pack_releases SET sealed_at = ? WHERE id = ?').run(timestamp, releaseId);
      this.storage.recordChange('PACK_RELEASE', releaseId, 'CREATE', {
        packId,
        version,
        contentHash,
        itemCount: items.length,
        dependencyCount: dependencies.length,
      });
      return this.getPackRelease(releaseId);
    })();
  }

  getPackRelease(releaseId: string): PackReleaseRecord {
    const row = this.db.prepare('SELECT * FROM pack_releases WHERE id = ? AND sealed_at IS NOT NULL').get(releaseId) as
      JsonMap | undefined;
    if (!row) throw new Error('Pack release not found');
    return {
      id: text(row.id),
      packId: text(row.pack_id),
      version: text(row.version),
      manifestVersion: Number(row.manifest_version),
      contentHash: text(row.content_hash),
      manifest: parseObject(row.manifest_json),
      compatibility: parseObject(row.compatibility_json),
      defaultRoles: parseStrings(row.default_roles_json),
      licenseSummary: text(row.license_summary),
      provenance: parseObject(row.provenance_json),
      publishedAt: nullableText(row.published_at),
      createdAt: text(row.created_at),
      sealedAt: text(row.sealed_at),
      items: (
        this.db
          .prepare('SELECT * FROM pack_release_items WHERE release_id = ? ORDER BY sort_order, id')
          .all(releaseId) as JsonMap[]
      ).map(releaseItemRecord),
      dependencies: (
        this.db
          .prepare('SELECT * FROM pack_dependencies WHERE release_id = ? ORDER BY sort_order, id')
          .all(releaseId) as JsonMap[]
      ).map(dependencyRecord),
    };
  }

  private assertReleaseMatches(row: JsonMap, input: RegisterPackReleaseInput) {
    const scalarMatches =
      text(row.content_hash) === input.contentHash.trim() &&
      Number(row.manifest_version) === input.manifestVersion &&
      text(row.manifest_json) === json(input.manifest, {}) &&
      text(row.compatibility_json) === json(input.compatibility, {}) &&
      text(row.default_roles_json) === json(input.defaultRoles, []) &&
      text(row.license_summary) === (input.licenseSummary?.trim() ?? '') &&
      text(row.provenance_json) === json(input.provenance, {}) &&
      nullableText(row.published_at) === (input.publishedAt ?? null) &&
      row.sealed_at !== null;
    if (!scalarMatches) throw new Error('Immutable pack release conflicts with the registered baseline');
    const release = this.getPackRelease(text(row.id));
    const items = input.items ?? [];
    const dependencies = input.dependencies ?? [];
    if (release.items.length !== items.length || release.dependencies.length !== dependencies.length) {
      throw new Error('Immutable pack release contents conflict with the registered baseline');
    }
    items.forEach((item, index) => {
      const stored = release.items[index];
      const matches =
        (!item.id || item.id === stored.id) &&
        item.itemKey.trim() === stored.itemKey &&
        item.objectType.trim() === stored.objectType &&
        item.objectRevisionId.trim() === stored.objectRevisionId &&
        item.contentHash.trim() === stored.contentHash &&
        (item.inclusionKind ?? 'CORE') === stored.inclusionKind &&
        (item.visibility ?? 'VISIBLE') === stored.visibility &&
        (item.rightsStatus?.trim() || 'UNKNOWN') === stored.rightsStatus &&
        json(item.metadata, {}) === json(stored.metadata, {}) &&
        json(item.provenance, {}) === json(stored.provenance, {});
      if (!matches) throw new Error('Immutable pack release item conflicts with the registered baseline');
    });
    dependencies.forEach((dependency, index) => {
      const stored = release.dependencies[index];
      const matches =
        (!dependency.id || dependency.id === stored.id) &&
        dependency.targetPackId.trim() === stored.targetPackId &&
        dependency.kind === stored.kind &&
        dependency.versionRange.trim() === stored.versionRange &&
        (dependency.lockedReleaseId ?? null) === stored.lockedReleaseId &&
        json(dependency.suggestedRoles, []) === json(stored.suggestedRoles, []) &&
        (dependency.capabilityKey?.trim() ?? '') === stored.capabilityKey &&
        json(dependency.metadata, {}) === json(stored.metadata, {});
      if (!matches) throw new Error('Immutable pack dependency conflicts with the registered baseline');
    });
  }

  private validateDependencies(packId: string, dependencies: PackDependencyInput[]) {
    for (const dependency of dependencies) {
      const targetPackId = required(dependency.targetPackId, 'Dependency pack id');
      if (!this.db.prepare('SELECT 1 FROM packs WHERE id = ?').get(targetPackId)) {
        throw new Error(`Dependency pack is not registered: ${targetPackId}`);
      }
      if (dependency.kind === 'REQUIRED' && targetPackId === packId) {
        throw new Error('Required pack dependency cycle detected');
      }
      if (dependency.lockedReleaseId) {
        const locked = this.db
          .prepare('SELECT pack_id FROM pack_releases WHERE id = ? AND sealed_at IS NOT NULL')
          .get(dependency.lockedReleaseId) as JsonMap | undefined;
        if (!locked || text(locked.pack_id) !== targetPackId) {
          throw new Error('Locked dependency release does not belong to target pack');
        }
        if (
          dependency.kind === 'REQUIRED' &&
          this.requiredDependencyClosureReaches(dependency.lockedReleaseId, packId)
        ) {
          throw new Error('Required pack dependency cycle detected');
        }
      }
    }
  }

  private requiredDependencyClosureReaches(startReleaseId: string, targetPackId: string) {
    const queue = [startReleaseId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const releaseId = queue.shift()!;
      if (visited.has(releaseId)) continue;
      visited.add(releaseId);
      const release = this.db.prepare('SELECT pack_id FROM pack_releases WHERE id = ?').get(releaseId) as
        JsonMap | undefined;
      if (!release) continue;
      if (text(release.pack_id) === targetPackId) return true;
      const dependencies = this.db
        .prepare(
          `SELECT target_pack_id, locked_release_id FROM pack_dependencies
          WHERE release_id = ? AND dependency_kind = 'REQUIRED'`,
        )
        .all(releaseId) as JsonMap[];
      for (const dependency of dependencies) {
        if (text(dependency.target_pack_id) === targetPackId) return true;
        const lockedReleaseId = nullableText(dependency.locked_release_id);
        if (lockedReleaseId) queue.push(lockedReleaseId);
      }
    }
    return false;
  }

  private assertUnique(values: string[], label: string) {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
  }

  protected addTombstone(entityType: string, entityId: string, deletedAt: string) {
    this.db
      .prepare('INSERT INTO tombstones(id, entity_type, entity_id, deleted_at, sync_state) VALUES (?, ?, ?, ?, ?)')
      .run(ulid(), entityType, entityId, deletedAt, 'LOCAL_ONLY');
  }
}
