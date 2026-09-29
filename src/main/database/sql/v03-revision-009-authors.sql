CREATE TABLE creation_authors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_data_url TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE creation_items ADD COLUMN author_revision INTEGER NOT NULL DEFAULT 0;
