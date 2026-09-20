CREATE TABLE IF NOT EXISTS desktop_petal_layers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL
);
INSERT OR IGNORE INTO desktop_petal_layers(id,name,color) VALUES ('default','','rose');
CREATE TABLE IF NOT EXISTS desktop_content_pins (
  id TEXT PRIMARY KEY, source_kind TEXT NOT NULL CHECK(source_kind IN ('ARTICLE','SOCIAL_POST','MATERIAL','IMAGE','ALBUM','MATERIAL_ALBUM','PROMPT_SERIES','CREATION_DRAFT','INSPIRATION_STASH','VIDEO_DOCUMENT','GIF_DOCUMENT')),
  source_id TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'cream', icon TEXT NOT NULL DEFAULT 'bookmark',
  UNIQUE(source_kind,source_id)
);
CREATE TABLE IF NOT EXISTS desktop_petal_memberships (
  instance_id TEXT PRIMARY KEY, layer_id TEXT NOT NULL REFERENCES desktop_petal_layers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS desktop_petal_memberships_layer ON desktop_petal_memberships(layer_id);
