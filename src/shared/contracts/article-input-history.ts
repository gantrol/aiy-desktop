import { z } from 'zod';
import { creationDraftDtoSchema } from '@/shared/contracts/creation-draft';

const identifier = z.string().min(1).max(200);
const recordKind = z.enum(['CREATION', 'STASH', 'WRITING', 'ASSISTANT']);
const cursorSchema = z.object({ createdAt: identifier, id: identifier }).strict();
const target = z.object({ spaceId: identifier, articleId: identifier }).strict();

export const articleInputHistoryQuerySchema = target.extend({ cursor: cursorSchema.nullable().default(null) });
export const articleInputRecordQuerySchema = target.extend({ recordId: identifier });
export const articleInputContinueQuerySchema = articleInputRecordQuerySchema.extend({ requestId: identifier });
export const articleInputSummarySchema = z.object({ id: identifier, kind: recordKind, createdAt: identifier }).strict();
export const articleInputHistoryPageSchema = target.extend({
  items: z.array(articleInputSummarySchema).max(20),
  nextCursor: cursorSchema.nullable(),
});

// Optional fields distinguish recorded settings from defaults used only when starting a new draft.
export const articleInputDraftSnapshotSchema = creationDraftDtoSchema
  .pick({
    text: true,
    document: true,
    promptNodes: true,
    startMode: true,
    writingInstruction: true,
    termPromptLocale: true,
    termIds: true,
    wordPaletteReferences: true,
    dictionaryScope: true,
    canvasPresetKey: true,
    quality: true,
    selectedModelKeys: true,
    repeatCount: true,
    modelTargets: true,
  })
  .partial()
  .extend({
    text: z.string().max(30_000),
    referenceAssetIds: z.array(identifier).max(100),
    videoMaterialIds: z.array(identifier).max(8),
  });

// Historical assistant requests may exceed today's editable draft limits.
// Keep them readable without silently truncating them when continuing.
export const articleInputSnapshotSchema = articleInputDraftSnapshotSchema.extend({
  canvasPresetKey: z.string().max(200).nullable().optional(),
  wordPaletteReferences: z
    .array(
      creationDraftDtoSchema.shape.wordPaletteReferences.element.extend({
        parameterValues: z.record(z.string().max(64), z.string().max(300)),
      }),
    )
    .max(80)
    .optional(),
});

export const articleInputRecordSchema = target.extend({
  ...articleInputSummarySchema.shape,
  snapshot: articleInputSnapshotSchema,
  selectionText: z.string().max(30_000).nullable(),
  referenceAssets: creationDraftDtoSchema.shape.referenceAssets,
  videoAttachments: creationDraftDtoSchema.shape.videoAttachments,
  missingReferenceIds: z.array(identifier).max(108),
  canContinue: z.boolean(),
  // Structured, frozen request facts; never populated from the current article or current model configuration.
  requestDetails: z.record(z.string(), z.unknown()).nullable(),
});

export type ArticleInputHistoryQuery = z.infer<typeof articleInputHistoryQuerySchema>;
export type ArticleInputRecordQuery = z.infer<typeof articleInputRecordQuerySchema>;
export type ArticleInputContinueQuery = z.infer<typeof articleInputContinueQuerySchema>;
export type ArticleInputSummary = z.infer<typeof articleInputSummarySchema>;
export type ArticleInputHistoryPage = z.infer<typeof articleInputHistoryPageSchema>;
export type ArticleInputSnapshot = z.infer<typeof articleInputSnapshotSchema>;
export type ArticleInputRecord = z.infer<typeof articleInputRecordSchema>;
