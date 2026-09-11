CREATE TABLE desktop_note_instances_with_white (
  id TEXT PRIMARY KEY,
  stash_id TEXT NOT NULL REFERENCES inspiration_stashes(id) ON DELETE CASCADE,
  color TEXT NOT NULL DEFAULT 'white' CHECK(color IN ('white','rose','cream','sage','sky','lilac')),
  icon TEXT NOT NULL DEFAULT 'feather' CHECK(icon IN ('feather','lightbulb','heart','star','bookmark','check','flag','flower')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO desktop_note_instances_with_white(id, stash_id, color, icon, created_at, updated_at)
SELECT id, stash_id, color, icon, created_at, updated_at FROM desktop_note_instances;
DROP TABLE desktop_note_instances;
ALTER TABLE desktop_note_instances_with_white RENAME TO desktop_note_instances;
CREATE INDEX desktop_note_instances_source ON desktop_note_instances(stash_id);
