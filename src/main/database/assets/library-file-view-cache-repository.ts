import { realpathSync } from 'node:fs';
import { LibraryFileViewProjectionRepository } from '@/main/database/assets/library-file-view-projection-repository';
import {
  type FileViewIndex,
  albumsDirectoryName,
  directProjectionChangeTypeValues,
  directoryKey,
  projectionCacheAlgorithmVersion,
  projectionCacheChangeRowIdKey,
  projectionCacheDirectoryCountKey,
  projectionCacheLinkCountKey,
  projectionCacheMetadataKeys,
  projectionCacheSchemaVersionKey,
  projectionCacheStateKey,
  projectionCacheTermPlacementCountKey,
  projectionCacheVersionKey,
  safeDirectoryLabel,
  storedNonNegativeInteger,
  termsDirectoryName,
} from '@/main/database/assets/library-file-view-values';
import { type JsonMap, text } from '@/main/database/core/values';

export class LibraryFileViewCacheRepository extends LibraryFileViewProjectionRepository {
  protected loadReusableProjection(): FileViewIndex | null {
    const placeholders = projectionCacheMetadataKeys.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT key, value FROM app_meta
        WHERE key IN (${placeholders})`,
      )
      .all(...projectionCacheMetadataKeys) as JsonMap[];
    const metadata = new Map(rows.map((row) => [text(row.key), text(row.value)]));
    if (
      metadata.get(projectionCacheVersionKey) !== projectionCacheAlgorithmVersion ||
      metadata.get(projectionCacheStateKey) !== 'CLEAN'
    )
      return null;

    const checkpointRowId = storedNonNegativeInteger(metadata.get(projectionCacheChangeRowIdKey));
    const checkpointSchemaVersion = storedNonNegativeInteger(metadata.get(projectionCacheSchemaVersionKey));
    const expectedDirectoryCount = storedNonNegativeInteger(metadata.get(projectionCacheDirectoryCountKey));
    const expectedLinkCount = storedNonNegativeInteger(metadata.get(projectionCacheLinkCountKey));
    const expectedTermPlacementCount = storedNonNegativeInteger(metadata.get(projectionCacheTermPlacementCountKey));
    if (
      checkpointRowId === null ||
      checkpointSchemaVersion === null ||
      expectedDirectoryCount === null ||
      expectedLinkCount === null ||
      expectedTermPlacementCount === null ||
      checkpointSchemaVersion !== this.currentSchemaVersion() ||
      this.hasUnsettledProjectionRows()
    )
      return null;

    const currentChangeRowId = this.currentChangeRowId();
    if (currentChangeRowId < checkpointRowId || this.hasRelevantProjectionChangesAfter(checkpointRowId)) return null;

    const root = realpathSync(this.storage.libraryRoot);
    const index = this.loadIndex(root);
    const activeDirectoryCount = index.directories.filter((entry) => entry.state === 'ACTIVE').length;
    const activeLinkCount = index.links.filter((entry) => entry.state === 'ACTIVE').length;
    const termPlacementCount = Number(
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
        FROM term_directory_placements`,
        )
        .pluck()
        .get(),
    );
    if (
      activeDirectoryCount !== expectedDirectoryCount ||
      activeLinkCount !== expectedLinkCount ||
      termPlacementCount !== expectedTermPlacementCount
    )
      return null;

    // Ignore unrelated change events without carrying an ever-growing scan range.
    if (currentChangeRowId > checkpointRowId) {
      this.writeProjectionCacheValue(projectionCacheChangeRowIdKey, String(currentChangeRowId));
    }
    return index;
  }

  protected reconcileAndCheckpoint(): FileViewIndex {
    // This is a projection-work marker, not a process-lifetime marker. A dev
    // watcher may terminate Electron abruptly while an already-clean projection
    // remains safe to reuse; an interrupted reconciliation remains DIRTY.
    this.writeProjectionCacheValue(projectionCacheStateKey, 'DIRTY');
    const checkpointRowId = this.currentChangeRowId();
    const schemaVersion = this.currentSchemaVersion();
    const index = this.reconcile();
    this.persistProjectionCheckpoint(index, checkpointRowId, schemaVersion);
    return index;
  }

  protected persistProjectionCheckpoint(index: FileViewIndex, changeRowId: number, schemaVersion: number) {
    const activeDirectoryCount = index.directories.filter((entry) => entry.state === 'ACTIVE').length;
    const activeLinkCount = index.links.filter((entry) => entry.state === 'ACTIVE').length;
    const termPlacementCount = Number(
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
        FROM term_directory_placements`,
        )
        .pluck()
        .get(),
    );
    const values = [
      [projectionCacheVersionKey, projectionCacheAlgorithmVersion],
      [projectionCacheStateKey, 'CLEAN'],
      [projectionCacheChangeRowIdKey, String(changeRowId)],
      [projectionCacheSchemaVersionKey, String(schemaVersion)],
      [projectionCacheDirectoryCountKey, String(activeDirectoryCount)],
      [projectionCacheLinkCountKey, String(activeLinkCount)],
      [projectionCacheTermPlacementCountKey, String(termPlacementCount)],
    ] as const;
    const upsert = this.db.prepare(`INSERT INTO app_meta(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    this.db.transaction(() => {
      for (const [key, value] of values) upsert.run(key, value);
    })();
  }

  protected writeProjectionCacheValue(key: string, value: string) {
    this.db
      .prepare(
        `INSERT INTO app_meta(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  protected currentChangeRowId() {
    const value = Number(
      this.db
        .prepare(
          `SELECT COALESCE(MAX(rowid), 0)
        FROM change_events`,
        )
        .pluck()
        .get(),
    );
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  protected currentSchemaVersion() {
    const value = Number(
      this.db
        .prepare(
          `SELECT value FROM app_meta
        WHERE key = 'database_schema_revision'`,
        )
        .pluck()
        .get(),
    );
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  protected hasRelevantProjectionChangesAfter(changeRowId: number) {
    const placeholders = directProjectionChangeTypeValues.map(() => '?').join(', ');
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM change_events
        WHERE rowid > ? AND (
          entity_type IN (${placeholders})
          OR (
            entity_type = 'IMAGE_ASSET'
            AND EXISTS (
              SELECT 1 FROM file_projection_links link
              WHERE link.image_asset_id = change_events.entity_id
            )
          )
          OR (
            entity_type IN ('MATERIAL', 'EXTERNAL_MATERIAL_METADATA')
            AND EXISTS (
              SELECT 1 FROM materials material
              JOIN file_projection_links link ON link.image_asset_id = material.image_asset_id
              WHERE material.id = change_events.entity_id
            )
          )
        ) LIMIT 1`,
        )
        .get(changeRowId, ...directProjectionChangeTypeValues),
    );
  }

  protected hasUnsettledProjectionRows() {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM file_projection_directories
        WHERE state NOT IN ('ACTIVE', 'RETIRED') LIMIT 1`,
        )
        .get() ||
      this.db
        .prepare(
          `SELECT 1 FROM file_projection_links
          WHERE state NOT IN ('ACTIVE', 'RETIRED') LIMIT 1`,
        )
        .get(),
    );
  }

  protected reconcile(): FileViewIndex {
    this.assertProjectionSchemaReady();
    const root = realpathSync(this.storage.libraryRoot);
    const albumsRoot = this.ensureExactDirectory(root, albumsDirectoryName);
    const termsRoot = this.ensureExactDirectory(root, termsDirectoryName);
    const previousIndex = this.loadIndex(root);
    this.retireUnavailableProjectionReservations(root, previousIndex);
    const albums = this.loadAlbumTree();
    const terms = this.loadTermDirectoryNodes();
    const assets = this.loadAssets();
    const previousDirectories = previousIndex.directories;
    const albumDirectories = this.reconcileAlbumDirectories(root, albumsRoot, albums, previousDirectories);
    const termProjection = this.reconcileTermDirectories(root, termsRoot, terms, previousDirectories);
    const currentDirectories = [
      ...[...albumDirectories.entries()].map(([albumId, absolutePath]) => ({
        key: directoryKey('ALBUM', albumId),
        contextType: 'ALBUM' as const,
        contextId: albumId,
        parentKey: albums.get(albumId)?.parentId ? directoryKey('ALBUM', albums.get(albumId)!.parentId!) : null,
        state: 'ACTIVE' as const,
        relativePath: this.relativeManagedPath(root, absolutePath),
        preferredLabel: safeDirectoryLabel(albums.get(albumId)?.title ?? ''),
      })),
      ...termProjection.directories,
    ];
    this.persistCurrentDirectories(currentDirectories);
    const desiredLinks = this.buildDesiredLinks(root, assets, albumDirectories, termProjection.termDirectories, terms);
    const previousLinks = previousIndex.links;
    const links = this.reconcileLinks(root, desiredLinks, previousLinks);
    this.removeEmptyManagedDirectories(root, previousDirectories, currentDirectories);

    const nextIndex: FileViewIndex = {
      directories: currentDirectories,
      links,
    };
    this.saveIndex(nextIndex);
    return nextIndex;
  }
}
