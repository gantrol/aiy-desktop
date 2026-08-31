CREATE TABLE article_elements (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(article_id, id)
);

CREATE TABLE article_revision_elements (
  revision_id TEXT NOT NULL REFERENCES article_revisions(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL,
  block_index INTEGER NOT NULL CHECK(block_index >= 0),
  node_type TEXT NOT NULL
    CHECK(node_type IN (
      'paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'image',
      'table', 'tableRow', 'tableHeader', 'tableCell'
    )),
  text_fingerprint TEXT NOT NULL CHECK(length(text_fingerprint) = 16),
  preview TEXT NOT NULL CHECK(length(preview) <= 280),
  PRIMARY KEY(revision_id, element_id),
  UNIQUE(revision_id, block_index),
  FOREIGN KEY(article_id, element_id) REFERENCES article_elements(article_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_article_revision_elements_element
ON article_revision_elements(article_id, element_id, revision_id);

CREATE TABLE article_element_flags (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind = 'NEEDS_EDIT'),
  status TEXT NOT NULL CHECK(status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  created_revision_id TEXT NOT NULL REFERENCES article_revisions(id),
  created_preview TEXT NOT NULL CHECK(length(created_preview) <= 280),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(article_id, element_id, kind),
  FOREIGN KEY(article_id, element_id) REFERENCES article_elements(article_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_article_element_flags_article_status
ON article_element_flags(article_id, status, updated_at DESC, id);
