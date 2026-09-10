import { z } from 'zod';
import {
  GIF_MAX_OUTPUT_BYTES,
  GIF_MAX_SOURCE_BYTES,
  GIF_MAX_FRAMES,
  gifManifestSchema,
} from '@/shared/contracts/gif-making';

export const GIF_RENDER_REQUEST = 'gif-render:request';
export const GIF_RENDER_RESPONSE = 'gif-render:response';
export const gifRenderRequestSchema = z
  .object({
    runId: z.string().uuid(),
    manifest: gifManifestSchema,
    sources: z
      .array(
        z
          .object({
            assetId: z.string().min(1).max(200),
            mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
            bytes: z
              .instanceof(Uint8Array)
              .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= GIF_MAX_SOURCE_BYTES),
          })
          .strict(),
      )
      .max(GIF_MAX_FRAMES + 1),
  })
  .strict()
  .refine((value) => value.sources.reduce((size, source) => size + source.bytes.byteLength, 0) <= GIF_MAX_SOURCE_BYTES);
export const gifRenderResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('progress'),
      runId: z.string().uuid(),
      stage: z.enum(['PALETTE', 'ENCODING', 'VERIFYING']),
      completed: z.number().int().nonnegative(),
      total: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('complete'),
      runId: z.string().uuid(),
      bytes: z
        .instanceof(Uint8Array)
        .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= GIF_MAX_OUTPUT_BYTES),
    })
    .strict(),
  z.object({ kind: z.literal('error'), runId: z.string().uuid(), error: z.string().max(200) }).strict(),
]);
export type GifRenderRequest = z.infer<typeof gifRenderRequestSchema>;
