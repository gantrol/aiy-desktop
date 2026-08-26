-- Revision-4 fragment. A creation item is the stable aggregate shown in the
-- creator library. Its forms reference the typed content aggregates that own
-- their own revisions and workspace state.

CREATE TABLE creation_items (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  phase TEXT NOT NULL CHECK(phase IN ('DRAFT', 'ACTIVE')),
  primary_form_id TEXT REFERENCES creation_forms(id),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) > 0),
  archived_at TEXT,
  deleted_at TEXT,
  CHECK(
    (phase = 'DRAFT' AND primary_form_id IS NULL)
    OR (phase = 'ACTIVE' AND primary_form_id IS NOT NULL)
  )
);

CREATE TABLE creation_forms (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) > 0),
  creation_item_id TEXT NOT NULL REFERENCES creation_items(id),
  role TEXT NOT NULL CHECK(role IN (
    'INSPIRATION', 'IMAGE_CREATION', 'SOCIAL_POST', 'ARTICLE',
    'VIDEO_DOCUMENT', 'SOCIAL_POST_COVER', 'ARTICLE_HEADER', 'ARTICLE_INLINE'
  )),
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'INSPIRATION_STASH', 'PROMPT_SERIES', 'SOCIAL_POST', 'ARTICLE',
    'VIDEO_DOCUMENT', 'DERIVED_VISUAL'
  )),
  entity_id TEXT NOT NULL CHECK(length(trim(entity_id)) > 0),
  anchor_key TEXT,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0),
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) > 0),
  deleted_at TEXT,
  CHECK(
    (role = 'INSPIRATION' AND entity_type = 'INSPIRATION_STASH' AND anchor_key IS NULL)
    OR (role = 'IMAGE_CREATION' AND entity_type = 'PROMPT_SERIES' AND anchor_key IS NULL)
    OR (role = 'SOCIAL_POST' AND entity_type = 'SOCIAL_POST' AND anchor_key IS NULL)
    OR (role = 'ARTICLE' AND entity_type = 'ARTICLE' AND anchor_key IS NULL)
    OR (role = 'VIDEO_DOCUMENT' AND entity_type = 'VIDEO_DOCUMENT' AND anchor_key IS NULL)
    OR (role IN ('SOCIAL_POST_COVER', 'ARTICLE_HEADER')
      AND entity_type = 'DERIVED_VISUAL' AND anchor_key IS NULL)
    OR (role = 'ARTICLE_INLINE' AND entity_type = 'DERIVED_VISUAL'
      AND length(trim(anchor_key)) > 0)
  )
);

CREATE INDEX idx_creation_items_active_activity
ON creation_items(archived_at, updated_at DESC, id DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_creation_forms_item_order
ON creation_forms(creation_item_id, sort_order, created_at, id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_creation_forms_active_entity
ON creation_forms(entity_type, entity_id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_creation_forms_active_singleton_role
ON creation_forms(creation_item_id, role)
WHERE deleted_at IS NULL AND role <> 'ARTICLE_INLINE';

CREATE UNIQUE INDEX idx_creation_forms_active_article_inline_anchor
ON creation_forms(creation_item_id, role, anchor_key)
WHERE deleted_at IS NULL AND role = 'ARTICLE_INLINE';
