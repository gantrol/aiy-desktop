import type { AssetDto, FavoriteTextMaterialDto } from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, mediaUrl, text } from '@/main/database/core/values';
import {
  creationItemCoverSortOrder,
  creationItemIncludesSeries,
} from '@/main/database/creations/creation-output-presentation-sql';

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
  ), projected_creation_items(id) AS (
    SELECT DISTINCT member.target_id
    FROM album_members member
    JOIN projected_albums album ON album.id = member.album_id
    JOIN creation_items item ON item.id = member.target_id
      AND item.deleted_at IS NULL AND item.archived_at IS NULL
    WHERE member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
  ), projected_owner_series(id) AS (
    SELECT DISTINCT form.entity_id
    FROM projected_creation_items item
    JOIN creation_forms form ON form.creation_item_id = item.id
      AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
      AND form.deleted_at IS NULL
    JOIN prompt_series series ON series.id = form.entity_id
      AND series.deleted_at IS NULL AND series.archived_at IS NULL
    UNION
    SELECT DISTINCT visual.prompt_series_id
    FROM projected_creation_items item
    JOIN creation_forms form ON form.creation_item_id = item.id
      AND form.entity_type = 'DERIVED_VISUAL' AND form.deleted_at IS NULL
    JOIN derived_visuals visual ON visual.id = form.entity_id AND visual.prompt_series_id IS NOT NULL
    JOIN prompt_series series ON series.id = visual.prompt_series_id
      AND series.deleted_at IS NULL AND series.archived_at IS NULL
  ), projected_series(id) AS (
    SELECT DISTINCT series.id
    FROM projected_owner_series owner
    JOIN prompt_series series ON series.deleted_at IS NULL AND series.archived_at IS NULL
    WHERE ${creationItemIncludesSeries('owner.id', 'series.id')}
  ), projected_assets(id) AS (
    SELECT material.image_asset_id
    FROM album_members member
    JOIN projected_albums album ON album.id = member.album_id
    JOIN materials material ON material.id = member.target_id
      AND material.kind IN ('IMAGE', 'VIDEO') AND material.deleted_at IS NULL AND material.archived_at IS NULL
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
      AND NOT EXISTS (
        SELECT 1 FROM prompt_series_output_exclusions exclusion
        WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = run.result_asset_id
      )
    UNION
    SELECT imported.image_asset_id
    FROM projected_series projected
    JOIN creation_output_imports imported ON imported.series_id = projected.id
    WHERE imported.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM prompt_series_output_exclusions exclusion
        WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = imported.image_asset_id
      )
    UNION
    SELECT transform.output_asset_id
    FROM projected_series projected
    JOIN image_transform_runs transform ON transform.series_id = projected.id
    WHERE transform.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM prompt_series_output_exclusions exclusion
        WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = transform.output_asset_id
      )
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
), projected_creation_items(id) AS (
  SELECT DISTINCT member.target_id
  FROM album_members member
  JOIN projected_albums album ON album.id = member.album_id
  JOIN creation_items item ON item.id = member.target_id
    AND item.deleted_at IS NULL AND item.archived_at IS NULL
  WHERE member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
), projected_owner_series(id) AS (
  SELECT DISTINCT form.entity_id
  FROM projected_creation_items item
  JOIN creation_forms form ON form.creation_item_id = item.id
    AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
    AND form.deleted_at IS NULL
  JOIN prompt_series series ON series.id = form.entity_id
    AND series.deleted_at IS NULL AND series.archived_at IS NULL
  UNION
  SELECT DISTINCT visual.prompt_series_id
  FROM projected_creation_items item
  JOIN creation_forms form ON form.creation_item_id = item.id
    AND form.entity_type = 'DERIVED_VISUAL' AND form.deleted_at IS NULL
  JOIN derived_visuals visual ON visual.id = form.entity_id AND visual.prompt_series_id IS NOT NULL
  JOIN prompt_series series ON series.id = visual.prompt_series_id
    AND series.deleted_at IS NULL AND series.archived_at IS NULL
), projected_series(id) AS (
  SELECT DISTINCT series.id
  FROM projected_owner_series owner
  JOIN prompt_series series ON series.deleted_at IS NULL AND series.archived_at IS NULL
  WHERE ${creationItemIncludesSeries('owner.id', 'series.id')}
)`;

const batchProjectionCte = (rootCount: number) => `WITH RECURSIVE projection_roots(root_id) AS (
  SELECT id FROM albums
  WHERE id IN (${Array.from({ length: rootCount }, () => '?').join(',')}) AND deleted_at IS NULL
), projected_albums(root_id, id) AS (
  SELECT root_id, root_id FROM projection_roots
  UNION
  SELECT parent.root_id, member.target_id
  FROM projected_albums parent
  JOIN album_members member ON member.album_id = parent.id
  JOIN albums child ON child.id = member.target_id AND child.deleted_at IS NULL
  WHERE member.target_type = 'ALBUM' AND member.deleted_at IS NULL
), projected_creation_items(root_id, id) AS (
  SELECT DISTINCT album.root_id, member.target_id
  FROM album_members member
  JOIN projected_albums album ON album.id = member.album_id
  JOIN creation_items item ON item.id = member.target_id
    AND item.deleted_at IS NULL AND item.archived_at IS NULL
  WHERE member.target_type = 'CREATION_ITEM' AND member.deleted_at IS NULL
), projected_owner_series(root_id, id) AS (
  SELECT DISTINCT item.root_id, form.entity_id
  FROM projected_creation_items item
  JOIN creation_forms form ON form.creation_item_id = item.id
    AND form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
    AND form.deleted_at IS NULL
  JOIN prompt_series series ON series.id = form.entity_id
    AND series.deleted_at IS NULL AND series.archived_at IS NULL
  UNION
  SELECT DISTINCT item.root_id, visual.prompt_series_id
  FROM projected_creation_items item
  JOIN creation_forms form ON form.creation_item_id = item.id
    AND form.entity_type = 'DERIVED_VISUAL' AND form.deleted_at IS NULL
  JOIN derived_visuals visual ON visual.id = form.entity_id AND visual.prompt_series_id IS NOT NULL
  JOIN prompt_series series ON series.id = visual.prompt_series_id
    AND series.deleted_at IS NULL AND series.archived_at IS NULL
), projected_series(root_id, id) AS (
  SELECT DISTINCT owner.root_id, series.id
  FROM projected_owner_series owner
  JOIN prompt_series series ON series.deleted_at IS NULL AND series.archived_at IS NULL
  WHERE ${creationItemIncludesSeries('owner.id', 'series.id')}
)`;

export interface AlbumProjectionSummary {
  materialCount: number;
  creationItemCount: number;
  previewAssets: AssetDto[];
  documentPreviewAssets: AssetDto[];
  activityAt: string;
}

function appendPreviewRows(summaries: Map<string, AlbumProjectionSummary>, rows: readonly JsonMap[]) {
  for (const row of rows) {
    const summary = summaries.get(text(row.album_id));
    if (!summary) continue;
    const target = text(row.preview_kind) === 'DOCUMENT' ? summary.documentPreviewAssets : summary.previewAssets;
    target.push(assetDto(row));
  }
}

function projectedCreationItemActivityValues(rootIdExpression?: string) {
  const root = rootIdExpression ? `${rootIdExpression}, ` : '';
  return `SELECT ${root}item.updated_at
    FROM projected_creation_items projected
    JOIN creation_items item ON item.id = projected.id
    UNION ALL
    SELECT ${root}form.updated_at
    FROM projected_creation_items projected
    JOIN creation_forms form ON form.creation_item_id = projected.id AND form.deleted_at IS NULL
    UNION ALL
    SELECT ${root}inspiration.updated_at
    FROM projected_creation_items projected
    JOIN creation_forms form ON form.creation_item_id = projected.id
      AND form.entity_type = 'INSPIRATION_STASH' AND form.deleted_at IS NULL
    JOIN inspiration_stashes inspiration ON inspiration.id = form.entity_id AND inspiration.deleted_at IS NULL
    UNION ALL
    SELECT ${root}post.updated_at
    FROM projected_creation_items projected
    JOIN creation_forms form ON form.creation_item_id = projected.id
      AND form.entity_type = 'SOCIAL_POST' AND form.deleted_at IS NULL
    JOIN social_post_drafts post ON post.id = form.entity_id AND post.deleted_at IS NULL
    UNION ALL
    SELECT ${root}article.updated_at
    FROM projected_creation_items projected
    JOIN creation_forms form ON form.creation_item_id = projected.id
      AND form.entity_type = 'ARTICLE' AND form.deleted_at IS NULL
    JOIN articles article ON article.id = form.entity_id AND article.deleted_at IS NULL
    UNION ALL
    SELECT ${root}document.updated_at
    FROM projected_creation_items projected
    JOIN creation_forms form ON form.creation_item_id = projected.id
      AND form.entity_type = 'VIDEO_DOCUMENT' AND form.deleted_at IS NULL
    JOIN documents document ON document.id = form.entity_id AND document.deleted_at IS NULL
    UNION ALL
    SELECT ${root}visual.updated_at
    FROM projected_creation_items projected
    JOIN creation_forms form ON form.creation_item_id = projected.id
      AND form.entity_type = 'DERIVED_VISUAL' AND form.deleted_at IS NULL
    JOIN derived_visuals visual ON visual.id = form.entity_id`;
}

function projectedSeriesActivityValues(rootIdExpression?: string) {
  const root = rootIdExpression ? `${rootIdExpression}, ` : '';
  return `SELECT ${root}series.created_at
    FROM projected_series projected
    JOIN prompt_series series ON series.id = projected.id
    UNION ALL
    SELECT ${root}version.created_at
    FROM projected_series projected
    JOIN prompt_versions version ON version.series_id = projected.id
    UNION ALL
    SELECT ${root}COALESCE(run.finished_at, run.created_at)
    FROM projected_series projected
    JOIN prompt_versions version ON version.series_id = projected.id
    JOIN generation_runs run ON run.prompt_version_id = version.id
    UNION ALL
    SELECT ${root}imported.created_at
    FROM projected_series projected
    JOIN creation_output_imports imported ON imported.series_id = projected.id
    WHERE imported.deleted_at IS NULL
    UNION ALL
    SELECT ${root}transform.created_at
    FROM projected_series projected
    JOIN image_transform_runs transform ON transform.series_id = projected.id
    WHERE transform.deleted_at IS NULL
    UNION ALL
    SELECT ${root}review.updated_at
    FROM projected_series projected
    JOIN prompt_versions version ON version.series_id = projected.id
    JOIN generation_runs run ON run.prompt_version_id = version.id
    JOIN generation_output_reviews review ON review.generation_run_id = run.id
    UNION ALL
    SELECT ${root}cover.created_at
    FROM projected_series projected
    JOIN prompt_series_cover_assets cover ON cover.series_id = projected.id
    UNION ALL
    SELECT ${root}exclusion.removed_at
    FROM projected_series projected
    JOIN prompt_series_output_exclusions exclusion ON exclusion.series_id = projected.id`;
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
        WHEN 'TEXT' THEN 'TEXT:' || material.id
        ELSE material.kind || ':' || material.image_asset_id
      END
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      JOIN materials material ON material.id = member.target_id
        AND material.deleted_at IS NULL AND material.archived_at IS NULL
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
        AND NOT EXISTS (
          SELECT 1 FROM prompt_series_output_exclusions exclusion
          WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = run.result_asset_id
        )
      UNION
      SELECT 'IMAGE:' || imported.image_asset_id
      FROM projected_series projected
      JOIN creation_output_imports imported ON imported.series_id = projected.id AND imported.deleted_at IS NULL
      JOIN image_assets asset ON asset.id = imported.image_asset_id AND asset.deleted_at IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM prompt_series_output_exclusions exclusion
        WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = imported.image_asset_id
      )
      UNION
      SELECT 'IMAGE:' || transform.output_asset_id
      FROM projected_series projected
      JOIN image_transform_runs transform ON transform.series_id = projected.id AND transform.deleted_at IS NULL
      JOIN image_assets asset ON asset.id = transform.output_asset_id AND asset.deleted_at IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM prompt_series_output_exclusions exclusion
        WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = transform.output_asset_id
      )
    ), activity_values(value) AS (
      SELECT COALESCE(album.content_updated_at, album.created_at)
      FROM projected_albums projected
      JOIN albums album ON album.id = projected.id
      UNION ALL
      SELECT member.updated_at
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      WHERE member.deleted_at IS NULL
      UNION ALL
      ${projectedCreationItemActivityValues()}
      UNION ALL
      ${projectedSeriesActivityValues()}
    ) SELECT
      (SELECT count(*) FROM projected_materials) AS material_count,
      (SELECT count(*) FROM projected_creation_items) AS creation_item_count,
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
        AND material.kind IN ('IMAGE', 'VIDEO') AND material.deleted_at IS NULL
        AND material.archived_at IS NULL
      WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
    ), creative_assets(id, activity_at) AS (
      SELECT reference.value, inspiration.updated_at
      FROM projected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'INSPIRATION' AND form.entity_type = 'INSPIRATION_STASH'
        AND form.deleted_at IS NULL
      JOIN inspiration_stashes inspiration ON inspiration.id = form.entity_id
        AND inspiration.status = 'ACTIVE' AND inspiration.deleted_at IS NULL
      JOIN json_each(inspiration.input_json, '$.referenceAssetIds') reference
      UNION ALL
      SELECT media.value, post.updated_at
      FROM projected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'SOCIAL_POST' AND form.entity_type = 'SOCIAL_POST'
        AND form.deleted_at IS NULL
      JOIN social_post_drafts post ON post.id = form.entity_id
        AND post.status = 'ACTIVE' AND post.deleted_at IS NULL
      JOIN social_post_revisions revision ON revision.id = post.current_revision_id
      JOIN json_each(revision.content_json, '$.mediaAssetIds') media
      UNION ALL
      SELECT json_extract(binding.value, '$.assetId'), article.updated_at
      FROM projected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'ARTICLE' AND form.entity_type = 'ARTICLE'
        AND form.deleted_at IS NULL
      JOIN articles article ON article.id = form.entity_id
        AND article.status = 'ACTIVE' AND article.deleted_at IS NULL
      JOIN article_revisions revision ON revision.id = article.current_revision_id
      JOIN json_each(revision.content_json, '$.mediaBindings') binding
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
        AND NOT EXISTS (
          SELECT 1 FROM prompt_series_output_exclusions exclusion
          WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = run.result_asset_id
        )
      UNION ALL
      SELECT projected.id, imported.image_asset_id, imported.created_at
      FROM projected_series projected
      JOIN creation_output_imports imported ON imported.series_id = projected.id
      WHERE imported.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM prompt_series_output_exclusions exclusion
          WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = imported.image_asset_id
        )
      UNION ALL
      SELECT projected.id, transform.output_asset_id, transform.created_at
      FROM projected_series projected
      JOIN image_transform_runs transform ON transform.series_id = projected.id
      WHERE transform.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM prompt_series_output_exclusions exclusion
          WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = transform.output_asset_id
        )
    ), ranked_series_assets AS (
      SELECT assets.series_id, assets.id, assets.activity_at,
        ${creationItemCoverSortOrder('assets.series_id', 'assets.id')} AS cover_sort_order,
        ROW_NUMBER() OVER (
          PARTITION BY assets.series_id
          ORDER BY COALESCE(${creationItemCoverSortOrder('assets.series_id', 'assets.id')}, 2147483647),
            assets.activity_at DESC, assets.id DESC
        ) AS series_order
      FROM series_assets assets
      JOIN prompt_series series ON series.id = assets.series_id
    ), preview_candidates(id, priority, activity_at) AS (
      SELECT id, cover_sort_order, activity_at FROM ranked_series_assets WHERE cover_sort_order IS NOT NULL
      UNION ALL
      SELECT id, 3, activity_at FROM ranked_series_assets WHERE series_order = 1
      UNION ALL
      SELECT id, 4, activity_at FROM creative_assets
      UNION ALL
      SELECT id, 5, activity_at FROM direct_assets
      UNION ALL
      SELECT id, 6, activity_at FROM series_assets
    ), ranked_assets AS (
      SELECT id, MIN(priority) AS priority, MAX(activity_at) AS activity_at
      FROM preview_candidates GROUP BY id
    ) SELECT asset.* FROM ranked_assets projected
      JOIN image_assets asset ON asset.id = projected.id AND asset.deleted_at IS NULL
      ORDER BY projected.priority, projected.activity_at DESC, asset.id DESC LIMIT 5`,
      )
      .all(albumId) as JsonMap[];

    const documentPreviews = this.db
      .prepare(
        `${projectionCte}, document_assets(id, activity_at) AS (
      SELECT thumbnail.image_asset_id, document.updated_at
      FROM projected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'VIDEO_DOCUMENT' AND form.entity_type = 'VIDEO_DOCUMENT'
        AND form.deleted_at IS NULL
      JOIN documents document ON document.id = form.entity_id
        AND document.deleted_at IS NULL AND document.status = 'ACTIVE'
      JOIN document_thumbnails thumbnail ON thumbnail.document_id = document.id
      JOIN image_assets asset ON asset.id = thumbnail.image_asset_id
        AND asset.mime_type LIKE 'image/%' AND asset.deleted_at IS NULL
    ), ranked_assets AS (
      SELECT id, MAX(activity_at) AS activity_at
      FROM document_assets GROUP BY id
    ) SELECT asset.* FROM ranked_assets projected
      JOIN image_assets asset ON asset.id = projected.id AND asset.deleted_at IS NULL
      ORDER BY projected.activity_at DESC, asset.id DESC LIMIT 5`,
      )
      .all(albumId) as JsonMap[];

    return {
      materialCount: Number(count.material_count),
      creationItemCount: Number(count.creation_item_count),
      previewAssets: previews.map(assetDto),
      documentPreviewAssets: documentPreviews.map(assetDto),
      activityAt: text(count.activity_at),
    };
  }

  listSummaries(albumIds: readonly string[]): Map<string, AlbumProjectionSummary> {
    if (albumIds.length === 0) return new Map();
    const projection = batchProjectionCte(albumIds.length);
    const countRows = this.db
      .prepare(
        `${projection}, projected_materials(root_id, key) AS (
      SELECT album.root_id, CASE material.kind
        WHEN 'TEXT' THEN 'TEXT:' || material.id
        ELSE material.kind || ':' || material.image_asset_id
      END
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      JOIN materials material ON material.id = member.target_id
        AND material.deleted_at IS NULL AND material.archived_at IS NULL
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
        AND NOT EXISTS (
          SELECT 1 FROM prompt_series_output_exclusions exclusion
          WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = run.result_asset_id
        )
      UNION
      SELECT projected.root_id, 'IMAGE:' || imported.image_asset_id
      FROM projected_series projected
      JOIN creation_output_imports imported ON imported.series_id = projected.id AND imported.deleted_at IS NULL
      JOIN image_assets asset ON asset.id = imported.image_asset_id AND asset.deleted_at IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM prompt_series_output_exclusions exclusion
        WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = imported.image_asset_id
      )
      UNION
      SELECT projected.root_id, 'IMAGE:' || transform.output_asset_id
      FROM projected_series projected
      JOIN image_transform_runs transform ON transform.series_id = projected.id AND transform.deleted_at IS NULL
      JOIN image_assets asset ON asset.id = transform.output_asset_id AND asset.deleted_at IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM prompt_series_output_exclusions exclusion
        WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = transform.output_asset_id
      )
    ), material_counts(root_id, material_count) AS (
      SELECT root_id, count(*) FROM projected_materials GROUP BY root_id
    ), creation_item_counts(root_id, creation_item_count) AS (
      SELECT root_id, count(*) FROM projected_creation_items GROUP BY root_id
    ), activity_values(root_id, value) AS (
      SELECT projected.root_id, COALESCE(album.content_updated_at, album.created_at)
      FROM projected_albums projected
      JOIN albums album ON album.id = projected.id
      UNION ALL
      SELECT album.root_id, member.updated_at
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      WHERE member.deleted_at IS NULL
      UNION ALL
      ${projectedCreationItemActivityValues('projected.root_id')}
      UNION ALL
      ${projectedSeriesActivityValues('projected.root_id')}
    ), activity_summaries(root_id, activity_at) AS (
      SELECT root_id, MAX(value) FROM activity_values GROUP BY root_id
    ) SELECT root.root_id AS album_id,
        COALESCE(material.material_count, 0) AS material_count,
        COALESCE(item.creation_item_count, 0) AS creation_item_count,
        activity.activity_at
      FROM projection_roots root
      LEFT JOIN material_counts material ON material.root_id = root.root_id
      LEFT JOIN creation_item_counts item ON item.root_id = root.root_id
      LEFT JOIN activity_summaries activity ON activity.root_id = root.root_id`,
      )
      .all(...albumIds) as JsonMap[];

    const summaries = new Map<string, AlbumProjectionSummary>();
    for (const row of countRows) {
      summaries.set(text(row.album_id), {
        materialCount: Number(row.material_count),
        creationItemCount: Number(row.creation_item_count),
        previewAssets: [],
        documentPreviewAssets: [],
        activityAt: text(row.activity_at),
      });
    }

    const previewRows = this.db
      .prepare(
        `${projection}, direct_assets(root_id, id, activity_at) AS (
      SELECT album.root_id, material.image_asset_id, member.updated_at
      FROM album_members member
      JOIN projected_albums album ON album.id = member.album_id
      JOIN materials material ON material.id = member.target_id
        AND material.kind IN ('IMAGE', 'VIDEO') AND material.deleted_at IS NULL
        AND material.archived_at IS NULL
      WHERE member.target_type = 'MATERIAL' AND member.deleted_at IS NULL
    ), creative_assets(root_id, id, activity_at) AS (
      SELECT item.root_id, reference.value, inspiration.updated_at
      FROM projected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'INSPIRATION' AND form.entity_type = 'INSPIRATION_STASH'
        AND form.deleted_at IS NULL
      JOIN inspiration_stashes inspiration ON inspiration.id = form.entity_id
        AND inspiration.status = 'ACTIVE' AND inspiration.deleted_at IS NULL
      JOIN json_each(inspiration.input_json, '$.referenceAssetIds') reference
      UNION ALL
      SELECT item.root_id, media.value, post.updated_at
      FROM projected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'SOCIAL_POST' AND form.entity_type = 'SOCIAL_POST'
        AND form.deleted_at IS NULL
      JOIN social_post_drafts post ON post.id = form.entity_id
        AND post.status = 'ACTIVE' AND post.deleted_at IS NULL
      JOIN social_post_revisions revision ON revision.id = post.current_revision_id
      JOIN json_each(revision.content_json, '$.mediaAssetIds') media
      UNION ALL
      SELECT item.root_id, json_extract(binding.value, '$.assetId'), article.updated_at
      FROM projected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'ARTICLE' AND form.entity_type = 'ARTICLE'
        AND form.deleted_at IS NULL
      JOIN articles article ON article.id = form.entity_id
        AND article.status = 'ACTIVE' AND article.deleted_at IS NULL
      JOIN article_revisions revision ON revision.id = article.current_revision_id
      JOIN json_each(revision.content_json, '$.mediaBindings') binding
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
        AND NOT EXISTS (
          SELECT 1 FROM prompt_series_output_exclusions exclusion
          WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = run.result_asset_id
        )
      UNION ALL
      SELECT projected.root_id, projected.id, imported.image_asset_id, imported.created_at
      FROM projected_series projected
      JOIN creation_output_imports imported ON imported.series_id = projected.id
      WHERE imported.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM prompt_series_output_exclusions exclusion
          WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = imported.image_asset_id
        )
      UNION ALL
      SELECT projected.root_id, projected.id, transform.output_asset_id, transform.created_at
      FROM projected_series projected
      JOIN image_transform_runs transform ON transform.series_id = projected.id
      WHERE transform.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM prompt_series_output_exclusions exclusion
          WHERE exclusion.series_id = projected.id AND exclusion.image_asset_id = transform.output_asset_id
        )
    ), ranked_series_assets AS (
      SELECT assets.root_id, assets.series_id, assets.id, assets.activity_at,
        ${creationItemCoverSortOrder('assets.series_id', 'assets.id')} AS cover_sort_order,
        ROW_NUMBER() OVER (
          PARTITION BY assets.root_id, assets.series_id
          ORDER BY COALESCE(${creationItemCoverSortOrder('assets.series_id', 'assets.id')}, 2147483647),
            assets.activity_at DESC, assets.id DESC
        ) AS series_order
      FROM series_assets assets
      JOIN prompt_series series ON series.id = assets.series_id
    ), preview_candidates(root_id, id, priority, activity_at) AS (
      SELECT root_id, id, cover_sort_order, activity_at
      FROM ranked_series_assets WHERE cover_sort_order IS NOT NULL
      UNION ALL
      SELECT root_id, id, 3, activity_at FROM ranked_series_assets WHERE series_order = 1
      UNION ALL
      SELECT root_id, id, 4, activity_at FROM creative_assets
      UNION ALL
      SELECT root_id, id, 5, activity_at FROM direct_assets
      UNION ALL
      SELECT root_id, id, 6, activity_at FROM series_assets
    ), ranked_assets(root_id, id, priority, activity_at) AS (
      SELECT root_id, id, MIN(priority), MAX(activity_at)
      FROM preview_candidates GROUP BY root_id, id
    ), limited_assets AS (
      SELECT root_id, id, priority, activity_at,
        ROW_NUMBER() OVER (
          PARTITION BY root_id ORDER BY priority, activity_at DESC, id DESC
        ) AS preview_order
      FROM ranked_assets
    ), document_assets(root_id, id, activity_at) AS (
      SELECT item.root_id, thumbnail.image_asset_id, document.updated_at
      FROM projected_creation_items item
      JOIN creation_forms form ON form.creation_item_id = item.id
        AND form.role = 'VIDEO_DOCUMENT' AND form.entity_type = 'VIDEO_DOCUMENT'
        AND form.deleted_at IS NULL
      JOIN documents document ON document.id = form.entity_id
        AND document.deleted_at IS NULL AND document.status = 'ACTIVE'
      JOIN document_thumbnails thumbnail ON thumbnail.document_id = document.id
      JOIN image_assets asset ON asset.id = thumbnail.image_asset_id
        AND asset.mime_type LIKE 'image/%' AND asset.deleted_at IS NULL
    ), ranked_document_assets(root_id, id, activity_at) AS (
      SELECT root_id, id, MAX(activity_at)
      FROM document_assets GROUP BY root_id, id
    ), limited_document_assets AS (
      SELECT root_id, id, activity_at,
        ROW_NUMBER() OVER (
          PARTITION BY root_id ORDER BY activity_at DESC, id DESC
        ) AS preview_order
      FROM ranked_document_assets
    ) SELECT 'MEDIA' AS preview_kind, projected.root_id AS album_id,
        projected.preview_order, asset.*
      FROM limited_assets projected
      JOIN image_assets asset ON asset.id = projected.id AND asset.deleted_at IS NULL
      WHERE projected.preview_order <= 5
      UNION ALL
      SELECT 'DOCUMENT' AS preview_kind, projected.root_id AS album_id,
        projected.preview_order, asset.*
      FROM limited_document_assets projected
      JOIN image_assets asset ON asset.id = projected.id AND asset.deleted_at IS NULL
      WHERE projected.preview_order <= 5
      ORDER BY album_id, preview_kind, preview_order`,
      )
      .all(...albumIds) as JsonMap[];

    appendPreviewRows(summaries, previewRows);
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
        AND material.kind = 'TEXT' AND material.deleted_at IS NULL AND material.archived_at IS NULL
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
