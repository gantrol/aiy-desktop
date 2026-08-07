import type { AssetDto, FavoriteTextMaterialDto } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, mediaUrl, text } from '@/main/database/values';

/**
 * The single recursive membership rule used by album counts, previews, and the
 * material library. Direct materials, creation outputs, and child albums all
 * project into the containing album; duplicate image assets collapse by id.
 */
export const albumProjectedAssetPredicate = `EXISTS (
  WITH RECURSIVE projected_albums(id) AS (
    SELECT id FROM albums WHERE id = ? AND deleted_at IS NULL
    UNION
    SELECT member.target_id
    FROM album_members member
    JOIN projected_albums parent ON parent.id = member.album_id
    JOIN albums child ON child.id = member.target_id AND child.deleted_at IS NULL
    WHERE member.target_type = 'ALBUM' AND member.deleted_at IS NULL
  ), projected_series(id) AS (
    SELECT DISTINCT member.target_id
    FROM album_members member
    JOIN projected_albums album ON album.id = member.album_id
    JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
    WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
  ), projected_assets(id) AS (
    SELECT material.image_asset_id
    FROM album_members member
    JOIN projected_albums album ON album.id = member.album_id
    JOIN materials material ON material.id = member.target_id
      AND material.kind = 'IMAGE' AND material.deleted_at IS NULL
    WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
    UNION
    SELECT run.result_asset_id
    FROM projected_series projected
    JOIN prompt_versions version ON version.series_id = projected.id
    JOIN generation_runs run ON run.prompt_version_id = version.id
    WHERE run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM generation_output_reviews review
        WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
      )
    UNION
    SELECT imported.image_asset_id
    FROM projected_series projected
    JOIN creation_output_imports imported ON imported.series_id = projected.id
    WHERE imported.deleted_at IS NULL
  )
  SELECT 1 FROM projected_assets projected WHERE projected.id = asset.id
)`;

const projectionCte = `WITH RECURSIVE projected_albums(id) AS (
  SELECT id FROM albums WHERE id = ? AND deleted_at IS NULL
  UNION
  SELECT member.target_id
  FROM album_members member
  JOIN projected_albums parent ON parent.id = member.album_id
  JOIN albums child ON child.id = member.target_id AND child.deleted_at IS NULL
  WHERE member.target_type = 'ALBUM' AND member.deleted_at IS NULL
), projected_series(id) AS (
  SELECT DISTINCT member.target_id
  FROM album_members member
  JOIN projected_albums album ON album.id = member.album_id
  JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
  WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
)`;

const batchProjectionCte = `WITH RECURSIVE projection_roots(root_id) AS (
  SELECT id FROM albums WHERE deleted_at IS NULL
), projected_albums(root_id, id) AS (
  SELECT root_id, root_id FROM projection_roots
  UNION
  SELECT parent.root_id, member.target_id
  FROM projected_albums parent
  JOIN album_members member ON member.album_id = parent.id
  JOIN albums child ON child.id = member.target_id AND child.deleted_at IS NULL
  WHERE member.target_type = 'ALBUM' AND member.deleted_at IS NULL
), projected_series(root_id, id) AS (
  SELECT DISTINCT album.root_id, member.target_id
  FROM album_members member
  JOIN projected_albums album ON album.id = member.album_id
  JOIN prompt_series series ON series.id = member.target_id AND series.deleted_at IS NULL
  WHERE member.target_type = 'SERIES' AND member.deleted_at IS NULL
)`;

export interface AlbumProjectionSummary {
  materialCount: number;
  seriesCount: number;
  previewAssets: AssetDto[];
  activityAt: string;
}

function assetDto(row: JsonMap): AssetDto {
  const id = text(row.id);
  return {
    id,
    kind: text(row.kind) as AssetDto['kind'],
    originType: text(row.origin_type),
    width: Number(row.width),
    height: Number(row.height),
    mimeType: text(row.mime_type),
    byteSize: Number(row.byte_size),
    mediaUrl: mediaUrl(id),
    createdAt: text(row.created_at),
  };
}

export class AlbumProjectionRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  summary(albumId: string): AlbumProjectionSummary {
    const count = this.db
      .prepare(
        `${projectionCte}, projected_materials(key) AS (
      SELECT CASE material.kind
        WHEN 'IMAGE' THEN 'IMAGE:' || material.image_asset_id
        ELSE 'TEXT:' || material.id
      END
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      JOIN materials material ON material.id = member.target_id AND material.deleted_at IS NULL
      LEFT JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
      WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
        AND (material.kind = 'TEXT' OR asset.id IS NOT NULL)
      UNION
      SELECT 'IMAGE:' || run.result_asset_id
      FROM projected_series projected
      JOIN prompt_versions version ON version.series_id = projected.id
      JOIN generation_runs run ON run.prompt_version_id = version.id
      JOIN image_assets asset ON asset.id = run.result_asset_id AND asset.deleted_at IS NULL
      WHERE run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM generation_output_reviews review
          WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
        )
      UNION
      SELECT 'IMAGE:' || imported.image_asset_id
      FROM projected_series projected
      JOIN creation_output_imports imported ON imported.series_id = projected.id AND imported.deleted_at IS NULL
      JOIN image_assets asset ON asset.id = imported.image_asset_id AND asset.deleted_at IS NULL
    ), activity_values(value) AS (
      SELECT COALESCE(album.content_updated_at, album.updated_at)
      FROM projected_albums projected
      JOIN albums album ON album.id = projected.id
      UNION ALL
      SELECT member.updated_at
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      WHERE member.deleted_at IS NULL
      UNION ALL
      SELECT series.created_at
      FROM projected_series projected
      JOIN prompt_series series ON series.id = projected.id
      UNION ALL
      SELECT version.created_at
      FROM projected_series projected
      JOIN prompt_versions version ON version.series_id = projected.id
      UNION ALL
      SELECT run.created_at
      FROM projected_series projected
      JOIN prompt_versions version ON version.series_id = projected.id
      JOIN generation_runs run ON run.prompt_version_id = version.id
      UNION ALL
      SELECT imported.created_at
      FROM projected_series projected
      JOIN creation_output_imports imported ON imported.series_id = projected.id
      WHERE imported.deleted_at IS NULL
    ) SELECT
      (SELECT count(*) FROM projected_materials) AS material_count,
      (SELECT count(*) FROM projected_series) AS series_count,
      (SELECT MAX(value) FROM activity_values) AS activity_at`,
      )
      .get(albumId) as JsonMap;

    const previews = this.db
      .prepare(
        `${projectionCte}, direct_assets(id, activity_at) AS (
      SELECT material.image_asset_id, member.updated_at
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      JOIN materials material ON material.id = member.target_id
        AND material.kind = 'IMAGE' AND material.deleted_at IS NULL
      WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
    ), series_assets(series_id, id, activity_at) AS (
      SELECT projected.id, run.result_asset_id, run.created_at
      FROM projected_series projected
      JOIN prompt_versions version ON version.series_id = projected.id
      JOIN generation_runs run ON run.prompt_version_id = version.id
      WHERE run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM generation_output_reviews review
          WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
        )
      UNION ALL
      SELECT projected.id, imported.image_asset_id, imported.created_at
      FROM projected_series projected
      JOIN creation_output_imports imported ON imported.series_id = projected.id
      WHERE imported.deleted_at IS NULL
    ), ranked_series_assets AS (
      SELECT series_id, id, activity_at,
        ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY activity_at, id) AS series_order
      FROM series_assets
    ), preview_candidates(id, priority, activity_at) AS (
      SELECT id, 0, activity_at FROM ranked_series_assets WHERE series_order = 1
      UNION ALL
      SELECT id, 1, activity_at FROM direct_assets
      UNION ALL
      SELECT id, 2, activity_at FROM series_assets
    ), ranked_assets AS (
      SELECT id, MIN(priority) AS priority, MAX(activity_at) AS activity_at
      FROM preview_candidates GROUP BY id
    ) SELECT asset.* FROM ranked_assets projected
      JOIN image_assets asset ON asset.id = projected.id AND asset.deleted_at IS NULL
      ORDER BY projected.priority, projected.activity_at DESC, asset.id DESC LIMIT 5`,
      )
      .all(albumId) as JsonMap[];

    return {
      materialCount: Number(count.material_count),
      seriesCount: Number(count.series_count),
      previewAssets: previews.map(assetDto),
      activityAt: text(count.activity_at),
    };
  }

  listSummaries(): Map<string, AlbumProjectionSummary> {
    const countRows = this.db
      .prepare(
        `${batchProjectionCte}, projected_materials(root_id, key) AS (
      SELECT album.root_id, CASE material.kind
        WHEN 'IMAGE' THEN 'IMAGE:' || material.image_asset_id
        ELSE 'TEXT:' || material.id
      END
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      JOIN materials material ON material.id = member.target_id AND material.deleted_at IS NULL
      LEFT JOIN image_assets asset ON asset.id = material.image_asset_id AND asset.deleted_at IS NULL
      WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
        AND (material.kind = 'TEXT' OR asset.id IS NOT NULL)
      UNION
      SELECT projected.root_id, 'IMAGE:' || run.result_asset_id
      FROM projected_series projected
      JOIN prompt_versions version ON version.series_id = projected.id
      JOIN generation_runs run ON run.prompt_version_id = version.id
      JOIN image_assets asset ON asset.id = run.result_asset_id AND asset.deleted_at IS NULL
      WHERE run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM generation_output_reviews review
          WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
        )
      UNION
      SELECT projected.root_id, 'IMAGE:' || imported.image_asset_id
      FROM projected_series projected
      JOIN creation_output_imports imported ON imported.series_id = projected.id AND imported.deleted_at IS NULL
      JOIN image_assets asset ON asset.id = imported.image_asset_id AND asset.deleted_at IS NULL
    ), material_counts(root_id, material_count) AS (
      SELECT root_id, count(*) FROM projected_materials GROUP BY root_id
    ), series_counts(root_id, series_count) AS (
      SELECT root_id, count(*) FROM projected_series GROUP BY root_id
    ), activity_values(root_id, value) AS (
      SELECT projected.root_id, COALESCE(album.content_updated_at, album.updated_at)
      FROM projected_albums projected
      JOIN albums album ON album.id = projected.id
      UNION ALL
      SELECT album.root_id, member.updated_at
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      WHERE member.deleted_at IS NULL
      UNION ALL
      SELECT projected.root_id, series.created_at
      FROM projected_series projected
      JOIN prompt_series series ON series.id = projected.id
      UNION ALL
      SELECT projected.root_id, version.created_at
      FROM projected_series projected
      JOIN prompt_versions version ON version.series_id = projected.id
      UNION ALL
      SELECT projected.root_id, run.created_at
      FROM projected_series projected
      JOIN prompt_versions version ON version.series_id = projected.id
      JOIN generation_runs run ON run.prompt_version_id = version.id
      UNION ALL
      SELECT projected.root_id, imported.created_at
      FROM projected_series projected
      JOIN creation_output_imports imported ON imported.series_id = projected.id
      WHERE imported.deleted_at IS NULL
    ), activity_summaries(root_id, activity_at) AS (
      SELECT root_id, MAX(value) FROM activity_values GROUP BY root_id
    ) SELECT root.root_id AS album_id,
        COALESCE(material.material_count, 0) AS material_count,
        COALESCE(series.series_count, 0) AS series_count,
        activity.activity_at
      FROM projection_roots root
      LEFT JOIN material_counts material ON material.root_id = root.root_id
      LEFT JOIN series_counts series ON series.root_id = root.root_id
      LEFT JOIN activity_summaries activity ON activity.root_id = root.root_id`,
      )
      .all() as JsonMap[];

    const summaries = new Map<string, AlbumProjectionSummary>();
    for (const row of countRows) {
      summaries.set(text(row.album_id), {
        materialCount: Number(row.material_count),
        seriesCount: Number(row.series_count),
        previewAssets: [],
        activityAt: text(row.activity_at),
      });
    }

    const previewRows = this.db
      .prepare(
        `${batchProjectionCte}, direct_assets(root_id, id, activity_at) AS (
      SELECT album.root_id, material.image_asset_id, member.updated_at
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      JOIN materials material ON material.id = member.target_id
        AND material.kind = 'IMAGE' AND material.deleted_at IS NULL
      WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
    ), series_assets(root_id, series_id, id, activity_at) AS (
      SELECT projected.root_id, projected.id, run.result_asset_id, run.created_at
      FROM projected_series projected
      JOIN prompt_versions version ON version.series_id = projected.id
      JOIN generation_runs run ON run.prompt_version_id = version.id
      WHERE run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM generation_output_reviews review
          WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
        )
      UNION ALL
      SELECT projected.root_id, projected.id, imported.image_asset_id, imported.created_at
      FROM projected_series projected
      JOIN creation_output_imports imported ON imported.series_id = projected.id
      WHERE imported.deleted_at IS NULL
    ), ranked_series_assets AS (
      SELECT root_id, series_id, id, activity_at,
        ROW_NUMBER() OVER (
          PARTITION BY root_id, series_id ORDER BY activity_at, id
        ) AS series_order
      FROM series_assets
    ), preview_candidates(root_id, id, priority, activity_at) AS (
      SELECT root_id, id, 0, activity_at FROM ranked_series_assets WHERE series_order = 1
      UNION ALL
      SELECT root_id, id, 1, activity_at FROM direct_assets
      UNION ALL
      SELECT root_id, id, 2, activity_at FROM series_assets
    ), ranked_assets(root_id, id, priority, activity_at) AS (
      SELECT root_id, id, MIN(priority), MAX(activity_at)
      FROM preview_candidates GROUP BY root_id, id
    ), limited_assets AS (
      SELECT root_id, id, priority, activity_at,
        ROW_NUMBER() OVER (
          PARTITION BY root_id ORDER BY priority, activity_at DESC, id DESC
        ) AS preview_order
      FROM ranked_assets
    ) SELECT projected.root_id AS album_id, asset.*
      FROM limited_assets projected
      JOIN image_assets asset ON asset.id = projected.id AND asset.deleted_at IS NULL
      WHERE projected.preview_order <= 5
      ORDER BY projected.root_id, projected.preview_order`,
      )
      .all() as JsonMap[];

    for (const row of previewRows) {
      summaries.get(text(row.album_id))?.previewAssets.push(assetDto(row));
    }
    return summaries;
  }

  listTextMaterials(albumId: string): FavoriteTextMaterialDto[] {
    const rows = this.db
      .prepare(
        `${projectionCte}
      SELECT material.id, material.text_content, material.created_at,
        MAX(member.updated_at) AS membership_updated_at
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      JOIN materials material ON material.id = member.target_id
        AND material.kind = 'TEXT' AND material.deleted_at IS NULL
      WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
      GROUP BY material.id, material.text_content, material.created_at
      ORDER BY membership_updated_at DESC, material.id DESC`,
      )
      .all(albumId) as JsonMap[];
    return rows.map((row) => ({
      id: text(row.id),
      text: text(row.text_content),
      createdAt: text(row.created_at),
      favoritedAt: text(row.membership_updated_at),
    }));
  }
}
