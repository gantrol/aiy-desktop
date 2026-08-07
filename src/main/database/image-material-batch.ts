import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';
import { databaseBatches, sqlPlaceholders } from '@/main/database/database-batch';

export { databaseBatches, sqlPlaceholders } from '@/main/database/database-batch';

/** Resolve, restore, or create image materials with two set reads per batch. */
export function ensureImageMaterials(storage: LibraryStorage, imageAssetIdsInput: readonly string[]): string[] {
  const db = storage.db;
  const imageAssetIds = [...new Set(imageAssetIdsInput)];
  const assetsById = new Map<string, JsonMap>();
  const materialsByAssetId = new Map<string, { active: string | null; deleted: string | null }>();
  for (const batch of databaseBatches(imageAssetIds)) {
    const assetRows = db
      .prepare(
        `SELECT id, object_hash, origin_type FROM image_assets
        WHERE id IN (${sqlPlaceholders(batch.length)}) AND deleted_at IS NULL`,
      )
      .all(...batch) as JsonMap[];
    for (const row of assetRows) assetsById.set(text(row.id), row);

    const materialRows = db
      .prepare(
        `SELECT id, image_asset_id, deleted_at FROM materials
        WHERE kind = 'IMAGE' AND image_asset_id IN (${sqlPlaceholders(batch.length)})
        ORDER BY created_at, id`,
      )
      .all(...batch) as JsonMap[];
    for (const row of materialRows) {
      const imageAssetId = text(row.image_asset_id);
      const current = materialsByAssetId.get(imageAssetId) ?? { active: null, deleted: null };
      if (row.deleted_at === null || row.deleted_at === undefined) current.active ??= text(row.id);
      else current.deleted ??= text(row.id);
      materialsByAssetId.set(imageAssetId, current);
    }
  }
  if (assetsById.size !== imageAssetIds.length) throw new Error('Image asset not found');

  const restoreMaterial = db.prepare('UPDATE materials SET deleted_at = NULL WHERE id = ?');
  const insertMaterial = db.prepare(
    `INSERT INTO materials
    (id, kind, image_asset_id, text_content, content_hash, source_type, created_at, deleted_at)
    VALUES (?, 'IMAGE', ?, NULL, ?, ?, ?, NULL)`,
  );
  const materialByAssetId = new Map<string, string>();
  for (const imageAssetId of imageAssetIds) {
    const existing = materialsByAssetId.get(imageAssetId);
    if (existing?.active) {
      materialByAssetId.set(imageAssetId, existing.active);
      continue;
    }
    if (existing?.deleted) {
      restoreMaterial.run(existing.deleted);
      storage.recordChange('MATERIAL', existing.deleted, 'RESTORE', { imageAssetId });
      materialByAssetId.set(imageAssetId, existing.deleted);
      continue;
    }
    const asset = assetsById.get(imageAssetId) as JsonMap;
    const materialId = ulid();
    insertMaterial.run(materialId, imageAssetId, text(asset.object_hash), text(asset.origin_type), now());
    storage.recordChange('MATERIAL', materialId, 'CREATE', { kind: 'IMAGE', imageAssetId });
    materialByAssetId.set(imageAssetId, materialId);
  }
  return imageAssetIdsInput.map((imageAssetId) => materialByAssetId.get(imageAssetId) as string);
}
