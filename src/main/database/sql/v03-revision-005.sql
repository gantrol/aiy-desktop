-- Revision 5 is the single v0.3.7 public migration. Creation-form lineage,
-- image breakdowns and evaluation suites are consolidated into their final
-- table definitions so shared tables are rebuilt only once.
--
-- The migration coordinator exposes normalized TEMP source views. Empty views
-- represent features that do not exist in a revision-4 library; development
-- revisions 5-7 expose their existing rows through the same boundary.

CREATE TABLE image_breakdowns_revision_5 (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  source_asset_id TEXT NOT NULL REFERENCES image_assets(id),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  focus TEXT NOT NULL DEFAULT '',
  route_key TEXT NOT NULL CHECK(route_key IN ('ANTIGRAVITY_CLI', 'GOOGLE_GEMINI', 'DEEPSEEK_VL')),
  model_key TEXT,
  status TEXT NOT NULL CHECK(status IN ('DRAFT', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) > 0),
  archived_at TEXT,
  deleted_at TEXT,
  CHECK(status <> 'SUCCEEDED' OR result_json IS NOT NULL),
  CHECK(status <> 'FAILED' OR error_message IS NOT NULL)
);

INSERT INTO image_breakdowns_revision_5 (
  id, source_asset_id, title, focus, route_key, model_key, status,
  result_json, error_code, error_message, created_at, updated_at, archived_at, deleted_at
)
SELECT
  id, source_asset_id, title, focus, route_key, model_key, status,
  result_json, error_code, error_message, created_at, updated_at, archived_at, deleted_at
FROM aiy_revision_5_image_breakdowns_source;

CREATE TABLE evaluation_suites_revision_5 (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  album_id TEXT REFERENCES albums(id),
  current_revision_id TEXT REFERENCES evaluation_suite_revisions_revision_5(id),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) > 0),
  archived_at TEXT,
  deleted_at TEXT,
  CHECK(
    (status = 'ACTIVE' AND archived_at IS NULL)
    OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)
  )
);

CREATE TABLE evaluation_suite_revisions_revision_5 (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  suite_id TEXT NOT NULL REFERENCES evaluation_suites_revision_5(id),
  revision_no INTEGER NOT NULL CHECK(revision_no > 0),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
  UNIQUE(suite_id, revision_no)
);

INSERT INTO evaluation_suites_revision_5 (
  id, album_id, current_revision_id, status, created_at, updated_at, archived_at, deleted_at
)
SELECT id, album_id, current_revision_id, status, created_at, updated_at, archived_at, deleted_at
FROM aiy_revision_5_evaluation_suites_source;

INSERT INTO evaluation_suite_revisions_revision_5 (
  id, suite_id, revision_no, content_json, content_hash, created_at
)
SELECT id, suite_id, revision_no, content_json, content_hash, created_at
FROM aiy_revision_5_evaluation_suite_revisions_source;

CREATE TABLE creation_forms_revision_5 (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  creation_item_id TEXT NOT NULL REFERENCES creation_items(id),
  source_form_id TEXT REFERENCES creation_forms_revision_5(id),
  role TEXT NOT NULL CHECK(role IN (
    'INSPIRATION', 'IMAGE_BREAKDOWN', 'IMAGE_CREATION', 'SOCIAL_POST', 'ARTICLE',
    'VIDEO_DOCUMENT', 'EVALUATION_SUITE', 'SOCIAL_POST_COVER', 'ARTICLE_HEADER', 'ARTICLE_INLINE'
  )),
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'INSPIRATION_STASH', 'IMAGE_BREAKDOWN', 'PROMPT_SERIES', 'SOCIAL_POST', 'ARTICLE',
    'VIDEO_DOCUMENT', 'EVALUATION_SUITE', 'DERIVED_VISUAL'
  )),
  entity_id TEXT NOT NULL CHECK(length(trim(entity_id)) > 0),
  anchor_key TEXT,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) > 0),
  deleted_at TEXT,
  CHECK(
    (role = 'INSPIRATION' AND entity_type = 'INSPIRATION_STASH' AND anchor_key IS NULL)
    OR (role = 'IMAGE_BREAKDOWN' AND entity_type = 'IMAGE_BREAKDOWN' AND anchor_key IS NULL)
    OR (role = 'IMAGE_CREATION' AND entity_type = 'PROMPT_SERIES' AND anchor_key IS NULL)
    OR (role = 'SOCIAL_POST' AND entity_type = 'SOCIAL_POST' AND anchor_key IS NULL)
    OR (role = 'ARTICLE' AND entity_type = 'ARTICLE' AND anchor_key IS NULL)
    OR (role = 'VIDEO_DOCUMENT' AND entity_type = 'VIDEO_DOCUMENT' AND anchor_key IS NULL)
    OR (role = 'EVALUATION_SUITE' AND entity_type = 'EVALUATION_SUITE' AND anchor_key IS NULL)
    OR (role IN ('SOCIAL_POST_COVER', 'ARTICLE_HEADER')
      AND entity_type = 'DERIVED_VISUAL' AND anchor_key IS NULL)
    OR (role = 'ARTICLE_INLINE' AND entity_type = 'DERIVED_VISUAL'
      AND length(trim(anchor_key)) > 0)
  )
);

INSERT INTO creation_forms_revision_5 (
  id, creation_item_id, source_form_id, role, entity_type, entity_id, anchor_key,
  sort_order, created_at, updated_at, deleted_at
)
SELECT
  id, creation_item_id, source_form_id, role, entity_type, entity_id, anchor_key,
  sort_order, created_at, updated_at, deleted_at
FROM aiy_revision_5_creation_forms_source;

-- Preserve exact development-lineage values and backfill only revision-4 rows
-- or historical nulls.
UPDATE creation_forms_revision_5
SET source_form_id = (
  SELECT parent_form.id
  FROM derived_visuals visual
  JOIN creation_forms_revision_5 parent_form
    ON parent_form.creation_item_id = creation_forms_revision_5.creation_item_id
    AND parent_form.deleted_at IS NULL
    AND (
      (visual.article_id IS NOT NULL
        AND parent_form.entity_type = 'ARTICLE'
        AND parent_form.entity_id = visual.article_id)
      OR
      (visual.social_post_id IS NOT NULL
        AND parent_form.entity_type = 'SOCIAL_POST'
        AND parent_form.entity_id = visual.social_post_id)
    )
  WHERE creation_forms_revision_5.entity_type = 'DERIVED_VISUAL'
    AND visual.id = creation_forms_revision_5.entity_id
  ORDER BY parent_form.created_at, parent_form.id
  LIMIT 1
)
WHERE entity_type = 'DERIVED_VISUAL'
  AND deleted_at IS NULL
  AND source_form_id IS NULL;

UPDATE creation_forms_revision_5
SET source_form_id = (
  SELECT item.primary_form_id
  FROM creation_items item
  WHERE item.id = creation_forms_revision_5.creation_item_id
)
WHERE deleted_at IS NULL
  AND source_form_id IS NULL
  AND role <> 'INSPIRATION'
  AND id <> (
    SELECT item.primary_form_id
    FROM creation_items item
    WHERE item.id = creation_forms_revision_5.creation_item_id
  );

CREATE TABLE content_lifecycle_batches_revision_5 (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  action TEXT NOT NULL CHECK(action IN ('ARCHIVE', 'DELETE')),
  root_entity_type TEXT NOT NULL CHECK(root_entity_type IN (
    'ALBUM', 'CREATION_ITEM', 'PROMPT_SERIES', 'CREATION', 'INSPIRATION_STASH', 'IMAGE_BREAKDOWN',
    'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT', 'EVALUATION_SUITE', 'MATERIAL', 'IMAGE_ASSET'
  )),
  root_entity_id TEXT NOT NULL CHECK(length(trim(root_entity_id)) > 0),
  root_kind TEXT NOT NULL CHECK(root_kind IN ('ALBUM', 'CREATION', 'MATERIAL')),
  root_subtype TEXT NOT NULL CHECK(root_subtype IN (
    'CREATION_ALBUM', 'MATERIAL_ALBUM', 'PROMPT_SERIES', 'IDEA_CREATION',
    'INSPIRATION_STASH', 'IMAGE_BREAKDOWN', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT',
    'EVALUATION_SUITE', 'IMAGE_MATERIAL', 'VIDEO_MATERIAL', 'TEXT_MATERIAL'
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

INSERT INTO content_lifecycle_batches_revision_5
SELECT * FROM content_lifecycle_batches;

CREATE TABLE content_lifecycle_batch_members_revision_5 (
  batch_id TEXT NOT NULL REFERENCES content_lifecycle_batches_revision_5(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'ALBUM', 'CREATION_ITEM', 'PROMPT_SERIES', 'CREATION', 'INSPIRATION_STASH', 'IMAGE_BREAKDOWN',
    'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT', 'EVALUATION_SUITE', 'MATERIAL', 'IMAGE_ASSET'
  )),
  entity_id TEXT NOT NULL CHECK(length(trim(entity_id)) > 0),
  kind TEXT NOT NULL CHECK(kind IN ('ALBUM', 'CREATION', 'MATERIAL')),
  subtype TEXT NOT NULL CHECK(subtype IN (
    'CREATION_ALBUM', 'MATERIAL_ALBUM', 'PROMPT_SERIES', 'IDEA_CREATION',
    'INSPIRATION_STASH', 'IMAGE_BREAKDOWN', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT',
    'EVALUATION_SUITE', 'IMAGE_MATERIAL', 'VIDEO_MATERIAL', 'TEXT_MATERIAL'
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

INSERT INTO content_lifecycle_batch_members_revision_5
SELECT * FROM content_lifecycle_batch_members;

DROP VIEW temp.aiy_revision_5_creation_forms_source;
DROP VIEW temp.aiy_revision_5_image_breakdowns_source;
DROP VIEW temp.aiy_revision_5_evaluation_suites_source;
DROP VIEW temp.aiy_revision_5_evaluation_suite_revisions_source;

DROP TABLE creation_forms;
DROP TABLE content_lifecycle_batch_members;
DROP TABLE content_lifecycle_batches;
DROP TABLE IF EXISTS image_breakdowns;
DROP TABLE IF EXISTS evaluation_suite_revisions;
DROP TABLE IF EXISTS evaluation_suites;

ALTER TABLE image_breakdowns_revision_5 RENAME TO image_breakdowns;
ALTER TABLE evaluation_suites_revision_5 RENAME TO evaluation_suites;
ALTER TABLE evaluation_suite_revisions_revision_5 RENAME TO evaluation_suite_revisions;
ALTER TABLE creation_forms_revision_5 RENAME TO creation_forms;
ALTER TABLE content_lifecycle_batches_revision_5 RENAME TO content_lifecycle_batches;
ALTER TABLE content_lifecycle_batch_members_revision_5 RENAME TO content_lifecycle_batch_members;

CREATE INDEX idx_image_breakdowns_activity
ON image_breakdowns(archived_at, updated_at DESC, id DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_image_breakdowns_source
ON image_breakdowns(source_asset_id, updated_at DESC, id DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_evaluation_suites_activity
ON evaluation_suites(status, updated_at DESC, id DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_evaluation_suite_revisions_suite
ON evaluation_suite_revisions(suite_id, revision_no DESC);

CREATE INDEX idx_creation_forms_item_order
ON creation_forms(creation_item_id, sort_order, created_at, id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_creation_forms_active_entity
ON creation_forms(entity_type, entity_id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_creation_forms_active_unique_role
ON creation_forms(creation_item_id, role)
WHERE deleted_at IS NULL
  AND role IN ('INSPIRATION', 'IMAGE_BREAKDOWN', 'IMAGE_CREATION', 'VIDEO_DOCUMENT', 'EVALUATION_SUITE');

CREATE UNIQUE INDEX idx_creation_forms_active_article_inline_anchor
ON creation_forms(creation_item_id, role, anchor_key)
WHERE deleted_at IS NULL AND role = 'ARTICLE_INLINE';

CREATE INDEX idx_creation_forms_active_source
ON creation_forms(source_form_id, created_at, id)
WHERE deleted_at IS NULL AND source_form_id IS NOT NULL;

CREATE INDEX idx_content_lifecycle_batches_page
ON content_lifecycle_batches(action, changed_at DESC, root_entity_type, root_entity_id);

CREATE INDEX idx_content_lifecycle_batches_due
ON content_lifecycle_batches(action, purge_state, expires_at, id);

CREATE INDEX idx_content_lifecycle_members_parent
ON content_lifecycle_batch_members(batch_id, parent_entity_type, parent_entity_id, sort_order, entity_type, entity_id);
