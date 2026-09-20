import type { LibraryStorage } from '@/main/database/core/storage';

export const retainedRevokedExtensionScopes = 32;
export const retainedExtensionStateEvents = 200;
export const retainedTotalExtensionStateEvents = 4096;

/** Run inside the caller's transaction. Fixed/declared denials and live grants are not history. */
export function compactExtensionPermissionHistory(
  storage: LibraryStorage,
  extensionId: string,
  declaredPermissions: readonly string[],
) {
  const declared = [...new Set(declaredPermissions)];
  const exclusion = declared.length ? `AND permission_key NOT IN (${declared.map(() => '?').join(', ')})` : '';
  storage.db
    .prepare(
      `DELETE FROM extension_permission_grants
       WHERE extension_id = ? AND granted = 0 AND permission_key IN (
         SELECT permission_key FROM extension_permission_grants
         WHERE extension_id = ? AND granted = 0 ${exclusion}
           AND (permission_key LIKE 'network:https://%' OR permission_key LIKE 'network:http://%')
         ORDER BY updated_at DESC, permission_key ASC
         LIMIT -1 OFFSET ?
       )`,
    )
    .run(extensionId, extensionId, ...declared, retainedRevokedExtensionScopes);
}

/** Audit is bounded diagnostics, not a permanent or complete security ledger. */
export function compactExtensionStateHistory(storage: LibraryStorage, extensionId: string) {
  storage.db
    .prepare(
      `DELETE FROM extension_state_events WHERE extension_id = ? AND id IN (
         SELECT id FROM extension_state_events WHERE extension_id = ?
         ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?
       )`,
    )
    .run(extensionId, extensionId, retainedExtensionStateEvents);
  storage.db
    .prepare(
      `DELETE FROM extension_state_events WHERE id IN (
         SELECT id FROM extension_state_events
         ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?
       )`,
    )
    .run(retainedTotalExtensionStateEvents);
}
