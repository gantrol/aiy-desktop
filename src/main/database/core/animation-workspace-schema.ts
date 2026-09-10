import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { columnNames } from '@/main/database/core/schema-inspection';
import { separateLegacyGifWorkspaces } from '@/main/database/core/legacy-gif-workspaces';

function definition(db: Database.Database, table: string) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").pluck().get(table) as string;
}

export function animationWorkspaceShape(db: Database.Database) {
  return (
    columnNames(db, 'gif_documents').has('status') &&
    columnNames(db, 'gif_documents').has('deleted_at') &&
    definition(db, 'creation_forms')?.includes("'GIF_DOCUMENT'") === true
  );
}

/** Called inside the released-schema migration, with foreign keys disabled. */
function extendTable(db: Database.Database, table: string, transform: (sql: string) => string) {
  const sql = definition(db, table);
  if (sql.includes("'GIF_DOCUMENT'")) return;
  const indexes = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL")
    .all(table) as { sql: string }[];
  const temporary = `${table}_animation`;
  const create = transform(sql).replace(/^CREATE TABLE\s+(?:"[^"]+"|\w+)/i, `CREATE TABLE ${temporary}`);
  db.exec(create);
  db.exec(
    `INSERT INTO ${temporary} SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${temporary} RENAME TO ${table}`,
  );
  for (const index of indexes) db.exec(index.sql);
}

export function ensureAnimationWorkspaceSchema(db: Database.Database) {
  for (const column of ['archived_at', 'deleted_at']) {
    if (!columnNames(db, 'gif_documents').has(column)) db.exec(`ALTER TABLE gif_documents ADD COLUMN ${column} TEXT`);
  }
  if (!columnNames(db, 'gif_documents').has('status'))
    db.exec(
      "ALTER TABLE gif_documents ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED'))",
    );
  const legacyForms = !definition(db, 'creation_forms').includes("'GIF_DOCUMENT'");
  extendTable(db, 'creation_forms', (sql) =>
    sql
      .replace(/CHECK\(role IN \(/, "CHECK(role IN ('ANIMATION', ")
      .replace(/CHECK\(entity_type IN \(/, "CHECK(entity_type IN ('GIF_DOCUMENT', ")
      .replace(
        /\(role = 'INSPIRATION'/,
        "(role = 'ANIMATION' AND entity_type = 'GIF_DOCUMENT' AND anchor_key IS NULL) OR (role = 'INSPIRATION'",
      ),
  );
  for (const table of ['content_lifecycle_batches', 'content_lifecycle_batch_members'])
    extendTable(db, table, (sql) => sql.replaceAll("'VIDEO_DOCUMENT'", "'VIDEO_DOCUMENT', 'GIF_DOCUMENT'"));
  if (!legacyForms) return;
  separateLegacyGifWorkspaces(db);
  const orphanMotions = db
    .prepare(
      `SELECT motion.id,motion.series_id,motion.title,motion.updated_at,r.manifest_json
    FROM gif_documents motion JOIN gif_document_revisions r ON r.document_id=motion.id AND r.revision=motion.revision
    WHERE motion.purpose='MOTION' AND NOT EXISTS (SELECT 1 FROM gif_documents editor
      JOIN gif_document_revisions saved ON saved.document_id=editor.id AND saved.revision=editor.revision
      WHERE editor.purpose='GIF' AND json_extract(saved.manifest_json,'$.motionDocumentId')=motion.id)`,
    )
    .all() as { id: string; series_id: string | null; title: string; updated_at: string; manifest_json: string }[];
  const insertDocument = db.prepare(
    "INSERT INTO gif_documents(id,series_id,title,purpose,revision,updated_at) VALUES (?,?,?,'GIF',1,?)",
  );
  const insertRevision = db.prepare(`INSERT INTO gif_document_revisions(document_id,revision,manifest_json,created_at)
    VALUES (?,1,json_set(?,'$.frames',json('[]'),'$.backgroundAssetId',NULL,'$.motionDocumentId',?),?)`);
  for (const motion of orphanMotions) {
    const id = randomUUID();
    insertDocument.run(id, motion.series_id, motion.title, motion.updated_at);
    insertRevision.run(id, motion.manifest_json, motion.id, motion.updated_at);
  }
  db.exec(`CREATE TEMP TABLE animation_owners AS
    SELECT d.id, d.updated_at, (SELECT form.id FROM creation_forms form
      LEFT JOIN derived_visuals visual ON form.entity_type='DERIVED_VISUAL' AND visual.id=form.entity_id
      JOIN creation_items item ON item.id=form.creation_item_id AND item.archived_at IS NULL AND item.deleted_at IS NULL
      WHERE form.deleted_at IS NULL AND ((form.entity_type='PROMPT_SERIES' AND form.entity_id=d.series_id)
        OR visual.prompt_series_id=d.series_id) ORDER BY form.created_at,form.id LIMIT 1) AS source_form_id
    FROM gif_documents d WHERE d.purpose='GIF';
    INSERT INTO creation_items(id,phase,primary_form_id,pinned,created_at,updated_at)
      SELECT 'gif-item:'||id,'ACTIVE','gif-form:'||id,0,updated_at,updated_at FROM animation_owners WHERE source_form_id IS NULL;
    INSERT INTO creation_forms(id,creation_item_id,source_form_id,role,entity_type,entity_id,anchor_key,sort_order,created_at,updated_at)
      SELECT 'gif-form:'||owner.id,COALESCE(source.creation_item_id,'gif-item:'||owner.id),owner.source_form_id,
        'ANIMATION','GIF_DOCUMENT',owner.id,NULL,
        COALESCE((SELECT MAX(sort_order)+1 FROM creation_forms WHERE creation_item_id=source.creation_item_id),0),
        owner.updated_at,owner.updated_at FROM animation_owners owner LEFT JOIN creation_forms source ON source.id=owner.source_form_id;
    DROP TABLE animation_owners;`);
}
