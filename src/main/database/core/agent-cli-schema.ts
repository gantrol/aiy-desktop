import type Database from 'better-sqlite3';

const agentCliTables = ['agent_command_requests', 'agent_generation_jobs', 'agent_generation_job_runs'] as const;

function unsupportedSchema(): never {
  throw new Error('Unsupported database schema: AIY 0.3.0 requires its first public release baseline');
}

function tableNames(db: Database.Database) {
  return new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
        name: string;
      }>
    ).map(({ name }) => name),
  );
}

function columnNames(db: Database.Database, table: string) {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(({ name }) => name));
}

export function agentCliShape(db: Database.Database) {
  const tables = tableNames(db);
  const present = agentCliTables.map((table) => tables.has(table));
  if (present.every((value) => !value)) return 'ABSENT' as const;
  if (!present.every(Boolean)) unsupportedSchema();

  const commandColumns = columnNames(db, 'agent_command_requests');
  const jobColumns = columnNames(db, 'agent_generation_jobs');
  const runColumns = columnNames(db, 'agent_generation_job_runs');
  if (
    !['id', 'command', 'input_hash', 'result_json', 'created_at'].every((column) => commandColumns.has(column)) ||
    !['id', 'draft_json', 'created_at', 'started_at'].every((column) => jobColumns.has(column)) ||
    !['job_id', 'run_id', 'sort_order'].every((column) => runColumns.has(column))
  ) {
    unsupportedSchema();
  }
  return 'COMPLETE' as const;
}
