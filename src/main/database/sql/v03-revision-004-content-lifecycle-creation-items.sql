-- Completes lifecycle tables written by pre-release revision-4 builds before
-- creation_items became the stable creator-library aggregate.

CREATE TABLE content_lifecycle_batches_revision_4_composition (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  action TEXT NOT NULL CHECK(action IN ('ARCHIVE', 'DELETE')),
  root_entity_type TEXT NOT NULL CHECK(root_entity_type IN (
    'ALBUM', 'CREATION_ITEM', 'PROMPT_SERIES', 'CREATION', 'INSPIRATION_STASH',
    'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT', 'MATERIAL', 'IMAGE_ASSET'
  )),
  root_entity_id TEXT NOT NULL CHECK(length(trim(root_entity_id)) > 0),
  root_kind TEXT NOT NULL CHECK(root_kind IN ('ALBUM', 'CREATION', 'MATERIAL')),
  root_subtype TEXT NOT NULL CHECK(root_subtype IN (
    'CREATION_ALBUM', 'MATERIAL_ALBUM', 'PROMPT_SERIES', 'IDEA_CREATION',
    'INSPIRATION_STASH', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT',
    'IMAGE_MATERIAL', 'VIDEO_MATERIAL', 'TEXT_MATERIAL'
  )),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  preview_asset_id TEXT,
  preview_text TEXT,
  state_before_action TEXT NOT NULL CHECK(state_before_action IN ('ACTIVE', 'ARCHIVED')),
  changed_at TEXT NOT NULL CHECK(length(trim(changed_at)) > 0),
  expires_at TEXT,
  purge_state TEXT CHECK(purge_state IN ('RETAINED', 'PURGE_PENDING', 'FAILED')),
  purge_requested_at TEXT,
  purge_error TEXT,
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) > 0),
  UNIQUE(action, root_entity_type, root_entity_id)
);

INSERT INTO content_lifecycle_batches_revision_4_composition
SELECT * FROM content_lifecycle_batches;

CREATE TABLE content_lifecycle_batch_members_revision_4_composition (
  batch_id TEXT NOT NULL REFERENCES content_lifecycle_batches_revision_4_composition(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'ALBUM', 'CREATION_ITEM', 'PROMPT_SERIES', 'CREATION', 'INSPIRATION_STASH',
    'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT', 'MATERIAL', 'IMAGE_ASSET'
  )),
  entity_id TEXT NOT NULL CHECK(length(trim(entity_id)) > 0),
  kind TEXT NOT NULL CHECK(kind IN ('ALBUM', 'CREATION', 'MATERIAL')),
  subtype TEXT NOT NULL CHECK(subtype IN (
    'CREATION_ALBUM', 'MATERIAL_ALBUM', 'PROMPT_SERIES', 'IDEA_CREATION',
    'INSPIRATION_STASH', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT',
    'IMAGE_MATERIAL', 'VIDEO_MATERIAL', 'TEXT_MATERIAL'
  )),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  preview_asset_id TEXT,
  preview_text TEXT,
  parent_entity_type TEXT,
  parent_entity_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  state_before_action TEXT NOT NULL CHECK(state_before_action IN ('ACTIVE', 'ARCHIVED', 'PRESERVED')),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)),
  PRIMARY KEY(batch_id, entity_type, entity_id)
);

INSERT INTO content_lifecycle_batch_members_revision_4_composition
SELECT * FROM content_lifecycle_batch_members;

DROP TABLE content_lifecycle_batch_members;
DROP TABLE content_lifecycle_batches;
ALTER TABLE content_lifecycle_batches_revision_4_composition RENAME TO content_lifecycle_batches;
ALTER TABLE content_lifecycle_batch_members_revision_4_composition RENAME TO content_lifecycle_batch_members;

CREATE INDEX idx_content_lifecycle_batches_page
ON content_lifecycle_batches(action, changed_at DESC, root_entity_type, root_entity_id);

CREATE INDEX idx_content_lifecycle_batches_due
ON content_lifecycle_batches(action, purge_state, expires_at, id);

CREATE INDEX idx_content_lifecycle_members_parent
ON content_lifecycle_batch_members(batch_id, parent_entity_type, parent_entity_id, sort_order, entity_type, entity_id);

-- Prompt-series archive state existed in those development databases before
-- creation_items was added, so copy it into the aggregate exactly once.
UPDATE creation_items
SET archived_at = (
      SELECT series.archived_at
      FROM creation_forms form
      JOIN prompt_series series
        ON form.entity_type = 'PROMPT_SERIES' AND series.id = form.entity_id
      WHERE form.creation_item_id = creation_items.id AND form.deleted_at IS NULL
      LIMIT 1
    ),
    updated_at = COALESCE((
      SELECT series.archived_at
      FROM creation_forms form
      JOIN prompt_series series
        ON form.entity_type = 'PROMPT_SERIES' AND series.id = form.entity_id
      WHERE form.creation_item_id = creation_items.id AND form.deleted_at IS NULL
      LIMIT 1
    ), updated_at)
WHERE archived_at IS NULL AND EXISTS (
  SELECT 1
  FROM creation_forms form
  JOIN prompt_series series
    ON form.entity_type = 'PROMPT_SERIES' AND series.id = form.entity_id
  WHERE form.creation_item_id = creation_items.id
    AND form.deleted_at IS NULL AND series.archived_at IS NOT NULL
);
