import { z } from 'zod';

export const tablePublicationPreviewSchema = z
  .object({
    id: z.string().uuid(),
    markdown: z.string().max(256_000),
    mediaBindings: z.array(z.object({ path: z.string().max(4000), assetId: z.string().max(200) }).strict()).max(1020),
    coverAssetId: z.string().max(200).nullable(),
    titleInBody: z.boolean().optional(),
    tables: z
      .array(
        z
          .object({
            number: z.number().int().positive(),
            markdown: z.string().max(128_000),
            mediaAssetIds: z.array(z.string().max(200)).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    media: z
      .array(
        z
          .object({
            assetId: z.string().max(200),
            mediaUrl: z.string().max(500),
          })
          .strict(),
      )
      .max(20),
    linksAsText: z.boolean(),
  })
  .strict();

export type TablePublicationPreview = z.infer<typeof tablePublicationPreviewSchema>;

export const TABLE_PUBLICATION_ERRORS = [
  'TABLE_STRUCTURE_UNSUPPORTED',
  'TABLE_TOO_WIDE',
  'TABLE_ROW_TOO_TALL',
  'TABLE_RESOURCE_UNAVAILABLE',
  'TABLE_IMAGE_LIMIT',
  'TABLE_ORDER_CONFLICT',
  'TABLE_RENDER_FAILED',
  'TABLE_PREVIEW_EXPIRED',
  'TABLE_PREPARATION_BUSY',
] as const;
