import type Database from 'better-sqlite3';

function unsupportedSchema(): never {
  throw new Error('Unsupported database schema: AIY 0.3.0 requires its first public release baseline');
}

export function articleDeliveryJobShape(db: Database.Database) {
  const definition = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'article_delivery_jobs'")
    .pluck()
    .get();
  if (definition === undefined) return 'ABSENT' as const;
  if (typeof definition !== 'string') unsupportedSchema();
  const columns = new Set(
    (db.prepare('PRAGMA table_info(article_delivery_jobs)').all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  const required = [
    'id',
    'extension_id',
    'channel_id',
    'space_id',
    'article_id',
    'article_revision_id',
    'article_content_hash',
    'target_slug',
    'target_description',
    'status',
    'attempt_count',
    'result_json',
    'error_code',
    'error_message',
    'retryable',
    'retry_of_job_id',
    'created_at',
    'started_at',
    'completed_at',
    'updated_at',
  ];
  if (!required.every((column) => columns.has(column))) unsupportedSchema();
  const normalizedDefinition = definition.replace(/\s+/g, ' ');
  if (
    !normalizedDefinition.includes("status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')") ||
    !normalizedDefinition.includes('REFERENCES article_revisions(id) ON DELETE RESTRICT')
  ) {
    unsupportedSchema();
  }
  return 'COMPLETE' as const;
}
