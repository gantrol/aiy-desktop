CREATE TABLE IF NOT EXISTS creation_item_parents (
  creation_item_id TEXT PRIMARY KEY REFERENCES creation_items(id) ON DELETE CASCADE,
  parent_creation_item_id TEXT NOT NULL REFERENCES creation_items(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  updated_at TEXT NOT NULL,
  CHECK(creation_item_id <> parent_creation_item_id)
);
CREATE INDEX IF NOT EXISTS idx_creation_item_parents_order
ON creation_item_parents(parent_creation_item_id, sort_order, creation_item_id);

CREATE TABLE IF NOT EXISTS album_notes (
  album_id TEXT PRIMARY KEY REFERENCES albums(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE
);
