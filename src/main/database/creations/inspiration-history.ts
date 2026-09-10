import { ulid } from 'ulid';
import type Database from 'better-sqlite3';

export function appendInspirationRevision(
  db: Database.Database,
  stashId: string,
  contentJson: string,
  hash: string,
  createdAt: string,
) {
  const latest = db
    .prepare(
      'SELECT id, content_hash, revision_no FROM inspiration_stash_revisions WHERE stash_id = ? ORDER BY revision_no DESC LIMIT 1',
    )
    .get(stashId) as { id: string; content_hash: string; revision_no: number } | undefined;
  if (latest?.content_hash === hash) return latest.id;
  const id = ulid();
  db.prepare(
    'INSERT INTO inspiration_stash_revisions (id, stash_id, revision_no, content_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, stashId, (latest?.revision_no ?? 0) + 1, contentJson, hash, createdAt);
  return id;
}
