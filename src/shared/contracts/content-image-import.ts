import type { AssetDto, CreatorImageImportItemInput } from '@/shared/contracts';
import { z } from 'zod';

export const contentImageImportIdSchema = z.string().uuid();
export const contentImageStageSchema = z
  .object({
    importId: contentImageImportIdSchema,
    source: z.enum(['UPLOAD', 'PASTE', 'DROP']),
    item: z
      .object({
        name: z.string().max(500),
        mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']),
        bytes: z.custom<Uint8Array>(
          (value) => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= 25 * 1024 * 1024,
        ),
      })
      .strict(),
  })
  .strict();
export type ContentImageStage = z.infer<typeof contentImageStageSchema>;
export interface ContentImageImportsApi {
  contentImageAccepted(importId: string): Promise<boolean>;
  contentImageStage(input: ContentImageStage): Promise<void>;
  contentImageResolve(importId: string): Promise<AssetDto>;
}
export type ContentImageStoredItem = Pick<CreatorImageImportItemInput, 'name' | 'mimeType'>;
