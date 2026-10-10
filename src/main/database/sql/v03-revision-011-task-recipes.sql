ALTER TABLE word_palette_revisions ADD COLUMN method_json TEXT;
ALTER TABLE article_check_runs ADD COLUMN input_json TEXT;
ALTER TABLE derived_visuals ADD COLUMN recipe_input_json TEXT;
