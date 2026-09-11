import type { RecordedLibraryChange } from '@/main/database/core/storage';
import type { ContentSource } from '@/shared/contracts/content-library';
import type Database from 'better-sqlite3';

export const readableSourceTables = {
  ARTICLE: 'articles',
  SOCIAL_POST: 'social_post_drafts',
  INSPIRATION_STASH: 'articles',
  VIDEO_DOCUMENT: 'documents',
} as const;
type SourceRow = { source_kind: ContentSource['kind']; source_id: string };
export type ReadableContentJob = SourceRow & { generation: number; attempts: number };

/** Only metadata enters this durable queue. Content hydration happens one document at a time. */
export class ReadableContentQueue {
  constructor(private readonly db: Database.Database) {}
  unavailable(job: ReadableContentJob) {
    this.db
      .prepare(
        'UPDATE readable_content_jobs SET attempts = 3 WHERE source_kind = ? AND source_id = ? AND generation = ?',
      )
      .run(job.source_kind, job.source_id, job.generation);
  }
  resume() {
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO readable_content_jobs(source_kind, source_id) SELECT source_kind, source_id FROM readable_content_files WHERE state IN ('PENDING', 'ERROR') ON CONFLICT(source_kind, source_id) DO NOTHING",
        )
        .run();
      for (const [kind, table] of Object.entries(readableSourceTables).filter(
        ([kind]) => kind !== 'INSPIRATION_STASH',
      )) {
        this.db
          .prepare(
            `INSERT INTO readable_content_jobs(source_kind, source_id) SELECT f.source_kind, f.source_id FROM readable_content_files f LEFT JOIN ${table} s ON s.id = f.source_id WHERE f.source_kind = ? AND f.state <> 'RETIRED' AND (s.id IS NULL OR s.deleted_at IS NOT NULL OR s.status <> 'ACTIVE') ON CONFLICT(source_kind, source_id) DO NOTHING`,
          )
          .run(kind);
      }
    })();
  }
  enqueue(source: ContentSource) {
    const kind = source.kind === 'INSPIRATION_STASH' ? 'ARTICLE' : source.kind;
    this.db
      .prepare(
        'INSERT INTO readable_content_jobs(source_kind, source_id) VALUES (?, ?) ON CONFLICT(source_kind, source_id) DO UPDATE SET generation = generation + 1, attempts = 0, retry_at = 0',
      )
      .run(kind, source.id);
  }
  changed(changes: readonly RecordedLibraryChange[]) {
    const sources = new Map<string, ContentSource>();
    const add = (kind: string, id: string) => {
      if (kind === 'INSPIRATION_STASH') kind = 'ARTICLE';
      if (kind in readableSourceTables) sources.set(`${kind}:${id}`, { kind: kind as ContentSource['kind'], id });
    };
    const item = (id: string) => {
      const rows = this.db
        .prepare('SELECT entity_type, entity_id FROM creation_forms WHERE creation_item_id = ?')
        .all(id) as { entity_type: string; entity_id: string }[];
      for (const row of rows) add(row.entity_type, row.entity_id);
    };
    const album = (id: string) => {
      const rows = this.db
        .prepare(
          `WITH RECURSIVE affected(id) AS (SELECT ? UNION SELECT m.target_id FROM album_members m JOIN affected a ON m.album_id = a.id WHERE m.target_type = 'ALBUM') SELECT source_kind, source_id FROM readable_content_files WHERE album_id IN (SELECT id FROM affected)`,
        )
        .all(id) as SourceRow[];
      for (const row of rows) add(row.source_kind, row.source_id);
    };
    for (const change of changes) {
      const kind = change.entityType;
      if (kind === 'DOCUMENT') add('VIDEO_DOCUMENT', change.entityId);
      else if (kind in readableSourceTables) add(kind, change.entityId);
      else if (kind === 'ALBUM') album(change.entityId);
      else if (kind === 'CREATION_ITEM') item(change.entityId);
      else if (kind === 'CREATION_FORM') {
        const form = this.db
          .prepare('SELECT entity_type, entity_id FROM creation_forms WHERE id = ?')
          .get(change.entityId) as { entity_type: string; entity_id: string } | undefined;
        if (form) add(form.entity_type, form.entity_id);
      } else if (kind === 'ALBUM_MEMBER') {
        const member = this.db
          .prepare('SELECT target_type, target_id FROM album_members WHERE id = ?')
          .get(change.entityId) as { target_type: string; target_id: string } | undefined;
        if (member?.target_type === 'CREATION_ITEM') item(member.target_id);
        else if (member?.target_type === 'ALBUM') album(member.target_id);
      }
    }
    this.db.transaction(() => {
      for (const source of sources.values()) this.enqueue(source);
    })();
  }
  next(): ReadableContentJob | undefined {
    let job = this.db
      .prepare(
        'SELECT * FROM readable_content_jobs WHERE attempts < 3 AND retry_at <= ? ORDER BY retry_at, source_kind, source_id LIMIT 1',
      )
      .get(Date.now()) as ReadableContentJob | undefined;
    if (job) return job;
    this.migrateOne();
    job = this.db
      .prepare(
        'SELECT * FROM readable_content_jobs WHERE attempts < 3 AND retry_at <= ? ORDER BY retry_at, source_kind, source_id LIMIT 1',
      )
      .get(Date.now()) as ReadableContentJob | undefined;
    return job;
  }
  private migrateOne() {
    this.db.transaction(() => {
      const key = 'readable_content_migration_v1';
      const saved = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
        { value: string } | undefined;
      if (saved?.value === 'COMPLETE') return;
      const row = this.db
        .prepare(
          `SELECT * FROM (${Object.entries(readableSourceTables)
            .filter(([kind]) => kind !== 'INSPIRATION_STASH')
            .map(
              ([kind, table]) =>
                `SELECT '${kind}' kind, s.id, '${kind}:' || s.id cursor FROM ${table} s WHERE s.deleted_at IS NULL AND s.status = 'ACTIVE' AND NOT EXISTS(SELECT 1 FROM readable_content_files f WHERE f.source_key = '${kind}:' || s.id AND f.state = 'ACTIVE' AND f.updated_at >= s.updated_at) AND NOT EXISTS(SELECT 1 FROM readable_content_jobs j WHERE j.source_kind = '${kind}' AND j.source_id = s.id)`,
            )
            .join(' UNION ALL ')}) WHERE cursor > ? ORDER BY cursor LIMIT 1`,
        )
        .get(saved?.value ?? '') as { kind: ContentSource['kind']; id: string; cursor: string } | undefined;
      // Advance only after the same transaction has retained the work, including failures.
      if (row) this.enqueue(row);
      this.db
        .prepare('INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, row?.cursor ?? 'COMPLETE');
    })();
  }
  complete(job: ReadableContentJob) {
    this.db
      .prepare('DELETE FROM readable_content_jobs WHERE source_kind = ? AND source_id = ? AND generation = ?')
      .run(job.source_kind, job.source_id, job.generation);
  }
  failed(job: ReadableContentJob) {
    this.db
      .prepare(
        'UPDATE readable_content_jobs SET attempts = attempts + 1, retry_at = ? WHERE source_kind = ? AND source_id = ? AND generation = ?',
      )
      .run(Date.now() + 15_000 * (job.attempts + 1), job.source_kind, job.source_id, job.generation);
  }
  hasWork() {
    return Boolean(this.db.prepare('SELECT 1 FROM readable_content_jobs WHERE attempts < 3 LIMIT 1').get());
  }
}
