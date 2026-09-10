import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ResolvedAssetFile } from '@/main/database/assets/asset-file-repository';
import { LibraryFileViewPathRepository } from '@/main/database/assets/library-file-view-path-repository';
import {
  type DesiredLink,
  type FileViewIndex,
  type IndexedDirectory,
  type IndexedLink,
  type ProjectionDirectoryType,
  type ProjectionLinkType,
  type ProjectionState,
  collisionKey,
} from '@/main/database/assets/library-file-view-values';
import { type JsonMap, now, text } from '@/main/database/core/values';

export class LibraryFileViewIndexRepository extends LibraryFileViewPathRepository {
  protected loadAssets() {
    const rows = this.db
      .prepare(
        `WITH projected_asset_ids AS (
            SELECT material.image_asset_id AS asset_id
            FROM album_members member
            JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
            JOIN materials material ON material.id = member.target_id
              AND material.kind IN ('IMAGE', 'VIDEO') AND material.deleted_at IS NULL
              AND material.archived_at IS NULL
            WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
            UNION
            SELECT run.result_asset_id AS asset_id
            FROM album_members member
            JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
            JOIN creation_items item ON item.id = member.target_id
              AND item.deleted_at IS NULL AND item.archived_at IS NULL
            JOIN creation_forms form ON form.creation_item_id = item.id
              AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
              AND form.deleted_at IS NULL
            JOIN prompt_series series ON series.id = form.entity_id
              AND series.deleted_at IS NULL AND series.archived_at IS NULL
            JOIN prompt_versions version ON version.series_id = series.id
            JOIN generation_runs run ON run.prompt_version_id = version.id
            WHERE member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
              AND run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM prompt_series_output_exclusions exclusion
                WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = run.result_asset_id
              )
            UNION
            SELECT imported.image_asset_id AS asset_id
            FROM album_members member
            JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
            JOIN creation_items item ON item.id = member.target_id
              AND item.deleted_at IS NULL AND item.archived_at IS NULL
            JOIN creation_forms form ON form.creation_item_id = item.id
              AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
              AND form.deleted_at IS NULL
            JOIN prompt_series series ON series.id = form.entity_id
              AND series.deleted_at IS NULL AND series.archived_at IS NULL
            JOIN creation_output_imports imported ON imported.series_id = series.id
              AND imported.deleted_at IS NULL
            WHERE member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM prompt_series_output_exclusions exclusion
                WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = imported.image_asset_id
              )
            UNION
            SELECT transform.output_asset_id AS asset_id
            FROM album_members member
            JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
            JOIN creation_items item ON item.id = member.target_id
              AND item.deleted_at IS NULL AND item.archived_at IS NULL
            JOIN creation_forms form ON form.creation_item_id = item.id
              AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
              AND form.deleted_at IS NULL
            JOIN prompt_series series ON series.id = form.entity_id
              AND series.deleted_at IS NULL AND series.archived_at IS NULL
            JOIN image_transform_runs transform ON transform.series_id = series.id
              AND transform.deleted_at IS NULL
            WHERE member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM prompt_series_output_exclusions exclusion
                WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = transform.output_asset_id
              )
            UNION
            SELECT gif.output_asset_id AS asset_id
            FROM album_members member
            JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
            JOIN creation_items item ON item.id = member.target_id
              AND item.deleted_at IS NULL AND item.archived_at IS NULL
            JOIN creation_forms form ON form.creation_item_id = item.id
              AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
              AND form.deleted_at IS NULL
            JOIN prompt_series series ON series.id = form.entity_id
              AND series.deleted_at IS NULL AND series.archived_at IS NULL
            JOIN gif_documents gif_document ON gif_document.series_id = series.id
            JOIN gif_export_runs gif ON gif.document_id = gif_document.id AND gif.state = 'SUCCEEDED'
            WHERE member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM prompt_series_output_exclusions exclusion
                WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = gif.output_asset_id
              )
            UNION
            SELECT binding.image_asset_id AS asset_id
            FROM album_members member
            JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
            JOIN creation_items item ON item.id = member.target_id
              AND item.deleted_at IS NULL AND item.archived_at IS NULL
            JOIN creation_forms form ON form.creation_item_id = item.id
              AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
              AND form.deleted_at IS NULL
            JOIN prompt_series series ON series.id = form.entity_id
              AND series.deleted_at IS NULL AND series.archived_at IS NULL
            JOIN prompt_versions version ON version.series_id = series.id
            JOIN reference_bindings binding ON binding.prompt_version_id = version.id
            WHERE member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
            UNION
            SELECT media.image_asset_id AS asset_id
            FROM term_media_links media
            JOIN terms term ON term.id = media.term_id AND term.archived_at IS NULL
            WHERE media.deleted_at IS NULL
          )
          SELECT asset.id
          FROM projected_asset_ids projected
          JOIN image_assets asset ON asset.id = projected.asset_id AND asset.deleted_at IS NULL
          ORDER BY asset.created_at, asset.id`,
      )
      .all() as JsonMap[];
    const assets = new Map<string, ResolvedAssetFile>();
    for (const row of rows) {
      const asset = this.assetFiles.resolve(text(row.id));
      if (asset) assets.set(asset.assetId, asset);
    }
    return assets;
  }

  protected retireUnavailableProjectionReservations(root: string, index: FileViewIndex) {
    const missingDirectoryKeys = index.directories
      .filter((entry) => entry.state !== 'RETIRED')
      .filter((entry) => !existsSync(this.absoluteManagedPath(root, entry.relativePath)))
      .map((entry) => entry.key);
    const missingLinkKeys = index.links
      .filter((entry) => entry.state !== 'RETIRED')
      .filter((entry) => !existsSync(this.absoluteManagedPath(root, entry.relativePath)))
      .map((entry) => entry.key);
    if (missingDirectoryKeys.length === 0 && missingLinkKeys.length === 0) return;

    const timestamp = now();
    const retireDirectory = this.db.prepare(`UPDATE file_projection_directories
        SET state = 'RETIRED', retired_at = COALESCE(retired_at, ?), updated_at = ?
        WHERE projection_key = ? AND state <> 'RETIRED'`);
    const retireLink = this.db.prepare(`UPDATE file_projection_links
        SET state = 'RETIRED', retired_at = COALESCE(retired_at, ?), updated_at = ?
        WHERE projection_key = ? AND state <> 'RETIRED'`);
    this.db.transaction(() => {
      for (const key of missingDirectoryKeys) retireDirectory.run(timestamp, timestamp, key);
      for (const key of missingLinkKeys) retireLink.run(timestamp, timestamp, key);
    })();
  }

  protected loadIndex(root: string): FileViewIndex {
    const directoryRows = this.db
      .prepare(
        `SELECT projection_key, context_type, context_id, parent_projection_key, state,
          relative_path, preferred_name
        FROM file_projection_directories
        ORDER BY projection_key`,
      )
      .all() as JsonMap[];
    const linkRows = this.db
      .prepare(
        `SELECT projection_key, context_type, context_id, directory_projection_key, state,
          image_asset_id,
          relative_path, source_relative_path, source_object_hash, preferred_name
        FROM file_projection_links
        ORDER BY projection_key`,
      )
      .all() as JsonMap[];
    return {
      directories: directoryRows
        .map((row): IndexedDirectory => ({
          key: text(row.projection_key),
          contextType: text(row.context_type) as ProjectionDirectoryType,
          contextId: text(row.context_id),
          parentKey: text(row.parent_projection_key) || null,
          state: text(row.state) as ProjectionState,
          relativePath: text(row.relative_path),
          preferredLabel: text(row.preferred_name),
        }))
        .filter((entry) => this.isValidDirectoryRecord(root, entry)),
      links: linkRows
        .map((row): IndexedLink => ({
          key: text(row.projection_key),
          contextType: text(row.context_type) as ProjectionLinkType,
          contextId: text(row.context_id),
          directoryKey: text(row.directory_projection_key),
          state: text(row.state) as ProjectionState,
          assetId: text(row.image_asset_id),
          relativePath: text(row.relative_path),
          sourceRelativePath: text(row.source_relative_path),
          sourceObjectHash: text(row.source_object_hash),
          preferredName: text(row.preferred_name),
        }))
        .filter((entry) => this.isValidLinkRecord(root, entry)),
    } satisfies FileViewIndex;
  }

  protected persistCurrentDirectories(directories: IndexedDirectory[]) {
    const timestamp = now();
    const upsert = this.db.prepare(`INSERT INTO file_projection_directories
        (projection_key, context_type, context_id, parent_projection_key,
          relative_path, relative_path_key, previous_relative_path,
          preferred_name, allocated_name, allocated_name_key,
          state, reserved_until, last_error, verified_at, retired_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'ACTIVE', NULL, NULL, ?, NULL, ?, ?)
        ON CONFLICT(projection_key) DO UPDATE SET
          context_type = excluded.context_type,
          context_id = excluded.context_id,
          parent_projection_key = excluded.parent_projection_key,
          previous_relative_path = CASE
            WHEN file_projection_directories.relative_path <> excluded.relative_path
              THEN file_projection_directories.relative_path
            ELSE file_projection_directories.previous_relative_path
          END,
          relative_path = excluded.relative_path,
          relative_path_key = excluded.relative_path_key,
          preferred_name = excluded.preferred_name,
          allocated_name = excluded.allocated_name,
          allocated_name_key = excluded.allocated_name_key,
          state = 'ACTIVE',
          last_error = NULL,
          verified_at = excluded.verified_at,
          retired_at = NULL,
          updated_at = excluded.updated_at`);
    this.db.transaction(() => {
      for (const entry of directories) {
        const allocatedName = path.basename(entry.relativePath);
        upsert.run(
          entry.key,
          entry.contextType,
          entry.contextId,
          entry.parentKey,
          entry.relativePath,
          collisionKey(entry.relativePath),
          entry.preferredLabel,
          allocatedName,
          collisionKey(allocatedName),
          timestamp,
          timestamp,
          timestamp,
        );
      }
    })();
  }

  protected saveIndex(index: FileViewIndex) {
    this.db.transaction(() => {
      const timestamp = now();
      this.db
        .prepare(
          `UPDATE file_projection_links
          SET state = 'RETIRED', retired_at = COALESCE(retired_at, ?), updated_at = ?
          WHERE state <> 'RETIRED'`,
        )
        .run(timestamp, timestamp);
      this.db
        .prepare(
          `UPDATE file_projection_directories
          SET state = 'RETIRED', retired_at = COALESCE(retired_at, ?), updated_at = ?
          WHERE state <> 'RETIRED'`,
        )
        .run(timestamp, timestamp);
      const insertDirectory = this.db.prepare(`INSERT INTO file_projection_directories
          (projection_key, context_type, context_id, parent_projection_key,
            relative_path, relative_path_key, preferred_name,
            allocated_name, allocated_name_key, state, last_error, verified_at, retired_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?, NULL, ?, ?)
          ON CONFLICT(projection_key) DO UPDATE SET
            context_type = excluded.context_type,
            context_id = excluded.context_id,
            parent_projection_key = excluded.parent_projection_key,
            relative_path = excluded.relative_path,
            relative_path_key = excluded.relative_path_key,
            preferred_name = excluded.preferred_name,
            allocated_name = excluded.allocated_name,
            allocated_name_key = excluded.allocated_name_key,
            state = 'ACTIVE',
            last_error = NULL,
            verified_at = excluded.verified_at,
            retired_at = NULL,
            updated_at = excluded.updated_at`);
      for (const entry of index.directories) {
        const allocatedName = path.basename(entry.relativePath);
        insertDirectory.run(
          entry.key,
          entry.contextType,
          entry.contextId,
          entry.parentKey,
          entry.relativePath,
          collisionKey(entry.relativePath),
          entry.preferredLabel,
          allocatedName,
          collisionKey(allocatedName),
          timestamp,
          timestamp,
          timestamp,
        );
      }
      const insertLink = this.db.prepare(`INSERT INTO file_projection_links
          (projection_key, context_type, context_id, directory_projection_key,
            image_asset_id, relative_path, relative_path_key,
            source_relative_path, source_object_hash, preferred_name, allocated_name, allocated_name_key,
            state, last_error, verified_at, retired_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?, NULL, ?, ?)
          ON CONFLICT(projection_key) DO UPDATE SET
            context_type = excluded.context_type,
            context_id = excluded.context_id,
            directory_projection_key = excluded.directory_projection_key,
            image_asset_id = excluded.image_asset_id,
            relative_path = excluded.relative_path,
            relative_path_key = excluded.relative_path_key,
            source_relative_path = excluded.source_relative_path,
            source_object_hash = excluded.source_object_hash,
            preferred_name = excluded.preferred_name,
            allocated_name = excluded.allocated_name,
            allocated_name_key = excluded.allocated_name_key,
            state = 'ACTIVE',
            last_error = NULL,
            verified_at = excluded.verified_at,
            retired_at = NULL,
            updated_at = excluded.updated_at`);
      for (const entry of index.links) {
        const allocatedName = path.basename(entry.relativePath);
        insertLink.run(
          entry.key,
          entry.contextType,
          entry.contextId,
          entry.directoryKey || null,
          entry.assetId,
          entry.relativePath,
          collisionKey(entry.relativePath),
          entry.sourceRelativePath,
          entry.sourceObjectHash,
          entry.preferredName,
          allocatedName,
          collisionKey(allocatedName),
          timestamp,
          timestamp,
          timestamp,
        );
      }
    })();
  }

  protected persistPendingLink(root: string, entry: DesiredLink, destination: string) {
    const timestamp = now();
    const relativePath = this.relativeManagedPath(root, destination);
    const sourceRelativePath = this.relativeSafePath(root, entry.asset.absolutePath);
    const allocatedName = path.basename(destination);
    this.db
      .prepare(
        `INSERT INTO file_projection_links
        (projection_key, context_type, context_id, directory_projection_key, image_asset_id,
          relative_path, relative_path_key, previous_relative_path,
          source_relative_path, source_object_hash, preferred_name, allocated_name, allocated_name_key,
          state, reserved_until, last_error, verified_at, retired_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'PENDING_CREATE', NULL, NULL, NULL, NULL, ?, ?)
        ON CONFLICT(projection_key) DO UPDATE SET
          context_type = excluded.context_type,
          context_id = excluded.context_id,
          directory_projection_key = excluded.directory_projection_key,
          image_asset_id = excluded.image_asset_id,
          previous_relative_path = CASE
            WHEN file_projection_links.relative_path <> excluded.relative_path
              THEN file_projection_links.relative_path
            ELSE file_projection_links.previous_relative_path
          END,
          relative_path = excluded.relative_path,
          relative_path_key = excluded.relative_path_key,
          source_relative_path = excluded.source_relative_path,
          source_object_hash = excluded.source_object_hash,
          preferred_name = excluded.preferred_name,
          allocated_name = excluded.allocated_name,
          allocated_name_key = excluded.allocated_name_key,
          state = 'PENDING_CREATE',
          last_error = NULL,
          retired_at = NULL,
          updated_at = excluded.updated_at`,
      )
      .run(
        entry.key,
        entry.contextType,
        entry.contextId,
        entry.directoryKey || null,
        entry.asset.assetId,
        relativePath,
        collisionKey(relativePath),
        sourceRelativePath,
        entry.asset.objectHash,
        entry.preferredName,
        allocatedName,
        collisionKey(allocatedName),
        timestamp,
        timestamp,
      );
  }

  protected updateLinkState(key: string, state: ProjectionState, error: unknown = null) {
    const timestamp = now();
    const lastError = error instanceof Error ? error.message : error ? String(error) : null;
    this.db
      .prepare(
        `UPDATE file_projection_links
        SET state = ?, last_error = ?,
          verified_at = CASE WHEN ? = 'ACTIVE' THEN ? ELSE verified_at END,
          retired_at = CASE WHEN ? = 'RETIRED' THEN ? ELSE NULL END,
          updated_at = ?
        WHERE projection_key = ?`,
      )
      .run(state, lastError, state, timestamp, state, timestamp, timestamp, key);
  }

  protected isValidDirectoryRecord(root: string, value: unknown): value is IndexedDirectory {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<IndexedDirectory>;
    return (
      typeof entry.key === 'string' &&
      ['ALBUM', 'TERM_DOMAIN', 'TERM_TYPE', 'TERM'].includes(entry.contextType ?? '') &&
      typeof entry.contextId === 'string' &&
      (entry.parentKey === null || typeof entry.parentKey === 'string') &&
      ['PENDING_CREATE', 'ACTIVE', 'PENDING_DELETE', 'ERROR', 'RETIRED'].includes(entry.state ?? '') &&
      typeof entry.relativePath === 'string' &&
      typeof entry.preferredLabel === 'string' &&
      this.isManagedViewPath(root, entry.relativePath)
    );
  }

  protected isValidLinkRecord(root: string, value: unknown): value is IndexedLink {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<IndexedLink>;
    return (
      typeof entry.key === 'string' &&
      ['ALBUM', 'TERM'].includes(entry.contextType ?? '') &&
      typeof entry.contextId === 'string' &&
      typeof entry.directoryKey === 'string' &&
      ['PENDING_CREATE', 'ACTIVE', 'PENDING_DELETE', 'ERROR', 'RETIRED'].includes(entry.state ?? '') &&
      typeof entry.assetId === 'string' &&
      typeof entry.relativePath === 'string' &&
      typeof entry.sourceRelativePath === 'string' &&
      typeof entry.sourceObjectHash === 'string' &&
      typeof entry.preferredName === 'string' &&
      this.isManagedViewPath(root, entry.relativePath) &&
      this.isSafeRelativePath(root, entry.sourceRelativePath)
    );
  }
}
