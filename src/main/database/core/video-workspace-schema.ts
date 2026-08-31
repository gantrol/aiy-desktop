import type Database from 'better-sqlite3';

const currentVideoWorkspaceColumns = [
  {
    table: 'video_assets',
    columns: ['audio_status', 'audio_track_count', 'audio_primary_codec', 'audio_detected_at', 'audio_error_code'],
  },
  { table: 'video_document_generation_runs', columns: ['error_detail_json'] },
] as const;

function columnNames(db: Database.Database, table: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
  );
}

export function assertCurrentVideoWorkspaceColumns(db: Database.Database) {
  for (const requirement of currentVideoWorkspaceColumns) {
    const columns = columnNames(db, requirement.table);
    if (requirement.columns.some((column) => !columns.has(column))) {
      throw new Error('Unsupported database schema: AIY 0.3.0 requires its first public release baseline');
    }
  }
}
