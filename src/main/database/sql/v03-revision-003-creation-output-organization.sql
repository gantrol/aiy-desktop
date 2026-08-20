ALTER TABLE creation_output_imports
ADD COLUMN relationship_kind TEXT NOT NULL DEFAULT 'UNSPECIFIED'
  CHECK(relationship_kind IN ('UNSPECIFIED', 'PRIMARY', 'VARIANT', 'DERIVED', 'POST_EDIT'));

ALTER TABLE creation_output_imports
ADD COLUMN relationship_target_output_id TEXT REFERENCES creation_output_imports(id)
  CHECK(
    (relationship_kind IN ('UNSPECIFIED', 'PRIMARY') AND relationship_target_output_id IS NULL)
    OR
    (relationship_kind IN ('VARIANT', 'DERIVED', 'POST_EDIT') AND relationship_target_output_id IS NOT NULL)
  );

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY series_id
      ORDER BY created_at DESC, batch_id DESC, sort_order, id DESC
    ) - 1 AS next_sort_order
  FROM creation_output_imports
  WHERE deleted_at IS NULL
)
UPDATE creation_output_imports
SET sort_order = (
  SELECT ranked.next_sort_order
  FROM ranked
  WHERE ranked.id = creation_output_imports.id
)
WHERE id IN (SELECT id FROM ranked);

CREATE INDEX IF NOT EXISTS idx_creation_output_imports_series_order
ON creation_output_imports(series_id, sort_order, id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_creation_output_imports_relationship_target
ON creation_output_imports(relationship_target_output_id)
WHERE relationship_target_output_id IS NOT NULL;
