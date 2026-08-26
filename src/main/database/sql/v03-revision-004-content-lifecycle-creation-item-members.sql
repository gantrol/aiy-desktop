-- Idempotently composes entity-level lifecycle batches with the stable
-- creation item that owns each form. Concrete form members remain in the
-- batch so their exact pre-operation states can still be restored.

INSERT OR IGNORE INTO content_lifecycle_batch_members (
  batch_id, entity_type, entity_id, kind, subtype, title, preview_asset_id,
  preview_text, parent_entity_type, parent_entity_id, sort_order,
  state_before_action, payload_json
)
SELECT
  member.batch_id,
  'CREATION_ITEM',
  form.creation_item_id,
  'CREATION',
  member.subtype,
  member.title,
  member.preview_asset_id,
  member.preview_text,
  member.parent_entity_type,
  member.parent_entity_id,
  member.sort_order,
  member.state_before_action,
  CASE
    WHEN json_type(member.payload_json, '$.relations') = 'array' THEN member.payload_json
    ELSE json_object(
      'relations',
      json(COALESCE((
        SELECT json_group_array(json_object(
          'id', relation.id,
          'albumId', relation.album_id,
          'targetType', relation.target_type,
          'targetId', relation.target_id,
          'sortOrder', relation.sort_order,
          'createdAt', relation.created_at
        ))
        FROM album_members relation
        JOIN content_lifecycle_batches batch ON batch.id = member.batch_id
        WHERE relation.target_type = 'CREATION_ITEM'
          AND relation.target_id = form.creation_item_id
          AND (
            (batch.action = 'ARCHIVE' AND relation.deleted_at IS NULL)
            OR (batch.action = 'DELETE' AND relation.deleted_at = batch.changed_at)
          )
      ), '[]'))
    )
  END
FROM content_lifecycle_batch_members member
JOIN content_lifecycle_batches batch ON batch.id = member.batch_id
JOIN creation_forms form
  ON form.entity_type = member.entity_type
  AND form.entity_id = member.entity_id
  AND (
    form.deleted_at IS NULL
    OR (batch.action = 'DELETE' AND form.deleted_at = batch.changed_at)
  )
JOIN creation_items item
  ON item.id = form.creation_item_id
WHERE member.entity_type IN (
  'PROMPT_SERIES', 'INSPIRATION_STASH', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT'
);

-- A migrated deleted document may have had no legacy recovery entry. Its
-- creation item is still recoverable and receives a normal 30-day batch.
INSERT OR IGNORE INTO content_lifecycle_batches (
  id, action, root_entity_type, root_entity_id, root_kind, root_subtype, title,
  preview_asset_id, preview_text, state_before_action, changed_at, expires_at,
  purge_state, purge_requested_at, purge_error, updated_at
)
SELECT
  'legacy:creation-item:' || item.id,
  'DELETE',
  'CREATION_ITEM',
  item.id,
  'CREATION',
  CASE form.entity_type
    WHEN 'PROMPT_SERIES' THEN 'PROMPT_SERIES'
    WHEN 'INSPIRATION_STASH' THEN 'INSPIRATION_STASH'
    WHEN 'SOCIAL_POST' THEN 'SOCIAL_POST'
    WHEN 'ARTICLE' THEN 'ARTICLE'
    ELSE 'VIDEO_DOCUMENT'
  END,
  COALESCE(
    NULLIF(trim(series.title), ''),
    NULLIF(trim(document.title), ''),
    item.id
  ),
  NULL,
  NULL,
  CASE WHEN item.archived_at IS NULL THEN 'ACTIVE' ELSE 'ARCHIVED' END,
  item.deleted_at,
  strftime('%Y-%m-%dT%H:%M:%fZ', item.deleted_at, '+30 days'),
  'RETAINED',
  NULL,
  NULL,
  item.deleted_at
FROM creation_items item
JOIN creation_forms form
  ON form.id = item.primary_form_id
  AND (form.deleted_at IS NULL OR form.deleted_at = item.deleted_at)
LEFT JOIN prompt_series series
  ON form.entity_type = 'PROMPT_SERIES' AND series.id = form.entity_id
LEFT JOIN documents document
  ON form.entity_type = 'VIDEO_DOCUMENT' AND document.id = form.entity_id
WHERE item.deleted_at IS NOT NULL
  AND form.entity_type IN ('PROMPT_SERIES', 'VIDEO_DOCUMENT')
  AND NOT EXISTS (
    SELECT 1
    FROM content_lifecycle_batch_members member
    WHERE member.entity_type = 'CREATION_ITEM' AND member.entity_id = item.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM content_lifecycle_batch_members member
    WHERE member.entity_type = form.entity_type AND member.entity_id = form.entity_id
  );

INSERT OR IGNORE INTO content_lifecycle_batch_members (
  batch_id, entity_type, entity_id, kind, subtype, title, preview_asset_id,
  preview_text, parent_entity_type, parent_entity_id, sort_order,
  state_before_action, payload_json
)
SELECT
  batch.id, 'CREATION_ITEM', batch.root_entity_id, 'CREATION', batch.root_subtype,
  batch.title, batch.preview_asset_id, batch.preview_text, NULL, NULL, 0,
  batch.state_before_action, '{}'
FROM content_lifecycle_batches batch
WHERE batch.root_entity_type = 'CREATION_ITEM';

-- Every aggregate batch retains its concrete lifecycle-capable forms as
-- internal members. They are omitted from the visible impact count.
INSERT OR IGNORE INTO content_lifecycle_batch_members (
  batch_id, entity_type, entity_id, kind, subtype, title, preview_asset_id,
  preview_text, parent_entity_type, parent_entity_id, sort_order,
  state_before_action, payload_json
)
SELECT
  aggregate.batch_id,
  form.entity_type,
  form.entity_id,
  'CREATION',
  CASE form.entity_type
    WHEN 'PROMPT_SERIES' THEN 'PROMPT_SERIES'
    WHEN 'INSPIRATION_STASH' THEN 'INSPIRATION_STASH'
    WHEN 'SOCIAL_POST' THEN 'SOCIAL_POST'
    WHEN 'ARTICLE' THEN 'ARTICLE'
    ELSE 'VIDEO_DOCUMENT'
  END,
  aggregate.title,
  aggregate.preview_asset_id,
  aggregate.preview_text,
  'CREATION_ITEM',
  aggregate.entity_id,
  form.sort_order,
  CASE
    WHEN batch.action = 'ARCHIVE' THEN 'ACTIVE'
    WHEN COALESCE(
      series.archived_at,
      inspiration.archived_at,
      social.archived_at,
      article.archived_at,
      document.archived_at
    ) IS NULL THEN aggregate.state_before_action
    ELSE 'ARCHIVED'
  END,
  CASE
    WHEN form.entity_type = 'PROMPT_SERIES' THEN '{}'
    ELSE json_object(
      'statusBefore',
      CASE
        WHEN batch.action = 'ARCHIVE' THEN 'ACTIVE'
        ELSE COALESCE(
          inspiration.status,
          social.status,
          article.status,
          document.status,
          'ACTIVE'
        )
      END
    )
  END
FROM content_lifecycle_batch_members aggregate
JOIN content_lifecycle_batches batch ON batch.id = aggregate.batch_id
JOIN creation_forms form
  ON form.creation_item_id = aggregate.entity_id
  AND (
    form.deleted_at IS NULL
    OR (batch.action = 'DELETE' AND form.deleted_at = batch.changed_at)
  )
LEFT JOIN prompt_series series
  ON form.entity_type = 'PROMPT_SERIES' AND series.id = form.entity_id
LEFT JOIN inspiration_stashes inspiration
  ON form.entity_type = 'INSPIRATION_STASH' AND inspiration.id = form.entity_id
LEFT JOIN social_post_drafts social
  ON form.entity_type = 'SOCIAL_POST' AND social.id = form.entity_id
LEFT JOIN articles article
  ON form.entity_type = 'ARTICLE' AND article.id = form.entity_id
LEFT JOIN documents document
  ON form.entity_type = 'VIDEO_DOCUMENT' AND document.id = form.entity_id
WHERE aggregate.entity_type = 'CREATION_ITEM'
  AND form.entity_type IN (
    'PROMPT_SERIES', 'INSPIRATION_STASH', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT'
  );

-- Internal form members no longer appear beside their owning item when an
-- archived/deleted album is browsed.
UPDATE content_lifecycle_batch_members AS member
SET parent_entity_type = 'CREATION_ITEM',
    parent_entity_id = (
      SELECT form.creation_item_id
      FROM creation_forms form
      WHERE form.entity_type = member.entity_type
        AND form.entity_id = member.entity_id
        AND (
          form.deleted_at IS NULL
          OR form.deleted_at = (
            SELECT batch.changed_at
            FROM content_lifecycle_batches batch
            WHERE batch.id = member.batch_id AND batch.action = 'DELETE'
          )
        )
      LIMIT 1
    ),
    payload_json = json_remove(payload_json, '$.relations')
WHERE member.entity_type IN (
    'PROMPT_SERIES', 'INSPIRATION_STASH', 'SOCIAL_POST', 'ARTICLE', 'VIDEO_DOCUMENT'
  )
  AND EXISTS (
    SELECT 1
    FROM creation_forms form
    JOIN content_lifecycle_batch_members aggregate
      ON aggregate.batch_id = member.batch_id
      AND aggregate.entity_type = 'CREATION_ITEM'
      AND aggregate.entity_id = form.creation_item_id
    WHERE form.entity_type = member.entity_type
      AND form.entity_id = member.entity_id
      AND (
        form.deleted_at IS NULL
        OR form.deleted_at = (
          SELECT batch.changed_at
          FROM content_lifecycle_batches batch
          WHERE batch.id = member.batch_id AND batch.action = 'DELETE'
        )
      )
  );

UPDATE creation_items
SET archived_at = COALESCE(
      archived_at,
      (
        SELECT batch.changed_at
        FROM content_lifecycle_batch_members member
        JOIN content_lifecycle_batches batch ON batch.id = member.batch_id
        WHERE member.entity_type = 'CREATION_ITEM'
          AND member.entity_id = creation_items.id
          AND (
            batch.action = 'ARCHIVE'
            OR (batch.action = 'DELETE' AND member.state_before_action = 'ARCHIVED')
          )
        ORDER BY batch.changed_at LIMIT 1
      )
    ),
    deleted_at = COALESCE(
      deleted_at,
      (
        SELECT batch.changed_at
        FROM content_lifecycle_batch_members member
        JOIN content_lifecycle_batches batch ON batch.id = member.batch_id
        WHERE member.entity_type = 'CREATION_ITEM'
          AND member.entity_id = creation_items.id
          AND batch.action = 'DELETE'
        ORDER BY batch.changed_at LIMIT 1
      )
    );
