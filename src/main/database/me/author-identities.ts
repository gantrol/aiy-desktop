import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ContentAuthor } from '@/shared/contracts/content-provenance';
import { authorSummarySchema, type AuthorSummary } from '@/shared/contracts/authorship';

export function authorSummary(db: Database.Database, id: string): AuthorSummary {
  const row = db.prepare('SELECT id,name,kind,application FROM creation_authors WHERE id=?').get(id);
  if (!row) throw new Error('AUTHOR_UNAVAILABLE');
  return authorSummarySchema.parse(row);
}

export function createAuthorIdentity(db: Database.Database, name: string, kind: AuthorSummary['kind'] = null) {
  const id = randomUUID(),
    timestamp = new Date().toISOString();
  db.prepare('INSERT INTO creation_authors(id,name,kind,created_at,updated_at) VALUES(?,?,?,?,?)').run(
    id,
    name,
    kind,
    timestamp,
    timestamp,
  );
  return authorSummary(db, id);
}

/** Names cannot identify people. Callers reuse their scoped mapping for repeated declarations. */
export function resolveDeclaredAuthor(db: Database.Database, author: ContentAuthor): AuthorSummary | null {
  if (author.kind === 'UNKNOWN') return null;
  if (author.kind !== 'AI') {
    if (!author.name) return null;
    return createAuthorIdentity(db, author.name, author.kind === 'HUMAN' ? 'HUMAN' : null);
  }
  const id = randomUUID(),
    timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO creation_authors(id,name,kind,application,created_at,updated_at)
    VALUES(?,'','AI',?,?,?) ON CONFLICT DO NOTHING`,
  ).run(id, author.application, timestamp, timestamp);
  const existing = db.prepare('SELECT id FROM creation_authors WHERE application=?').pluck().get(author.application);
  return authorSummary(db, String(existing));
}
