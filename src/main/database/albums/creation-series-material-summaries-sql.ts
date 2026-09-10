import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';
import {
  creationItemCoverSortOrder,
  creationOutputNotExcluded,
} from '@/main/database/creations/creation-output-presentation-sql';

export const creationSeriesMaterialSummariesSql = `WITH series_relationships(series_id, asset_id, relationship_role) AS (
  SELECT version.series_id, run.result_asset_id, 'OUTPUT'
  FROM prompt_versions version
  JOIN prompt_series series ON series.id = version.series_id
    AND series.deleted_at IS NULL AND series.archived_at IS NULL
  JOIN generation_runs run ON run.prompt_version_id = version.id
    AND run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM generation_output_reviews review
      WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM prompt_series_output_exclusions exclusion
      WHERE exclusion.series_id = version.series_id AND exclusion.image_asset_id = run.result_asset_id
    )
  UNION
  SELECT imported.series_id, imported.image_asset_id, 'OUTPUT'
  FROM creation_output_imports imported
  JOIN prompt_series series ON series.id = imported.series_id
    AND series.deleted_at IS NULL AND series.archived_at IS NULL
  WHERE imported.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM prompt_series_output_exclusions exclusion
      WHERE exclusion.series_id = imported.series_id
        AND exclusion.image_asset_id = imported.image_asset_id
    )
  UNION
  SELECT transform.series_id, transform.output_asset_id, 'OUTPUT'
  FROM image_transform_runs transform
  JOIN prompt_series series ON series.id = transform.series_id
    AND series.deleted_at IS NULL AND series.archived_at IS NULL
  WHERE transform.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM prompt_series_output_exclusions exclusion
      WHERE exclusion.series_id = transform.series_id
        AND exclusion.image_asset_id = transform.output_asset_id
    )
  UNION
  SELECT series.id, gif.output_asset_id, 'OUTPUT'
  FROM gif_export_runs gif
  JOIN gif_documents document ON document.id = gif.document_id
  JOIN prompt_series series ON series.id = document.series_id
    AND series.deleted_at IS NULL AND series.archived_at IS NULL
  WHERE gif.state = 'SUCCEEDED'
    AND ${creationOutputNotExcluded('series.id', 'gif.output_asset_id')}
  UNION
  SELECT series.id, binding.image_asset_id, 'INPUT'
  FROM prompt_series series
  JOIN reference_bindings binding ON binding.prompt_version_id = series.current_version_id
    AND binding.source_type = 'DIRECT'
  WHERE series.deleted_at IS NULL AND series.archived_at IS NULL
  UNION
  SELECT series.id, version.source_image_id, 'INPUT'
  FROM prompt_series series
  JOIN prompt_versions version ON version.id = series.current_version_id
  WHERE series.deleted_at IS NULL AND series.archived_at IS NULL AND version.source_image_id IS NOT NULL
), series_assets(series_id, asset_id) AS (
  SELECT DISTINCT relationship.series_id, relationship.asset_id
  FROM series_relationships relationship
  WHERE relationship.relationship_role = 'OUTPUT' OR EXISTS (
    SELECT 1 FROM materials material
    WHERE material.image_asset_id = relationship.asset_id AND material.kind = 'IMAGE'
      AND material.deleted_at IS NULL AND material.archived_at IS NULL
  )
), root_assets(series_id, asset_id) AS (
  SELECT MIN(series_assets.series_id), series_assets.asset_id
  FROM series_assets
  GROUP BY series_assets.asset_id
), series_owners(series_id, creation_item_id, album_id) AS (
  SELECT form.entity_id, item.id, owner.id
  FROM creation_forms form
  JOIN creation_items item ON item.id = form.creation_item_id
    AND item.deleted_at IS NULL AND item.archived_at IS NULL
  LEFT JOIN album_members member ON member.target_type = 'CREATION_ITEM'
    AND member.target_id = item.id AND member.deleted_at IS NULL
  LEFT JOIN albums owner ON owner.id = member.album_id
    AND owner.deleted_at IS NULL AND owner.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
  WHERE form.role = 'IMAGE_CREATION' AND form.entity_type = 'PROMPT_SERIES'
    AND form.deleted_at IS NULL
), scoped_assets(scope_id, series_id, asset_id) AS (
  SELECT 'SERIES:' || series_assets.series_id, series_assets.series_id, series_assets.asset_id FROM series_assets
  UNION
  SELECT 'ROOT', root_assets.series_id, root_assets.asset_id FROM root_assets
  UNION
  SELECT 'UNASSIGNED', series_assets.series_id, series_assets.asset_id
  FROM series_assets
  WHERE NOT EXISTS (
    SELECT 1 FROM series_owners owner
    WHERE owner.series_id = series_assets.series_id AND owner.album_id IS NOT NULL
  )
), content_assets(content_kind, content_id, series_id, album_id, asset_id, content_preview_rank, activity_at) AS (
  SELECT 'INSPIRATION_STASH', inspiration.id, image_form.entity_id, owner.id,
    reference.value, CAST(reference.key AS INTEGER) + 1, inspiration.updated_at
  FROM creation_forms content_form
  JOIN creation_items item ON item.id = content_form.creation_item_id
    AND item.deleted_at IS NULL AND item.archived_at IS NULL
  LEFT JOIN creation_forms image_form ON image_form.creation_item_id = item.id
    AND image_form.role = 'IMAGE_CREATION' AND image_form.entity_type = 'PROMPT_SERIES'
    AND image_form.deleted_at IS NULL
  LEFT JOIN album_members member ON member.target_type = 'CREATION_ITEM'
    AND member.target_id = item.id AND member.deleted_at IS NULL
  LEFT JOIN albums owner ON owner.id = member.album_id
    AND owner.deleted_at IS NULL AND owner.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
  JOIN inspiration_stashes inspiration ON inspiration.id = content_form.entity_id
  JOIN json_each(inspiration.input_json, '$.referenceAssetIds') reference
  WHERE content_form.role = 'INSPIRATION' AND content_form.entity_type = 'INSPIRATION_STASH'
    AND content_form.deleted_at IS NULL
    AND inspiration.status = 'ACTIVE' AND inspiration.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM materials material
      WHERE material.image_asset_id = reference.value AND material.kind = 'IMAGE'
        AND material.deleted_at IS NULL AND material.archived_at IS NULL
    )
  UNION ALL
  SELECT 'SOCIAL_POST', post.id, image_form.entity_id, owner.id, media.value,
    CASE
      WHEN media.value = json_extract(revision.content_json, '$.coverAssetId') THEN 0
      ELSE CAST(media.key AS INTEGER) + 1
    END,
    post.updated_at
  FROM creation_forms content_form
  JOIN creation_items item ON item.id = content_form.creation_item_id
    AND item.deleted_at IS NULL AND item.archived_at IS NULL
  LEFT JOIN creation_forms image_form ON image_form.creation_item_id = item.id
    AND image_form.role = 'IMAGE_CREATION' AND image_form.entity_type = 'PROMPT_SERIES'
    AND image_form.deleted_at IS NULL
  LEFT JOIN album_members member ON member.target_type = 'CREATION_ITEM'
    AND member.target_id = item.id AND member.deleted_at IS NULL
  LEFT JOIN albums owner ON owner.id = member.album_id
    AND owner.deleted_at IS NULL AND owner.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
  JOIN social_post_drafts post ON post.id = content_form.entity_id
  JOIN social_post_revisions revision ON revision.id = post.current_revision_id
  JOIN json_each(revision.content_json, '$.mediaAssetIds') media
  WHERE content_form.role = 'SOCIAL_POST' AND content_form.entity_type = 'SOCIAL_POST'
    AND content_form.deleted_at IS NULL
    AND post.status = 'ACTIVE' AND post.deleted_at IS NULL
  UNION ALL
  SELECT 'ARTICLE', article.id, image_form.entity_id, owner.id,
    json_extract(binding.value, '$.assetId'),
    CASE
      WHEN json_extract(binding.value, '$.assetId') = json_extract(revision.content_json, '$.coverAssetId') THEN 0
      ELSE CAST(binding.key AS INTEGER) + 1
    END,
    article.updated_at
  FROM creation_forms content_form
  JOIN creation_items item ON item.id = content_form.creation_item_id
    AND item.deleted_at IS NULL AND item.archived_at IS NULL
  LEFT JOIN creation_forms image_form ON image_form.creation_item_id = item.id
    AND image_form.role = 'IMAGE_CREATION' AND image_form.entity_type = 'PROMPT_SERIES'
    AND image_form.deleted_at IS NULL
  LEFT JOIN album_members member ON member.target_type = 'CREATION_ITEM'
    AND member.target_id = item.id AND member.deleted_at IS NULL
  LEFT JOIN albums owner ON owner.id = member.album_id
    AND owner.deleted_at IS NULL AND owner.intent <> '${MATERIAL_LIBRARY_ALBUM_INTENT}'
  JOIN articles article ON article.id = content_form.entity_id
  JOIN article_revisions revision ON revision.id = article.current_revision_id
  JOIN json_each(revision.content_json, '$.mediaBindings') binding
  WHERE content_form.role = 'ARTICLE' AND content_form.entity_type = 'ARTICLE'
    AND content_form.deleted_at IS NULL
    AND article.status = 'ACTIVE' AND article.deleted_at IS NULL
), scoped_content_assets(scope_id, content_id, asset_id, content_preview_rank, activity_at) AS (
  SELECT 'ROOT', content_kind || ':' || content_id, asset_id, content_preview_rank, activity_at
  FROM content_assets
  UNION ALL
  SELECT 'UNASSIGNED', content_kind || ':' || content_id, asset_id, content_preview_rank, activity_at
  FROM content_assets
  WHERE album_id IS NULL AND (
    content_kind <> 'INSPIRATION_STASH' OR series_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM series_owners owner
      WHERE owner.series_id = content_assets.series_id AND owner.album_id IS NOT NULL
    )
  )
  UNION ALL
  SELECT 'SERIES:' || series_id, content_kind || ':' || content_id,
    asset_id, content_preview_rank, activity_at
  FROM content_assets
  WHERE series_id IS NOT NULL
), ranked_per_creation AS (
  SELECT scoped_assets.scope_id, asset.id,
    row_number() OVER (
      PARTITION BY scoped_assets.scope_id, scoped_assets.series_id
      ORDER BY COALESCE(
          ${creationItemCoverSortOrder('scoped_assets.series_id', 'asset.id')},
          2147483647
        ),
        asset.created_at DESC, asset.id DESC
    ) AS creation_preview_rank,
    asset.created_at AS activity_at
  FROM scoped_assets
  JOIN image_assets asset ON asset.id = scoped_assets.asset_id AND asset.deleted_at IS NULL
), ranked_assets AS (
  SELECT scope_id, id, MIN(creation_preview_rank) AS creation_preview_rank, MAX(activity_at) AS activity_at
  FROM (
    SELECT scope_id, id, creation_preview_rank, activity_at FROM ranked_per_creation
    UNION ALL
    SELECT content.scope_id, asset.id, content.content_preview_rank, content.activity_at
    FROM scoped_content_assets content
    JOIN image_assets asset ON asset.id = content.asset_id AND asset.deleted_at IS NULL
  ) candidates
  GROUP BY scope_id, id
), ranked AS (
  SELECT ranked_assets.scope_id, asset.*,
    count(*) OVER (PARTITION BY ranked_assets.scope_id) AS material_count,
    row_number() OVER (
      PARTITION BY ranked_assets.scope_id
      ORDER BY ranked_assets.creation_preview_rank,
        ranked_assets.activity_at DESC, ranked_assets.id DESC
    ) AS preview_rank
  FROM ranked_assets
  JOIN image_assets asset ON asset.id = ranked_assets.id AND asset.deleted_at IS NULL
)
SELECT * FROM ranked WHERE preview_rank <= 5
ORDER BY scope_id, preview_rank`;
