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
const dictionaryScopeSchema = z
  .object({
    mode: z.enum(['ALL', 'SELECTED']),
    sources: z.array(z.object({ packId: idSchema, packReleaseId: idSchema }).strict()).max(50),
    includeLocalTerms: z.boolean(),
  })
  .strict();
const generationTargetSchema = z
  .object({
    modelKey: idSchema,
    count: z.number().int().min(1).max(100),
    quality: z.enum(['low', 'medium', 'high']),
  })
  .strict();
const assetSchema = z
  .object({
    id: idSchema,
    kind: z.enum(['GENERATED', 'REFERENCE']),
    originType: z.string().optional(),
    width: z.number(),
    height: z.number(),
    mimeType: z.string(),
    byteSize: z.number().optional(),
    mediaUrl: z.string(),
    createdAt: z.string(),
  })
  .strict();

export const creationDraftLoadInputSchema = z.object({ draftId: idSchema }).strict();

export const creationDraftDtoSchema = z
  .object({
    id: idSchema,
    targetAlbumId: idSchema.nullable(),
    title: z.string().max(300),
    text: z.string().max(30_000),
    promptNodes: z.array(promptNodeSchema).max(2_000).optional(),
    referenceAssets: z.array(assetSchema).max(8),
    termPromptLocale: localeSchema,
    termIds: z.array(idSchema).max(100),
    wordPaletteReferences: z.array(paletteReferenceSchema).max(50),
    dictionaryScope: dictionaryScopeSchema,
    canvasPresetKey: z.string().max(100).nullable(),
    quality: z.enum(['low', 'medium', 'high']),
    selectedModelKeys: z.array(idSchema).max(20),
    repeatCount: z.number().int().min(1).max(100),
    modelTargets: z.array(generationTargetSchema).max(20),
    createdAt: z.string().min(1).max(100),
    updatedAt: z.string().min(1).max(100),
  })
  .strict();

export type CreationDraftLoadInput = z.infer<typeof creationDraftLoadInputSchema>;
export type CreationDraftDto = z.infer<typeof creationDraftDtoSchema>;
