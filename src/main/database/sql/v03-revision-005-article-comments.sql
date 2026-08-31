ALTER TABLE article_revision_elements RENAME TO article_revision_elements_before_comments;

DROP INDEX idx_article_revision_elements_element;

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

INSERT INTO article_revision_elements (
  revision_id, article_id, element_id, block_index, node_type, text_fingerprint, preview
)
SELECT revision_id, article_id, element_id, block_index, node_type, text_fingerprint, preview
FROM article_revision_elements_before_comments;

DROP TABLE article_revision_elements_before_comments;

CREATE INDEX idx_article_revision_elements_element
ON article_revision_elements(article_id, element_id, revision_id);

CREATE TABLE article_comments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_revision_id TEXT NOT NULL REFERENCES article_revisions(id),
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

CREATE TABLE article_comment_replies (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES article_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
  author_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO article_comments (
  id, article_id, created_revision_id, status, anchor_kind,
  start_element_id, start_offset, end_element_id, end_offset,
  start_block_index, end_block_index, exact_quote, prefix, suffix,
  created_preview, body, author_id, created_at, updated_at, resolved_at
)
SELECT
  flag.id,
  flag.article_id,
  flag.created_revision_id,
  'OPEN',
  'BLOCK',
  flag.element_id,
  0,
  flag.element_id,
  0,
  COALESCE(placement.block_index, 0),
  COALESCE(placement.block_index, 0),
  flag.created_preview,
  '',
  '',
  flag.created_preview,
  '',
  NULL,
  flag.created_at,
  flag.updated_at,
  NULL
FROM article_element_flags flag
LEFT JOIN article_revision_elements placement
  ON placement.revision_id = flag.created_revision_id
    AND placement.article_id = flag.article_id
    AND placement.element_id = flag.element_id;

DROP TABLE article_element_flags;

CREATE INDEX idx_article_comments_article_status
ON article_comments(article_id, status, updated_at DESC, id);

CREATE INDEX idx_article_comment_replies_comment
ON article_comment_replies(comment_id, created_at, id);
