import type Database from 'better-sqlite3';
import sql from '@/main/database/sql/v03-revision-006-gif-making.sql?raw';
import { columnNames } from '@/main/database/core/schema-inspection';
import { migrateGifExecutionOwnership } from '@/main/database/creations/gif-execution-ownership';
import {
  animationWorkspaceShape,
  ensureAnimationWorkspaceSchema,
} from '@/main/database/core/animation-workspace-schema';

export function gifMakingShape(db: Database.Database) {
  return (
    animationWorkspaceShape(db) &&
    columnNames(db, 'gif_workspace_state').has('state_json') &&
    columnNames(db, 'gif_frame_groups').has('post_id') &&
    columnNames(db, 'gif_execution_series').has('series_id') &&
    columnNames(db, 'gif_documents').has('revision') &&
    columnNames(db, 'gif_documents').has('purpose') &&
    columnNames(db, 'gif_document_revisions').has('motion_draft_json') &&
    columnNames(db, 'gif_document_revisions').has('manifest_json') &&
    columnNames(db, 'gif_document_assets').has('asset_id') &&
    columnNames(db, 'gif_export_runs').has('encoder') &&
    columnNames(db, 'gif_generation_runs').has('settings_json') &&
    columnNames(db, 'gif_generation_runs').has('audit_json') &&
    columnNames(db, 'gif_generation_assets').has('asset_id')
  );
}
export function ensureGifMakingSchema(db: Database.Database) {
  const migrateOwnership = !columnNames(db, 'gif_execution_series').has('series_id');
  db.exec(sql);
  if (!columnNames(db, 'gif_documents').has('purpose')) {
    db.exec(
      "ALTER TABLE gif_documents ADD COLUMN purpose TEXT NOT NULL DEFAULT 'GIF' CHECK(purpose IN ('GIF','MOTION'))",
    );
    // Previous versions created a one-frame GIF document before generating motion.
    // Classify only untouched source drafts; exported or assembled GIFs remain GIFs.
    db.exec(`UPDATE gif_documents SET purpose='MOTION'
      WHERE EXISTS (SELECT 1 FROM gif_generation_runs g WHERE g.document_id=gif_documents.id)
      AND NOT EXISTS (SELECT 1 FROM gif_export_runs e WHERE e.document_id=gif_documents.id)
      AND EXISTS (SELECT 1 FROM gif_document_revisions r WHERE r.document_id=gif_documents.id
        AND r.revision=gif_documents.revision AND json_array_length(r.manifest_json,'$.frames')=1)`);
  }
  if (!columnNames(db, 'gif_document_revisions').has('motion_draft_json'))
    db.exec('ALTER TABLE gif_document_revisions ADD COLUMN motion_draft_json TEXT');
  if (!columnNames(db, 'gif_generation_runs').has('audit_json'))
    db.exec('ALTER TABLE gif_generation_runs ADD COLUMN audit_json TEXT');
  if (migrateOwnership) migrateGifExecutionOwnership(db);
  ensureAnimationWorkspaceSchema(db);
}
