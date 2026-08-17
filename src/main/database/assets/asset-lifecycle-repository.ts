import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now } from '@/main/database/core/values';

/**
 * Owns asset-level lifecycle changes. Deletion is intentionally logical: the
 * immutable object-store file and historical relationships remain available
 * for audit/history, while ordinary read models stop projecting the asset.
 */
export class AssetLifecycleRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  delete(assetId: string): void {
    this.db.transaction(() => {
      const asset = this.db.prepare('SELECT id FROM image_assets WHERE id = ? AND deleted_at IS NULL').get(assetId);
      if (!asset) throw new Error('Image asset not found');

      const deletedAt = now();
      this.db
        .prepare('UPDATE image_assets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(deletedAt, assetId);
      this.db
        .prepare("INSERT INTO tombstones VALUES (?, 'IMAGE_ASSET', ?, ?, 'LOCAL_ONLY')")
        .run(ulid(), assetId, deletedAt);
      this.storage.recordChange('IMAGE_ASSET', assetId, 'DELETE', { preserveFile: true });
    })();
  }
}
