import type Database from 'better-sqlite3';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import { resolveTaskRecipe } from '@/main/database/dictionary/task-recipe';
import { promptRecipeDefaultsSchema, type PromptRecipeDefaults } from '@/shared/contracts/prompt-recipes';
import { taskRecipeMethodSchema, type TaskRecipeTask } from '@/shared/contracts/task-recipe';
import { PROMPT_RECIPES_EXTENSION_ID } from '@/shared/extension-ids';

const key = 'prompt_recipe_defaults_v1';

export function readPromptRecipeDefaults(db: Database.Database): PromptRecipeDefaults {
  const stored = db.prepare('SELECT value FROM app_meta WHERE key = ?').pluck().get(key);
  if (stored === undefined) return { ARTICLE_COMMENT: null, IMAGE_COVER: null };
  try {
    return promptRecipeDefaultsSchema.parse(JSON.parse(String(stored)));
  } catch {
    throw new Error('TASK_RECIPE_CONFIGURATION_UNAVAILABLE');
  }
}

function currentRecipe(db: Database.Database, task: TaskRecipeTask, recipeId: string) {
  const row = db
    .prepare(
      `SELECT revision.id, revision.method_json
    FROM word_palettes palette JOIN word_palette_revisions revision ON revision.id = palette.current_revision_id
    WHERE palette.id = ? AND palette.deleted_at IS NULL AND palette.archived_at IS NULL`,
    )
    .get(recipeId) as { id: string; method_json: string | null } | undefined;
  if (!row?.method_json) throw new Error('TASK_RECIPE_UNAVAILABLE');
  const method = taskRecipeMethodSchema.parse(JSON.parse(row.method_json));
  const input = { source: { recipeId, revisionId: row.id }, instructions: method.instructions };
  resolveTaskRecipe(db, task, input);
  return input;
}

export function savePromptRecipeDefault(db: Database.Database, task: TaskRecipeTask, recipeId: string | null) {
  return db.transaction(() => {
    if (recipeId) currentRecipe(db, task, recipeId);
    const next = { ...readPromptRecipeDefaults(db), [task]: recipeId };
    db.prepare(
      'INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(key, JSON.stringify(next));
    return next;
  })();
}

export function resolveDefaultTaskRecipe(db: Database.Database, extensions: ExtensionRegistry, task: TaskRecipeTask) {
  if (!extensions.isActivated(PROMPT_RECIPES_EXTENSION_ID)) return undefined;
  const recipeId = readPromptRecipeDefaults(db)[task];
  return recipeId ? currentRecipe(db, task, recipeId) : undefined;
}
