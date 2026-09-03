import { z } from 'zod';

export const naturalWatermarkBrandSchema = z.enum(['AIY', 'AICANDO_XYZ']);
export const naturalWatermarkStyleSchema = z.enum(['AIY', 'AICANDO_XYZ', 'CUSTOM']);
export const naturalWatermarkPlacementSchema = z.enum(['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT']);
export const naturalWatermarkCustomLogoIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const NATURAL_WATERMARK_CUSTOM_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const NATURAL_WATERMARK_CUSTOM_LOGO_SIZE = 512;
export const NATURAL_WATERMARK_TEXT_MAX_LENGTH = 48;

export const naturalWatermarkLogoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('BUILT_IN'), brand: naturalWatermarkBrandSchema }).strict(),
  z.object({ kind: z.literal('CUSTOM'), id: naturalWatermarkCustomLogoIdSchema }).strict(),
]);

export const naturalWatermarkTextSchema = z
  .string()
  .max(NATURAL_WATERMARK_TEXT_MAX_LENGTH)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), 'Watermark text contains unsupported control characters');

export const naturalWatermarkCustomLogoSchema = z
  .object({
    id: naturalWatermarkCustomLogoIdSchema,
    mimeType: z.literal('image/png'),
    bytes: z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength > 0 && value.byteLength <= NATURAL_WATERMARK_CUSTOM_LOGO_MAX_BYTES),
  })
  .strict();

export const naturalWatermarkConfigurationSchema = z
  .object({
    logo: naturalWatermarkLogoSchema,
    text: naturalWatermarkTextSchema,
    placement: naturalWatermarkPlacementSchema,
    opacity: z.number().min(0.35).max(0.95),
  })
  .strict();

export const DEFAULT_NATURAL_WATERMARK_CONFIGURATION = Object.freeze({
  logo: Object.freeze({ kind: 'BUILT_IN', brand: 'AIY' }),
  text: 'AIY',
  placement: 'BOTTOM_RIGHT',
  opacity: 0.72,
} as const satisfies NaturalWatermarkConfiguration);

export type NaturalWatermarkBrand = z.infer<typeof naturalWatermarkBrandSchema>;
export type NaturalWatermarkStyle = z.infer<typeof naturalWatermarkStyleSchema>;
export type NaturalWatermarkLogo = z.infer<typeof naturalWatermarkLogoSchema>;
export type NaturalWatermarkCustomLogo = z.infer<typeof naturalWatermarkCustomLogoSchema>;
export type NaturalWatermarkPlacement = z.infer<typeof naturalWatermarkPlacementSchema>;
export type NaturalWatermarkConfiguration = z.infer<typeof naturalWatermarkConfigurationSchema>;
