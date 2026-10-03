import type Database from 'better-sqlite3';
import type { CalendarItem } from '@/shared/contracts/calendar';

/** Read only retained revision identities for this page; content is loaded when opened. */
export function attachCalendarContentRevisions(db: Database.Database, items: CalendarItem[], knownAt?: string) {
  const eventIds = items
    .filter((item) => item.entity?.available && item.changes[0]?.operation !== 'CORRECT')
    .map((item) => item.id);
  if (!eventIds.length) return;
  const rows = db
    .prepare(
      `SELECT e.id event_id,r.article_id,r.id revision_id,r.revision_no
      FROM change_events e
      JOIN article_revisions r ON r.id=CASE
        WHEN e.entity_type='ARTICLE_REVISION' THEN e.entity_id
        WHEN e.entity_type IN ('ARTICLE','INSPIRATION_STASH') THEN json_extract(e.payload_json,'$.revisionId') END
      JOIN articles a ON a.id=r.article_id AND a.deleted_at IS NULL
      WHERE e.id IN (SELECT value FROM json_each(?))
        AND (e.entity_type='ARTICLE_REVISION' OR e.entity_id=r.article_id)
        AND (? IS NULL OR r.created_at<=?)`,
    )
    .all(JSON.stringify(eventIds), knownAt ?? null, knownAt ?? null) as {
    event_id: string;
    article_id: string;
    revision_id: string;
    revision_no: number;
  }[];
  const revisions = new Map(rows.map((row) => [row.event_id, row]));
  for (const item of items) {
    const revision = revisions.get(item.id);
    if (revision && item.changes[0]?.operation !== 'CORRECT') {
      item.contentRevision = {
        articleId: revision.article_id,
        revisionId: revision.revision_id,
        revisionNo: revision.revision_no,
      };
    }
  }
}
