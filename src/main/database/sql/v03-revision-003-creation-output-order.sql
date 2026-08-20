ALTER TABLE creation_output_imports
ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0);
