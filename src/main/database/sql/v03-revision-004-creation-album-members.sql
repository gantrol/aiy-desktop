-- Revision-4 fragment. Albums own stable creation items, never an individual
-- creation form. Material and child-album membership remain unchanged.

CREATE TABLE album_members_revision_4_composition (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('MATERIAL', 'ALBUM', 'CREATION_ITEM')),
  target_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(album_id, target_type, target_id)
);

-- Material and album edges keep their stable membership IDs.
INSERT INTO album_members_revision_4_composition (
  id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at
)
SELECT
  id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at
FROM album_members
WHERE target_type IN ('MATERIAL', 'ALBUM');

-- Every legacy entity edge is mapped to its owning item. Development builds
-- also wrote direct inspiration/post/article edges, while a derived visual's
-- series is mapped through the visual's parent form.
CREATE TEMP TABLE revision_4_creation_member_candidates AS
SELECT
  member.id,
  member.album_id,
  member.sort_order,
  member.created_at,
  member.updated_at,
  member.deleted_at,
  COALESCE(entity_form.creation_item_id, parent_form.creation_item_id) AS creation_item_id,
  CASE
    WHEN COALESCE(entity_form.id, parent_form.id) = item.primary_form_id THEN 1
    ELSE 0
  END AS is_primary
FROM album_members member
LEFT JOIN derived_visuals visual
  ON member.target_type = 'SERIES' AND visual.prompt_series_id = member.target_id
LEFT JOIN creation_forms entity_form
  ON entity_form.deleted_at IS NULL AND (
    (member.target_type = 'SERIES'
      AND entity_form.entity_type = 'PROMPT_SERIES' AND entity_form.entity_id = member.target_id)
    OR (member.target_type = 'DOCUMENT'
      AND entity_form.entity_type = 'VIDEO_DOCUMENT' AND entity_form.entity_id = member.target_id)
    OR (member.target_type = 'INSPIRATION_STASH'
      AND entity_form.entity_type = 'INSPIRATION_STASH' AND entity_form.entity_id = member.target_id)
    OR (member.target_type = 'SOCIAL_POST'
      AND entity_form.entity_type = 'SOCIAL_POST' AND entity_form.entity_id = member.target_id)
    OR (member.target_type = 'ARTICLE'
      AND entity_form.entity_type = 'ARTICLE' AND entity_form.entity_id = member.target_id)
  )
LEFT JOIN creation_forms parent_form
  ON entity_form.id IS NULL AND visual.id IS NOT NULL AND parent_form.deleted_at IS NULL AND (
    (visual.social_post_id IS NOT NULL
      AND parent_form.entity_type = 'SOCIAL_POST' AND parent_form.entity_id = visual.social_post_id)
    OR (visual.article_id IS NOT NULL
      AND parent_form.entity_type = 'ARTICLE' AND parent_form.entity_id = visual.article_id)
  )
JOIN creation_items item
  ON item.id = COALESCE(entity_form.creation_item_id, parent_form.creation_item_id)
    AND item.deleted_at IS NULL
WHERE member.target_type IN ('SERIES', 'DOCUMENT', 'INSPIRATION_STASH', 'SOCIAL_POST', 'ARTICLE');

-- One item has one active owner. Prefer the active membership of its primary
-- form, then the most recently updated surviving legacy edge.
CREATE TEMP TABLE revision_4_creation_item_owners AS
WITH ranked AS (
  SELECT
    candidate.id AS member_id,
    candidate.creation_item_id,
    candidate.album_id,
    ROW_NUMBER() OVER (
      PARTITION BY candidate.creation_item_id
      ORDER BY
        candidate.is_primary DESC,
        candidate.updated_at DESC,
        candidate.created_at DESC,
        candidate.id DESC
    ) AS owner_rank
  FROM revision_4_creation_member_candidates candidate
  WHERE candidate.deleted_at IS NULL
)
SELECT member_id, creation_item_id, album_id
FROM ranked
WHERE owner_rank = 1;

-- Multiple form-level edges can collapse into the same item/album pair. Keep
-- one stable edge per pair and retire active edges from non-owner albums.
WITH ranked AS (
  SELECT
    candidate.*,
    owner.member_id AS owner_member_id,
    owner.album_id AS owner_album_id,
    ROW_NUMBER() OVER (
      PARTITION BY candidate.creation_item_id, candidate.album_id
      ORDER BY
        CASE WHEN candidate.id = owner.member_id THEN 0 ELSE 1 END,
        CASE WHEN candidate.deleted_at IS NULL THEN 0 ELSE 1 END,
        candidate.is_primary DESC,
        candidate.updated_at DESC,
        candidate.created_at DESC,
        candidate.id DESC
    ) AS pair_rank
  FROM revision_4_creation_member_candidates candidate
  LEFT JOIN revision_4_creation_item_owners owner
    ON owner.creation_item_id = candidate.creation_item_id
)
INSERT INTO album_members_revision_4_composition (
  id, album_id, target_type, target_id, sort_order, created_at, updated_at, deleted_at
)
SELECT
  ranked.id,
  ranked.album_id,
  'CREATION_ITEM',
  ranked.creation_item_id,
  ranked.sort_order,
  ranked.created_at,
  ranked.updated_at,
  CASE
    WHEN ranked.album_id = ranked.owner_album_id THEN NULL
    ELSE COALESCE(ranked.deleted_at, ranked.updated_at)
  END
FROM ranked
WHERE ranked.pair_rank = 1;

DROP TABLE revision_4_creation_item_owners;
DROP TABLE revision_4_creation_member_candidates;

DROP TABLE album_members;
ALTER TABLE album_members_revision_4_composition RENAME TO album_members;

CREATE UNIQUE INDEX idx_album_members_active_child_owner
ON album_members(target_id)
WHERE target_type = 'ALBUM' AND deleted_at IS NULL;

CREATE INDEX idx_album_members_active_order
ON album_members(album_id, target_type, sort_order, id)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_album_members_active_creation_item_owner
ON album_members(target_id)
WHERE target_type = 'CREATION_ITEM' AND deleted_at IS NULL;

CREATE INDEX idx_album_members_reverse
ON album_members(target_type, target_id, album_id)
WHERE deleted_at IS NULL;

-- Root ordering follows the stable item as well.
CREATE TABLE sidebar_root_order_revision_4 (
  scope TEXT NOT NULL CHECK(scope IN ('CREATOR', 'GALLERY')),
  target_type TEXT NOT NULL CHECK(target_type IN ('ALBUM', 'CREATION_ITEM')),
  target_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope, target_type, target_id)
);

INSERT INTO sidebar_root_order_revision_4 (
  scope, target_type, target_id, sort_order, updated_at
)
SELECT scope, target_type, target_id, sort_order, updated_at
FROM sidebar_root_order
WHERE target_type = 'ALBUM';

CREATE TEMP TABLE revision_4_creation_root_candidates AS
SELECT
  ordering.scope,
  ordering.target_id AS legacy_target_id,
  ordering.sort_order,
  ordering.updated_at,
  COALESCE(series_form.creation_item_id, parent_form.creation_item_id) AS creation_item_id,
  CASE
    WHEN COALESCE(series_form.id, parent_form.id) = item.primary_form_id THEN 1
    ELSE 0
  END AS is_primary
FROM sidebar_root_order ordering
LEFT JOIN derived_visuals visual
  ON ordering.target_type = 'SERIES' AND visual.prompt_series_id = ordering.target_id
LEFT JOIN creation_forms series_form
  ON ordering.target_type = 'SERIES'
    AND series_form.entity_type = 'PROMPT_SERIES' AND series_form.entity_id = ordering.target_id
    AND series_form.deleted_at IS NULL
LEFT JOIN creation_forms parent_form
  ON series_form.id IS NULL AND visual.id IS NOT NULL AND parent_form.deleted_at IS NULL AND (
    (visual.social_post_id IS NOT NULL
      AND parent_form.entity_type = 'SOCIAL_POST' AND parent_form.entity_id = visual.social_post_id)
    OR (visual.article_id IS NOT NULL
      AND parent_form.entity_type = 'ARTICLE' AND parent_form.entity_id = visual.article_id)
  )
JOIN creation_items item
  ON item.id = COALESCE(series_form.creation_item_id, parent_form.creation_item_id)
    AND item.deleted_at IS NULL
WHERE ordering.target_type = 'SERIES';

WITH ranked AS (
  SELECT
    candidate.*,
    ROW_NUMBER() OVER (
      PARTITION BY candidate.scope, candidate.creation_item_id
      ORDER BY
        candidate.is_primary DESC,
        candidate.updated_at DESC,
        candidate.sort_order,
        candidate.legacy_target_id
    ) AS item_rank
  FROM revision_4_creation_root_candidates candidate
)
INSERT INTO sidebar_root_order_revision_4 (
  scope, target_type, target_id, sort_order, updated_at
)
SELECT ranked.scope, 'CREATION_ITEM', ranked.creation_item_id, ranked.sort_order, ranked.updated_at
FROM ranked
WHERE ranked.item_rank = 1;

DROP TABLE revision_4_creation_root_candidates;

DROP TABLE sidebar_root_order;
ALTER TABLE sidebar_root_order_revision_4 RENAME TO sidebar_root_order;

CREATE INDEX idx_sidebar_root_order_sort
ON sidebar_root_order(scope, sort_order, target_type, target_id);
