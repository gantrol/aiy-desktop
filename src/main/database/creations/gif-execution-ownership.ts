import type Database from 'better-sqlite3';
import { now } from '@/main/database/core/values';

/** Model executions need prompt snapshots, but never own the source picture's input. */
export function gifExecutionSeries(db: Database.Database, documentId: string): string {
  const existing = db.prepare('SELECT series_id FROM gif_execution_series WHERE document_id=?').pluck().get(documentId);
  if (typeof existing === 'string') return existing;
  const seriesId = `gif:${documentId}`;
  db.transaction(() => {
    const document = db.prepare('SELECT title FROM gif_documents WHERE id=?').get(documentId) as
      { title: string } | undefined;
    if (!document) throw new Error('GIF_ASSET_UNAVAILABLE');
    db.prepare(
      `INSERT OR IGNORE INTO prompt_series
      (id,title,title_locale,current_version_id,created_at,deleted_at) VALUES (?,?,'en',NULL,?,NULL)`,
    ).run(seriesId, document.title, now());
    db.prepare('INSERT OR IGNORE INTO gif_execution_series(document_id,series_id) VALUES (?,?)').run(
      documentId,
      seriesId,
    );
  }).immediate();
  return seriesId;
}

export function isGifExecution(db: Database.Database, runId: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM generation_runs run
    JOIN prompt_versions version ON version.id=run.prompt_version_id
    JOIN gif_execution_series owner ON owner.series_id=version.series_id WHERE run.id=?
    UNION ALL SELECT 1 FROM gif_generation_runs WHERE generation_run_id=? LIMIT 1`,
      )
      .get(runId, runId),
  );
}

/** Move only proven, exclusively internal snapshots. Mixed/user-edited history stays intact. */
export function migrateGifExecutionOwnership(db: Database.Database) {
  db.exec(`INSERT OR IGNORE INTO prompt_series(id,title,title_locale,current_version_id,created_at,deleted_at)
    SELECT 'gif:' || id,title,'en',NULL,updated_at,NULL FROM gif_documents;
    INSERT OR IGNORE INTO gif_execution_series(document_id,series_id)
    SELECT id,'gif:' || id FROM gif_documents;
    CREATE TEMP TABLE gif_owned_versions AS
      SELECT version.id, version.series_id AS source_series_id, MIN(owner.series_id) AS execution_series_id
      FROM prompt_versions version
      JOIN generation_runs run ON run.prompt_version_id=version.id
      JOIN gif_generation_runs task ON task.generation_run_id=run.id
      JOIN gif_execution_series owner ON owner.document_id=task.document_id
      WHERE version.series_id<>owner.series_id
        AND NOT EXISTS (SELECT 1 FROM generation_runs other WHERE other.prompt_version_id=version.id
          AND NOT EXISTS (SELECT 1 FROM gif_generation_runs linked WHERE linked.generation_run_id=other.id))
      GROUP BY version.id HAVING COUNT(DISTINCT owner.series_id)=1;
    UPDATE prompt_series SET current_version_id=(
      SELECT version.id FROM prompt_versions version
      WHERE version.series_id=prompt_series.id AND version.id NOT IN (SELECT id FROM gif_owned_versions)
      ORDER BY version.version_no DESC LIMIT 1)
      WHERE current_version_id IN (SELECT id FROM gif_owned_versions);
    UPDATE prompt_versions SET series_id=(SELECT execution_series_id FROM gif_owned_versions WHERE id=prompt_versions.id)
      WHERE id IN (SELECT id FROM gif_owned_versions);
    UPDATE prompt_series SET current_version_id=(SELECT id FROM prompt_versions
      WHERE series_id=prompt_series.id ORDER BY version_no DESC LIMIT 1)
      WHERE id IN (SELECT execution_series_id FROM gif_owned_versions);
    DROP TABLE gif_owned_versions;`);
}
