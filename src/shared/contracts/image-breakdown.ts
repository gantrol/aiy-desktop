import { z } from 'zod';

const idSchema = z.string().min(1).max(200);
const routeIdSchema = z.string().min(1).max(750);
const modelKeySchema = z.string().min(1).max(500);
const dateTimeSchema = z.string().datetime({ offset: true });
const localeSchema = z.enum(['zh', 'en']);

export const imageBreakdownRouteKeySchema = z.enum(['ANTIGRAVITY_CLI', 'GOOGLE_GEMINI', 'DEEPSEEK_VL']);
export const imageBreakdownStatusSchema = z.enum(['DRAFT', 'RUNNING', 'SUCCEEDED', 'FAILED']);
export const imageBreakdownPromptKindSchema = z.enum(['FULL', 'STYLE', 'COMPOSITION_LIGHT']);

const imageBreakdownFacetSchema = z
  .object({
    observations: z.array(z.string().trim().min(1).max(500)).max(12),
    inferences: z.array(z.string().trim().min(1).max(500)).max(12),
  })
  .strict();

export const imageBreakdownResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary: z.string().trim().min(1).max(2_000),
    facets: z
      .object({
        subject: imageBreakdownFacetSchema,
        scene: imageBreakdownFacetSchema,
        composition: imageBreakdownFacetSchema,
        lightAndColor: imageBreakdownFacetSchema,
        style: imageBreakdownFacetSchema,
      })
      .strict(),
    prompts: z
      .object({
        full: z.string().trim().min(1).max(12_000),
        style: z.string().trim().min(1).max(8_000),
        compositionLight: z.string().trim().min(1).max(8_000),
      })
      .strict(),
  })
  .strict();

const sourceAssetSchema = z
  .object({
    id: idSchema,
    kind: z.enum(['GENERATED', 'REFERENCE']),
    originType: z.string().max(500).optional(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    mimeType: z.string().min(1).max(500),
    byteSize: z.number().int().nonnegative().optional(),
    mediaUrl: z.string().min(1).max(32_768),
    createdAt: dateTimeSchema,
  })
  .strict();

export const imageBreakdownSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(300),
    sourceAsset: sourceAssetSchema,
    focus: z.string().max(2_000),
    routeKey: imageBreakdownRouteKeySchema,
    modelKey: modelKeySchema.nullable(),
    status: imageBreakdownStatusSchema,
    result: imageBreakdownResultSchema.nullable(),
    errorCode: z.string().min(1).max(200).nullable(),
    errorMessage: z.string().max(2_000).nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .strict();

export const imageBreakdownCreateInputSchema = z
  .object({
    sourceAssetId: idSchema,
    albumId: idSchema.nullable(),
    sourceFormId: idSchema.nullable().optional().default(null),
    locale: localeSchema,
  })
  .strict();

export const imageBreakdownReplaceSourceInputSchema = z
  .object({
    id: idSchema,
    sourceAssetId: idSchema,
  })
  .strict();

export const imageBreakdownRunInputSchema = z
  .object({
    id: idSchema,
    focus: z.string().max(2_000),
    routeKey: imageBreakdownRouteKeySchema,
    modelKey: modelKeySchema,
    locale: localeSchema,
  })
  .strict();

export const imageBreakdownWorkerInputSchema = z
  .object({
    imagePath: z.string().min(1).max(32_768),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    focus: z.string().max(2_000),
    locale: localeSchema,
    routeKey: imageBreakdownRouteKeySchema,
    modelKey: modelKeySchema,
  })
  .strict();

export const imageBreakdownImageFormCreateInputSchema = z
  .object({
    id: idSchema,
    promptKind: imageBreakdownPromptKindSchema,
    locale: localeSchema,
  })
  .strict();

export const imageBreakdownCreateResultSchema = z
  .object({
    breakdown: imageBreakdownSchema,
    creationItemId: idSchema,
  })
  .strict();

export const imageBreakdownImageFormCreateResultSchema = z
  .object({
    seriesId: idSchema,
    versionId: idSchema,
  })
  .strict();

export type ImageBreakdownRouteKey = z.infer<typeof imageBreakdownRouteKeySchema>;
export type ImageBreakdownStatus = z.infer<typeof imageBreakdownStatusSchema>;
export type ImageBreakdownPromptKind = z.infer<typeof imageBreakdownPromptKindSchema>;
export type ImageBreakdownResult = z.infer<typeof imageBreakdownResultSchema>;
export type ImageBreakdownDto = z.infer<typeof imageBreakdownSchema>;
export type ImageBreakdownCreateInput = z.infer<typeof imageBreakdownCreateInputSchema>;
export type ImageBreakdownReplaceSourceInput = z.infer<typeof imageBreakdownReplaceSourceInputSchema>;
export type ImageBreakdownRunInput = z.infer<typeof imageBreakdownRunInputSchema>;
export type ImageBreakdownWorkerInput = z.infer<typeof imageBreakdownWorkerInputSchema>;
export type ImageBreakdownImageFormCreateInput = z.infer<typeof imageBreakdownImageFormCreateInputSchema>;
export type ImageBreakdownCreateResult = z.infer<typeof imageBreakdownCreateResultSchema>;
export type ImageBreakdownImageFormCreateResult = z.infer<typeof imageBreakdownImageFormCreateResultSchema>;

export const imageBreakdownRouteSchema = z
  .object({
    id: routeIdSchema,
    key: imageBreakdownRouteKeySchema,
    providerKey: z.enum(['antigravity-cli', 'google-gemini', 'deepseek']),
    modelKey: modelKeySchema,
    extensionId: idSchema,
    name: z.string().min(1).max(1_000),
    state: z.enum(['READY', 'UNAVAILABLE']),
    availabilityReason: z.string().max(10_000).nullable(),
  })
  .strict();

export const imageBreakdownRoutesSchema = z.array(imageBreakdownRouteSchema).max(100);

export type ImageBreakdownRouteDto = z.infer<typeof imageBreakdownRouteSchema>;
