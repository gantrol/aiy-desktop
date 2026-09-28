import { z } from 'zod';
import { linkCardTarget } from '@/shared/contracts/link-card';
import { parseAiyDeepLink } from '@/shared/contracts/app-deep-link';

const id = z.string().trim().min(1).max(200);
export const contentAgentSchema = z
  .object({
    application: z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/),
    agentId: id.optional(),
    model: id.optional(),
    threadId: id.optional(),
  })
  .strict();
export const contentAuthorSchema = z.discriminatedUnion('kind', [
  contentAgentSchema.extend({ kind: z.literal('AI') }).strict(),
  z.object({ kind: z.literal('HUMAN'), name: id.optional() }).strict(),
  z.object({ kind: z.literal('THIRD_PARTY'), name: id }).strict(),
  z.object({ kind: z.literal('UNKNOWN') }).strict(),
]);
export const contentSourceSchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .refine((value) => {
        return Boolean(linkCardTarget(value) || parseAiyDeepLink(value));
      }),
    relation: z.enum(['ORIGINAL', 'REFERENCE']),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export const contentOriginSchema = z
  .object({
    authors: z.array(contentAuthorSchema).min(1).max(32),
    sources: z.array(contentSourceSchema).max(100),
  })
  .strict();

/** Caller declarations, not an authentication or user-review signal. */
export const agentProvenanceSchema = contentAgentSchema
  .extend({
    contribution: z.enum(['GENERATED', 'SYNTHESIZED', 'EDITED', 'IMPORTED']).optional(),
    origin: contentOriginSchema.optional(),
    batchId: id.optional(),
  })
  .strict();
export const contentProvenanceSchema = contentOriginSchema
  .extend({
    writer: contentAuthorSchema,
    entry: z.enum(['CLI', 'AIY', 'UNKNOWN']),
    operation: z.enum(['GENERATED', 'SYNTHESIZED', 'EDITED', 'IMPORTED', 'UNKNOWN']),
    requestId: id.optional(),
    batchId: id.optional(),
    baseRevisionId: id.optional(),
  })
  .strict();
export type ContentAuthor = z.infer<typeof contentAuthorSchema>;
export type ContentProvenance = z.infer<typeof contentProvenanceSchema>;
export type AgentProvenance = z.infer<typeof agentProvenanceSchema>;

export function parseContentProvenance(value: unknown): ContentProvenance | undefined {
  if (value == null) return undefined;
  return contentProvenanceSchema.parse(typeof value === 'string' ? JSON.parse(value) : value);
}

export function contentAuthorKey(author: ContentAuthor) {
  return author.kind === 'AI' ? `AI:${author.application}` : author.kind;
}

export function matchesContentAuthor(provenance: ContentProvenance | undefined, filter = 'ALL') {
  return (
    filter === 'ALL' ||
    (provenance?.authors ?? [{ kind: 'UNKNOWN' } as const]).some((author) => contentAuthorKey(author) === filter)
  );
}
