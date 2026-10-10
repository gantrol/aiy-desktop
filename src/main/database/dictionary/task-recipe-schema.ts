import type Database from 'better-sqlite3';
import { columnNames } from '@/main/database/core/schema-inspection';
import sql from '@/main/database/sql/v03-revision-011-task-recipes.sql?raw';

export function taskRecipeSchemaComplete(db: Database.Database) {
  return (
    columnNames(db, 'word_palette_revisions').has('method_json') &&
    columnNames(db, 'article_check_runs').has('input_json') &&
    columnNames(db, 'derived_visuals').has('recipe_input_json')
  );
}

export function ensureTaskRecipeSchema(db: Database.Database) {
  if (!taskRecipeSchemaComplete(db)) db.exec(sql);
}
