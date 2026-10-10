import type { LibraryDatabase } from '@/main/database';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import {
  readPromptRecipeDefaults,
  resolveDefaultTaskRecipe,
  savePromptRecipeDefault,
} from '@/main/extensions/prompt-recipes';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { promptRecipeSelectionSchema, promptRecipeSpaceSchema } from '@/shared/contracts/prompt-recipes';
import { taskRecipeTaskSchema } from '@/shared/contracts/task-recipe';

export function registerPromptRecipeIpc(
  ipc: IpcHandlerRegistrar,
  database: LibraryDatabase,
  extensions: ExtensionRegistry,
) {
  function current(raw: unknown) {
    if (database.getLocalSpace().id !== promptRecipeSpaceSchema.parse(raw))
      throw new Error('TASK_RECIPE_SPACE_CHANGED');
    return database.db;
  }
  ipc.handle('prompt-recipes:get', (_event, spaceId) => readPromptRecipeDefaults(current(spaceId)));
  ipc.handle('prompt-recipes:select', (_event, raw) => {
    const input = promptRecipeSelectionSchema.parse(raw);
    return savePromptRecipeDefault(current(input.spaceId), input.task, input.recipeId);
  });
  ipc.handle(
    'prompt-recipes:resolve',
    (_event, task, spaceId) =>
      resolveDefaultTaskRecipe(current(spaceId), extensions, taskRecipeTaskSchema.parse(task)) ?? null,
  );
}
