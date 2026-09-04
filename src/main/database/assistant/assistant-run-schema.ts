import type Database from 'better-sqlite3';
import { z } from 'zod';
import { verifyDatabaseForeignKeys } from '@/main/database/core/database-integrity';
import assistantReasoningEffortsSql from '@/main/database/sql/v03-revision-005-assistant-reasoning-efforts.sql?raw';

const legacyEfforts = "'minimal','low','medium','high','xhigh'";
const currentEfforts = `${legacyEfforts},'max','ultra'`;
const assistantRunColumns = [
  'id',
  'scope_kind',
  'scope_id',
  'mode',
  'status',
  'request_json',
  'context_key',
  'context_hash',
  'capability_receipt_json',
  'error_message',
  'created_at',
  'started_at',
  'updated_at',
  'finished_at',
  'dismissed_at',
  'provider_key',
  'model_key',
  'reasoning_effort',
];

export function assistantRunReasoningEffortShape(db: Database.Database) {
  const definition = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assistant_runs'")
    .pluck()
    .get();
  const constraints =
    typeof definition === 'string'
      ? [...definition.replace(/\s+/g, '').matchAll(/CHECK\(reasoning_effortISNULLORreasoning_effortIN\(([^)]+)\)\)/gi)]
      : [];
  if (constraints.length === 1) {
    if (constraints[0][1] === currentEfforts) return 'COMPLETE' as const;
    if (constraints[0][1] === legacyEfforts) return 'LEGACY' as const;
  }
  throw new Error('Unsupported assistant run reasoning-effort constraint');
}

export function ensureAssistantRunReasoningEfforts(db: Database.Database) {
  if (assistantRunReasoningEffortShape(db) === 'COMPLETE') return;
  const columns = z.array(z.object({ name: z.string() })).parse(db.prepare('PRAGMA table_xinfo(assistant_runs)').all());
  const columnNames = new Set(columns.map((column) => column.name));
  if (
    assistantRunColumns.some((name) => !columnNames.has(name)) ||
    columns.some((column) => !assistantRunColumns.includes(column.name) && column.name !== 'result_json')
  ) {
    throw new Error('Unsupported assistant run columns');
  }
  const schemaObjects = z.array(z.object({ sql: z.string() })).parse(
    db
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE tbl_name = 'assistant_runs' AND type IN ('index', 'trigger') AND sql IS NOT NULL
           AND name NOT IN ('idx_assistant_runs_scope', 'idx_assistant_runs_status')`,
      )
      .all(),
  );
  const resultProjection = columnNames.has('result_json') ? 'result_json' : 'NULL AS result_json';
  db.exec(`CREATE TEMP VIEW aiy_assistant_run_migration_source AS
    SELECT ${assistantRunColumns.join(', ')}, ${resultProjection} FROM assistant_runs`);
  db.exec(assistantReasoningEffortsSql);
  for (const object of schemaObjects) db.exec(object.sql);
  verifyDatabaseForeignKeys(db);
}
