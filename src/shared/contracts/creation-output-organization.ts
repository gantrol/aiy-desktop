import { z } from 'zod';

const assetSchema = z
  .object({
    id: z.string(),
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

export const importedCreationOutputSchema = z
  .object({
    id: z.string(),
    batchId: z.string(),
    seriesId: z.string(),
    promptVersionId: z.string().nullable(),
    imageAssetId: z.string(),
    sourceType: z.enum(['PASTE', 'DROP', 'UPLOAD']),
    originalName: z.string(),
    displayName: z.string(),
    note: z.string(),
    sourceUrl: z.string(),
    aiGeneratedStatus: z.enum(['YES', 'NO', 'UNKNOWN', 'OTHER']),
    comparisonRole: z.enum(['MODEL', 'UNKNOWN', 'ACTUAL']),
    executionRouteKey: z.string().nullable().optional(),
    modelKey: z.string().nullable().optional(),
    modelName: z.string(),
    modelProvider: z.string(),
    modelVersion: z.string(),
    generationTextType: z.enum(['EXACT_PROMPT', 'DESCRIPTION', 'RECONSTRUCTION', 'UNKNOWN']),
    generationText: z.string(),
    provenanceConfidence: z.enum(['VERIFIED', 'DECLARED', 'INFERRED', 'UNKNOWN']),
    sortOrder: z.number().optional(),
    relationshipKind: z.enum(['UNSPECIFIED', 'PRIMARY', 'VARIANT', 'DERIVED', 'POST_EDIT']).optional(),
    relationshipTargetOutputId: z.string().nullable().optional(),
    codexTask: z.object({ threadId: z.string(), threadName: z.string() }).strict().nullable().optional(),
    createdAt: z.string(),
    asset: assetSchema,
  })
  .strict();

export const creatorOutputsOrganizeResultSchema = z.object({ outputs: z.array(importedCreationOutputSchema) }).strict();
