CREATE TABLE content_revision_elements (
  form_id TEXT NOT NULL REFERENCES creation_forms(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  block_index INTEGER NOT NULL CHECK(block_index >= 0),
  node_type TEXT NOT NULL
    CHECK(node_type IN (
      'paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'image',
      'table', 'tableRow', 'tableHeader', 'tableCell'
    )),
  text_fingerprint TEXT NOT NULL CHECK(length(text_fingerprint) = 16),
  preview TEXT NOT NULL CHECK(length(preview) <= 280),
  PRIMARY KEY(form_id, revision_id, element_id),
  UNIQUE(form_id, revision_id, block_index)
);

CREATE INDEX idx_content_revision_elements_form
ON content_revision_elements(form_id, revision_id, element_id);

CREATE TABLE content_comments (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES creation_forms(id) ON DELETE CASCADE,
  created_revision_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN', 'RESOLVED', 'REJECTED')),
  anchor_kind TEXT NOT NULL
    CHECK(anchor_kind IN ('TEXT_RANGE', 'BLOCK', 'TABLE', 'TABLE_ROW', 'TABLE_CELL')),
  start_element_id TEXT NOT NULL,
  start_offset INTEGER NOT NULL CHECK(start_offset >= 0),
  end_element_id TEXT NOT NULL,
  end_offset INTEGER NOT NULL CHECK(end_offset >= 0),
  start_block_index INTEGER NOT NULL CHECK(start_block_index >= 0),
  end_block_index INTEGER NOT NULL CHECK(end_block_index >= 0),
  exact_quote TEXT NOT NULL CHECK(length(exact_quote) <= 2000),
  prefix TEXT NOT NULL CHECK(length(prefix) <= 200),
  suffix TEXT NOT NULL CHECK(length(suffix) <= 200),
  created_preview TEXT NOT NULL CHECK(length(created_preview) <= 280),
  body TEXT NOT NULL CHECK(length(body) <= 10000),
  author_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE content_comment_replies (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES content_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
  author_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_content_comments_form_status
ON content_comments(form_id, status, updated_at DESC, id);

CREATE INDEX idx_content_comment_replies_comment
ON content_comment_replies(comment_id, created_at, id);
