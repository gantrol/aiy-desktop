import { z } from 'zod';

export const naturalWatermarkBrandSchema = z.enum(['AIY', 'AICANDO_XYZ']);
export const naturalWatermarkStyleSchema = z.enum(['AIY', 'AICANDO_XYZ', 'CUSTOM']);
export const naturalWatermarkPlacementSchema = z.enum(['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT']);
export const naturalWatermarkCustomLogoIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const naturalWatermarkProfileIdSchema = z.string().uuid();
export const NATURAL_WATERMARK_CUSTOM_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const NATURAL_WATERMARK_CUSTOM_LOGO_SIZE = 512;
export const NATURAL_WATERMARK_PREVIEW_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export const NATURAL_WATERMARK_PREVIEW_IMAGE_SIZE = 1_600;
export const NATURAL_WATERMARK_TEXT_MAX_LENGTH = 48;
export const NATURAL_WATERMARK_PROFILE_NAME_MAX_LENGTH = 48;
export const NATURAL_WATERMARK_MAX_PROFILES = 24;
export const NATURAL_WATERMARK_MIN_SIZE_RATIO = 0.025;
export const NATURAL_WATERMARK_MAX_SIZE_RATIO = 0.16;
export const NATURAL_WATERMARK_MAX_JITTER_RATIO = 0.3;

const supportedTextSchema = (maximumLength: number, label: string) =>
  z
    .string()
    .max(maximumLength)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), `${label} contains unsupported control characters`);

export const naturalWatermarkLogoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('BUILT_IN'), brand: naturalWatermarkBrandSchema }).strict(),
  z.object({ kind: z.literal('CUSTOM'), id: naturalWatermarkCustomLogoIdSchema }).strict(),
]);

export const naturalWatermarkTextSchema = supportedTextSchema(NATURAL_WATERMARK_TEXT_MAX_LENGTH, 'Watermark text');
export const naturalWatermarkProfileNameSchema = supportedTextSchema(
  NATURAL_WATERMARK_PROFILE_NAME_MAX_LENGTH,
  'Watermark name',
)
  .trim()
  .min(1);

export const naturalWatermarkPositionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

export const naturalWatermarkPositionJitterSchema = z
  .object({
    enabled: z.boolean(),
    x: z.number().min(0).max(NATURAL_WATERMARK_MAX_JITTER_RATIO),
    y: z.number().min(0).max(NATURAL_WATERMARK_MAX_JITTER_RATIO),
  })
  .strict();

export const naturalWatermarkCustomLogoSchema = z
  .object({
    id: naturalWatermarkCustomLogoIdSchema,
    mimeType: z.literal('image/png'),
    bytes: z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength > 0 && value.byteLength <= NATURAL_WATERMARK_CUSTOM_LOGO_MAX_BYTES),
  })
  .strict();

export const naturalWatermarkPreviewImageSchema = z
  .object({
    mimeType: z.literal('image/png'),
    bytes: z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength > 0 && value.byteLength <= NATURAL_WATERMARK_PREVIEW_IMAGE_MAX_BYTES),
  })
  .strict();

export const naturalWatermarkProfileSchema = z
  .object({
    id: naturalWatermarkProfileIdSchema,
    name: naturalWatermarkProfileNameSchema,
    logo: naturalWatermarkLogoSchema,
    text: naturalWatermarkTextSchema,
    sizeRatio: z.number().min(NATURAL_WATERMARK_MIN_SIZE_RATIO).max(NATURAL_WATERMARK_MAX_SIZE_RATIO),
    position: naturalWatermarkPositionSchema,
    positionJitter: naturalWatermarkPositionJitterSchema,
    opacity: z.number().min(0.35).max(0.95),
  })
  .strict();

export const naturalWatermarkConfigurationSchema = z
  .object({
    profiles: z.array(naturalWatermarkProfileSchema).min(1).max(NATURAL_WATERMARK_MAX_PROFILES),
    preferredProfileId: naturalWatermarkProfileIdSchema,
  })
  .strict()
  .superRefine((configuration, context) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const [index, profile] of configuration.profiles.entries()) {
      if (ids.has(profile.id)) {
        context.addIssue({
          code: 'custom',
          path: ['profiles', index, 'id'],
          message: 'Watermark profile ID is duplicated',
        });
      }
      ids.add(profile.id);
      const normalizedName = profile.name.toLowerCase();
      if (names.has(normalizedName)) {
        context.addIssue({
          code: 'custom',
          path: ['profiles', index, 'name'],
          message: 'Watermark profile name is duplicated',
        });
      }
      names.add(normalizedName);
    }
    if (!ids.has(configuration.preferredProfileId)) {
      context.addIssue({
        code: 'custom',
        path: ['preferredProfileId'],
        message: 'Preferred watermark profile is missing',
      });
    }
  });

export type NaturalWatermarkBrand = z.infer<typeof naturalWatermarkBrandSchema>;
export type NaturalWatermarkStyle = z.infer<typeof naturalWatermarkStyleSchema>;
export type NaturalWatermarkLogo = z.infer<typeof naturalWatermarkLogoSchema>;
export type NaturalWatermarkCustomLogo = z.infer<typeof naturalWatermarkCustomLogoSchema>;
export type NaturalWatermarkPreviewImage = z.infer<typeof naturalWatermarkPreviewImageSchema>;
export type NaturalWatermarkPlacement = z.infer<typeof naturalWatermarkPlacementSchema>;
export type NaturalWatermarkPosition = z.infer<typeof naturalWatermarkPositionSchema>;
export type NaturalWatermarkPositionJitter = z.infer<typeof naturalWatermarkPositionJitterSchema>;
export type NaturalWatermarkProfile = z.infer<typeof naturalWatermarkProfileSchema>;
export type NaturalWatermarkConfiguration = z.infer<typeof naturalWatermarkConfigurationSchema>;

export const DEFAULT_NATURAL_WATERMARK_PROFILE_ID = '14bb53fd-9db8-4d23-a93e-2a5ba46b8534';
export const DEFAULT_NATURAL_WATERMARK_PROFILE = Object.freeze({
  id: DEFAULT_NATURAL_WATERMARK_PROFILE_ID,
  name: 'AIY',
  logo: Object.freeze({ kind: 'BUILT_IN', brand: 'AIY' }),
  text: 'AIY',
  sizeRatio: 0.052,
  position: Object.freeze({ x: 1, y: 1 }),
  positionJitter: Object.freeze({ enabled: false, x: 0.03, y: 0.03 }),
  opacity: 0.72,
} as const satisfies NaturalWatermarkProfile);

export const DEFAULT_NATURAL_WATERMARK_CONFIGURATION = Object.freeze({
  profiles: [DEFAULT_NATURAL_WATERMARK_PROFILE],
  preferredProfileId: DEFAULT_NATURAL_WATERMARK_PROFILE_ID,
} satisfies NaturalWatermarkConfiguration);
