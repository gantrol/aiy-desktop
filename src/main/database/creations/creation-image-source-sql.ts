import { creationItemIncludesSeries } from '@/main/database/creations/creation-output-presentation-sql';

/** Exact output ownership, shared by single-image navigation and bounded calendar batches. */
export function creationImageSourceFormsSql(assetIdsSql: string, preferredFormId = 'NULL') {
  return `WITH requested_assets(asset_id) AS (${assetIdsSql}),
    asset_series(asset_id,series_id,relation_priority,relation_at,relation_key) AS (
      SELECT run.result_asset_id,version.series_id,0,run.created_at,run.id
      FROM requested_assets requested JOIN generation_runs run ON run.result_asset_id=requested.asset_id
      JOIN prompt_versions version ON version.id=run.prompt_version_id WHERE run.status='SUCCEEDED'
      UNION ALL
      SELECT imported.image_asset_id,imported.series_id,0,imported.created_at,imported.id
      FROM requested_assets requested JOIN creation_output_imports imported ON imported.image_asset_id=requested.asset_id
      WHERE imported.deleted_at IS NULL
      UNION ALL
      SELECT transform.output_asset_id,transform.series_id,0,transform.created_at,transform.id
      FROM requested_assets requested JOIN image_transform_runs transform ON transform.output_asset_id=requested.asset_id
      WHERE transform.deleted_at IS NULL
      UNION ALL
      SELECT binding.image_asset_id,version.series_id,1,version.created_at,binding.id
      FROM requested_assets requested JOIN reference_bindings binding ON binding.image_asset_id=requested.asset_id
      JOIN prompt_versions version ON version.id=binding.prompt_version_id WHERE ${preferredFormId} IS NOT NULL
      UNION ALL
      SELECT version.source_image_id,version.series_id,1,version.created_at,'source:' || version.id
      FROM requested_assets requested JOIN prompt_versions version ON version.source_image_id=requested.asset_id
      WHERE ${preferredFormId} IS NOT NULL
    ), owner_forms(form_id,owner_series_id) AS (
      SELECT form.id,form.entity_id FROM creation_forms form
      WHERE form.role='IMAGE_CREATION' AND form.entity_type='PROMPT_SERIES' AND form.deleted_at IS NULL
      UNION ALL
      SELECT form.id,visual.prompt_series_id FROM creation_forms form
      JOIN derived_visuals visual ON visual.id=form.entity_id
      WHERE form.entity_type='DERIVED_VISUAL' AND form.deleted_at IS NULL AND visual.prompt_series_id IS NOT NULL
    ), candidate_forms AS (
      SELECT form.*,asset.asset_id,asset.relation_priority,asset.relation_at,asset.relation_key,
        asset.series_id AS match_series_id,owner.owner_series_id
      FROM asset_series asset
      JOIN owner_forms owner ON ${creationItemIncludesSeries('owner.owner_series_id', 'asset.series_id')}
      JOIN creation_forms form ON form.id=owner.form_id AND form.deleted_at IS NULL
      JOIN creation_items item ON item.id=form.creation_item_id AND item.archived_at IS NULL AND item.deleted_at IS NULL
      WHERE (${preferredFormId} IS NULL OR form.id=${preferredFormId})
    ), unique_owners AS (
      SELECT asset_id FROM candidate_forms GROUP BY asset_id HAVING COUNT(DISTINCT creation_item_id)=1
    ), ranked_forms AS (
      SELECT candidate_forms.*,ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY relation_priority,
        CASE WHEN owner_series_id=match_series_id THEN 0 ELSE 1 END,
        relation_at DESC,relation_key DESC,sort_order,created_at,id) AS position
      FROM candidate_forms JOIN unique_owners USING (asset_id)
    ) SELECT * FROM ranked_forms WHERE position=1`;
}
