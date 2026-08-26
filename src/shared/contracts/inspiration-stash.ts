import { z } from 'zod';

const idSchema = z.string().min(1).max(200);
const localeSchema = z.enum(['zh', 'en']);
const promptNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }).strict(),
  z.object({ kind: z.literal('TERM'), termId: idSchema, promptLocale: localeSchema.optional() }).strict(),
  z.object({ kind: z.literal('RECIPE'), paletteId: idSchema }).strict(),
]);
const paletteReferenceSchema = z
  .object({
    paletteId: idSchema,
    paletteRevisionId: idSchema,
    parameterValues: z.record(z.string().max(64), z.string().max(120)),
    promptLocale: localeSchema,
  })
  .strict();

export const inspirationStashContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    manualPrompt: z.string().max(30_000),
    promptNodes: z.array(promptNodeSchema).max(2_000),
    referenceAssetIds: z.array(idSchema).max(100),
    termPromptLocale: localeSchema,
    termIds: z.array(idSchema).max(100),
    wordPaletteReferences: z.array(paletteReferenceSchema).max(50),
  })
  .strict();

export const inspirationStashSaveInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('UPDATE'),
      id: idSchema,
      content: inspirationStashContentSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('CREATE_STANDALONE'),
      albumId: idSchema.nullable(),
      content: inspirationStashContentSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('ADD_FORM'),
      creationItemId: idSchema,
      content: inspirationStashContentSchema,
    })
    .strict(),
]);

export const inspirationStashSetArchivedInputSchema = z
  .object({
    id: idSchema,
    archived: z.boolean(),
  })
  .strict();

export const inspirationStashMoveInputSchema = z
  .object({
    id: idSchema,
    albumId: idSchema.nullable(),
  })
  .strict();

export type InspirationStashContentInput = z.infer<typeof inspirationStashContentSchema>;
export type InspirationStashSaveInput = z.infer<typeof inspirationStashSaveInputSchema>;
export type InspirationStashMoveInput = z.infer<typeof inspirationStashMoveInputSchema>;
export type InspirationStashSetArchivedInput = z.infer<typeof inspirationStashSetArchivedInputSchema>;
