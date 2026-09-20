import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { columnNames, tableNames } from '@/main/database/core/schema-inspection';
import {
  calendarViewSchema,
  calendarViewListSchema,
  calendarViewSaveSchema,
  calendarViewDeleteSchema,
  type CalendarView,
  type CalendarViewSaveInput,
  type CalendarViewDeleteInput,
} from '@/shared/calendar-views';

const requiredColumns = ['id', 'name', 'name_key', 'preferences_json', 'revision', 'created_at', 'updated_at'];
export function calendarViewsSchemaComplete(db: Database.Database) {
  return (
    tableNames(db).has('calendar_views') &&
    requiredColumns.every((name) => columnNames(db, 'calendar_views').has(name)) &&
    Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='calendar_views_name'").get())
  );
}
export function ensureCalendarViewsSchema(db: Database.Database) {
  if (
    tableNames(db).has('calendar_views') &&
    !requiredColumns.every((name) => columnNames(db, 'calendar_views').has(name))
  ) {
    throw new Error('Calendar view schema is incomplete');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS calendar_views (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL,
    preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json)),
    revision INTEGER NOT NULL CHECK(revision > 0),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS calendar_views_name ON calendar_views(name_key);`);
}

interface ViewRow {
  id: string;
  name: string;
  preferences_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
function view(row: ViewRow): CalendarView {
  return calendarViewSchema.parse({
    id: row.id,
    name: row.name,
    preferences: JSON.parse(row.preferences_json),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Named views retain display configuration; they never rewrite calendar facts or activity revisions. */
export class CalendarViewRepository {
  constructor(private readonly db: Database.Database) {}
  list() {
    return calendarViewListSchema.parse(
      (this.db.prepare('SELECT * FROM calendar_views ORDER BY name_key,id LIMIT 51').all() as ViewRow[]).map(view),
    );
  }
  save(raw: CalendarViewSaveInput) {
    const input = calendarViewSaveSchema.parse(raw);
    return this.db
      .transaction(() => {
        const current = input.id
          ? (this.db.prepare('SELECT * FROM calendar_views WHERE id=?').get(input.id) as ViewRow | undefined)
          : undefined;
        if (input.id && (!current || current.revision !== input.expectedRevision)) {
          throw new Error('CALENDAR_VIEW_REVISION_CONFLICT');
        }
        if (!current && Number(this.db.prepare('SELECT COUNT(*) FROM calendar_views').pluck().get()) >= 50) {
          throw new Error('CALENDAR_VIEW_LIMIT');
        }
        const normalizedName = input.name.normalize('NFKC').trim();
        if (!normalizedName || normalizedName.length > 100) throw new Error('CALENDAR_VIEW_NAME_INVALID');
        const nameKey = normalizedName.toLowerCase();
        const duplicate = this.db
          .prepare('SELECT id FROM calendar_views WHERE name_key=? AND id<>?')
          .get(nameKey, input.id ?? '');
        if (duplicate) throw new Error('CALENDAR_VIEW_NAME_EXISTS');
        const id = current?.id ?? ulid();
        const at = new Date().toISOString();
        const revision = current ? current.revision + 1 : 1;
        if (!Number.isSafeInteger(revision)) throw new Error('CALENDAR_VIEW_REVISION_LIMIT');
        if (current) {
          const changed = this.db
            .prepare(
              `UPDATE calendar_views SET
          name=?,name_key=?,preferences_json=?,revision=?,updated_at=? WHERE id=? AND revision=?`,
            )
            .run(normalizedName, nameKey, JSON.stringify(input.preferences), revision, at, id, input.expectedRevision!);
          if (changed.changes !== 1) throw new Error('CALENDAR_VIEW_REVISION_CONFLICT');
        } else {
          this.db
            .prepare(
              `INSERT INTO calendar_views
          (id,name,name_key,preferences_json,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,
            )
            .run(id, normalizedName, nameKey, JSON.stringify(input.preferences), revision, at, at);
        }
        return view(this.db.prepare('SELECT * FROM calendar_views WHERE id=?').get(id) as ViewRow);
      })
      .immediate();
  }
  delete(raw: CalendarViewDeleteInput): { deleted: true } {
    const input = calendarViewDeleteSchema.parse(raw);
    return this.db
      .transaction(() => {
        const changed = this.db
          .prepare('DELETE FROM calendar_views WHERE id=? AND revision=?')
          .run(input.id, input.expectedRevision);
        if (changed.changes !== 1) throw new Error('CALENDAR_VIEW_REVISION_CONFLICT');
        return { deleted: true as const };
      })
      .immediate();
  }
}
