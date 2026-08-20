import { z } from 'zod';

const idSchema = z.string().min(1).max(200);

export const MAX_PROMPT_SERIES_COVERS = 3;

const promptSeriesCoverAssetIdsSchema = z
  .array(idSchema)
  .max(MAX_PROMPT_SERIES_COVERS)
  .refine((assetIds) => new Set(assetIds).size === assetIds.length, 'Cover image ids must be unique');

export const promptSeriesOutputRemoveInputSchema = z
  .object({
    seriesId: idSchema,
    imageAssetId: idSchema,
  })
  .strict();

export const promptSeriesCoverSetInputSchema = z
  .object({
    seriesId: idSchema,
    imageAssetIds: promptSeriesCoverAssetIdsSchema,
  })
  .strict();

export const promptSeriesOutputPresentationResultSchema = z
  .object({
    seriesId: idSchema,
    imageAssetId: idSchema.nullable(),
    explicitCoverAssetId: idSchema.nullable(),
    explicitCoverAssetIds: promptSeriesCoverAssetIdsSchema,
  })
  .strict();

export type PromptSeriesOutputRemoveInput = z.infer<typeof promptSeriesOutputRemoveInputSchema>;
export type PromptSeriesCoverSetInput = z.infer<typeof promptSeriesCoverSetInputSchema>;
export type PromptSeriesOutputPresentationResult = z.infer<typeof promptSeriesOutputPresentationResultSchema>;
