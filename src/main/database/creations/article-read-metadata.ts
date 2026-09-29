import type Database from 'better-sqlite3';
import { text, type JsonMap } from '@/main/database/core/values';
import { contentAuthorsMany } from '@/main/database/me/content-authorship';
import { revisionContexts } from '@/main/database/creations/article-write-context';

export function articleReadMetadata(db: Database.Database, rows: JsonMap[]): JsonMap[] {
  const authors = contentAuthorsMany(
    db,
    rows.map((row) => ({ kind: 'ARTICLE', id: text(row.id) })),
  );
  const contexts = revisionContexts(
    db,
    rows.map((row) => text(row.revision_id)),
  );
  return rows.map((row) => ({
    ...row,
    authors: authors.get(`ARTICLE:${row.id}`) ?? [],
    write_context: contexts.get(text(row.revision_id)),
  }));
}
