import { z } from 'zod';

export const IMAGE_PRIVACY_COVER_COLOR = '#000000';

export const imagePrivacyKindSchema = z.enum(['email', 'phone', 'credential', 'custom']);
export const imagePrivacyOptionsSchema = z
  .object({
    kinds: z.array(imagePrivacyKindSchema).min(1).max(4),
    terms: z.array(z.string().trim().min(1).max(100)).max(30),
  })
  .strict();
export const imagePrivacyCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cancel'), requestId: z.string().uuid() }).strict(),
  z
    .object({
      kind: z.literal('recognize'),
      requestId: z.string().uuid(),
      bytes: z.custom<Uint8Array>(
        (value) => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= 25 * 1024 * 1024,
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal('scan'),
      requestId: z.string().uuid(),
      options: imagePrivacyOptionsSchema,
      bytes: z.custom<Uint8Array>(
        (value) => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= 25 * 1024 * 1024,
      ),
    })
    .strict(),
]);
export const imagePrivacyRegionSchema = z
  .object({
    kind: imagePrivacyKindSchema,
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();
export const imagePrivacyResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      regions: z.array(imagePrivacyRegionSchema).max(300),
      text: z.string().max(262144).optional(),
    })
    .strict(),
  z
    .object({ status: z.enum(['unsupported', 'unavailable', 'tooLarge', 'busy', 'cancelled', 'failed', 'tooMany']) })
    .strict(),
]);
export type ImagePrivacyCommand = z.infer<typeof imagePrivacyCommandSchema>;
export type ImagePrivacyOptions = z.infer<typeof imagePrivacyOptionsSchema>;
export type ImagePrivacyRegion = z.infer<typeof imagePrivacyRegionSchema>;
export type ImagePrivacyResult = z.infer<typeof imagePrivacyResultSchema>;
