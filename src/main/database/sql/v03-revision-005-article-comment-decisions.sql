DROP INDEX idx_article_comments_article_status;
DROP INDEX idx_article_comment_replies_comment;

ALTER TABLE article_comment_replies RENAME TO article_comment_replies_before_decisions;
ALTER TABLE article_comments RENAME TO article_comments_before_decisions;

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
  id, article_id, created_revision_id, status, anchor_kind,
  start_element_id, start_offset, end_element_id, end_offset,
  start_block_index, end_block_index, exact_quote, prefix, suffix,
  created_preview, body, author_id, created_at, updated_at, resolved_at
FROM article_comments_before_decisions;

INSERT INTO article_comment_replies (
  id, comment_id, body, author_id, created_at, updated_at
)
SELECT id, comment_id, body, author_id, created_at, updated_at
FROM article_comment_replies_before_decisions;

DROP TABLE article_comment_replies_before_decisions;
DROP TABLE article_comments_before_decisions;

CREATE INDEX idx_article_comments_article_status
ON article_comments(article_id, status, updated_at DESC, id);

CREATE INDEX idx_article_comment_replies_comment
ON article_comment_replies(comment_id, created_at, id);
