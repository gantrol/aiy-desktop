import { z } from 'zod';
import {
  browserCompanionSourceSchema,
  browserCompanionTargetSchema,
  browserCompanionWatermarkSelectionSchema,
} from '@/shared/contracts/browser-companion';
import { tablePublicationPreviewSchema } from '@/shared/contracts/table-publication-preview';

const ids = z.array(z.string().min(1).max(200)).max(1000);
const bindings = z.array(z.object({ path: z.string().max(4000), assetId: z.string().max(200) }).strict()).max(1000);
export const tablePublicationInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedSpaceId: z.string().min(1).max(200),
    source: browserCompanionSourceSchema,
    target: browserCompanionTargetSchema.exclude(['chatgpt']),
    markdown: z.string().min(1).max(128_000),
    leadingMediaAssetIds: ids,
    mediaAssetIds: ids,
    mediaBindings: bindings,
    preferredMediaAssetIds: ids.nullable(),
    watermark: browserCompanionWatermarkSelectionSchema,
    tableLabel: z.string().min(1).max(100),
  })
  .strict();
export const tablePublicationResultSchema = z
  .object({
    markdown: z.string().max(256_000),
    mediaAssetIds: ids,
    mediaBindings: tablePublicationPreviewSchema.shape.mediaBindings,
    preview: tablePublicationPreviewSchema,
  })
  .strict();
export type TablePublicationInput = z.infer<typeof tablePublicationInputSchema>;
export type TablePublicationResult = z.infer<typeof tablePublicationResultSchema>;

export const tablePublicationDiscardSchema = z
  .object({
    expectedSpaceId: z.string().min(1).max(200),
    ids: z.array(z.string().uuid()).max(32),
  })
  .strict();
export type TablePublicationDiscard = z.infer<typeof tablePublicationDiscardSchema>;
