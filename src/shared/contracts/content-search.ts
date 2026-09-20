import { z } from 'zod';
import { contentSourceSchema } from '@/shared/contracts/content-source';

export const contentSearchKindSchema = z.enum(['ALL', 'ARTICLE', 'SOCIAL_POST', 'VIDEO_DOCUMENT']);
export const contentLookupInputSchema = z
  .object({
    query: z
      .string()
      .max(200)
      .refine((value) => !value.includes('\0')),
    type: contentSearchKindSchema.default('ALL'),
    offset: z.number().int().min(0).max(1_000_000).default(0),
    snapshot: z.string().max(200).optional(),
    retryUnavailable: z.boolean().default(false),
    advanceIndex: z.boolean().default(true),
  })
  .strict();
export type ContentLookupInput = z.infer<typeof contentLookupInputSchema>;
export const contentLookupResultSchema = z
  .object({
    scope: z.literal('CURRENT_SAVED_DOCUMENTS'),
    snapshot: z.string(),
    reset: z.boolean(),
    coverage: z
      .object({
        total: z.number().int().nonnegative(),
        ready: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
        unavailable: z.number().int().nonnegative(),
        limited: z.number().int().nonnegative(),
      })
      .strict(),
    items: z
      .array(
        z
          .object({
            source: contentSourceSchema,
            title: z.string(),
            preview: z.string(),
            bodyIndexed: z.boolean(),
            updatedAt: z.string(),
            branchRole: z.string().nullable(),
            match: z.enum(['ID', 'TITLE', 'BODY', 'RECENT']),
          })
          .strict(),
      )
      .max(30),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ContentLookupResult = z.infer<typeof contentLookupResultSchema>;
export interface ContentLookupApi {
  lookup(input: z.input<typeof contentLookupInputSchema>): Promise<ContentLookupResult>;
}
