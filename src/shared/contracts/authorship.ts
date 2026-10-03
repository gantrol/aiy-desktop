import { commentCompilationOriginSchema } from '@/shared/contracts/comment-compilation';
import { z } from 'zod';
import { contentSourceSchema, type ContentAuthor } from '@/shared/contracts/content-provenance';

export const authorSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(200),
  kind: z.enum(['HUMAN', 'AI']).nullable(),
  application: z.string().nullable(),
});
export type AuthorSummary = z.infer<typeof authorSummarySchema>;

/** One operation, never an accumulated list of the work's authors. */
export const contentWriteContextSchema = z.object({
  writer: authorSummarySchema.nullable(),
  entry: z.enum(['CLI', 'AIY', 'UNKNOWN']),
  operation: z.enum(['GENERATED', 'SYNTHESIZED', 'EDITED', 'IMPORTED', 'COPIED', 'UNKNOWN']),
  agentId: z.string().optional(),
  model: z.string().optional(),
  threadId: z.string().optional(),
  requestId: z.string().optional(),
  batchId: z.string().optional(),
  baseRevisionId: z.string().optional(),
  sources: z.array(contentSourceSchema).max(100),
  commentCompilation: commentCompilationOriginSchema.optional(),
});
export type ContentWriteContext = z.infer<typeof contentWriteContextSchema>;

/** Serialized v1 declarations remain supported for public responses and immutable event snapshots. */
export function authorDeclaration(author: AuthorSummary | null): ContentAuthor {
  if (!author) return { kind: 'UNKNOWN' };
  if (author.kind === 'AI' && author.application) return { kind: 'AI', application: author.application };
  if (author.kind === 'HUMAN') return { kind: 'HUMAN', ...(author.name ? { name: author.name } : {}) };
  return author.name ? { kind: 'THIRD_PARTY', name: author.name } : { kind: 'UNKNOWN' };
}

export function matchesAuthor(authors: readonly AuthorSummary[], filter = 'ALL') {
  return filter === 'ALL' || (filter === 'UNASSIGNED' ? authors.length === 0 : authors.some((a) => a.id === filter));
}
