import { createHash, randomUUID } from 'node:crypto';
import type { ExtensionManifestDto, ExtensionSource } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now, type JsonMap } from '@/main/database/core/values';
import { extensionPermissionLegacyAliases } from '@/shared/extension-permissions';

interface InstallationRow {
  extension_id: string;
  installed_version: string;
  source_kind: ExtensionSource;
  enabled: number;
  manifest_hash: string;
  installed_at: string;
  updated_at: string;
}

interface PermissionRow {
  extension_id: string;
  permission_key: string;
  granted: number;
  updated_at: string;
}

interface ThreadBindingRow {
  extension_id: string;
  scope_kind: ExtensionThreadScopeKind;
  scope_id: string;
  thread_id: string;
  thread_name: string;
  created_at: string;
  updated_at: string;
}

export type ExtensionThreadScopeKind = 'DRAFT' | 'SERIES' | 'SYSTEM';

export interface ExtensionInstallationState {
  extensionId: string;
  installedVersion: string;
  source: ExtensionSource;
  enabled: boolean;
  manifestHash: string;
  installedAt: string;
  updatedAt: string;
  permissions: Map<string, boolean>;
}

export interface ExtensionReconcileEntry {
  manifest: ExtensionManifestDto;
  source: ExtensionSource;
  /** Initial state for a newly discovered extension. Existing user choices are never overwritten. */
  enabledByDefault?: boolean;
  /** Only trusted, application-distributed extensions may receive initial required grants. */
  grantRequiredPermissionsByDefault?: boolean;
}

export interface ExtensionThreadBinding {
  extensionId: string;
  scopeKind: ExtensionThreadScopeKind;
  scopeId: string;
  threadId: string;
  threadName: string;
  createdAt: string;
  updatedAt: string;
}

function manifestHash(manifest: ExtensionManifestDto) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export class ExtensionRepository {
  constructor(private readonly storage: LibraryStorage) {}

  reconcileBuiltIns(manifests: readonly ExtensionManifestDto[]) {
    return this.reconcile(
      manifests.map((manifest) => ({
        manifest,
        source: 'BUILT_IN' as const,
        enabledByDefault: true,
        grantRequiredPermissionsByDefault: true,
      })),
    );
  }

  reconcile(entries: readonly ExtensionReconcileEntry[]) {
    this.storage.db.transaction(() => {
      for (const entry of entries) {
        this.reconcileExtension(
          entry.manifest,
          entry.source,
          entry.enabledByDefault ?? false,
          entry.grantRequiredPermissionsByDefault ?? false,
        );
      }
    })();
  }

  listInstallations(): ExtensionInstallationState[] {
    const rows = this.storage.db
      .prepare(
        `SELECT extension_id, installed_version, source_kind,
      enabled, manifest_hash, installed_at, updated_at
      FROM extension_installations ORDER BY installed_at, extension_id`,
      )
      .all() as InstallationRow[];
    const permissions = this.storage.db
      .prepare(
        `SELECT extension_id, permission_key, granted, updated_at
      FROM extension_permission_grants ORDER BY extension_id, permission_key`,
      )
      .all() as PermissionRow[];
    const byExtension = new Map<string, Map<string, boolean>>();
    for (const permission of permissions) {
      const grants = byExtension.get(permission.extension_id) ?? new Map<string, boolean>();
      grants.set(permission.permission_key, Boolean(permission.granted));
      byExtension.set(permission.extension_id, grants);
    }
    return rows.map((row) => ({
      extensionId: row.extension_id,
      installedVersion: row.installed_version,
      source: row.source_kind,
      enabled: Boolean(row.enabled),
      manifestHash: row.manifest_hash,
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
      permissions: byExtension.get(row.extension_id) ?? new Map(),
    }));
  }

  setEnabled(extensionId: string, enabled: boolean) {
    return this.storage.db.transaction(() => {
      const existing = this.storage.db
        .prepare('SELECT enabled FROM extension_installations WHERE extension_id = ?')
        .get(extensionId) as { enabled: number } | undefined;
      if (!existing) throw new Error(`Extension is not installed: ${extensionId}`);
      if (Boolean(existing.enabled) === enabled) return;
      const updatedAt = now();
      this.storage.db
        .prepare('UPDATE extension_installations SET enabled = ?, updated_at = ? WHERE extension_id = ?')
        .run(enabled ? 1 : 0, updatedAt, extensionId);
      this.recordEvent(extensionId, enabled ? 'ENABLED' : 'DISABLED', { enabled }, updatedAt);
    })();
  }

  setPermission(extensionId: string, permission: string, granted: boolean) {
    return this.storage.db.transaction(() => {
      const installed = this.storage.db
        .prepare('SELECT 1 FROM extension_installations WHERE extension_id = ?')
        .get(extensionId);
      if (!installed) throw new Error(`Extension is not installed: ${extensionId}`);
      const updatedAt = now();
      this.storage.db
        .prepare(
          `INSERT INTO extension_permission_grants(
        extension_id, permission_key, granted, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(extension_id, permission_key) DO UPDATE SET
        granted = excluded.granted,
        updated_at = excluded.updated_at`,
        )
        .run(extensionId, permission, granted ? 1 : 0, updatedAt);
      this.storage.db
        .prepare('UPDATE extension_installations SET updated_at = ? WHERE extension_id = ?')
        .run(updatedAt, extensionId);
      this.recordEvent(
        extensionId,
        granted ? 'PERMISSION_GRANTED' : 'PERMISSION_REVOKED',
        { permission, granted },
        updatedAt,
      );
    })();
  }

  getThreadBinding(
    extensionId: string,
    scopeKind: ExtensionThreadScopeKind,
    scopeId: string,
  ): ExtensionThreadBinding | null {
    const row = this.storage.db
      .prepare(
        `SELECT extension_id, scope_kind, scope_id, thread_id,
      thread_name, created_at, updated_at
      FROM extension_thread_bindings
      WHERE extension_id = ? AND scope_kind = ? AND scope_id = ?`,
      )
      .get(extensionId, scopeKind, scopeId) as ThreadBindingRow | undefined;
    return row ? this.mapThreadBinding(row) : null;
  }

  bindThread(input: {
    extensionId: string;
    scopeKind: ExtensionThreadScopeKind;
    scopeId: string;
    threadId: string;
    threadName: string;
  }): ExtensionThreadBinding {
    return this.storage.db.transaction(() => {
      const existing = this.getThreadBinding(input.extensionId, input.scopeKind, input.scopeId);
      if (existing?.threadId === input.threadId && existing.threadName === input.threadName) return existing;
      const timestamp = now();
      this.storage.db
        .prepare(
          `INSERT INTO extension_thread_bindings(
        extension_id, scope_kind, scope_id, thread_id, thread_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(extension_id, scope_kind, scope_id) DO UPDATE SET
        thread_id = excluded.thread_id,
        thread_name = excluded.thread_name,
        updated_at = excluded.updated_at`,
        )
        .run(
          input.extensionId,
          input.scopeKind,
          input.scopeId,
          input.threadId,
          input.threadName,
          existing?.createdAt ?? timestamp,
          timestamp,
        );
      this.recordEvent(
        input.extensionId,
        'THREAD_BOUND',
        {
          scopeKind: input.scopeKind,
          scopeId: input.scopeId,
          threadId: input.threadId,
        },
        timestamp,
      );
      return this.getThreadBinding(input.extensionId, input.scopeKind, input.scopeId)!;
    })();
  }

  private reconcileExtension(
    manifest: ExtensionManifestDto,
    source: ExtensionSource,
    enabledByDefault: boolean,
    grantRequiredPermissionsByDefault: boolean,
  ) {
    const hash = manifestHash(manifest);
    const timestamp = now();
    const existing = this.storage.db
      .prepare(
        `SELECT extension_id, installed_version, source_kind,
      enabled, manifest_hash, installed_at, updated_at
      FROM extension_installations WHERE extension_id = ?`,
      )
      .get(manifest.id) as InstallationRow | undefined;
    if (!existing) {
      this.storage.db
        .prepare(
          `INSERT INTO extension_installations(
        extension_id, installed_version, source_kind, enabled, manifest_hash, installed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(manifest.id, manifest.version, source, enabledByDefault ? 1 : 0, hash, timestamp, timestamp);
      for (const permission of manifest.permissions) {
        this.storage.db
          .prepare(
            `INSERT INTO extension_permission_grants(
          extension_id, permission_key, granted, updated_at
        ) VALUES (?, ?, ?, ?)`,
          )
          .run(manifest.id, permission, grantRequiredPermissionsByDefault ? 1 : 0, timestamp);
      }
      for (const permission of manifest.optionalPermissions) {
        this.storage.db
          .prepare(
            `INSERT INTO extension_permission_grants(
          extension_id, permission_key, granted, updated_at
        ) VALUES (?, ?, 0, ?)`,
          )
          .run(manifest.id, permission, timestamp);
      }
      this.recordEvent(
        manifest.id,
        'DISCOVERED',
        {
          version: manifest.version,
          source,
          enabled: enabledByDefault,
          requiredPermissionsGranted: grantRequiredPermissionsByDefault,
        },
        timestamp,
      );
      return;
    }
    if (
      existing.installed_version !== manifest.version ||
      existing.manifest_hash !== hash ||
      existing.source_kind !== source
    ) {
      this.storage.db
        .prepare(
          `UPDATE extension_installations
        SET installed_version = ?, source_kind = ?, manifest_hash = ?, updated_at = ?
        WHERE extension_id = ?`,
        )
        .run(manifest.version, source, hash, timestamp, manifest.id);
      this.recordEvent(
        manifest.id,
        'UPDATED',
        {
          fromVersion: existing.installed_version,
          toVersion: manifest.version,
          source,
        },
        timestamp,
      );
    }
    for (const permission of [...manifest.permissions, ...manifest.optionalPermissions]) {
      const inheritedGrant = this.inheritedPermissionGrant(manifest.id, permission);
      this.storage.db
        .prepare(
          `INSERT OR IGNORE INTO extension_permission_grants(
        extension_id, permission_key, granted, updated_at
      ) VALUES (?, ?, ?, ?)`,
        )
        .run(manifest.id, permission, inheritedGrant ? 1 : 0, timestamp);
    }
  }

  private inheritedPermissionGrant(extensionId: string, permission: string) {
    const aliases = extensionPermissionLegacyAliases(permission);
    if (!aliases.length) return false;
    const placeholders = aliases.map(() => '?').join(', ');
    const row = this.storage.db
      .prepare(
        `SELECT 1 FROM extension_permission_grants
         WHERE extension_id = ? AND granted = 1 AND permission_key IN (${placeholders})
         LIMIT 1`,
      )
      .get(extensionId, ...aliases);
    return Boolean(row);
  }

  private recordEvent(extensionId: string, eventKind: string, payload: JsonMap, createdAt: string) {
    this.storage.db
      .prepare(
        `INSERT INTO extension_state_events(
      id, extension_id, event_kind, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), extensionId, eventKind, JSON.stringify(payload), createdAt);
  }

  private mapThreadBinding(row: ThreadBindingRow): ExtensionThreadBinding {
    return {
      extensionId: row.extension_id,
      scopeKind: row.scope_kind,
      scopeId: row.scope_id,
      threadId: row.thread_id,
      threadName: row.thread_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
