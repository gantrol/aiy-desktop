import type { CreateWordPaletteInput, Locale } from '@/shared/contracts';
import type { TaskRecipeInput, TaskRecipeTask } from '@/shared/contracts/task-recipe';

export function taskRecipeCreateInput(
  task: TaskRecipeTask,
  locale: Locale,
  name: string,
  instructions: string,
  source?: TaskRecipeInput['source'],
  referenceAssetIds: string[] = [],
): CreateWordPaletteInput {
  return {
    locale,
    name: name.trim(),
    nameLocale: locale,
    description: '',
    localizations: [],
    parameters: [],
    promptNodes: [],
    referenceAssetIds,
    method: { task, instructions: instructions.trim(), ...(source ? { source } : {}) },
  };
}
