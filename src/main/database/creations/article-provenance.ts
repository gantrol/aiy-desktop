import {
  agentProvenanceSchema,
  contentProvenanceSchema,
  type AgentProvenance,
  type ContentProvenance,
  type ContentAuthor,
  contentOriginSchema,
} from '@/shared/contracts/content-provenance';

export interface ArticleWriteContext {
  entry: 'CLI' | 'AIY';
  requestId: string;
  provenance?: AgentProvenance;
  origin?: import('zod').infer<typeof contentOriginSchema>;
}

function unique<T>(values: T[]) {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

function agentAuthor(declared?: AgentProvenance): ContentAuthor {
  if (!declared) return { kind: 'UNKNOWN' };
  return {
    kind: 'AI',
    application: declared.application,
    ...(declared.agentId ? { agentId: declared.agentId } : {}),
    ...(declared.model ? { model: declared.model } : {}),
    ...(declared.threadId ? { threadId: declared.threadId } : {}),
  };
}

/** Keep prior contributions when editing; UI saves alone do not establish human authorship. */
export function articleProvenance(
  context?: ArticleWriteContext,
  previous?: ContentProvenance,
  baseRevisionId?: string,
): ContentProvenance | undefined {
  if (!context && !previous) return undefined;
  const declared = context?.provenance ? agentProvenanceSchema.parse(context.provenance) : undefined;
  const origin = context?.origin ? contentOriginSchema.parse(context.origin) : declared?.origin;
  const writer = agentAuthor(declared);
  const operation = declared?.contribution ?? (baseRevisionId ? 'EDITED' : 'IMPORTED');
  const contributed = [...(origin?.authors ?? [])];
  if (declared && operation !== 'IMPORTED') contributed.push(writer);
  const authors = unique([
    ...(baseRevisionId ? (previous?.authors ?? [{ kind: 'UNKNOWN' } as const]) : []),
    ...contributed,
  ]);
  return contentProvenanceSchema.parse({
    authors: authors.length ? authors : [{ kind: 'UNKNOWN' }],
    sources: unique([...(previous?.sources ?? []), ...(origin?.sources ?? [])]),
    writer,
    operation,
    entry: context?.entry ?? 'AIY',
    ...(context ? { requestId: context.requestId } : {}),
    ...(declared?.batchId ? { batchId: declared.batchId } : {}),
    ...(baseRevisionId ? { baseRevisionId } : {}),
  });
}
