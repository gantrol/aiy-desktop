import type Database from 'better-sqlite3';
import { columnNames, tableNames } from '@/main/database/core/schema-inspection';
import { recordCalendarCapturedEvents } from '@/main/database/calendar/calendar-file-capture';
import type { BrowserCompanionCalendarCapture } from '@/main/browser-companion/protocol';
import type { BrowserCompanionStageInput, BrowserCompanionTarget } from '@/shared/contracts/browser-companion';

const columns = {
  calendar_handoff_sources: ['handoff_id', 'library_id', 'source_type', 'source_id'],
  calendar_file_event_times: ['event_id', 'recorded_at'],
} as const;

export function calendarHandoffCaptureComplete(db: Database.Database) {
  const tables = tableNames(db);
  return (
    Object.entries(columns).every(
      ([table, required]) => tables.has(table) && required.every((column) => columnNames(db, table).has(column)),
    ) &&
    Boolean(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='calendar_file_event_times_recorded'").get(),
    )
  );
}

export function ensureCalendarHandoffCaptureSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS calendar_handoff_sources (
    handoff_id TEXT PRIMARY KEY, library_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('ARTICLE','SOCIAL_POST_DRAFT','CREATION_DRAFT')),
    source_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS calendar_file_event_times (
    event_id TEXT PRIMARY KEY REFERENCES change_events(id), recorded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS calendar_file_event_times_recorded ON calendar_file_event_times(recorded_at,event_id);`);
  if (!calendarHandoffCaptureComplete(db)) throw new Error('Calendar file capture schema is incomplete');
}

/** Validate the host's source before any asynchronous media or handoff writes. */
export function calendarHandoffLibrary(db: Database.Database, source: BrowserCompanionStageInput['source']) {
  const table =
    source.kind === 'article' ? 'articles' : source.kind === 'social-post' ? 'social_post_drafts' : 'creation_drafts';
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND deleted_at IS NULL`).get(source.id))
    throw new Error('Browser handoff source is unavailable in the current library');
  const libraryId = db.prepare('SELECT id FROM local_spaces WHERE singleton_key=1').pluck().get();
  if (typeof libraryId !== 'string' || !libraryId) throw new Error('Browser handoff library is unavailable');
  return libraryId;
}

/** Library identity comes from the staging host; old, unbound files are never assigned to the active space. */
export function recordCalendarHandoffEvents(
  db: Database.Database,
  handoffId: string,
  target: BrowserCompanionTarget,
  capture: BrowserCompanionCalendarCapture,
) {
  const libraryId = db.prepare('SELECT id FROM local_spaces WHERE singleton_key=1').pluck().get();
  if (libraryId !== capture.libraryId) return false;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO calendar_handoff_sources(handoff_id,library_id,source_type,source_id)
      VALUES(?,?,?,?) ON CONFLICT(handoff_id) DO NOTHING`,
    ).run(handoffId, capture.libraryId, capture.sourceType, capture.sourceId);
    const source = db
      .prepare('SELECT library_id,source_type,source_id FROM calendar_handoff_sources WHERE handoff_id=?')
      .get(handoffId) as { library_id: string; source_type: string; source_id: string };
    if (
      source.library_id !== capture.libraryId ||
      source.source_type !== capture.sourceType ||
      source.source_id !== capture.sourceId
    )
      throw new Error('Browser handoff does not match its original calendar source');
    recordCalendarCapturedEvents(
      db,
      capture.events.map((event) => ({
        ...event,
        entityType: 'BROWSER_HANDOFF',
        entityId: handoffId,
        payload: { target },
      })),
    );
  })();
  return true;
}
