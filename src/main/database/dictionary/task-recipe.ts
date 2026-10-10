import type Database from 'better-sqlite3';
import {
  taskRecipeInputSchema,
  taskRecipeMethodSchema,
  type TaskRecipeInput,
  type TaskRecipeSnapshot,
  type TaskRecipeTask,
} from '@/shared/contracts/task-recipe';

export function resolveTaskRecipe(
  db: Database.Database,
  task: TaskRecipeTask,
  raw: TaskRecipeInput,
): TaskRecipeSnapshot {
  const input = taskRecipeInputSchema.parse(raw);
  if (!input.source)
    return {
      task,
      name: '',
      originalInstructions: '',
      instructions: input.instructions,
      referenceAssetIds: [],
    };
  const row = db
    .prepare(
      `SELECT revision.name, revision.method_json
    FROM word_palette_revisions revision JOIN word_palettes palette ON palette.id = revision.palette_id
    WHERE revision.id = ? AND palette.id = ? AND palette.deleted_at IS NULL AND palette.archived_at IS NULL`,
    )
    .get(input.source.revisionId, input.source.recipeId) as { name: string; method_json: string | null } | undefined;
  if (!row?.method_json) throw new Error('TASK_RECIPE_UNAVAILABLE');
  const method = taskRecipeMethodSchema.parse(JSON.parse(row.method_json));
  if (method.task !== task) throw new Error('TASK_RECIPE_INCOMPATIBLE');
  const assets = db
    .prepare(
      `SELECT image_asset_id FROM word_palette_revision_media
    WHERE palette_revision_id = ? ORDER BY sort_order`,
    )
    .all(input.source.revisionId) as { image_asset_id: string }[];
  if (assets.length > 8 || (task === 'ARTICLE_COMMENT' && assets.length)) throw new Error('TASK_RECIPE_INCOMPATIBLE');
  return {
    task,
    source: input.source,
    name: row.name,
    originalInstructions: method.instructions,
    instructions: input.instructions,
    referenceAssetIds: assets.map((asset) => asset.image_asset_id),
  };
}
