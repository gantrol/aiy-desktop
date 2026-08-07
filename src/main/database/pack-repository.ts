import { ulid } from 'ulid';
import type { AlbumDictionarySourceDto } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';

export type PackKind = 'CONTENT' | 'BUNDLE';
export type PackDependencyKind = 'REQUIRED' | 'OPTIONAL' | 'RECOMMENDED';
export type PackInstallationState =
  'INSTALLING' | 'UPDATING' | 'INSTALLED' | 'DISABLED' | 'FAILED_NO_USABLE_RELEASE' | 'REMOVAL_PENDING' | 'REMOVED';
export type PackInstallOperation = 'INSTALL' | 'UPGRADE' | 'VERIFY' | 'REMOVE';
export type PackInstallAttemptStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED' | 'CANCELLED';

export interface LocalSpaceRecord {
  id: string;
  name: string;
  description: string;
  mode: 'LOCAL';
  compatibilityVersion: number;
  backupConfig: JsonMap;
  retentionConfig: JsonMap;
  syncConfig: JsonMap;
  createdAt: string;
  updatedAt: string;
}

export interface SynchronizeLocalSpaceIdentityInput {
  id: string;
  name?: string;
  createdAt?: string;
}

export interface RegisterPackInput {
  id: string;
  kind: PackKind;
  displayName: string;
  description?: string;
  contentKinds?: string[];
}

export interface PackRecord extends RegisterPackInput {
  description: string;
  contentKinds: string[];
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
}

export interface PackReleaseSummaryRecord {
  id: string;
  packId: string;
  version: string;
  manifestVersion: number;
  contentHash: string;
  publishedAt: string | null;
  sealedAt: string;
  itemCount: number;
  dependencyCount: number;
}

export interface PackCatalogRecord {
  pack: PackRecord;
  releases: PackReleaseSummaryRecord[];
  installation: PackInstallationRecord | null;
}

export interface InstallExactPackReleaseInput {
  packId: string;
  releaseId: string;
  source?: JsonMap;
  dependencies?: PackInstallDependencyResolutionInput[];
  verification?: JsonMap;
}

export interface PackReleaseItemInput {
  id?: string;
  itemKey: string;
  objectType: string;
  objectRevisionId: string;
  contentHash: string;
  inclusionKind?: 'CORE' | 'OPTIONAL' | 'EXAMPLE';
  visibility?: 'VISIBLE' | 'HIDDEN' | 'INTERNAL';
  rightsStatus?: string;
  metadata?: JsonMap;
  provenance?: JsonMap;
}

export interface PackReleaseItemRecord {
  id: string;
  releaseId: string;
  itemKey: string;
  objectType: string;
  objectRevisionId: string;
  contentHash: string;
  inclusionKind: 'CORE' | 'OPTIONAL' | 'EXAMPLE';
  visibility: 'VISIBLE' | 'HIDDEN' | 'INTERNAL';
  rightsStatus: string;
  metadata: JsonMap;
  provenance: JsonMap;
  sortOrder: number;
  createdAt: string;
}

export interface PackDependencyInput {
  id?: string;
  targetPackId: string;
  kind: PackDependencyKind;
  versionRange: string;
  lockedReleaseId?: string | null;
  suggestedRoles?: string[];
  capabilityKey?: string;
  metadata?: JsonMap;
}

export interface PackDependencyRecord {
  id: string;
  releaseId: string;
  targetPackId: string;
  kind: PackDependencyKind;
  versionRange: string;
  lockedReleaseId: string | null;
  suggestedRoles: string[];
  capabilityKey: string;
  metadata: JsonMap;
  sortOrder: number;
  createdAt: string;
}

export interface RegisterPackReleaseInput {
  id: string;
  packId: string;
  version: string;
  manifestVersion: number;
  contentHash: string;
  manifest: JsonMap;
  compatibility?: JsonMap;
  defaultRoles?: string[];
  licenseSummary?: string;
  provenance?: JsonMap;
  publishedAt?: string | null;
  items?: PackReleaseItemInput[];
  dependencies?: PackDependencyInput[];
}

export interface PackReleaseRecord {
  id: string;
  packId: string;
  version: string;
  manifestVersion: number;
  contentHash: string;
  manifest: JsonMap;
  compatibility: JsonMap;
  defaultRoles: string[];
  licenseSummary: string;
  provenance: JsonMap;
  publishedAt: string | null;
  createdAt: string;
  sealedAt: string;
  items: PackReleaseItemRecord[];
  dependencies: PackDependencyRecord[];
}

export interface PackInstallDependencyResolutionInput {
  dependencyId: string;
  resolutionKind: 'LOCKED' | 'OMITTED';
  resolvedReleaseId?: string | null;
}

export interface BeginPackInstallAttemptInput {
  packId: string;
  targetReleaseId: string;
  operation: PackInstallOperation;
  transactionId?: string;
  source?: JsonMap;
  dependencies?: PackInstallDependencyResolutionInput[];
}

export interface PackInstallDependencyResolutionRecord {
  id: string;
  attemptId: string;
  dependencyId: string;
  resolutionKind: 'LOCKED' | 'OMITTED';
  resolvedReleaseId: string | null;
  createdAt: string;
}

export interface PackInstallAttemptRecord {
  id: string;
  installationId: string;
  transactionId: string;
  operation: PackInstallOperation;
  targetReleaseId: string;
  status: PackInstallAttemptStatus;
  previousInstallationState: PackInstallationState | null;
  previousReleaseId: string | null;
  source: JsonMap;
  verification: JsonMap | null;
  error: JsonMap | null;
  startedAt: string;
  finishedAt: string | null;
  dependencies: PackInstallDependencyResolutionRecord[];
}

export interface PackInstallationRecord {
  id: string;
  spaceId: string;
  packId: string;
  selectedReleaseId: string | null;
  state: PackInstallationState;
  installationSource: JsonMap;
  installedAt: string | null;
  disabledAt: string | null;
  removalRequestedAt: string | null;
  lastError: JsonMap | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UpsertContextPackActivationInput {
  id?: string;
  targetType: 'ALBUM' | 'CONVERSATION';
  targetId: string;
  packId: string;
  packReleaseId: string;
  roles: string[];
  priority?: number;
  state?: 'EXPLICIT_ACTIVE' | 'EXPLICIT_DISABLED';
  source: 'USER' | 'BUNDLE_DEFAULT';
  changeReason?: string;
}

export interface ContextPackActivationRecord {
  id: string;
  spaceId: string;
  targetType: 'ALBUM' | 'CONVERSATION';
  targetId: string;
  installationId: string;
  packId: string;
  packReleaseId: string;
  roles: string[];
  priority: number;
  state: 'EXPLICIT_ACTIVE' | 'EXPLICIT_DISABLED';
  source: 'USER' | 'BUNDLE_DEFAULT';
  changeReason: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UpsertLocalOverrideInput {
  id?: string;
  baseReleaseItemId: string;
  overrideKind: 'REPLACE' | 'HIDE' | 'ORDER' | 'DEFAULT';
  localObjectType?: string;
  localRevisionId?: string;
  localContentHash?: string;
  patch?: JsonMap;
  scopeType: 'SPACE' | 'ALBUM' | 'CONVERSATION';
  scopeId?: string;
  state?: 'ACTIVE' | 'DISABLED' | 'CONFLICTED' | 'DORMANT' | 'SUPERSEDED';
}

export interface LocalOverrideRecord {
  id: string;
  spaceId: string;
  baseReleaseItemId: string;
  overrideKind: 'REPLACE' | 'HIDE' | 'ORDER' | 'DEFAULT';
  localObjectType: string;
  localRevisionId: string;
  localContentHash: string;
  patch: JsonMap;
  scopeType: 'SPACE' | 'ALBUM' | 'CONVERSATION';
  scopeId: string;
  state: 'ACTIVE' | 'DISABLED' | 'CONFLICTED' | 'DORMANT' | 'SUPERSEDED';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface LinkPackReleaseItemInput {
  id?: string;
  releaseItemId: string;
  localObjectType: string;
  localObjectId: string;
  localRevisionId: string;
  mappingKind: 'INSTALLED_NEW' | 'REUSED_IDENTICAL' | 'MANUALLY_MAPPED' | 'RETAINED_HISTORY';
}

export interface PackObjectLinkRecord extends Required<LinkPackReleaseItemInput> {
  spaceId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as JsonMap)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, item]) => [key, normalizeJson(item)]));
  }
  return value;
}

function json(value: unknown, fallback: unknown) {
  return JSON.stringify(normalizeJson(value ?? fallback));
}

function parseObject(value: unknown): JsonMap {
  try {
    const parsed = JSON.parse(text(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonMap) : {};
  } catch {
    return {};
  }
}

function parseOptionalObject(value: unknown): JsonMap | null {
  return value === null || value === undefined || value === '' ? null : parseObject(value);
}

function parseStrings(value: unknown): string[] {
  try {
    const parsed = JSON.parse(text(value));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function nullableText(value: unknown) {
  return value === null || value === undefined ? null : text(value);
}

function localSpaceRecord(row: JsonMap): LocalSpaceRecord {
  return {
    id: text(row.id),
    name: text(row.name),
    description: text(row.description),
    mode: text(row.mode) as 'LOCAL',
    compatibilityVersion: Number(row.compatibility_version),
    backupConfig: parseObject(row.backup_config_json),
    retentionConfig: parseObject(row.retention_config_json),
    syncConfig: parseObject(row.sync_config_json),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function packRecord(row: JsonMap): PackRecord {
  return {
    id: text(row.id),
    kind: text(row.kind) as PackKind,
    displayName: text(row.display_name),
    description: text(row.description),
    contentKinds: parseStrings(row.content_kinds_json),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    retiredAt: nullableText(row.retired_at),
  };
}

function releaseItemRecord(row: JsonMap): PackReleaseItemRecord {
  return {
    id: text(row.id),
    releaseId: text(row.release_id),
    itemKey: text(row.item_key),
    objectType: text(row.object_type),
    objectRevisionId: text(row.object_revision_id),
    contentHash: text(row.content_hash),
    inclusionKind: text(row.inclusion_kind) as PackReleaseItemRecord['inclusionKind'],
    visibility: text(row.visibility) as PackReleaseItemRecord['visibility'],
    rightsStatus: text(row.rights_status),
    metadata: parseObject(row.metadata_json),
    provenance: parseObject(row.provenance_json),
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
  };
}

function dependencyRecord(row: JsonMap): PackDependencyRecord {
  return {
    id: text(row.id),
    releaseId: text(row.release_id),
    targetPackId: text(row.target_pack_id),
    kind: text(row.dependency_kind) as PackDependencyKind,
    versionRange: text(row.version_range),
    lockedReleaseId: nullableText(row.locked_release_id),
    suggestedRoles: parseStrings(row.suggested_roles_json),
    capabilityKey: text(row.capability_key),
    metadata: parseObject(row.metadata_json),
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
  };
}

function installationRecord(row: JsonMap): PackInstallationRecord {
  return {
    id: text(row.id),
    spaceId: text(row.space_id),
    packId: text(row.pack_id),
    selectedReleaseId: nullableText(row.selected_release_id),
    state: text(row.state) as PackInstallationState,
    installationSource: parseObject(row.installation_source_json),
    installedAt: nullableText(row.installed_at),
    disabledAt: nullableText(row.disabled_at),
    removalRequestedAt: nullableText(row.removal_requested_at),
    lastError: parseOptionalObject(row.last_error_json),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: nullableText(row.deleted_at),
  };
}

function activationRecord(row: JsonMap): ContextPackActivationRecord {
  return {
    id: text(row.id),
    spaceId: text(row.space_id),
    targetType: text(row.target_type) as ContextPackActivationRecord['targetType'],
    targetId: text(row.target_id),
    installationId: text(row.installation_id),
    packId: text(row.pack_id),
    packReleaseId: text(row.pack_release_id),
    roles: parseStrings(row.roles_json),
    priority: Number(row.priority),
    state: text(row.state) as ContextPackActivationRecord['state'],
    source: text(row.activation_source) as ContextPackActivationRecord['source'],
    changeReason: text(row.change_reason),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: nullableText(row.deleted_at),
  };
}

function overrideRecord(row: JsonMap): LocalOverrideRecord {
  return {
    id: text(row.id),
    spaceId: text(row.space_id),
    baseReleaseItemId: text(row.base_release_item_id),
    overrideKind: text(row.override_kind) as LocalOverrideRecord['overrideKind'],
    localObjectType: text(row.local_object_type),
    localRevisionId: text(row.local_revision_id),
    localContentHash: text(row.local_content_hash),
    patch: parseObject(row.patch_json),
    scopeType: text(row.scope_type) as LocalOverrideRecord['scopeType'],
    scopeId: text(row.scope_id),
    state: text(row.state) as LocalOverrideRecord['state'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: nullableText(row.deleted_at),
  };
}

function objectLinkRecord(row: JsonMap): PackObjectLinkRecord {
  return {
    id: text(row.id),
    spaceId: text(row.space_id),
    releaseItemId: text(row.release_item_id),
    localObjectType: text(row.local_object_type),
    localObjectId: text(row.local_object_id),
    localRevisionId: text(row.local_revision_id),
    mappingKind: text(row.mapping_kind) as PackObjectLinkRecord['mappingKind'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: nullableText(row.deleted_at),
  };
}

export class PackRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
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
      const timestamp = now();
      if (current.id !== id) {
        const conflict = this.db.prepare('SELECT 1 FROM local_spaces WHERE id = ?').get(id);
        if (conflict) throw new Error('Local space registry id is already in use');
        this.db.prepare('UPDATE local_spaces SET id = ?, updated_at = ? WHERE id = ?').run(id, timestamp, current.id);
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
      this.db
        .prepare(
          `UPDATE local_spaces SET name = COALESCE(?, name),
        created_at = COALESCE(?, created_at), updated_at = ? WHERE id = ?`,
        )
        .run(name, input.createdAt ?? null, timestamp, id);
      this.db
        .prepare(
          `INSERT INTO app_meta(key, value) VALUES ('local_space_id', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(id);
      if (name) {
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

  listPackCatalog(): PackCatalogRecord[] {
    const installations = new Map(this.listPackInstallations(true).map((item) => [item.packId, item]));
    return this.listPacks().map((pack) => ({
      pack,
      releases: (
        this.db
          .prepare(
            `SELECT release.id, release.pack_id, release.version,
          release.manifest_version, release.content_hash, release.published_at, release.sealed_at,
          (SELECT COUNT(*) FROM pack_release_items item WHERE item.release_id = release.id) AS item_count,
          (SELECT COUNT(*) FROM pack_dependencies dependency
            WHERE dependency.release_id = release.id) AS dependency_count
        FROM pack_releases release
        WHERE release.pack_id = ? AND release.sealed_at IS NOT NULL
        ORDER BY release.created_at DESC, release.id DESC`,
          )
          .all(pack.id) as JsonMap[]
      ).map((release) => ({
        id: text(release.id),
        packId: text(release.pack_id),
        version: text(release.version),
        manifestVersion: Number(release.manifest_version),
        contentHash: text(release.content_hash),
        publishedAt: nullableText(release.published_at),
        sealedAt: text(release.sealed_at),
        itemCount: Number(release.item_count),
        dependencyCount: Number(release.dependency_count),
      })),
      installation: installations.get(pack.id) ?? null,
    }));
  }

  installExactPackRelease(input: InstallExactPackReleaseInput): PackInstallationRecord {
    const current = this.listPackInstallations(true).find((item) => item.packId === input.packId);
    if (
      current?.deletedAt === null &&
      current.selectedReleaseId === input.releaseId &&
      (current.state === 'INSTALLED' || current.state === 'DISABLED')
    ) {
      return current;
    }
    const attempt = this.beginPackInstallAttempt({
      packId: input.packId,
      targetReleaseId: input.releaseId,
      operation: current?.selectedReleaseId && !current.deletedAt ? 'UPGRADE' : 'INSTALL',
      source: input.source,
      dependencies: input.dependencies,
    });
    try {
      return this.completePackInstallAttempt(attempt.id, input.verification);
    } catch (error) {
      this.failPackInstallAttempt(attempt.id, {
        code: 'EXACT_RELEASE_INSTALL_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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

  beginPackInstallAttempt(input: BeginPackInstallAttemptInput): PackInstallAttemptRecord {
    const packId = required(input.packId, 'Pack id');
    const targetReleaseId = required(input.targetReleaseId, 'Target release id');
    return this.db.transaction(() => {
      const release = this.db
        .prepare('SELECT pack_id FROM pack_releases WHERE id = ? AND sealed_at IS NOT NULL')
        .get(targetReleaseId) as JsonMap | undefined;
      if (!release || text(release.pack_id) !== packId) throw new Error('Target release does not belong to pack');
      const spaceId = this.getLocalSpace().id;
      const existing = this.db
        .prepare('SELECT * FROM pack_installations WHERE space_id = ? AND pack_id = ?')
        .get(spaceId, packId) as JsonMap | undefined;
      if (
        existing &&
        this.db
          .prepare(
            `SELECT 1 FROM pack_install_attempts
        WHERE installation_id = ? AND status = 'RUNNING'`,
          )
          .get(existing.id)
      ) {
        throw new Error('Pack already has a running installation attempt');
      }
      if (
        (input.operation === 'VERIFY' || input.operation === 'REMOVE') &&
        (!existing || existing.deleted_at || !existing.selected_release_id)
      ) {
        throw new Error(`${input.operation.toLowerCase()} requires an installed release`);
      }
      if (
        (input.operation === 'VERIFY' || input.operation === 'REMOVE') &&
        text(existing!.selected_release_id) !== targetReleaseId
      ) {
        throw new Error(`${input.operation.toLowerCase()} must target the selected release`);
      }
      const timestamp = now();
      const installationId = existing ? text(existing.id) : ulid();
      const wasDeleted = Boolean(existing?.deleted_at);
      const previousState = existing && !wasDeleted ? (text(existing.state) as PackInstallationState) : null;
      const previousReleaseId = existing && !wasDeleted ? nullableText(existing.selected_release_id) : null;
      const progressState: PackInstallationState =
        input.operation === 'REMOVE' ? 'REMOVAL_PENDING' : previousReleaseId ? 'UPDATING' : 'INSTALLING';
      if (existing) {
        this.db
          .prepare(
            `UPDATE pack_installations SET selected_release_id = ?, state = ?,
          installation_source_json = ?, removal_requested_at = ?, last_error_json = NULL,
          updated_at = ?, deleted_at = NULL WHERE id = ?`,
          )
          .run(
            wasDeleted ? null : existing.selected_release_id,
            progressState,
            json(input.source, {}),
            input.operation === 'REMOVE' ? timestamp : null,
            timestamp,
            installationId,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO pack_installations
          (id, space_id, pack_id, selected_release_id, state, installation_source_json, installed_at,
            disabled_at, removal_requested_at, last_error_json, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL, ?, NULL, ?, ?, NULL)`,
          )
          .run(
            installationId,
            spaceId,
            packId,
            progressState,
            json(input.source, {}),
            input.operation === 'REMOVE' ? timestamp : null,
            timestamp,
            timestamp,
          );
      }

      const attemptId = ulid();
      this.db
        .prepare(
          `INSERT INTO pack_install_attempts
        (id, installation_id, transaction_id, operation, target_release_id, status,
          previous_installation_state, previous_release_id, source_json, verification_json,
          error_json, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?, NULL, NULL, ?, NULL)`,
        )
        .run(
          attemptId,
          installationId,
          input.transactionId?.trim() || ulid(),
          input.operation,
          targetReleaseId,
          previousState,
          previousReleaseId,
          json(input.source, {}),
          timestamp,
        );
      const resolutions = this.resolveAttemptDependencies(targetReleaseId, input.operation, input.dependencies ?? []);
      for (const resolution of resolutions) {
        this.db
          .prepare(
            `INSERT INTO pack_install_attempt_dependencies
          (id, attempt_id, dependency_id, resolution_kind, resolved_release_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            ulid(),
            attemptId,
            resolution.dependencyId,
            resolution.resolutionKind,
            resolution.resolvedReleaseId ?? null,
            timestamp,
          );
      }
      this.storage.recordChange('PACK_INSTALL_ATTEMPT', attemptId, 'START', {
        installationId,
        operation: input.operation,
        targetReleaseId,
      });
      return this.getPackInstallAttempt(attemptId);
    })();
  }

  completePackInstallAttempt(attemptId: string, verification: JsonMap = {}): PackInstallationRecord {
    return this.db.transaction(() => {
      const attempt = this.requireRunningAttempt(attemptId);
      const installation = this.db
        .prepare('SELECT * FROM pack_installations WHERE id = ?')
        .get(attempt.installationId) as JsonMap | undefined;
      if (!installation) throw new Error('Pack installation is unavailable');
      if (attempt.operation !== 'REMOVE' && attempt.operation !== 'VERIFY') {
        this.assertAttemptDependenciesInstalled(attempt, text(installation.space_id));
      }
      const timestamp = now();
      if (attempt.operation === 'REMOVE') {
        const activeActivation = this.db
          .prepare(
            `SELECT 1 FROM context_pack_activations
          WHERE installation_id = ? AND state = 'EXPLICIT_ACTIVE' AND deleted_at IS NULL LIMIT 1`,
          )
          .get(attempt.installationId);
        if (activeActivation) throw new Error('Disable or remove active pack contexts before removal');
        this.db
          .prepare(
            `UPDATE pack_installations SET state = 'REMOVED', disabled_at = ?,
          removal_requested_at = NULL, last_error_json = NULL, updated_at = ?, deleted_at = ? WHERE id = ?`,
          )
          .run(timestamp, timestamp, timestamp, attempt.installationId);
        this.addTombstone('PACK_INSTALLATION', attempt.installationId, timestamp);
      } else if (attempt.operation === 'VERIFY') {
        if (!attempt.previousInstallationState || !attempt.previousReleaseId) {
          throw new Error('Cannot verify a pack without an installed release');
        }
        this.db
          .prepare(
            `UPDATE pack_installations SET selected_release_id = ?, state = ?,
          removal_requested_at = NULL, last_error_json = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(attempt.previousReleaseId, attempt.previousInstallationState, timestamp, attempt.installationId);
      } else {
        this.db
          .prepare(
            `UPDATE pack_installations SET selected_release_id = ?, state = 'INSTALLED',
          installed_at = COALESCE(installed_at, ?), disabled_at = NULL, removal_requested_at = NULL,
          last_error_json = NULL, updated_at = ?, deleted_at = NULL WHERE id = ?`,
          )
          .run(attempt.targetReleaseId, timestamp, timestamp, attempt.installationId);
      }
      this.db
        .prepare(
          `UPDATE pack_install_attempts SET status = 'SUCCEEDED', verification_json = ?,
        finished_at = ? WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(json(verification, {}), timestamp, attempt.id);
      this.storage.recordChange('PACK_INSTALL_ATTEMPT', attempt.id, 'SUCCEED', {
        installationId: attempt.installationId,
        targetReleaseId: attempt.targetReleaseId,
      });
      this.storage.recordChange(
        'PACK_INSTALLATION',
        attempt.installationId,
        attempt.operation === 'REMOVE' ? 'DELETE' : 'SELECT_RELEASE',
        {
          releaseId: attempt.targetReleaseId,
          attemptId: attempt.id,
        },
      );
      return installationRecord(
        this.db.prepare('SELECT * FROM pack_installations WHERE id = ?').get(attempt.installationId) as JsonMap,
      );
    })();
  }

  failPackInstallAttempt(attemptId: string, error: JsonMap): PackInstallationRecord {
    return this.db.transaction(() => {
      const attempt = this.requireRunningAttempt(attemptId);
      const timestamp = now();
      const restoredState = attempt.previousInstallationState ?? 'FAILED_NO_USABLE_RELEASE';
      this.db
        .prepare(
          `UPDATE pack_installations SET selected_release_id = ?, state = ?,
        disabled_at = CASE WHEN ? = 'DISABLED' THEN disabled_at ELSE NULL END,
        removal_requested_at = NULL, last_error_json = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          attempt.previousReleaseId,
          restoredState,
          restoredState,
          json(error, {}),
          timestamp,
          attempt.installationId,
        );
      this.db
        .prepare(
          `UPDATE pack_install_attempts SET status = 'FAILED', error_json = ?, finished_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(json(error, {}), timestamp, attempt.id);
      this.storage.recordChange('PACK_INSTALL_ATTEMPT', attempt.id, 'FAIL', {
        installationId: attempt.installationId,
        error,
      });
      return installationRecord(
        this.db.prepare('SELECT * FROM pack_installations WHERE id = ?').get(attempt.installationId) as JsonMap,
      );
    })();
  }

  cancelPackInstallAttempt(attemptId: string, reason: JsonMap = {}): PackInstallationRecord {
    return this.db.transaction(() => {
      const attempt = this.requireRunningAttempt(attemptId);
      const timestamp = now();
      const error = { code: 'CANCELLED', ...reason };
      this.db
        .prepare(
          `UPDATE pack_installations SET selected_release_id = ?, state = ?,
        disabled_at = CASE WHEN ? = 'DISABLED' THEN disabled_at ELSE NULL END,
        removal_requested_at = NULL, last_error_json = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(
          attempt.previousReleaseId,
          attempt.previousInstallationState ?? 'FAILED_NO_USABLE_RELEASE',
          attempt.previousInstallationState ?? 'FAILED_NO_USABLE_RELEASE',
          timestamp,
          attempt.installationId,
        );
      this.db
        .prepare(
          `UPDATE pack_install_attempts SET status = 'CANCELLED', error_json = ?, finished_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(json(error, {}), timestamp, attempt.id);
      this.storage.recordChange('PACK_INSTALL_ATTEMPT', attempt.id, 'CANCEL', {
        installationId: attempt.installationId,
        reason,
      });
      return installationRecord(
        this.db.prepare('SELECT * FROM pack_installations WHERE id = ?').get(attempt.installationId) as JsonMap,
      );
    })();
  }

  reconcileInterruptedPackInstallAttempts(): number {
    return this.db.transaction(() => {
      const running = this.db
        .prepare("SELECT id FROM pack_install_attempts WHERE status = 'RUNNING'")
        .all() as JsonMap[];
      for (const row of running) {
        const attempt = this.requireRunningAttempt(text(row.id));
        const timestamp = now();
        const error = { code: 'APP_RESTARTED', message: 'Installation attempt interrupted by restart' };
        this.db
          .prepare(
            `UPDATE pack_installations SET selected_release_id = ?, state = ?,
          removal_requested_at = NULL, last_error_json = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            attempt.previousReleaseId,
            attempt.previousInstallationState ?? 'FAILED_NO_USABLE_RELEASE',
            json(error, {}),
            timestamp,
            attempt.installationId,
          );
        this.db
          .prepare(
            `UPDATE pack_install_attempts SET status = 'INTERRUPTED', error_json = ?, finished_at = ?
          WHERE id = ?`,
          )
          .run(json(error, {}), timestamp, attempt.id);
        this.storage.recordChange('PACK_INSTALL_ATTEMPT', attempt.id, 'INTERRUPT', {
          installationId: attempt.installationId,
        });
      }
      return running.length;
    })();
  }

  setPackInstallationDisabled(packId: string, disabled: boolean): PackInstallationRecord {
    return this.db.transaction(() => {
      const spaceId = this.getLocalSpace().id;
      const row = this.db
        .prepare(
          `SELECT * FROM pack_installations
        WHERE space_id = ? AND pack_id = ? AND deleted_at IS NULL`,
        )
        .get(spaceId, packId) as JsonMap | undefined;
      if (!row || !row.selected_release_id) throw new Error('Pack is not installed');
      if (text(row.state) === 'INSTALLING' || text(row.state) === 'UPDATING' || text(row.state) === 'REMOVAL_PENDING') {
        throw new Error('Pack installation has an active operation');
      }
      const state: PackInstallationState = disabled ? 'DISABLED' : 'INSTALLED';
      const timestamp = now();
      this.db
        .prepare(`UPDATE pack_installations SET state = ?, disabled_at = ?, updated_at = ? WHERE id = ?`)
        .run(state, disabled ? timestamp : null, timestamp, row.id);
      this.storage.recordChange('PACK_INSTALLATION', text(row.id), disabled ? 'DISABLE' : 'ENABLE', {});
      return installationRecord(
        this.db.prepare('SELECT * FROM pack_installations WHERE id = ?').get(row.id) as JsonMap,
      );
    })();
  }

  listPackInstallations(includeRemoved = false): PackInstallationRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM pack_installations
      WHERE (? = 1 OR deleted_at IS NULL) ORDER BY created_at, id`,
      )
      .all(includeRemoved ? 1 : 0) as JsonMap[];
    return rows.map(installationRecord);
  }

  getPackInstallAttempt(attemptId: string): PackInstallAttemptRecord {
    const row = this.db.prepare('SELECT * FROM pack_install_attempts WHERE id = ?').get(attemptId) as
      JsonMap | undefined;
    if (!row) throw new Error('Pack installation attempt not found');
    return {
      id: text(row.id),
      installationId: text(row.installation_id),
      transactionId: text(row.transaction_id),
      operation: text(row.operation) as PackInstallOperation,
      targetReleaseId: text(row.target_release_id),
      status: text(row.status) as PackInstallAttemptStatus,
      previousInstallationState: nullableText(row.previous_installation_state) as PackInstallationState | null,
      previousReleaseId: nullableText(row.previous_release_id),
      source: parseObject(row.source_json),
      verification: parseOptionalObject(row.verification_json),
      error: parseOptionalObject(row.error_json),
      startedAt: text(row.started_at),
      finishedAt: nullableText(row.finished_at),
      dependencies: (
        this.db
          .prepare(
            `SELECT * FROM pack_install_attempt_dependencies
        WHERE attempt_id = ? ORDER BY id`,
          )
          .all(attemptId) as JsonMap[]
      ).map((dependency) => ({
        id: text(dependency.id),
        attemptId: text(dependency.attempt_id),
        dependencyId: text(dependency.dependency_id),
        resolutionKind: text(dependency.resolution_kind) as 'LOCKED' | 'OMITTED',
        resolvedReleaseId: nullableText(dependency.resolved_release_id),
        createdAt: text(dependency.created_at),
      })),
    };
  }

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

  private resolveAttemptDependencies(
    targetReleaseId: string,
    operation: PackInstallOperation,
    requested: PackInstallDependencyResolutionInput[],
  ) {
    if (operation === 'REMOVE' || operation === 'VERIFY') {
      if (requested.length > 0) throw new Error(`${operation.toLowerCase()} attempts do not accept dependency locks`);
      return [];
    }
    const declared = this.db
      .prepare('SELECT * FROM pack_dependencies WHERE release_id = ? ORDER BY sort_order, id')
      .all(targetReleaseId) as JsonMap[];
    const byId = new Map(requested.map((resolution) => [resolution.dependencyId, resolution]));
    if (byId.size !== requested.length) throw new Error('Duplicate dependency resolution');
    for (const dependencyId of byId.keys()) {
      if (!declared.some((dependency) => text(dependency.id) === dependencyId)) {
        throw new Error('Dependency resolution does not belong to target release');
      }
    }
    return declared.map((dependency) => {
      const dependencyId = text(dependency.id);
      const resolution = byId.get(dependencyId) ?? {
        dependencyId,
        resolutionKind: 'OMITTED' as const,
        resolvedReleaseId: null,
      };
      if (text(dependency.dependency_kind) === 'REQUIRED' && resolution.resolutionKind !== 'LOCKED') {
        throw new Error('Required dependency must resolve to an exact release');
      }
      if (resolution.resolutionKind === 'OMITTED') {
        if (resolution.resolvedReleaseId) throw new Error('Omitted dependency cannot have a release');
        return { ...resolution, resolvedReleaseId: null };
      }
      const resolvedReleaseId = required(resolution.resolvedReleaseId ?? '', 'Resolved dependency release id');
      const resolved = this.db
        .prepare('SELECT pack_id FROM pack_releases WHERE id = ? AND sealed_at IS NOT NULL')
        .get(resolvedReleaseId) as JsonMap | undefined;
      if (!resolved || text(resolved.pack_id) !== text(dependency.target_pack_id)) {
        throw new Error('Resolved dependency release does not belong to dependency pack');
      }
      const declaredLock = nullableText(dependency.locked_release_id);
      if (declaredLock && declaredLock !== resolvedReleaseId) {
        throw new Error('Resolved dependency release conflicts with manifest lock');
      }
      return { ...resolution, resolvedReleaseId };
    });
  }

  private requireRunningAttempt(attemptId: string) {
    const attempt = this.getPackInstallAttempt(attemptId);
    if (attempt.status !== 'RUNNING') throw new Error('Pack installation attempt is no longer running');
    return attempt;
  }

  private assertAttemptDependenciesInstalled(attempt: PackInstallAttemptRecord, spaceId: string) {
    const declared = this.db
      .prepare('SELECT * FROM pack_dependencies WHERE release_id = ?')
      .all(attempt.targetReleaseId) as JsonMap[];
    const resolutions = new Map(attempt.dependencies.map((resolution) => [resolution.dependencyId, resolution]));
    for (const dependency of declared) {
      const resolution = resolutions.get(text(dependency.id));
      if (text(dependency.dependency_kind) === 'REQUIRED' && resolution?.resolutionKind !== 'LOCKED') {
        throw new Error('Required dependency is not locked');
      }
      if (!resolution || resolution.resolutionKind === 'OMITTED') continue;
      const installed = this.db
        .prepare(
          `SELECT 1 FROM pack_installations
        WHERE space_id = ? AND pack_id = ? AND selected_release_id = ?
          AND state = 'INSTALLED' AND deleted_at IS NULL`,
        )
        .get(spaceId, dependency.target_pack_id, resolution.resolvedReleaseId);
      if (!installed) throw new Error(`Dependency is not installed: ${text(dependency.target_pack_id)}`);
    }
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

  private addTombstone(entityType: string, entityId: string, deletedAt: string) {
    this.db
      .prepare('INSERT INTO tombstones(id, entity_type, entity_id, deleted_at, sync_state) VALUES (?, ?, ?, ?, ?)')
      .run(ulid(), entityType, entityId, deletedAt, 'LOCAL_ONLY');
  }

  private assertUnique(values: string[], label: string) {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
  }
}
