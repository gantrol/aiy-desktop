import { z } from 'zod';
import { taskRecipeTaskSchema } from '@/shared/contracts/task-recipe';

export const promptRecipeSpaceSchema = z.string().min(1).max(200);
export const promptRecipeDefaultsSchema = z
  .object({
    ARTICLE_COMMENT: z.string().min(1).max(200).nullable(),
    IMAGE_COVER: z.string().min(1).max(200).nullable(),
  })
  .strict();
export const promptRecipeSelectionSchema = z
  .object({
    spaceId: promptRecipeSpaceSchema,
    task: taskRecipeTaskSchema,
    recipeId: z.string().min(1).max(200).nullable(),
  })
  .strict();
export type PromptRecipeDefaults = z.infer<typeof promptRecipeDefaultsSchema>;
export type PromptRecipeSelection = z.infer<typeof promptRecipeSelectionSchema>;
