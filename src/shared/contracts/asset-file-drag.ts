import { z } from 'zod';

const assetIdSchema = z.string().min(1).max(200);
const assetFileDragRequestIdSchema = z.string().uuid();

export const assetFilesStartDragChannel = 'asset-files:start-drag';
export const assetFilesDragFinishedChannel = 'asset-files:drag-finished';

export const assetFileDragIntentSchema = z.literal('EXPORT_FILES');

export const assetFileDragIdsSchema = z
  .array(assetIdSchema)
  .min(1)
  .max(100)
  .transform((assetIds) => [...new Set(assetIds)]);

export const assetFileDragRequestSchema = z
  .object({
    requestId: assetFileDragRequestIdSchema,
    intent: assetFileDragIntentSchema,
    assetIds: assetFileDragIdsSchema,
  })
  .strict();

export const assetFileDragResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      requestId: assetFileDragRequestIdSchema,
      status: z.literal('ENDED'),
    })
    .strict(),
  z
    .object({
      requestId: assetFileDragRequestIdSchema,
      status: z.literal('FAILED'),
      message: z.string().min(1).max(300),
    })
    .strict(),
]);

export type AssetFileDragIntent = z.infer<typeof assetFileDragIntentSchema>;
export type AssetFileDragRequest = z.infer<typeof assetFileDragRequestSchema>;
export type AssetFileDragResult = z.infer<typeof assetFileDragResultSchema>;
