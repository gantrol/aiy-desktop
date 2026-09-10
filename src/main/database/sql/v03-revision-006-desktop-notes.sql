CREATE TABLE IF NOT EXISTS inspiration_stash_revisions (
  id TEXT PRIMARY KEY,
  stash_id TEXT NOT NULL REFERENCES inspiration_stashes(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL CHECK(revision_no > 0),
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS inspiration_stash_revisions_source ON inspiration_stash_revisions(stash_id, revision_no DESC);
CREATE TABLE IF NOT EXISTS desktop_note_instances (
  id TEXT PRIMARY KEY,
  stash_id TEXT NOT NULL REFERENCES inspiration_stashes(id) ON DELETE CASCADE,
  color TEXT NOT NULL DEFAULT 'rose' CHECK(color IN ('rose','cream','sage','sky','lilac')),
  icon TEXT NOT NULL DEFAULT 'feather' CHECK(icon IN ('feather','lightbulb','heart','star','bookmark','check','flag','flower')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS desktop_note_instances_source ON desktop_note_instances(stash_id);
CREATE TABLE IF NOT EXISTS desktop_note_drafts (
  instance_id TEXT NOT NULL REFERENCES desktop_note_instances(id) ON DELETE CASCADE,
  editor_id TEXT NOT NULL,
  base_hash TEXT NOT NULL,
  text_content TEXT NOT NULL,
  document_json TEXT NOT NULL DEFAULT '{}',
  sequence INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(instance_id, editor_id)
);
