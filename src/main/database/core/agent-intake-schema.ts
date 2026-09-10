import type Database from 'better-sqlite3';
import migrationSql from '@/main/database/sql/v03-revision-005-agent-intake.sql?raw';

export function agentIntakeShape(db: Database.Database) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_intake_receipts'").get();
  if (!table) return 'ABSENT' as const;
  const columns = db.prepare('PRAGMA table_info(agent_intake_receipts)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!['request_id', 'request_hash', 'request_json', 'result_json', 'created_at'].every((name) => names.has(name))) {
    throw new Error('Unsupported agent intake receipt schema');
  }
  return 'COMPLETE' as const;
}

export function ensureAgentIntakeSchema(db: Database.Database) {
  if (agentIntakeShape(db) === 'ABSENT') db.exec(migrationSql);
}
