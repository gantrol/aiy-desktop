import type Database from 'better-sqlite3';
import { authorDeclaration, type AuthorSummary, type ContentWriteContext } from '@/shared/contracts/authorship';
import type { ContentProvenance } from '@/shared/contracts/content-provenance';
import { contentAuthors } from '@/main/database/me/content-authorship';
import { revisionContexts } from '@/main/database/creations/article-write-context';

/** The public v1 protocol retains its shape. Internal consumers use authors and writeContext directly. */
export function provenanceV1(authors: AuthorSummary[], context?: ContentWriteContext): ContentProvenance | undefined {
  if (!context && !authors.length) return undefined;
  const identity = authorDeclaration(context?.writer ?? null);
  const writer =
    identity.kind === 'AI'
      ? {
          ...identity,
          ...(context?.threadId ? { threadId: context.threadId } : {}),
          ...(context?.agentId ? { agentId: context.agentId } : {}),
          ...(context?.model ? { model: context.model } : {}),
        }
      : identity;
  return {
    authors: authors.length ? authors.map(authorDeclaration) : [{ kind: 'UNKNOWN' }],
    writer,
    entry: context?.entry ?? 'UNKNOWN',
    operation: context?.operation === 'COPIED' ? 'IMPORTED' : (context?.operation ?? 'UNKNOWN'),
    sources: context?.sources ?? [],
    requestId: context?.requestId,
    batchId: context?.batchId,
    baseRevisionId: context?.baseRevisionId,
  };
}

export function readProvenanceV1(db: Database.Database, articleId: string, revisionId: string) {
  return provenanceV1(
    contentAuthors(db, { kind: 'ARTICLE', id: articleId }),
    revisionContexts(db, [revisionId]).get(revisionId),
  );
}
