import { z } from 'zod';

const id = z.string().min(1).max(200);
export const taskRecipeTaskSchema = z.enum(['ARTICLE_COMMENT', 'IMAGE_COVER']);
export const taskRecipeSourceSchema = z.object({ recipeId: id, revisionId: id }).strict();
export const taskRecipeMethodSchema = z
  .object({
    task: taskRecipeTaskSchema,
    instructions: z.string().trim().min(1).max(12_000),
    source: taskRecipeSourceSchema.optional(),
  })
  .strict();

// Text is editable for this invocation; identity retains the selected revision.
export const taskRecipeInputSchema = z
  .object({
    source: taskRecipeSourceSchema.optional(),
    instructions: z.string().trim().max(12_000),
  })
  .strict();

export const taskRecipeSnapshotSchema = z
  .object({
    task: taskRecipeTaskSchema,
    source: taskRecipeSourceSchema.optional(),
    name: z.string().max(200),
    originalInstructions: z.string().max(12_000),
    instructions: z.string().max(12_000),
    referenceAssetIds: z.array(id).max(8),
  })
  .strict();

export const coverRecipeSnapshotSchema = z
  .object({
    recipe: taskRecipeSnapshotSchema,
    prompt: z.string().max(30_000),
  })
  .strict();

export type TaskRecipeTask = z.infer<typeof taskRecipeTaskSchema>;
export type TaskRecipeMethod = z.infer<typeof taskRecipeMethodSchema>;
export type TaskRecipeInput = z.infer<typeof taskRecipeInputSchema>;
export type TaskRecipeSnapshot = z.infer<typeof taskRecipeSnapshotSchema>;
export type CoverRecipeSnapshot = z.infer<typeof coverRecipeSnapshotSchema>;
