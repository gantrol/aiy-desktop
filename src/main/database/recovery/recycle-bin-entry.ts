import path from 'node:path';
import { z } from 'zod';
import type { RecycleBinEntityType, RecycleBinScope } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';

export const RECYCLE_BIN_RETENTION_DAYS = 30;

export const promptSeriesRecoveryPayloadSchema = z
  .object({
    archivedCreationIds: z.array(z.string().min(1)).max(100_000),
    archivedInspirationStashIds: z.array(z.string().min(1)).max(100_000),
    deletedImportIds: z.array(z.string().min(1)).max(100_000),
    deletedTransformIds: z.array(z.string().min(1)).max(100_000),
  })
  .strict();

export type PromptSeriesRecoveryPayload = z.infer<typeof promptSeriesRecoveryPayloadSchema>;

interface RecycleBinEntryInput {
  entityType: RecycleBinEntityType;
  entityId: string;
  scope: RecycleBinScope;
  title: string;
  deletedAt: string;
  stateBeforeDelete: 'ACTIVE' | 'ARCHIVED';
  payload?: unknown;
}

export function recycleBinPurgeAfter(deletedAt: string) {
  const value = new Date(deletedAt);
  if (!Number.isFinite(value.getTime())) throw new Error('Recycle-bin deletion time is invalid');
  value.setUTCDate(value.getUTCDate() + RECYCLE_BIN_RETENTION_DAYS);
  return value.toISOString();
}

export function putRecycleBinEntry(storage: LibraryStorage, input: RecycleBinEntryInput) {
  const title = input.title.trim() || input.entityId;
  const payloadJson = JSON.stringify(input.payload ?? {});
  const purgeAfter = recycleBinPurgeAfter(input.deletedAt);
  storage.db
    .prepare(
      `INSERT INTO recycle_bin_entries (
        entity_type, entity_id, scope, title, deleted_at, purge_after,
        state_before_delete, payload_json, purge_state, purge_requested_at,
        purge_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RETAINED', NULL, NULL, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        scope = excluded.scope,
        title = excluded.title,
        deleted_at = excluded.deleted_at,
        purge_after = excluded.purge_after,
        state_before_delete = excluded.state_before_delete,
        payload_json = excluded.payload_json,
        purge_state = 'RETAINED',
        purge_requested_at = NULL,
        purge_error = NULL,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.entityType,
      input.entityId,
      input.scope,
      title,
      input.deletedAt,
      purgeAfter,
      input.stateBeforeDelete,
      payloadJson,
      input.deletedAt,
    );
  mirrorContentLifecycleEntry(storage, input, title, purgeAfter);
}

function mirrorContentLifecycleEntry(
  storage: LibraryStorage,
  input: RecycleBinEntryInput,
  title: string,
  purgeAfter: string,
) {
  const available = storage.db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_lifecycle_batches'")
    .get();
  if (!available) return;
  const album =
    input.entityType === 'ALBUM'
      ? (storage.db.prepare('SELECT intent FROM albums WHERE id = ?').get(input.entityId) as JsonMap | undefined)
      : undefined;
  const asset =
    input.entityType === 'IMAGE_ASSET'
      ? (storage.db.prepare('SELECT mime_type FROM image_assets WHERE id = ?').get(input.entityId) as
          JsonMap | undefined)
      : undefined;
  const kind = input.entityType === 'ALBUM' ? 'ALBUM' : input.entityType === 'IMAGE_ASSET' ? 'MATERIAL' : 'CREATION';
  const subtype =
    input.entityType === 'ALBUM'
      ? text(album?.intent) === 'MATERIAL_LIBRARY'
        ? 'MATERIAL_ALBUM'
        : 'CREATION_ALBUM'
      : input.entityType === 'PROMPT_SERIES'
        ? 'PROMPT_SERIES'
        : input.entityType === 'CREATION'
          ? 'IDEA_CREATION'
          : text(asset?.mime_type).startsWith('video/')
            ? 'VIDEO_MATERIAL'
            : 'IMAGE_MATERIAL';
  const batchId = `legacy:${input.entityType.toLowerCase()}:${input.entityId}`;
  storage.db
    .prepare(
      `INSERT INTO content_lifecycle_batches (
        id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
        preview_asset_id, preview_text, state_before_action, changed_at, expires_at,
        purge_state, purge_requested_at, purge_error, updated_at
      ) VALUES (?, 'DELETE', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'RETAINED', NULL, NULL, ?)
      ON CONFLICT(action, root_entity_type, root_entity_id) DO UPDATE SET
        title = excluded.title,
        preview_asset_id = excluded.preview_asset_id,
        state_before_action = excluded.state_before_action,
        changed_at = excluded.changed_at,
        expires_at = excluded.expires_at,
        purge_state = 'RETAINED',
        purge_requested_at = NULL,
        purge_error = NULL,
        updated_at = excluded.updated_at`,
    )
    .run(
      batchId,
      input.entityType,
      input.entityId,
      kind,
      subtype,
      title,
      input.entityType === 'IMAGE_ASSET' ? input.entityId : null,
      input.stateBeforeDelete,
      input.deletedAt,
      purgeAfter,
      input.deletedAt,
    );
  const resolvedBatchId = storage.db
    .prepare(
      `SELECT id FROM content_lifecycle_batches
      WHERE action = 'DELETE' AND root_entity_type = ? AND root_entity_id = ?`,
    )
    .pluck()
    .get(input.entityType, input.entityId);
  if (typeof resolvedBatchId !== 'string') throw new Error('Content lifecycle compatibility batch was not created');
  storage.db
    .prepare(
      `INSERT INTO content_lifecycle_batch_members (
        batch_id, entity_type, entity_id, kind, subtype, title, preview_asset_id,
        preview_text, parent_entity_type, parent_entity_id, sort_order, state_before_action, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, '{}')
      ON CONFLICT(batch_id, entity_type, entity_id) DO UPDATE SET
        title = excluded.title,
        preview_asset_id = excluded.preview_asset_id,
        state_before_action = excluded.state_before_action,
        payload_json = '{}'`,
    )
    .run(
      resolvedBatchId,
      input.entityType,
      input.entityId,
      kind,
      subtype,
      title,
      input.entityType === 'IMAGE_ASSET' ? input.entityId : null,
      input.stateBeforeDelete,
    );
}

export function deletedAssetTitle(storage: LibraryStorage, assetId: string) {
  const row = storage.db
    .prepare(
      `SELECT metadata.display_name, metadata.original_name, asset.relative_path
      FROM image_assets asset
      LEFT JOIN materials material
        ON material.image_asset_id = asset.id AND material.kind IN ('IMAGE', 'VIDEO')
      LEFT JOIN external_material_metadata metadata ON metadata.material_id = material.id
      WHERE asset.id = ?
      ORDER BY material.created_at, material.id LIMIT 1`,
    )
    .get(assetId) as JsonMap | undefined;
  if (!row) throw new Error('Image asset not found');
  return (
    text(row.display_name).trim() || text(row.original_name).trim() || path.basename(text(row.relative_path)) || assetId
  );
}

export function putDeletedAssetEntry(storage: LibraryStorage, assetId: string, deletedAt: string) {
  putRecycleBinEntry(storage, {
    entityType: 'IMAGE_ASSET',
    entityId: assetId,
    scope: 'MATERIALS',
    title: deletedAssetTitle(storage, assetId),
    deletedAt,
    stateBeforeDelete: 'ACTIVE',
  });
}
