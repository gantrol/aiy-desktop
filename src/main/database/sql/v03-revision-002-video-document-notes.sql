-- Revision-2 fragment. Add a user-owned notes branch without changing the
-- public revision number prepared for 0.3.2.

CREATE TABLE document_branches_revision_2_notes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  role TEXT NOT NULL CHECK(role IN (
    'CLEAN_TRANSCRIPT', 'ARTICLE', 'NOTES', 'STORY_NO_SPOILER', 'STORY_SPOILER'
  )),
  spoiler_level TEXT NOT NULL CHECK(spoiler_level IN ('NONE', 'FULL')),
  status TEXT NOT NULL CHECK(status IN (
    'EMPTY', 'PROCESSING', 'PARTIAL', 'EDITABLE', 'CONFIRMED', 'FAILED'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(document_id, role)
);

INSERT INTO document_branches_revision_2_notes (
  id, document_id, role, spoiler_level, status, created_at, updated_at, deleted_at
)
SELECT id, document_id, role, spoiler_level, status, created_at, updated_at, deleted_at
FROM document_branches;

DROP TABLE document_branches;
ALTER TABLE document_branches_revision_2_notes RENAME TO document_branches;

CREATE INDEX idx_document_branches_active
ON document_branches(document_id, role, updated_at DESC)
WHERE deleted_at IS NULL;

INSERT INTO document_branches (
  id, document_id, role, spoiler_level, status, created_at, updated_at, deleted_at
)
SELECT document.id || ':notes', document.id, 'NOTES', 'NONE', 'EMPTY', document.created_at, document.updated_at, NULL
FROM documents document
WHERE document.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_branches branch
    WHERE branch.document_id = document.id AND branch.role = 'NOTES' AND branch.deleted_at IS NULL
  );

INSERT INTO document_drafts (id, branch_id, created_at, updated_at, deleted_at)
SELECT document.id || ':notes:draft', document.id || ':notes', document.created_at, document.updated_at, NULL
FROM documents document
WHERE document.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_drafts draft WHERE draft.branch_id = document.id || ':notes'
  );
