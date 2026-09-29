import type Database from 'better-sqlite3';
import type { CreationFormEntityRef } from '@/shared/contracts/creation-library';
import { authorSummarySchema, type AuthorSummary } from '@/shared/contracts/authorship';

export const authorshipKey = (target: CreationFormEntityRef) => `${target.kind}:${target.id}`;

/** Lists read author summaries in one query, without fetching avatars or article bodies. */
export function contentAuthorsMany(db: Database.Database, targets: readonly CreationFormEntityRef[]) {
  const result = new Map<string, AuthorSummary[]>();
  if (!targets.length) return result;
  const rows = db
    .prepare(
      `SELECT credit.target_type,credit.target_id,author.id,author.name,author.kind,author.application
    FROM json_each(?) selected JOIN content_authors credit
      ON credit.target_type=json_extract(selected.value,'$.kind') AND credit.target_id=json_extract(selected.value,'$.id')
    JOIN creation_authors author ON author.id=credit.author_id
    ORDER BY credit.target_type,credit.target_id,credit.sort_order,credit.author_id`,
    )
    .all(JSON.stringify([...new Map(targets.map((t) => [authorshipKey(t), t])).values()])) as (AuthorSummary & {
    target_type: string;
    target_id: string;
  })[];
  for (const row of rows) {
    const key = `${row.target_type}:${row.target_id}`;
    const authors = result.get(key) ?? [];
    authors.push(authorSummarySchema.parse(row));
    result.set(key, authors);
  }
  return result;
}

export function contentAuthors(db: Database.Database, target: CreationFormEntityRef) {
  return contentAuthorsMany(db, [target]).get(authorshipKey(target)) ?? [];
}

/** Called inside the owning content transaction; no implicit current-user assignment. */
export function initializeContentAuthors(db: Database.Database, target: CreationFormEntityRef, ids: string[] = []) {
  const inserted = db
    .prepare('INSERT OR IGNORE INTO content_authorships(target_type,target_id) VALUES(?,?)')
    .run(target.kind, target.id);
  if (!inserted.changes) return;
  replaceContentAuthors(db, target, ids);
}

export function replaceContentAuthors(db: Database.Database, target: CreationFormEntityRef, ids: string[]) {
  if (new Set(ids).size > 32) throw new Error('AUTHOR_LIMIT');
  db.prepare('DELETE FROM content_authors WHERE target_type=? AND target_id=?').run(target.kind, target.id);
  const insert = db.prepare('INSERT INTO content_authors(target_type,target_id,author_id,sort_order) VALUES(?,?,?,?)');
  [...new Set(ids)].forEach((id, index) => insert.run(target.kind, target.id, id, index));
}

export function copyContentAuthors(
  db: Database.Database,
  source: CreationFormEntityRef,
  target: CreationFormEntityRef,
) {
  initializeContentAuthors(
    db,
    target,
    contentAuthors(db, source).map((author) => author.id),
  );
}
