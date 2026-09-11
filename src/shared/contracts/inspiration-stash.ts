import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { blockDocumentAssetIds, blockDocumentSchema } from '@/shared/contracts/block-document';
import { z } from 'zod';
import { noteFileSchema, NOTE_FILE_LIMITS } from '@/shared/contracts/note-files';
import { creationDraftDtoSchema } from '@/shared/contracts/creation-draft';

const idSchema = z.string().min(1).max(200);
const localeSchema = z.enum(['zh', 'en']);
const promptNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(1_000_000) }).strict(),
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
const draftConsumptionSchema = {
  consumeCreationDraftId: idSchema.nullable().default(null),
};

/** Generation context is revisioned with an article, separately from its prose. */
export const articleCreationInputSchema = z
  .object({
    promptNodes: z.array(promptNodeSchema).max(2_000),
    termPromptLocale: localeSchema,
    termIds: z.array(idSchema).max(100),
    wordPaletteReferences: z.array(paletteReferenceSchema).max(50),
    referenceAssetIds: z.array(idSchema).max(100),
    settings: creationDraftDtoSchema
      .pick({
        dictionaryScope: true,
        canvasPresetKey: true,
        quality: true,
        selectedModelKeys: true,
        repeatCount: true,
        modelTargets: true,
      })
      .strip()
      .optional(),
  })
  .strict();

export const inspirationStashContentSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    document: blockDocumentSchema.optional(),
    // Optional keys stay absent in old revisions so their canonical hashes remain valid.
    title: z.string().max(200).optional(),
    format: z.literal('markdown').optional(),
    manualPrompt: z.string().max(1_000_000).optional(),
    promptNodes: z.array(promptNodeSchema).max(2_000),
    referenceAssetIds: z.array(idSchema).max(100),
    files: z.array(noteFileSchema).max(NOTE_FILE_LIMITS.count).optional(),
    termPromptLocale: localeSchema,
    termIds: z.array(idSchema).max(100),
    wordPaletteReferences: z.array(paletteReferenceSchema).max(50),
    settings: articleCreationInputSchema.shape.settings,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.schemaVersion === 2 && !value.document)
      context.addIssue({ code: 'custom', message: 'BLOCK_DOCUMENT_REQUIRED' });
    if (value.schemaVersion === 1 && (value.document || value.manualPrompt === undefined))
      context.addIssue({ code: 'custom', message: 'INVALID_LEGACY_CONTENT' });
    if (value.document && blockDocumentAssetIds(value.document).some((id) => !value.referenceAssetIds.includes(id)))
      context.addIssue({ code: 'custom', message: 'BLOCK_MEDIA_BINDING_MISSING' });
  })
  .transform((value) => ({
    ...value,
    manualPrompt: value.document ? blockDocumentMarkdown(value.document) : value.manualPrompt!,
    ...(value.document ? { format: 'markdown' as const } : {}),
  }));

export const inspirationStashSaveInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('UPDATE'),
      id: idSchema,
      expectedContentHash: z.string().min(1),
      expectedRevisionId: idSchema.optional(),
      content: inspirationStashContentSchema,
      ...draftConsumptionSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('CREATE_STANDALONE'),
      albumId: idSchema.nullable(),
      content: inspirationStashContentSchema,
      ...draftConsumptionSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('ADD_FORM'),
      creationItemId: idSchema,
      content: inspirationStashContentSchema,
      ...draftConsumptionSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('CREATE_NOTE'),
      requestId: idSchema,
      albumId: idSchema.nullable(),
      content: inspirationStashContentSchema,
      ...draftConsumptionSchema,
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
