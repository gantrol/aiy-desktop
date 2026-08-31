import { z } from 'zod';

const idSchema = z.string().min(1).max(200);
const handoffIdSchema = z.string().uuid();
const chromeProfileDirectorySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => value !== '.' && value !== '..' && !/[\\/\u0000-\u001f]/.test(value));

export const browserCompanionTargetSchema = z.enum(['weibo', 'wechat', 'chatgpt']);
export const browserCompanionBrowserIdSchema = z.enum(['chrome', 'edge']);

export const browserCompanionSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('social-post'),
      id: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('creation-draft'),
      id: idSchema,
    })
    .strict(),
]);

export const browserCompanionContentKindSchema = z.enum(['social-post-body', 'prompt']);
export const browserCompanionHandoffStateSchema = z.enum(['ready', 'claimed', 'delivered']);

export const browserCompanionStageInputSchema = z
  .object({
    target: browserCompanionTargetSchema,
    source: browserCompanionSourceSchema,
    contentKind: browserCompanionContentKindSchema,
    title: z.string().trim().min(1).max(200).optional(),
    text: z.string().trim().min(1).max(10_000),
    mediaAssetIds: z.array(idSchema).max(20).optional(),
  })
  .strict();

export const browserCompanionHistoryItemSchema = z
  .object({
    handoffId: handoffIdSchema,
    target: browserCompanionTargetSchema,
    source: browserCompanionSourceSchema,
    contentKind: browserCompanionContentKindSchema,
    text: z.string().min(1).max(10_000),
    mediaCount: z.number().int().min(0).max(20),
    state: browserCompanionHandoffStateSchema,
    createdAt: z.string().datetime({ offset: true }),
    claimedAt: z.string().datetime({ offset: true }).nullable(),
    deliveredAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const browserCompanionStageResultSchema = z
  .object({
    handoff: browserCompanionHistoryItemSchema,
    browserOpened: z.boolean(),
    browserOpenError: z
      .enum([
        'BROWSER_NOT_FOUND',
        // Persisted CLI action receipts can still contain the Chrome-only v1 values.
        'CHROME_NOT_FOUND',
        'DESTINATION_NOT_SELECTED',
        'PROFILE_NOT_SELECTED',
        'PROFILE_UNAVAILABLE',
        'COMPANION_NOT_INSTALLED',
        'NATIVE_HOST_UNAVAILABLE',
        'LAUNCH_FAILED',
      ])
      .nullable(),
  })
  .strict();

export const browserCompanionOpenInputSchema = z
  .object({
    target: browserCompanionTargetSchema,
  })
  .strict();

export const browserCompanionOpenResultSchema = browserCompanionStageResultSchema
  .pick({ browserOpened: true, browserOpenError: true })
  .strict();

export const browserCompanionProfileSchema = z
  .object({
    directory: chromeProfileDirectorySchema,
    name: z.string().trim().min(1).max(100),
    companionInstalled: z.boolean(),
  })
  .strict();

export const browserCompanionBrowserSchema = z
  .object({
    id: browserCompanionBrowserIdSchema,
    name: z.string().trim().min(1).max(100),
    available: z.boolean(),
    profiles: z.array(browserCompanionProfileSchema).max(100),
  })
  .strict();

export const browserCompanionDestinationSchema = z
  .object({
    browserId: browserCompanionBrowserIdSchema,
    profileDirectory: chromeProfileDirectorySchema,
  })
  .strict();

const browserCompanionRoutesSchema = z
  .object({
    chatgpt: browserCompanionDestinationSchema.nullable(),
    wechat: browserCompanionDestinationSchema.nullable(),
    weibo: browserCompanionDestinationSchema.nullable(),
  })
  .strict();

export const browserCompanionDestinationsResultSchema = z
  .object({
    browsers: z.array(browserCompanionBrowserSchema).max(10),
    routes: browserCompanionRoutesSchema,
  })
  .strict();

export const browserCompanionDestinationSelectInputSchema = browserCompanionDestinationSchema
  .extend({
    target: browserCompanionTargetSchema,
  })
  .strict();

export const browserCompanionHistoryResultSchema = z.array(browserCompanionHistoryItemSchema).max(10_000);

export const browserCompanionDeleteInputSchema = z
  .object({
    handoffIds: z.array(handoffIdSchema).min(1).max(500),
  })
  .strict();

export const browserCompanionDeleteResultSchema = z
  .object({
    deletedHandoffIds: z.array(handoffIdSchema).max(500),
  })
  .strict();

export type BrowserCompanionTarget = z.infer<typeof browserCompanionTargetSchema>;
export type BrowserCompanionBrowserId = z.infer<typeof browserCompanionBrowserIdSchema>;
export type BrowserCompanionSource = z.infer<typeof browserCompanionSourceSchema>;
export type BrowserCompanionContentKind = z.infer<typeof browserCompanionContentKindSchema>;
export type BrowserCompanionHandoffState = z.infer<typeof browserCompanionHandoffStateSchema>;
export type BrowserCompanionStageInput = z.infer<typeof browserCompanionStageInputSchema>;
export type BrowserCompanionHistoryItem = z.infer<typeof browserCompanionHistoryItemSchema>;
export type BrowserCompanionStageResult = z.infer<typeof browserCompanionStageResultSchema>;
export type BrowserCompanionOpenInput = z.infer<typeof browserCompanionOpenInputSchema>;
export type BrowserCompanionOpenResult = z.infer<typeof browserCompanionOpenResultSchema>;
export type BrowserCompanionProfile = z.infer<typeof browserCompanionProfileSchema>;
export type BrowserCompanionBrowser = z.infer<typeof browserCompanionBrowserSchema>;
export type BrowserCompanionDestination = z.infer<typeof browserCompanionDestinationSchema>;
export type BrowserCompanionDestinationsResult = z.infer<typeof browserCompanionDestinationsResultSchema>;
export type BrowserCompanionDestinationSelectInput = z.infer<typeof browserCompanionDestinationSelectInputSchema>;
export type BrowserCompanionBrowserOpenError = NonNullable<BrowserCompanionOpenResult['browserOpenError']>;
export type BrowserCompanionDeleteInput = z.infer<typeof browserCompanionDeleteInputSchema>;
export type BrowserCompanionDeleteResult = z.infer<typeof browserCompanionDeleteResultSchema>;
