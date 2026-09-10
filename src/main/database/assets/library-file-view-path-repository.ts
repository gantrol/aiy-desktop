import { gifOutputExists, creationOutputNotExcluded } from '@/main/database/creations/creation-output-presentation-sql';
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  AssetFileRepository,
  type ResolvedAssetFile,
  safeAssetFileName,
} from '@/main/database/assets/asset-file-repository';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';
import {
  type AlbumNode,
  type IndexedLink,
  type TermDirectoryNode,
  albumsDirectoryName,
  collisionKey,
  isPathInsideOrEqual,
  nodeErrorCode,
  termsDirectoryName,
} from '@/main/database/assets/library-file-view-values';

export class LibraryFileViewPathRepository {
  protected readonly assetFiles: AssetFileRepository;

  constructor(protected readonly storage: LibraryStorage) {
    this.assetFiles = new AssetFileRepository(storage);
  }

  protected get db() {
    return this.storage.db;
  }

  protected sourcePathForRecord(root: string, entry: IndexedLink) {
    const activeAsset = this.assetFiles.resolve(entry.assetId);
    if (activeAsset) return activeAsset.absolutePath;
    try {
      const sourcePath = path.resolve(root, entry.sourceRelativePath);
      this.assertInside(root, sourcePath);
      return existsSync(sourcePath) && statSync(sourcePath).isFile() ? sourcePath : null;
    } catch {
      return null;
    }
  }

  protected preferredAssetName(asset: ResolvedAssetFile) {
    const suggestedStem = path.basename(asset.suggestedName, path.extname(asset.suggestedName));
    const exposesInternalId =
      collisionKey(suggestedStem) === collisionKey(asset.assetId) ||
      collisionKey(suggestedStem) === collisionKey(`image-${asset.assetId}`);
    return safeAssetFileName(
      exposesInternalId ? `图片${asset.extension}` : asset.suggestedName,
      'image',
      asset.extension,
    );
  }

  protected ensureExactDirectory(root: string, name: string) {
    const candidate = path.resolve(root, name);
    this.assertInside(root, candidate);
    if (!existsSync(candidate)) {
      try {
        mkdirSync(candidate);
      } catch (error) {
        if (nodeErrorCode(error) !== 'EEXIST') throw error;
      }
    }
    const entry = lstatSync(candidate);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`Library view path is unavailable: ${name}`);
    }
    const resolved = realpathSync(candidate);
    this.assertInside(root, resolved);
    return resolved;
  }

  protected loadTermDirectoryNodes() {
    const rows = this.db
      .prepare(
        `SELECT term.id,
          COALESCE(NULLIF(TRIM(revision.title), ''), '未命名词条') AS name,
          revision.created_at,
          COALESCE((
            SELECT value.id
            FROM term_facet_assignments assignment
            JOIN facet_values value ON value.id = assignment.facet_value_id
            JOIN facet_definitions definition ON definition.id = value.definition_id
            WHERE assignment.term_revision_id = revision.id
              AND definition.system_role = 'PRIMARY_CLASSIFICATION'
            ORDER BY CASE value.id WHEN placement.domain_facet_value_id THEN 0 ELSE 1 END,
              value.sort_order, value.id
            LIMIT 1
          ), '__uncategorized_domain__') AS domain_id,
          COALESCE((
            SELECT NULLIF(TRIM(value.name_zh), '')
            FROM term_facet_assignments assignment
            JOIN facet_values value ON value.id = assignment.facet_value_id
            JOIN facet_definitions definition ON definition.id = value.definition_id
            WHERE assignment.term_revision_id = revision.id
              AND definition.system_role = 'PRIMARY_CLASSIFICATION'
            ORDER BY CASE value.id WHEN placement.domain_facet_value_id THEN 0 ELSE 1 END,
              value.sort_order, value.id
            LIMIT 1
          ), '未分类') AS domain_name,
          COALESCE((
            SELECT value.id
            FROM term_facet_assignments assignment
            JOIN facet_values value ON value.id = assignment.facet_value_id
            JOIN facet_definitions definition ON definition.id = value.definition_id
            WHERE assignment.term_revision_id = revision.id
              AND definition.system_role = 'SECONDARY_CLASSIFICATION'
            ORDER BY CASE value.id WHEN placement.item_type_facet_value_id THEN 0 ELSE 1 END,
              value.sort_order, value.id
            LIMIT 1
          ), '') AS type_id,
          COALESCE((
            SELECT NULLIF(TRIM(value.name_zh), '')
            FROM term_facet_assignments assignment
            JOIN facet_values value ON value.id = assignment.facet_value_id
            JOIN facet_definitions definition ON definition.id = value.definition_id
            WHERE assignment.term_revision_id = revision.id
              AND definition.system_role = 'SECONDARY_CLASSIFICATION'
            ORDER BY CASE value.id WHEN placement.item_type_facet_value_id THEN 0 ELSE 1 END,
              value.sort_order, value.id
            LIMIT 1
          ), '未分类') AS type_name
        FROM terms term
        JOIN term_revisions revision ON revision.id = term.current_revision_id
        LEFT JOIN term_directory_placements placement ON placement.term_id = term.id
        WHERE term.archived_at IS NULL
          AND EXISTS (
          SELECT 1 FROM term_media_links media
          JOIN image_assets asset ON asset.id = media.image_asset_id AND asset.deleted_at IS NULL
          WHERE media.term_id = term.id AND media.deleted_at IS NULL
        )
        ORDER BY revision.created_at, term.id`,
      )
      .all() as JsonMap[];
    return rows.map((row): TermDirectoryNode => ({
      id: text(row.id),
      name: text(row.name),
      domainId: text(row.domain_id),
      domainName: text(row.domain_name),
      typeId: text(row.type_id),
      typeName: text(row.type_name),
      createdAt: text(row.created_at),
    }));
  }

  protected loadAlbumTree() {
    const albumRows = this.db
      .prepare(
        `SELECT id, title, created_at FROM albums
        WHERE deleted_at IS NULL ORDER BY created_at, id`,
      )
      .all() as JsonMap[];
    const albums = new Map<string, AlbumNode>(
      albumRows.map((row) => {
        const id = text(row.id);
        return [
          id,
          {
            id,
            title: text(row.title),
            parentId: null,
            createdAt: text(row.created_at),
          },
        ];
      }),
    );

    const parentRows = this.db
      .prepare(
        `SELECT member.album_id, member.target_id
        FROM album_members member
        JOIN albums parent ON parent.id = member.album_id AND parent.deleted_at IS NULL
        JOIN albums child ON child.id = member.target_id AND child.deleted_at IS NULL
        WHERE member.target_type = 'ALBUM' AND member.deleted_at IS NULL
        ORDER BY member.updated_at DESC, member.created_at DESC, member.id DESC`,
      )
      .all() as JsonMap[];
    for (const row of parentRows) {
      const childId = text(row.target_id);
      const child = albums.get(childId);
      if (child && !child.parentId) child.parentId = text(row.album_id);
    }

    this.breakParentCycles(albums);
    return albums;
  }

  protected breakParentCycles(albums: Map<string, AlbumNode>) {
    for (const startId of [...albums.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
      const pathIds: string[] = [];
      const position = new Map<string, number>();
      let currentId: string | null = startId;
      while (currentId && albums.has(currentId)) {
        const cycleStart = position.get(currentId);
        if (cycleStart !== undefined) {
          const cycleIds = pathIds.slice(cycleStart).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
          const root = albums.get(cycleIds[0]);
          if (root) root.parentId = null;
          break;
        }
        position.set(currentId, pathIds.length);
        pathIds.push(currentId);
        currentId = albums.get(currentId)?.parentId ?? null;
      }
    }
  }

  protected albumDepth(albumId: string, albums: Map<string, AlbumNode>) {
    let depth = 0;
    let currentId = albums.get(albumId)?.parentId ?? null;
    while (currentId) {
      depth += 1;
      currentId = albums.get(currentId)?.parentId ?? null;
    }
    return depth;
  }

  protected albumForAlbumContext(assetId: string, requestedAlbumId: string, albums: Map<string, AlbumNode>) {
    if (!albums.has(requestedAlbumId)) return null;
    const directAlbumIds = this.directSourceAlbumIds(assetId);
    if (directAlbumIds.includes(requestedAlbumId)) return requestedAlbumId;

    const descendants = directAlbumIds
      .map((albumId) => ({ albumId, distance: this.distanceFromAncestor(albumId, requestedAlbumId, albums) }))
      .filter((candidate): candidate is { albumId: string; distance: number } => candidate.distance !== null)
      .sort((left, right) => left.distance - right.distance || left.albumId.localeCompare(right.albumId));
    return descendants[0]?.albumId ?? null;
  }

  protected albumForCreationContext(assetId: string, seriesId: string, albums: Map<string, AlbumNode>) {
    const matches = this.db
      .prepare(
        `SELECT 1
        FROM prompt_series series
        WHERE series.id = ? AND series.deleted_at IS NULL AND series.archived_at IS NULL AND (
          EXISTS (
            SELECT 1 FROM prompt_versions version
            JOIN generation_runs run ON run.prompt_version_id = version.id
            WHERE version.series_id = series.id AND run.status = 'SUCCEEDED'
              AND run.result_asset_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM prompt_series_output_exclusions exclusion
                WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = run.result_asset_id
              )
          ) OR EXISTS (
            SELECT 1 FROM creation_output_imports imported
            WHERE imported.series_id = series.id AND imported.image_asset_id = ?
              AND imported.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM prompt_series_output_exclusions exclusion
                WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = imported.image_asset_id
              )
          ) OR EXISTS (
            SELECT 1 FROM image_transform_runs transform
            WHERE transform.series_id = series.id AND transform.output_asset_id = ?
              AND transform.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM prompt_series_output_exclusions exclusion
                WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = transform.output_asset_id
              )
          ) OR (
            ${gifOutputExists('series.id', '?')}
            AND ${creationOutputNotExcluded('series.id', '?')}
          ) OR EXISTS (
            SELECT 1 FROM prompt_versions version
            JOIN reference_bindings binding ON binding.prompt_version_id = version.id
            WHERE version.series_id = series.id AND binding.image_asset_id = ?
          )
        ) LIMIT 1`,
      )
      .get(seriesId, assetId, assetId, assetId, assetId, assetId, assetId);
    if (!matches) return null;

    const owner = this.db
      .prepare(
        `SELECT member.album_id
        FROM creation_forms form
        JOIN creation_items item ON item.id = form.creation_item_id
          AND item.deleted_at IS NULL AND item.archived_at IS NULL
        JOIN album_members member ON member.target_type = 'CREATION_ITEM'
          AND member.target_id = item.id AND member.deleted_at IS NULL
        JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
        WHERE form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
          AND form.entity_id = ? AND form.deleted_at IS NULL
        ORDER BY member.album_id LIMIT 1`,
      )
      .get(seriesId) as JsonMap | undefined;
    const albumId = owner ? text(owner.album_id) : '';
    return albumId && albums.has(albumId) ? albumId : null;
  }

  protected directSourceAlbumIds(assetId: string) {
    const rows = this.db
      .prepare(
        `SELECT member.album_id
        FROM album_members member
        JOIN albums album ON album.id = member.album_id AND album.deleted_at IS NULL
        JOIN materials material ON material.id = member.target_id
          AND material.kind IN ('IMAGE', 'VIDEO') AND material.deleted_at IS NULL
          AND material.archived_at IS NULL
        WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
          AND material.image_asset_id = ?
        UNION
        SELECT member.album_id
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
          AND run.status = 'SUCCEEDED' AND run.result_asset_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM prompt_series_output_exclusions exclusion
            WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = run.result_asset_id
          )
        UNION
        SELECT member.album_id
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
          AND imported.image_asset_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM prompt_series_output_exclusions exclusion
            WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = imported.image_asset_id
          )
        UNION
        SELECT member.album_id
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
          AND transform.output_asset_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM prompt_series_output_exclusions exclusion
            WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = transform.output_asset_id
          )
        UNION
        SELECT member.album_id
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
          AND gif.output_asset_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM prompt_series_output_exclusions exclusion
            WHERE exclusion.series_id = series.id AND exclusion.image_asset_id = gif.output_asset_id
          )
        UNION
        SELECT member.album_id
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
          AND binding.image_asset_id = ?
        ORDER BY album_id`,
      )
      .all(assetId, assetId, assetId, assetId, assetId, assetId) as JsonMap[];
    return rows.map((row) => text(row.album_id));
  }

  protected distanceFromAncestor(albumId: string, ancestorId: string, albums: Map<string, AlbumNode>): number | null {
    let distance = 0;
    let currentId: string | null = albumId;
    while (currentId) {
      if (currentId === ancestorId) return distance;
      distance += 1;
      currentId = albums.get(currentId)?.parentId ?? null;
    }
    return null;
  }

  protected relativeManagedPath(root: string, candidate: string) {
    this.assertInside(root, candidate);
    const relative = path.relative(root, candidate);
    if (!this.isManagedViewPath(root, relative)) throw new Error('Path is outside the managed library folders');
    return relative.split(path.sep).join('/');
  }

  protected relativeSafePath(root: string, candidate: string) {
    this.assertInside(root, candidate);
    return path.relative(root, candidate).split(path.sep).join('/');
  }

  protected absoluteManagedPath(root: string, relativePath: string) {
    if (!this.isManagedViewPath(root, relativePath)) throw new Error('Invalid managed library path');
    return path.resolve(root, ...relativePath.split(/[\\/]/u));
  }

  protected isManagedViewPath(root: string, relativePath: string) {
    if (!this.isSafeRelativePath(root, relativePath)) return false;
    const first = relativePath.split(/[\\/]/u)[0];
    return first === albumsDirectoryName || first === termsDirectoryName;
  }

  protected isSafeRelativePath(root: string, relativePath: string) {
    if (!relativePath || path.isAbsolute(relativePath)) return false;
    const candidate = path.resolve(root, ...relativePath.split(/[\\/]/u));
    return candidate !== root && isPathInsideOrEqual(root, candidate);
  }

  protected assertProjectionSchemaReady() {
    const rows = this.db
      .prepare(
        `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('file_projection_directories', 'file_projection_links',
            'term_directory_placements')`,
      )
      .all() as JsonMap[];
    const tables = new Set(rows.map((row) => text(row.name)));
    if (
      tables.has('file_projection_directories') &&
      tables.has('file_projection_links') &&
      tables.has('term_directory_placements')
    )
      return;

    // A dev hot reload can replace this repository without reopening the database.
    // Disable the listener so a stale process cannot repeat the same synchronization
    // error after every write; a normal restart validates the baseline before use.
    this.handleUnavailableProjectionSchema();
    throw new Error('资料目录结构不是当前 v0.3 baseline，请重启应用');
  }

  protected absolutePathKey(value: string) {
    return collisionKey(path.resolve(value));
  }

  protected handleUnavailableProjectionSchema() {
    this.storage.setChangeListener(null);
  }

  protected assertInside(root: string, candidate: string) {
    if (!isPathInsideOrEqual(root, candidate)) {
      throw new Error('Library view path escaped the library root');
    }
  }
}
