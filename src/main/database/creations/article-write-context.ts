import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readUserProfile } from '@/main/database/me/user-profile';
import { authorDeclaration, contentWriteContextSchema, type ContentWriteContext } from '@/shared/contracts/authorship';
import type { AgentProvenance, ContentAuthor } from '@/shared/contracts/content-provenance';
import { authorSummary, resolveDeclaredAuthor } from '@/main/database/me/author-identities';

export interface ArticleWriteContext {
  entry: 'CLI' | 'AIY';
  requestId: string;
  provenance?: AgentProvenance;
  actorId?: string;
  operation?: ContentWriteContext['operation'];
  sources?: ContentWriteContext['sources'];
  commentCompilation?: ContentWriteContext['commentCompilation'];
}

/** Only explicit local authoring commands select the current user as the actor. */
export function localArticleWriteContext(db: Database.Database, requestId: string = randomUUID()): ArticleWriteContext {
  return { entry: 'AIY', requestId, actorId: readUserProfile(db).id };
}

export function initialArticleAuthors(db: Database.Database, input?: ArticleWriteContext) {
  if (!input) return [];
  if (input.actorId) return [input.actorId];
  const declared = input.provenance;
  if (!declared) return [];
  const authors: ContentAuthor[] = [...(declared.origin?.authors ?? [])];
  if (declared.contribution === 'GENERATED' || declared.contribution === 'SYNTHESIZED')
    authors.push({ kind: 'AI', ...declared });
  const identities = new Map(
    authors.map((author) => [
      JSON.stringify(author.kind === 'AI' ? { kind: author.kind, application: author.application } : author),
      author,
    ]),
  );
  return [
    ...new Set(
      [...identities.values()].flatMap((author) => {
        const resolved = resolveDeclaredAuthor(db, author);
        return resolved ? [resolved.id] : [];
      }),
    ),
  ];
}

function articleWriteOperation(input?: ArticleWriteContext, baseRevisionId?: string): ContentWriteContext['operation'] {
  return (
    input?.operation ??
    input?.provenance?.contribution ??
    (baseRevisionId ? 'EDITED' : input?.actorId ? 'GENERATED' : 'IMPORTED')
  );
}

export function articleWriteContext(
  db: Database.Database,
  input?: ArticleWriteContext,
  previous?: ContentWriteContext,
  baseRevisionId?: string,
): ContentWriteContext | undefined {
  if (!input && !previous) return undefined;
  const declared = input?.provenance;
  const writer = input?.actorId
    ? authorSummary(db, input.actorId)
    : declared
      ? resolveDeclaredAuthor(db, { kind: 'AI', ...declared })
      : null;
  const sources = [
    ...new Map(
      [...(previous?.sources ?? []), ...(input?.sources ?? []), ...(declared?.origin?.sources ?? [])].map((source) => [
        JSON.stringify(source),
        source,
      ]),
    ).values(),
  ];
  return contentWriteContextSchema.parse({
    writer,
    sources,
    entry: input?.entry ?? 'AIY',
    operation: articleWriteOperation(input, baseRevisionId),
    agentId: declared?.agentId,
    model: declared?.model,
    threadId: declared?.threadId,
    requestId: input?.requestId,
    batchId: declared?.batchId,
    baseRevisionId,
    commentCompilation: input?.commentCompilation ?? previous?.commentCompilation,
  });
}

/** Keep the released calendar's narrow writer snapshot, without duplicating a work-author list. */
export function revisionWriteEvent(context?: ContentWriteContext) {
  return context
    ? {
        writerAuthorId: context.writer?.id ?? null,
        provenance: { writer: authorDeclaration(context.writer), entry: context.entry, operation: context.operation },
      }
    : {};
}

export function saveRevisionContext(db: Database.Database, revisionId: string, context?: ContentWriteContext) {
  if (!context) return;
  const { writer, ...details } = context;
  db.prepare('INSERT INTO article_revision_context(revision_id,writer_author_id,context_json) VALUES(?,?,?)').run(
    revisionId,
    writer?.id ?? null,
    JSON.stringify({ ...details, writerName: writer?.name ?? null }),
  );
}

export function revisionContexts(db: Database.Database, ids: readonly string[]) {
  const result = new Map<string, ContentWriteContext>();
  if (!ids.length) return result;
  const rows = db
    .prepare(
      `SELECT context.*,author.name,author.kind,author.application
    FROM article_revision_context context JOIN json_each(?) selected ON selected.value=context.revision_id
    LEFT JOIN creation_authors author ON author.id=context.writer_author_id`,
    )
    .all(JSON.stringify(ids)) as {
    revision_id: string;
    writer_author_id: string | null;
    context_json: string;
    name: string;
    kind: string | null;
    application: string | null;
  }[];
  for (const row of rows) {
    const data = JSON.parse(row.context_json) as Record<string, unknown>;
    result.set(
      row.revision_id,
      contentWriteContextSchema.parse({
        ...data,
        writer: row.writer_author_id
          ? {
              id: row.writer_author_id,
              name: data.writerName ?? row.name,
              kind: row.kind,
              application: row.application,
            }
          : null,
      }),
    );
  }
  return result;
}
