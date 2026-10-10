import { z } from 'zod';
import type { VideoSearchApi } from '@/shared/contracts/video-search';
import {
  imageIssueInputSchema,
  imageSearchChannelsSchema,
  type ImageIssueResult,
} from '@/shared/contracts/image-search-issues';
import {
  contentLookupInputSchema,
  contentLookupResultSchema,
  contentSearchKindSchema,
} from '@/shared/contracts/content-search';

export const workspaceSearchModeSchema = z.enum(['TEXT', 'SEMANTIC', 'HYBRID']);
export type WorkspaceSearchMode = z.infer<typeof workspaceSearchModeSchema>;
export const workspaceSearchKindSchema = z.enum([...contentSearchKindSchema.options, 'IMAGE']);
export const workspaceSearchLocationSchema = contentLookupInputSchema.pick({ query: true, type: true }).extend({
  type: workspaceSearchKindSchema.default('ALL'),
  mode: workspaceSearchModeSchema.optional(),
  videoIds: z.array(z.string().min(1).max(200)).max(16).optional(),
});
export const imageSearchRequestIdSchema = z.string().uuid();
export const imageSearchDeviceSchema = z.enum(['AUTO', 'CPU', 'GPU']);
export type ImageSearchDevice = z.infer<typeof imageSearchDeviceSchema>;
export const imageSearchExecutionSchema = z
  .object({
    backend: z.enum(['cpu', 'webgpu']).nullable(),
    fallback: z.boolean(),
  })
  .strict();
export type ImageSearchExecution = z.infer<typeof imageSearchExecutionSchema>;
export const imageSearchTitleKindSchema = z.enum(['NAME', 'CREATION', 'DICTIONARY', 'UNTITLED']);
export const imageSearchInputSchema = z
  .object({
    requestId: imageSearchRequestIdSchema,
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !value.includes('\0')),
    offset: z.number().int().min(0).max(1_000_000).default(0),
    snapshot: z.string().max(200).optional(),
    advanceIndex: z.boolean().default(true),
    retryUnavailable: z.boolean().default(false),
    mode: workspaceSearchModeSchema.optional(),
  })
  .strict();
export const imageSearchItemSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string(),
    titleKind: imageSearchTitleKindSchema.default('NAME'),
    createdAt: z.string().default(''),
    score: z.number().min(-1).max(1).nullable(),
    match: z.enum(['EXACT', 'TEXT', 'OCR', 'SEMANTIC']),
    preview: z.string().max(1000).optional(),
    borderline: z.boolean().optional(),
  })
  .strict();
export const imageSearchResultSchema = z
  .object({
    snapshot: z.string(),
    reset: z.boolean(),
    indexError: z.enum(['UNAVAILABLE', 'GPU_UNAVAILABLE']).nullable().default(null),
    warning: z
      .enum(['OCR_UNAVAILABLE', 'OCR_UNSUPPORTED', 'DISABLED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'GPU_UNAVAILABLE'])
      .optional(),
    items: z.array(imageSearchItemSchema).max(30),
    nextOffset: z.number().int().nonnegative().nullable(),
    coverage: z
      .object({
        total: z.number().int().nonnegative(),
        ready: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
        unavailable: z.number().int().nonnegative(),
        limited: z.number().int().nonnegative().default(0),
      })
      .strict(),
    channels: imageSearchChannelsSchema.optional(),
    affected: z.number().int().nonnegative().optional(),
  })
  .strict();
export const imageSearchErrorSchema = z.enum([
  'DISABLED',
  'NOT_CONFIGURED',
  'UNAVAILABLE',
  'BUSY',
  'CANCELLED',
  'CHANGED',
  'GPU_UNAVAILABLE',
  'INVALID_QUERY',
]);
export const imageSearchResponseSchema = z.union([
  z.object({ result: imageSearchResultSchema }).strict(),
  z.object({ error: imageSearchErrorSchema }).strict(),
]);
export type ImageSearchInput = z.infer<typeof imageSearchInputSchema>;
export type ImageSearchItem = z.infer<typeof imageSearchItemSchema>;
export type ImageSearchResult = z.infer<typeof imageSearchResultSchema>;
export type ImageSearchResponse = z.infer<typeof imageSearchResponseSchema>;
export const contentSemanticInputSchema = contentLookupInputSchema.extend({
  requestId: imageSearchRequestIdSchema,
  query: imageSearchInputSchema.shape.query,
  mode: workspaceSearchModeSchema.optional(),
});
export type ContentSemanticInput = z.infer<typeof contentSemanticInputSchema>;
export const contentSemanticResponseSchema = z.union([
  z.object({ result: contentLookupResultSchema }).strict(),
  z.object({ error: imageSearchErrorSchema }).strict(),
]);
export type ContentSemanticResponse = z.infer<typeof contentSemanticResponseSchema>;
export const imageSearchModelStateSchema = z
  .object({
    active: z.boolean(),
    ready: z.boolean(),
    modelReady: z.boolean().optional(),
    runtimeRequired: z.boolean().optional(),
    canDownload: z.boolean(),
    download: z.enum(['IDLE', 'DOWNLOADING', 'READY', 'FAILED']),
    bytes: z.number().nonnegative(),
    total: z.number().nonnegative(),
    device: imageSearchDeviceSchema,
    execution: z
      .object({
        search: imageSearchExecutionSchema,
        index: imageSearchExecutionSchema,
        content: imageSearchExecutionSchema.default({ backend: null, fallback: false }),
        video: imageSearchExecutionSchema.default({ backend: null, fallback: false }),
      })
      .strict(),
  })
  .strict();
export type ImageSearchModelState = z.infer<typeof imageSearchModelStateSchema>;
export interface ImageSearchApi extends VideoSearchApi {
  issues(input: z.input<typeof imageIssueInputSchema>): Promise<ImageIssueResult>;
  modelState(): Promise<ImageSearchModelState>;
  setDevice(device: ImageSearchDevice): Promise<void>;
  downloadModel(): Promise<void>;
  cancelDownload(): Promise<void>;
  lookup(input: z.input<typeof imageSearchInputSchema>): Promise<ImageSearchResponse>;
  lookupMetadata(input: z.input<typeof imageSearchInputSchema>): Promise<ImageSearchResponse>;
  lookupContent(input: z.input<typeof contentSemanticInputSchema>): Promise<ContentSemanticResponse>;
  cancel(requestId: string): Promise<void>;
  inspect(assetId: string): Promise<boolean>;
  configure(locale: 'en' | 'zh'): Promise<boolean>;
}
