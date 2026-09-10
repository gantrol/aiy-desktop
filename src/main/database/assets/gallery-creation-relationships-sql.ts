import { creationOutputNotExcluded } from '@/main/database/creations/creation-output-presentation-sql';

export const creationOutputCandidatesSql = `
  SELECT run.result_asset_id AS asset_id, run.id AS run_id, NULL AS imported_output_id,
    run.created_at AS creation_created_at, run.created_at AS relation_created_at,
    run.id AS relation_key, 'OUTPUT' AS relation_role,
    version.version_no, series.id AS series_id, series.title, series.title_locale,
    series.deleted_at AS series_deleted_at, series.archived_at AS series_archived_at
  FROM generation_runs run
  JOIN prompt_versions version ON version.id = run.prompt_version_id
  JOIN prompt_series series ON series.id = version.series_id
  WHERE run.status = 'SUCCEEDED' AND run.result_asset_id IS NOT NULL
    AND ${creationOutputNotExcluded('series.id', 'run.result_asset_id')}
    AND NOT EXISTS (
      SELECT 1 FROM generation_output_reviews review
      WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED'
    )
  UNION ALL
  SELECT imported.image_asset_id AS asset_id, NULL AS run_id, imported.id AS imported_output_id,
    imported.created_at AS creation_created_at, imported.created_at AS relation_created_at,
    imported.id AS relation_key, 'OUTPUT' AS relation_role,
    version.version_no, series.id AS series_id, series.title, series.title_locale,
    series.deleted_at AS series_deleted_at, series.archived_at AS series_archived_at
  FROM creation_output_imports imported
  JOIN prompt_series series ON series.id = imported.series_id
  LEFT JOIN prompt_versions version ON version.id = imported.prompt_version_id
  WHERE imported.deleted_at IS NULL
    AND ${creationOutputNotExcluded('series.id', 'imported.image_asset_id')}
  UNION ALL
  SELECT transform.output_asset_id AS asset_id, NULL AS run_id, NULL AS imported_output_id,
    transform.created_at AS creation_created_at, transform.created_at AS relation_created_at,
    transform.id AS relation_key, 'OUTPUT' AS relation_role,
    version.version_no, series.id AS series_id, series.title, series.title_locale,
    series.deleted_at AS series_deleted_at, series.archived_at AS series_archived_at
  FROM image_transform_runs transform
  JOIN prompt_series series ON series.id = transform.series_id
  LEFT JOIN prompt_versions version ON version.id = series.current_version_id
  WHERE transform.deleted_at IS NULL
    AND ${creationOutputNotExcluded('series.id', 'transform.output_asset_id')}
  UNION ALL
  SELECT gif.output_asset_id AS asset_id, NULL AS run_id, NULL AS imported_output_id,
    gif.created_at AS creation_created_at, gif.created_at AS relation_created_at,
    gif.id AS relation_key, 'OUTPUT' AS relation_role,
    NULL AS version_no, series.id AS series_id, series.title, series.title_locale,
    series.deleted_at AS series_deleted_at, series.archived_at AS series_archived_at
  FROM gif_export_runs gif
  JOIN gif_documents document ON document.id = gif.document_id
  JOIN prompt_series series ON series.id = document.series_id
  WHERE gif.state = 'SUCCEEDED'
    AND ${creationOutputNotExcluded('series.id', 'gif.output_asset_id')}`;

export const creationRelationshipsCte = `creation_candidates AS (
  ${creationOutputCandidatesSql}
  UNION ALL
  SELECT binding.image_asset_id AS asset_id, NULL AS run_id, NULL AS imported_output_id,
    NULL AS creation_created_at, version.created_at AS relation_created_at,
    binding.id AS relation_key, 'INPUT' AS relation_role,
    version.version_no, series.id AS series_id, series.title, series.title_locale,
    series.deleted_at AS series_deleted_at, series.archived_at AS series_archived_at
  FROM prompt_series series
  JOIN prompt_versions version ON version.id = series.current_version_id
  JOIN reference_bindings binding ON binding.prompt_version_id = version.id
    AND binding.source_type = 'DIRECT'
  UNION ALL
  SELECT version.source_image_id AS asset_id, NULL AS run_id, NULL AS imported_output_id,
    NULL AS creation_created_at, version.created_at AS relation_created_at,
    'source:' || version.id AS relation_key, 'SOURCE' AS relation_role,
    version.version_no, series.id AS series_id, series.title, series.title_locale,
    series.deleted_at AS series_deleted_at, series.archived_at AS series_archived_at
  FROM prompt_series series
  JOIN prompt_versions version ON version.id = series.current_version_id
  WHERE version.source_image_id IS NOT NULL
),
creation_roles AS (
  SELECT candidate.asset_id,
    MAX(CASE WHEN candidate.relation_role = 'OUTPUT' THEN 1 ELSE 0 END) AS is_output,
    GROUP_CONCAT(DISTINCT candidate.relation_role) AS relation_roles,
    MAX(CASE WHEN candidate.relation_role = 'OUTPUT' THEN candidate.creation_created_at END)
      AS creation_created_at
  FROM creation_candidates candidate
  WHERE candidate.series_deleted_at IS NULL
  GROUP BY candidate.asset_id
),
creation_ranked AS (
  SELECT candidate.*,
    ROW_NUMBER() OVER (
      PARTITION BY candidate.asset_id
      ORDER BY CASE candidate.relation_role WHEN 'OUTPUT' THEN 0 WHEN 'SOURCE' THEN 1 ELSE 2 END,
        candidate.relation_created_at DESC, candidate.relation_key DESC
    ) AS position
  FROM creation_candidates candidate
  WHERE candidate.series_deleted_at IS NULL
),
creation AS (
  SELECT ranked.asset_id, ranked.run_id, ranked.imported_output_id,
    roles.creation_created_at, ranked.version_no, ranked.series_id,
    ranked.title, ranked.title_locale,
    roles.is_output, roles.relation_roles
  FROM creation_ranked ranked
  JOIN creation_roles roles ON roles.asset_id = ranked.asset_id
  WHERE ranked.position = 1
)`;
