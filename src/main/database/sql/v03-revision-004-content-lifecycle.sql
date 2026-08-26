ALTER TABLE prompt_series ADD COLUMN archived_at TEXT;
ALTER TABLE materials ADD COLUMN archived_at TEXT;

CREATE TABLE content_lifecycle_batches (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  action TEXT NOT NULL CHECK(action IN ('ARCHIVE', 'DELETE')),
  root_entity_type TEXT NOT NULL CHECK(root_entity_type IN (
    'ALBUM', 'CREATION_ITEM', 'PROMPT_SERIES', 'CREATION', 'INSPIRATION_STASH', 'SOCIAL_POST',
    'ARTICLE', 'VIDEO_DOCUMENT', 'MATERIAL', 'IMAGE_ASSET'
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

CREATE INDEX idx_content_lifecycle_batches_page
ON content_lifecycle_batches(action, changed_at DESC, root_entity_type, root_entity_id);

CREATE INDEX idx_content_lifecycle_batches_due
ON content_lifecycle_batches(action, purge_state, expires_at, id);

CREATE TABLE content_lifecycle_batch_members (
  batch_id TEXT NOT NULL REFERENCES content_lifecycle_batches(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'ALBUM', 'CREATION_ITEM', 'PROMPT_SERIES', 'CREATION', 'INSPIRATION_STASH', 'SOCIAL_POST',
    'ARTICLE', 'VIDEO_DOCUMENT', 'MATERIAL', 'IMAGE_ASSET'
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

CREATE INDEX idx_content_lifecycle_members_parent
ON content_lifecycle_batch_members(batch_id, parent_entity_type, parent_entity_id, sort_order, entity_type, entity_id);

INSERT INTO content_lifecycle_batches (
  id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
  preview_asset_id, preview_text, state_before_action, changed_at, expires_at,
  purge_state, purge_requested_at, purge_error, updated_at
)
SELECT
  'legacy:' || lower(entry.entity_type) || ':' || entry.entity_id,
  'DELETE', entry.entity_type, entry.entity_id,
  CASE WHEN entry.entity_type = 'ALBUM' THEN 'ALBUM'
       WHEN entry.entity_type = 'IMAGE_ASSET' THEN 'MATERIAL' ELSE 'CREATION' END,
  CASE
    WHEN entry.entity_type = 'ALBUM' AND entry.scope = 'MATERIAL_ALBUMS' THEN 'MATERIAL_ALBUM'
    WHEN entry.entity_type = 'ALBUM' THEN 'CREATION_ALBUM'
    WHEN entry.entity_type = 'PROMPT_SERIES' THEN 'PROMPT_SERIES'
    WHEN entry.entity_type = 'CREATION' THEN 'IDEA_CREATION'
    WHEN COALESCE(asset.mime_type, '') LIKE 'video/%' THEN 'VIDEO_MATERIAL'
    ELSE 'IMAGE_MATERIAL'
  END,
  entry.title, CASE WHEN entry.entity_type = 'IMAGE_ASSET' THEN entry.entity_id END,
  NULL, entry.state_before_delete, entry.deleted_at, entry.purge_after,
  entry.purge_state, entry.purge_requested_at, entry.purge_error, entry.updated_at
FROM recycle_bin_entries entry
LEFT JOIN image_assets asset ON entry.entity_type = 'IMAGE_ASSET' AND asset.id = entry.entity_id;

INSERT INTO content_lifecycle_batch_members (
  batch_id, entity_type, entity_id, kind, subtype, title, preview_asset_id,
  preview_text, parent_entity_type, parent_entity_id, sort_order, state_before_action, payload_json
)
SELECT
  batch.id, batch.root_entity_type, batch.root_entity_id, batch.root_kind, batch.root_subtype,
  batch.title, batch.preview_asset_id, batch.preview_text, NULL, NULL, 0,
  batch.state_before_action,
  CASE WHEN entry.entity_type = 'ALBUM' THEN json_object(
    'relations', json(COALESCE((
      SELECT json_group_array(json_object(
        'id', relation.id,
        'albumId', relation.album_id,
        'targetType', relation.target_type,
        'targetId', relation.target_id,
        'sortOrder', relation.sort_order,
        'createdAt', relation.created_at
      ))
      FROM album_members relation
      WHERE relation.deleted_at = entry.deleted_at
        AND (
          relation.album_id = entry.entity_id
          OR (relation.target_type = 'ALBUM' AND relation.target_id = entry.entity_id)
        )
    ), '[]'))
  ) ELSE '{}' END
FROM content_lifecycle_batches batch
JOIN recycle_bin_entries entry
  ON batch.action = 'DELETE' AND entry.entity_type = batch.root_entity_type AND entry.entity_id = batch.root_entity_id;

INSERT OR IGNORE INTO content_lifecycle_batches (
  id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
  state_before_action, changed_at, purge_state, updated_at
)
SELECT 'archive:album:' || id, 'ARCHIVE', 'ALBUM', id, 'ALBUM',
  CASE WHEN intent = 'MATERIAL_LIBRARY' THEN 'MATERIAL_ALBUM' ELSE 'CREATION_ALBUM' END,
  title, 'ACTIVE', archived_at, NULL, archived_at
FROM albums WHERE archived_at IS NOT NULL AND deleted_at IS NULL;

INSERT OR IGNORE INTO content_lifecycle_batch_members (
  batch_id, entity_type, entity_id, kind, subtype, title, sort_order, state_before_action
)
SELECT batch.id, 'ALBUM', album.id, 'ALBUM', batch.root_subtype, album.title, 0, 'ACTIVE'
FROM content_lifecycle_batches batch
JOIN albums album ON batch.root_entity_type = 'ALBUM' AND batch.root_entity_id = album.id
WHERE batch.action = 'ARCHIVE';

INSERT OR IGNORE INTO content_lifecycle_batches (
  id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
  state_before_action, changed_at, purge_state, updated_at
)
SELECT 'archive:creation:' || id, 'ARCHIVE', 'CREATION', id, 'CREATION', 'IDEA_CREATION',
  title, 'ACTIVE', archived_at, NULL, archived_at
FROM creations WHERE archived_at IS NOT NULL AND deleted_at IS NULL;

INSERT OR IGNORE INTO content_lifecycle_batch_members (
  batch_id, entity_type, entity_id, kind, subtype, title, sort_order, state_before_action
)
SELECT batch.id, 'CREATION', creation.id, 'CREATION', 'IDEA_CREATION', creation.title, 0, 'ACTIVE'
FROM content_lifecycle_batches batch
JOIN creations creation ON batch.root_entity_type = 'CREATION' AND batch.root_entity_id = creation.id
WHERE batch.action = 'ARCHIVE';

INSERT OR IGNORE INTO content_lifecycle_batches (
  id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
  preview_text, state_before_action, changed_at, purge_state, updated_at
)
SELECT 'archive:inspiration:' || id, 'ARCHIVE', 'INSPIRATION_STASH', id, 'CREATION', 'INSPIRATION_STASH',
  COALESCE(NULLIF(trim(json_extract(input_json, '$.title')), ''), id),
  substr(input_json, 1, 500), 'ACTIVE', archived_at, NULL, archived_at
FROM inspiration_stashes WHERE archived_at IS NOT NULL AND deleted_at IS NULL;

INSERT OR IGNORE INTO content_lifecycle_batches (
  id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
  preview_text, state_before_action, changed_at, purge_state, updated_at
)
SELECT 'archive:social:' || draft.id, 'ARCHIVE', 'SOCIAL_POST', draft.id, 'CREATION', 'SOCIAL_POST',
  COALESCE(NULLIF(trim(json_extract(revision.content_json, '$.title')), ''), draft.id),
  substr(revision.content_json, 1, 500), 'ACTIVE', draft.archived_at, NULL, draft.archived_at
FROM social_post_drafts draft
LEFT JOIN social_post_revisions revision ON revision.id = draft.current_revision_id
WHERE draft.archived_at IS NOT NULL AND draft.deleted_at IS NULL;

INSERT OR IGNORE INTO content_lifecycle_batches (
  id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
  preview_text, state_before_action, changed_at, purge_state, updated_at
)
SELECT 'archive:article:' || article.id, 'ARCHIVE', 'ARTICLE', article.id, 'CREATION', 'ARTICLE',
  COALESCE(NULLIF(trim(json_extract(revision.content_json, '$.title')), ''), article.id),
  substr(revision.content_json, 1, 500), 'ACTIVE', article.archived_at, NULL, article.archived_at
FROM articles article
LEFT JOIN article_revisions revision ON revision.id = article.current_revision_id
WHERE article.archived_at IS NOT NULL AND article.deleted_at IS NULL;

INSERT OR IGNORE INTO content_lifecycle_batches (
  id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
  state_before_action, changed_at, purge_state, updated_at
)
SELECT 'archive:document:' || id, 'ARCHIVE', 'VIDEO_DOCUMENT', id, 'CREATION', 'VIDEO_DOCUMENT',
  title, 'ACTIVE', archived_at, NULL, archived_at
FROM documents WHERE archived_at IS NOT NULL AND deleted_at IS NULL;

INSERT OR IGNORE INTO content_lifecycle_batch_members (
  batch_id, entity_type, entity_id, kind, subtype, title, preview_asset_id,
  preview_text, sort_order, state_before_action
)
SELECT id, root_entity_type, root_entity_id, root_kind, root_subtype, title,
  preview_asset_id, preview_text, 0, state_before_action
FROM content_lifecycle_batches
WHERE action = 'ARCHIVE' AND root_entity_type <> 'ALBUM'
ON CONFLICT(batch_id, entity_type, entity_id) DO NOTHING;
