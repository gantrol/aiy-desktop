import { z } from 'zod';
import { contentSourceSchema } from '@/shared/contracts/content-source';

export const semanticContentSourceSchema = z.object({
  key: z.string(),
  stamp: z.string(),
  source: contentSourceSchema,
  title: z.string(),
  body: z.string().max(250_000),
  state: z.enum(['ready', 'pending', 'limited', 'unavailable']),
  updatedAt: z.string(),
  branchRole: z.string().nullable(),
});
export type SemanticContentSource = z.infer<typeof semanticContentSourceSchema>;

export const contentVectorCommandSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('content-sync-start') }),
  z.object({ op: z.literal('content-sync'), items: z.array(semanticContentSourceSchema).max(8) }),
  z.object({ op: z.literal('content-sync-finish') }),
  z.object({ op: z.literal('content-index'), type: z.string(), retry: z.boolean() }),
  z.object({
    op: z.literal('content-search'),
    query: z.string().max(200),
    type: z.string(),
    offset: z.number().int().nonnegative().max(1_000_000),
    hybrid: z.boolean().optional(),
  }),
]);
