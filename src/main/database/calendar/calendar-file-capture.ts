import type Database from 'better-sqlite3';

export interface CalendarCapturedEvent {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  observedAt: string;
  payload?: Record<string, string | number | boolean | null>;
}

/** Consume durable file receipts. Replaying a receipt never creates a second event. */
export function recordCalendarCapturedEvents(db: Database.Database, events: readonly CalendarCapturedEvent[]) {
  db.transaction(() => {
    const insert = db.prepare(`INSERT INTO change_events
      (id,entity_type,entity_id,operation,payload_json,occurred_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO NOTHING`);
    const previous = db.prepare('SELECT entity_type,entity_id,operation,occurred_at FROM change_events WHERE id=?');
    const time = db.prepare(`INSERT INTO calendar_file_event_times(event_id,recorded_at) VALUES(?,?)
      ON CONFLICT(event_id) DO NOTHING`);
    for (const event of events) {
      const id = `calendar:file:${event.id}`;
      const existing = previous.get(id) as
        { entity_type: string; entity_id: string; operation: string; occurred_at: string } | undefined;
      if (existing) {
        if (
          existing.entity_type !== event.entityType ||
          existing.entity_id !== event.entityId ||
          existing.operation !== event.operation ||
          existing.occurred_at !== event.observedAt
        )
          throw new Error('Calendar file receipt identity does not match its recorded event');
        continue;
      }
      insert.run(
        id,
        event.entityType,
        event.entityId,
        event.operation,
        JSON.stringify(event.payload ?? {}),
        event.observedAt,
      );
      time.run(id, new Date().toISOString());
    }
  })();
}
