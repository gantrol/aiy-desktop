import type Database from 'better-sqlite3';

interface CalendarTrigger {
  name: string;
  table: string;
  event: string;
  when?: string;
  entityType: string;
  entityId: string;
  operation: string;
  eventId?: string;
}

// These lifecycle writes had no recordChange() call. Keep the list explicit and
// small: never record autosaved drafts, window geometry, focus, progress or heartbeats.
const definitions: CalendarTrigger[] = [
  {
    name: 'pin_create',
    table: 'desktop_content_pins',
    event: 'INSERT',
    entityType: 'DESKTOP_CONTENT_PIN',
    entityId: 'NEW.id',
    operation: "'CREATE'",
  },
  {
    name: 'pin_remove',
    table: 'desktop_content_pins',
    event: 'DELETE',
    entityType: 'DESKTOP_CONTENT_PIN',
    entityId: 'OLD.id',
    operation: "'DELETE'",
  },
  {
    name: 'note_create',
    table: 'desktop_note_instances',
    event: 'INSERT',
    entityType: 'DESKTOP_NOTE_INSTANCE',
    entityId: 'NEW.id',
    operation: "'CREATE'",
  },
  {
    name: 'note_remove',
    table: 'desktop_note_instances',
    event: 'DELETE',
    entityType: 'DESKTOP_NOTE_INSTANCE',
    entityId: 'OLD.id',
    operation: "'DELETE'",
  },
  {
    name: 'layer_create',
    table: 'desktop_petal_layers',
    event: 'INSERT',
    entityType: 'PETAL_LAYER',
    entityId: 'NEW.id',
    operation: "'CREATE'",
  },
  {
    name: 'layer_rename',
    table: 'desktop_petal_layers',
    event: 'UPDATE OF name',
    when: 'NEW.name IS NOT OLD.name',
    entityType: 'PETAL_LAYER',
    entityId: 'NEW.id',
    operation: "'RENAME'",
  },
  {
    name: 'layer_remove',
    table: 'desktop_petal_layers',
    event: 'DELETE',
    entityType: 'PETAL_LAYER',
    entityId: 'OLD.id',
    operation: "'DELETE'",
  },
  {
    name: 'membership_move',
    table: 'desktop_petal_memberships',
    event: 'UPDATE OF layer_id',
    when: 'NEW.layer_id IS NOT OLD.layer_id',
    entityType: 'PETAL_MEMBERSHIP',
    entityId: 'NEW.instance_id',
    operation: "'MOVE'",
  },
  // Successful generation completion is already recorded by WorkbenchRunRepository.
  {
    name: 'generation_state',
    table: 'generation_runs',
    event: 'UPDATE OF status',
    when: "NEW.status IS NOT OLD.status AND NEW.status IN ('RUNNING','FAILED','CANCELLED','INTERRUPTED')",
    entityType: 'GENERATION_RUN',
    entityId: 'NEW.id',
    operation: 'NEW.status',
  },
  {
    name: 'process_create',
    table: 'ai_processes',
    event: 'INSERT',
    entityType: 'AI_PROCESS',
    entityId: 'NEW.id',
    operation: "'CREATE'",
  },
  {
    name: 'process_finish',
    table: 'ai_processes',
    event: 'UPDATE OF status',
    when: "NEW.status IS NOT OLD.status AND NEW.status IN ('SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')",
    entityType: 'AI_PROCESS',
    entityId: 'NEW.id',
    operation: 'NEW.status',
  },
  {
    name: 'agent_command_complete',
    table: 'agent_command_requests',
    event: 'INSERT',
    entityType: 'AGENT_COMMAND',
    entityId: 'NEW.id',
    operation: "'COMPLETE'",
  },
  // A prepared CLI job is saved by an explicit command, not by editor autosave.
  {
    name: 'agent_job_create',
    table: 'agent_generation_jobs',
    event: 'INSERT',
    entityType: 'AGENT_GENERATION_JOB',
    entityId: 'NEW.id',
    operation: "'CREATE'",
  },
  {
    name: 'agent_job_start',
    table: 'agent_generation_jobs',
    event: 'UPDATE OF started_at',
    when: 'OLD.started_at IS NULL AND NEW.started_at IS NOT NULL',
    entityType: 'AGENT_GENERATION_JOB',
    entityId: 'NEW.id',
    operation: "'START'",
  },
  // Generation run events already cover creation, retries and status. Capture
  // an active cancellation request separately from the eventual outcome.
  {
    name: 'background_job_cancel_request',
    table: 'background_jobs',
    event: 'UPDATE OF desired_state',
    when: "NEW.desired_state IS NOT OLD.desired_state AND NEW.desired_state='CANCEL' AND NEW.status IN ('QUEUED','RUNNING')",
    entityType: 'BACKGROUND_JOB',
    entityId: 'NEW.id',
    operation: "'CANCEL_REQUESTED'",
  },
  {
    name: 'extension_state',
    table: 'extension_state_events',
    event: 'INSERT',
    when: "NEW.event_kind IN ('DISCOVERED','UPDATED','ENABLED','DISABLED','PERMISSION_GRANTED','PERMISSION_REVOKED','THREAD_BOUND')",
    entityType: 'EXTENSION',
    entityId: 'NEW.extension_id',
    operation: 'NEW.event_kind',
    eventId: "'calendar:extension:' || NEW.id",
  },
  {
    name: 'codex_content_create',
    table: 'codex_content_tasks',
    event: 'INSERT',
    entityType: 'CODEX_CONTENT_TASK',
    entityId: 'NEW.id',
    operation: "'CREATE'",
  },
  {
    name: 'codex_content_state',
    table: 'codex_content_tasks',
    event: 'UPDATE OF status',
    when: "NEW.status IS NOT OLD.status AND NEW.status IN ('STARTING','RUNNING','COLLECTING','COMPLETED','FAILED','INTERRUPTED','COLLECTION_FAILED')",
    entityType: 'CODEX_CONTENT_TASK',
    entityId: 'NEW.id',
    operation: 'NEW.status',
  },
  {
    name: 'gif_generation_create',
    table: 'gif_generation_runs',
    event: 'INSERT',
    entityType: 'GIF_GENERATION_RUN',
    entityId: 'NEW.id',
    operation: "'CREATE'",
  },
  {
    name: 'gif_generation_state',
    table: 'gif_generation_runs',
    event: 'UPDATE OF state',
    when: "NEW.state IS NOT OLD.state AND NEW.state IN ('GENERATING','COMPOSITING','READY','ADOPTED','FAILED','CANCELLED')",
    entityType: 'GIF_GENERATION_RUN',
    entityId: 'NEW.id',
    operation: 'NEW.state',
  },
  {
    name: 'gif_export_create',
    table: 'gif_export_runs',
    event: 'INSERT',
    entityType: 'GIF_EXPORT_RUN',
    entityId: 'NEW.id',
    operation: "'START'",
  },
  {
    name: 'gif_export_state',
    table: 'gif_export_runs',
    event: 'UPDATE OF state',
    when: "NEW.state IS NOT OLD.state AND NEW.state IN ('SUCCEEDED','FAILED','CANCELLED')",
    entityType: 'GIF_EXPORT_RUN',
    entityId: 'NEW.id',
    operation: 'NEW.state',
  },
  {
    name: 'content_reference_create',
    table: 'content_block_references',
    event: 'INSERT',
    entityType: 'CONTENT_REFERENCE',
    entityId: 'NEW.id',
    operation: "'CAPTURE'",
  },
  {
    name: 'article_delivery_running',
    table: 'article_delivery_jobs',
    event: 'UPDATE OF status',
    when: "NEW.status IS NOT OLD.status AND (NEW.status='RUNNING' OR (OLD.status='RUNNING' AND NEW.status='QUEUED'))",
    entityType: 'ARTICLE_DELIVERY_JOB',
    entityId: 'NEW.id',
    operation: "CASE WHEN NEW.status='RUNNING' THEN 'RUNNING' ELSE 'REQUEUE' END",
  },
];

function sourceTables(db: Database.Database) {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
}
export function calendarEventTriggersComplete(db: Database.Database) {
  const tables = sourceTables(db);
  const names = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'calendar_capture_%'").all() as {
        name: string;
      }[]
    ).map((row) => row.name),
  );
  return definitions
    .filter((definition) => tables.has(definition.table))
    .every((definition) => names.has(`calendar_capture_${definition.name}`));
}
export function ensureCalendarEventTriggers(db: Database.Database) {
  const tables = sourceTables(db);
  for (const definition of definitions) {
    if (!tables.has(definition.table)) continue;
    db.exec(`CREATE TRIGGER IF NOT EXISTS calendar_capture_${definition.name} AFTER ${definition.event} ON ${definition.table}
      FOR EACH ROW ${definition.when ? `WHEN ${definition.when}` : ''}
      BEGIN
        INSERT INTO change_events(id,entity_type,entity_id,operation,payload_json,occurred_at)
        VALUES(${definition.eventId ?? "'calendar:' || lower(hex(randomblob(16)))"},'${definition.entityType}',${definition.entityId},${definition.operation},'{}',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END`);
  }
}
