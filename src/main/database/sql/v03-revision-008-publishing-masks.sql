CREATE TABLE IF NOT EXISTS publishing_mask_drafts (
  id TEXT PRIMARY KEY,
  article_id TEXT REFERENCES articles(id) ON DELETE CASCADE,
  social_post_id TEXT REFERENCES social_post_drafts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('wechat', 'xiaohongshu', 'weibo', 'x')),
  format TEXT NOT NULL CHECK (format IN ('inline-article', 'numbered-gallery')),
  version INTEGER NOT NULL CHECK (version > 0),
  draft_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((article_id IS NOT NULL) != (social_post_id IS NOT NULL)),
  CHECK (format != 'inline-article' OR platform = 'wechat'),
  UNIQUE (article_id, platform, format),
  UNIQUE (social_post_id, platform, format)
);
