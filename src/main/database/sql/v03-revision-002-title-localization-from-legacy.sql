-- Normalize the title shape from the immutable revision-1 schema shipped in
-- AIY 0.3.0/0.3.1. This script is intentionally selected only after the
-- application verifies that the database still has the released legacy
-- title_zh/title_en columns and does not already have localization tables.
--
-- A later fragment in the same revision removes the legacy columns only after
-- the application validates this copy. Runtime code uses the canonical title
-- fields and localization tables exclusively.
ALTER TABLE albums
ADD COLUMN title_locale TEXT NOT NULL DEFAULT 'und'
CHECK(length(trim(title_locale)) > 0);

CREATE TABLE album_localizations (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id),
  locale TEXT NOT NULL CHECK(length(trim(locale)) > 0),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  UNIQUE(album_id, locale)
);

ALTER TABLE prompt_series
ADD COLUMN title_locale TEXT NOT NULL DEFAULT 'zh'
CHECK(length(trim(title_locale)) > 0);

CREATE TABLE prompt_series_localizations (
  id TEXT PRIMARY KEY,
  prompt_series_id TEXT NOT NULL REFERENCES prompt_series(id),
  locale TEXT NOT NULL CHECK(length(trim(locale)) > 0),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  UNIQUE(prompt_series_id, locale)
);

-- Preserve the legacy primary title exactly. When it matches an explicit
-- localized value, that locale becomes primary. A distinct legacy title uses
-- `und`, allowing both explicit zh/en values to remain addressable.
UPDATE prompt_series
SET title_locale = CASE
  WHEN length(trim(COALESCE(title_zh, ''))) > 0 AND title = title_zh THEN 'zh'
  WHEN length(trim(COALESCE(title_en, ''))) > 0 AND title = title_en THEN 'en'
  WHEN length(trim(COALESCE(title_zh, ''))) = 0
    AND length(trim(COALESCE(title_en, ''))) = 0 THEN 'und'
  ELSE 'und'
END;

INSERT INTO prompt_series_localizations(id, prompt_series_id, locale, title)
SELECT 'migration_r2_prompt_series_zh_' || id, id, 'zh', title_zh
FROM prompt_series
WHERE title_locale <> 'zh' AND length(trim(COALESCE(title_zh, ''))) > 0;

INSERT INTO prompt_series_localizations(id, prompt_series_id, locale, title)
SELECT 'migration_r2_prompt_series_en_' || id, id, 'en', title_en
FROM prompt_series
WHERE title_locale <> 'en' AND length(trim(COALESCE(title_en, ''))) > 0;

ALTER TABLE creation_drafts
ADD COLUMN title TEXT NOT NULL DEFAULT '';

-- Released builds wrote and read the active draft title through title_zh;
-- title_en was an unused compatibility field. Preserve that behavior, with
-- title_en only as a fallback for externally-modified databases.
UPDATE creation_drafts
SET title = CASE
  WHEN length(trim(COALESCE(title_zh, ''))) > 0 THEN title_zh
  WHEN length(trim(COALESCE(title_en, ''))) > 0 THEN title_en
  ELSE ''
END;

CREATE INDEX idx_album_localizations_owner_locale
ON album_localizations(album_id, locale, id);

CREATE INDEX idx_prompt_series_localizations_owner_locale
ON prompt_series_localizations(prompt_series_id, locale, id);
