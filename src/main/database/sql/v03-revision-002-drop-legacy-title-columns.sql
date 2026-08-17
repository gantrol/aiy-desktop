-- Revision-2 fragment. The preceding localization fragment has copied every
-- supported legacy title into canonical fields and localization tables. The
-- application validates that representation immediately before running this
-- script in the same transaction.
ALTER TABLE creation_drafts DROP COLUMN title_zh;
ALTER TABLE creation_drafts DROP COLUMN title_en;

ALTER TABLE prompt_series DROP COLUMN title_zh;
ALTER TABLE prompt_series DROP COLUMN title_en;
