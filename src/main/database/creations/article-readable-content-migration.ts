import type Database from 'better-sqlite3';

/** Consolidate historical key formats without losing ownership of previously generated files. */
export function migrateArticleReadableContent(db: Database.Database) {
  if (!db.inTransaction) throw new Error('Readable article migration requires a transaction');
  const read = db.prepare(
    "SELECT source_key,source_id,files_json FROM readable_content_files WHERE source_kind='INSPIRATION_STASH' AND source_key>? ORDER BY source_key LIMIT 32",
  );
  const merge = db.prepare(`UPDATE readable_content_files SET files_json=(
    SELECT json_group_array(json(value)) FROM (
      SELECT value FROM json_each(readable_content_files.files_json)
      UNION ALL
      SELECT incoming.value FROM json_each(@files) incoming WHERE NOT EXISTS (
        SELECT 1 FROM json_each(readable_content_files.files_json) retained
        WHERE json_extract(retained.value,'$.path')=json_extract(incoming.value,'$.path')
      )
    )
  ),source_kind='ARTICLE',state='PENDING' WHERE source_key=@key`);
  const rename = db.prepare(
    "UPDATE readable_content_files SET source_key=?,source_kind='ARTICLE',state='PENDING' WHERE source_key=?",
  );
  const mergeAssets = db.prepare(`INSERT INTO readable_content_assets(source_key,asset_id,relative_path)
    SELECT ?,asset_id,relative_path FROM readable_content_assets WHERE source_key=?
    ON CONFLICT(source_key,asset_id) DO NOTHING`);
  const removeAssets = db.prepare('DELETE FROM readable_content_assets WHERE source_key=?');
  const remove = db.prepare('DELETE FROM readable_content_files WHERE source_key=?');
  let cursor = '';
  for (;;) {
    const rows = read.all(cursor) as { source_key: string; source_id: string; files_json: string }[];
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.source_key;
      const key = `ARTICLE:${row.source_id}`;
      if (key === row.source_key) {
        rename.run(key, row.source_key);
        continue;
      }
      const merged = merge.run({ key, files: row.files_json }).changes > 0;
      if (!merged) rename.run(key, row.source_key);
      // Child rows use the exact historical key, including any legacy suffix.
      mergeAssets.run(key, row.source_key);
      removeAssets.run(row.source_key);
      if (merged) remove.run(row.source_key);
    }
  }
  db.exec(`INSERT INTO readable_content_jobs(source_kind,source_id,generation,attempts,retry_at)
    SELECT 'ARTICLE',source_id,generation+1,0,0 FROM readable_content_jobs WHERE source_kind='INSPIRATION_STASH'
    ON CONFLICT(source_kind,source_id) DO UPDATE SET
      generation=MAX(readable_content_jobs.generation,excluded.generation)+1,attempts=0,retry_at=0;
    DELETE FROM readable_content_jobs WHERE source_kind='INSPIRATION_STASH';
    DELETE FROM app_meta WHERE key='readable_content_migration_v1';`);
}
