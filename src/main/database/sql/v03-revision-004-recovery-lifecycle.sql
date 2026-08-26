CREATE TABLE recycle_bin_entries (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('ALBUM', 'PROMPT_SERIES', 'CREATION', 'IMAGE_ASSET')),
  entity_id TEXT NOT NULL CHECK(length(trim(entity_id)) > 0),
  scope TEXT NOT NULL CHECK(scope IN ('CREATOR_ALBUMS', 'MATERIAL_ALBUMS', 'CREATIONS', 'MATERIALS')),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  deleted_at TEXT NOT NULL CHECK(length(trim(deleted_at)) > 0),
  purge_after TEXT NOT NULL CHECK(length(trim(purge_after)) > 0),
  state_before_delete TEXT NOT NULL CHECK(state_before_delete IN ('ACTIVE', 'ARCHIVED')),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)),
  purge_state TEXT NOT NULL DEFAULT 'RETAINED'
    CHECK(purge_state IN ('RETAINED', 'PURGE_PENDING', 'FAILED')),
  purge_requested_at TEXT,
  purge_error TEXT,
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) > 0),
  PRIMARY KEY(entity_type, entity_id)
);

CREATE INDEX idx_recycle_bin_scope_page
ON recycle_bin_entries(scope, deleted_at DESC, entity_type, entity_id);

CREATE INDEX idx_recycle_bin_due
ON recycle_bin_entries(purge_state, purge_after, entity_type, entity_id);

INSERT OR IGNORE INTO recycle_bin_entries (
  entity_type, entity_id, scope, title, deleted_at, purge_after,
  state_before_delete, payload_json, purge_state, updated_at
)
SELECT
  'ALBUM', album.id,
  CASE WHEN album.intent = 'MATERIAL_LIBRARY' THEN 'MATERIAL_ALBUMS' ELSE 'CREATOR_ALBUMS' END,
  album.title, album.deleted_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', album.deleted_at, '+30 days'),
  CASE WHEN album.archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END,
  '{}', 'RETAINED', album.deleted_at
FROM albums album
WHERE album.deleted_at IS NOT NULL;

INSERT OR IGNORE INTO recycle_bin_entries (
  entity_type, entity_id, scope, title, deleted_at, purge_after,
  state_before_delete, payload_json, purge_state, updated_at
)
SELECT
  'PROMPT_SERIES', series.id, 'CREATIONS', series.title, series.deleted_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', series.deleted_at, '+30 days'),
  'ACTIVE',
  json_object(
    'archivedCreationIds', json(COALESCE((
      SELECT json_group_array(creation.id) FROM creations creation
      WHERE creation.source_scope_kind = 'SERIES' AND creation.source_scope_id = series.id
        AND creation.archived_at = series.deleted_at AND creation.deleted_at IS NULL
    ), '[]')),
    'archivedInspirationStashIds', json(COALESCE((
      SELECT json_group_array(inspiration.id)
      FROM creation_forms series_form
      JOIN creation_forms inspiration_form
        ON inspiration_form.creation_item_id = series_form.creation_item_id
        AND inspiration_form.entity_type = 'INSPIRATION_STASH'
      JOIN inspiration_stashes inspiration ON inspiration.id = inspiration_form.entity_id
      WHERE series_form.entity_type = 'PROMPT_SERIES' AND series_form.entity_id = series.id
        AND inspiration.archived_at = series.deleted_at AND inspiration.deleted_at IS NULL
    ), '[]')),
    'deletedImportIds', json(COALESCE((
      SELECT json_group_array(imported.id) FROM creation_output_imports imported
      WHERE imported.series_id = series.id AND imported.deleted_at = series.deleted_at
    ), '[]')),
    'deletedTransformIds', json(COALESCE((
      SELECT json_group_array(transform.id) FROM image_transform_runs transform
      WHERE transform.series_id = series.id AND transform.deleted_at = series.deleted_at
    ), '[]'))
  ),
  'RETAINED', series.deleted_at
FROM prompt_series series
WHERE series.deleted_at IS NOT NULL;

INSERT OR IGNORE INTO recycle_bin_entries (
  entity_type, entity_id, scope, title, deleted_at, purge_after,
  state_before_delete, payload_json, purge_state, updated_at
)
SELECT
  'CREATION', creation.id, 'CREATIONS', creation.title, creation.deleted_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', creation.deleted_at, '+30 days'),
  CASE WHEN creation.status = 'ARCHIVED' THEN 'ARCHIVED' ELSE 'ACTIVE' END,
  '{}', 'RETAINED', creation.deleted_at
FROM creations creation
WHERE creation.deleted_at IS NOT NULL;

INSERT OR IGNORE INTO recycle_bin_entries (
  entity_type, entity_id, scope, title, deleted_at, purge_after,
  state_before_delete, payload_json, purge_state, updated_at
)
SELECT
  'IMAGE_ASSET', asset.id, 'MATERIALS',
  COALESCE(NULLIF(metadata.display_name, ''), NULLIF(metadata.original_name, ''), asset.relative_path, asset.id),
  asset.deleted_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', asset.deleted_at, '+30 days'),
  'ACTIVE', '{}', 'RETAINED', asset.deleted_at
FROM image_assets asset
LEFT JOIN materials material ON material.image_asset_id = asset.id AND material.kind IN ('IMAGE', 'VIDEO')
LEFT JOIN external_material_metadata metadata ON metadata.material_id = material.id
WHERE asset.deleted_at IS NOT NULL
GROUP BY asset.id;
