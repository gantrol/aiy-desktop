ALTER TABLE prompt_versions
ADD COLUMN source_import_id TEXT REFERENCES creation_output_imports(id);
