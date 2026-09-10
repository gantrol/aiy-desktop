import { z } from 'zod';
import { GIF_MAX_SOURCE_BYTES } from '@/shared/contracts/gif-making';
import { gifGenerationSettingsSchema } from '@/shared/contracts/gif-generation';
import { gifFrameAuditSchema } from '@/shared/contracts/gif-motion-plan';
export const GIF_FRAME_REQUEST = 'gif-frame:request';
export const GIF_FRAME_RESPONSE = 'gif-frame:response';
const bytes = z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= GIF_MAX_SOURCE_BYTES);
export const gifFrameRequestSchema = z
  .object({
    runId: z.string().uuid(),
    operation: z.enum(['PREPARE', 'COMPOSE']),
    settings: gifGenerationSettingsSchema,
    source: bytes,
    sheet: bytes.nullable(),
    frameImages: z.array(bytes).min(1).max(7).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.source.byteLength +
        (v.sheet?.byteLength ?? 0) +
        (v.frameImages?.reduce((n, image) => n + image.byteLength, 0) ?? 0) <=
      GIF_MAX_SOURCE_BYTES,
  )
  .refine((v) => {
    if (v.operation === 'PREPARE') return !v.sheet && !v.frameImages;
    return v.settings.generationMode === 'FRAMES'
      ? !v.sheet && v.frameImages?.length === v.settings.keyframes - 1
      : Boolean(v.sheet) && !v.frameImages;
  });
export const gifFrameResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('complete'),
      runId: z.string().uuid(),
      images: z.array(bytes).max(8),
      audit: gifFrameAuditSchema.optional(),
    })
    .strict()
    .refine((v) => v.images.reduce((n, b) => n + b.byteLength, 0) <= GIF_MAX_SOURCE_BYTES),
  z.object({ kind: z.literal('error'), runId: z.string().uuid(), error: z.string().max(200) }).strict(),
]);
export type GifFrameRequest = z.infer<typeof gifFrameRequestSchema>;
