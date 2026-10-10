import { z } from 'zod';
import { contentLookupResultSchema } from '@/shared/contracts/content-search';
import { imageSearchErrorSchema } from '@/shared/contracts/image-search';

export const selectedVideoIdsSchema = z
  .array(z.string().min(1).max(200))
  .max(16)
  .refine((ids) => new Set(ids).size === ids.length);
export const videoSearchInputSchema = z
  .object({
    requestId: z.string().uuid(),
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !value.includes('\0')),
    // Omitted means all active videos in this space; explicit IDs retain the older bounded scope.
    documentIds: selectedVideoIdsSchema.refine((ids) => ids.length > 0).optional(),
    mode: z.enum(['SEMANTIC', 'HYBRID']),
    advanceIndex: z.boolean().default(false),
    retryUnavailable: z.boolean().default(false),
    offset: z.number().int().min(0).max(990).default(0),
    snapshot: z.string().max(200).optional(),
  })
  .strict();
export const videoSearchItemSchema = z
  .object({
    id: z.string(),
    documentId: z.string(),
    sourceHash: z.string(),
    revision: z.string(),
    title: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    kind: z.enum(['FRAME', 'TRANSCRIPT', 'NOTE']),
    preview: z.string().max(1000),
    score: z.number().finite(),
    borderline: z.boolean().default(false),
    lexicalMatch: z.boolean().default(false),
  })
  .strict();
export const videoSearchResultSchema = contentLookupResultSchema.omit({ items: true }).extend({
  items: z.array(videoSearchItemSchema).max(30),
  indexedFrames: z.number().int().nonnegative(),
  processedMs: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
  relevance: z.enum(['EMPTY', 'BORDERLINE', 'CANDIDATES']).default('EMPTY'),
});
export const videoSearchResponseSchema = z.union([
  z.object({ result: videoSearchResultSchema }).strict(),
  z.object({ error: imageSearchErrorSchema }).strict(),
]);
export const videoSearchOpenInputSchema = videoSearchItemSchema.pick({
  documentId: true,
  sourceHash: true,
  revision: true,
});
export const videoSearchOpenResultSchema = z
  .object({ mediaUrl: z.string().startsWith('aiy-media://asset/') })
  .nullable();
export type VideoSearchInput = z.infer<typeof videoSearchInputSchema>;
export type VideoSearchItem = z.infer<typeof videoSearchItemSchema>;
export type VideoSearchResult = z.infer<typeof videoSearchResultSchema>;
export type VideoSearchResponse = z.infer<typeof videoSearchResponseSchema>;
export interface VideoSearchApi {
  lookupVideo(input: z.input<typeof videoSearchInputSchema>): Promise<VideoSearchResponse>;
  openVideo(input: z.infer<typeof videoSearchOpenInputSchema>): Promise<z.infer<typeof videoSearchOpenResultSchema>>;
}
