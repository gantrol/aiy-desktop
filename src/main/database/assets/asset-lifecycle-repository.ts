import type { LibraryStorage } from '@/main/database/core/storage';
import { ContentLifecycleRepository } from '@/main/database/recovery/content-lifecycle-repository';

/**
 * Owns asset-level lifecycle changes. Deletion is intentionally logical: the
 * immutable object-store file and historical relationships remain available
 * for audit/history, while ordinary read models stop projecting the asset.
 */
export class AssetLifecycleRepository {
  private readonly lifecycle: ContentLifecycleRepository;

  constructor(storage: LibraryStorage) {
    this.lifecycle = new ContentLifecycleRepository(storage, async () => undefined);
  }

  delete(assetId: string): void {
    this.lifecycle.applyDirect('DELETE', { entityType: 'IMAGE_ASSET', entityId: assetId });
  }
}
