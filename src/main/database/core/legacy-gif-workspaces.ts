import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/** Separate pre-workspace GIFs that generated frames in their own document. */
export function separateLegacyGifWorkspaces(db: Database.Database) {
  const roots = db
    .prepare(
      `SELECT d.id,d.series_id,d.title,d.revision,d.updated_at,
      r.manifest_json,latest.settings_json
    FROM gif_documents d JOIN gif_document_revisions r ON r.document_id=d.id AND r.revision=d.revision
    JOIN gif_generation_runs latest ON latest.id=(SELECT id FROM gif_generation_runs
      WHERE document_id=d.id ORDER BY created_at DESC,rowid DESC LIMIT 1)
    WHERE d.purpose='GIF' AND json_extract(r.manifest_json,'$.motionDocumentId') IS NULL`,
    )
    .all() as {
    id: string;
    series_id: string | null;
    title: string;
    revision: number;
    updated_at: string;
    manifest_json: string;
    settings_json: string;
  }[];
  for (const root of roots) {
    const motionId = randomUUID();
    const revision = root.revision + 1;
    db.prepare(
      `INSERT INTO gif_documents(id,series_id,title,purpose,revision,updated_at)
      VALUES (?,?,?,'MOTION',?,?)`,
    ).run(motionId, root.series_id, root.title, revision, root.updated_at);
    // Preserve every original revision referenced by a generation run.
    db.prepare(
      `INSERT INTO gif_document_revisions(document_id,revision,manifest_json,motion_draft_json,created_at)
      SELECT ?,revision,manifest_json,motion_draft_json,created_at FROM gif_document_revisions WHERE document_id=?`,
    ).run(motionId, root.id);
    db.prepare(
      `INSERT INTO gif_document_assets(document_id,revision,asset_id)
      SELECT ?,revision,asset_id FROM gif_document_assets WHERE document_id=?`,
    ).run(motionId, root.id);
    db.prepare(
      `INSERT INTO gif_document_revisions(document_id,revision,manifest_json,motion_draft_json,created_at)
      SELECT ?,?,json_set(json_remove(?,'$.motionDocumentId','$.generationId'),
        '$.frames',json_array(json_object('id',?,'assetId',json_extract(?,'$.sourceAssetId'),
          'durationMs',100,'sourceRect',NULL)),
        '$.backgroundAssetId',NULL,'$.playback','FORWARD'),NULL,?`,
    ).run(motionId, revision, root.manifest_json, randomUUID(), root.settings_json, root.updated_at);
    db.prepare(
      `INSERT INTO gif_document_assets(document_id,revision,asset_id)
      VALUES (?,?,json_extract(?,'$.sourceAssetId'))`,
    ).run(motionId, revision, root.settings_json);
    db.prepare('UPDATE gif_generation_runs SET document_id=? WHERE document_id=?').run(motionId, root.id);
    db.prepare('UPDATE gif_execution_series SET document_id=? WHERE document_id=?').run(motionId, root.id);
    // Append a linked editor revision; existing exports retain their exact original revision.
    db.prepare(
      `INSERT INTO gif_document_revisions(document_id,revision,manifest_json,motion_draft_json,created_at)
      VALUES (?,?,json_set(?,'$.motionDocumentId',?),NULL,?)`,
    ).run(root.id, revision, root.manifest_json, motionId, root.updated_at);
    db.prepare(
      `INSERT INTO gif_document_assets(document_id,revision,asset_id)
      SELECT document_id,?,asset_id FROM gif_document_assets WHERE document_id=? AND revision=?`,
    ).run(revision, root.id, root.revision);
    db.prepare('UPDATE gif_documents SET revision=? WHERE id=?').run(revision, root.id);
  }
}
