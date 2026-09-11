import { migrateArticleNoteDrafts } from '@/main/database/creations/article-note-draft-migration';
import { migrateArticleReadableContent } from '@/main/database/creations/article-readable-content-migration';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { articleDraftContent } from '@/shared/article-draft';
import { canonicalArticleContentJson } from '@/shared/contracts/article';
import { inspirationStashContentSchema } from '@/shared/contracts/inspiration-stash';

const marker = 'article-drafts.v1';
type Row = Record<string, string | number | null>;

export function articleDraftShape(db: Database.Database) {
  if (db.prepare('SELECT value FROM app_meta WHERE key = ?').pluck().get(marker) !== 'complete') return false;
  const tables = db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('article_legacy_sources','article_legacy_revisions','creation_items','desktop_note_instances')",
    )
    .all() as { name: string; sql: string }[];
  return (
    tables.length === 4 &&
    !tables
      .find((table) => table.name === 'creation_items')!
      .sql.includes("(phase = 'DRAFT' AND primary_form_id IS NULL)") &&
    /REFERENCES\s+articles\s*\(/i.test(tables.find((table) => table.name === 'desktop_note_instances')!.sql)
  );
}

/** Rebuild known tables in place, retaining columns, indexes and referencing table names. */
function rebuild(db: Database.Database, table: string, transform: (sql: string) => string) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").pluck().get(table) as string;
  if (!sql) throw new Error(`Article draft migration is missing ${table}`);
  const changed = transform(sql);
  if (changed === sql) return;
  const indexes = db
    .prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL")
    .pluck()
    .all(table) as string[];
  const temporary = `${table}_article_draft_migration`;
  const header = /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|\w+)/i;
  db.exec(changed.replace(header, `CREATE TABLE "${temporary}"`));
  const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[])
    .map(({ name }) => `"${name}"`)
    .join(',');
  db.exec(
    `INSERT INTO "${temporary}" (${columns}) SELECT ${columns} FROM "${table}"; DROP TABLE "${table}"; ALTER TABLE "${temporary}" RENAME TO "${table}";`,
  );
  for (const index of indexes) db.exec(index);
}

/** Runs once in the existing schema transaction with foreign keys disabled. Original history remains immutable. */
export function ensureArticleDrafts(db: Database.Database) {
  if (articleDraftShape(db)) return;
  if (db.prepare('SELECT value FROM app_meta WHERE key = ?').pluck().get(marker) === 'complete')
    throw new Error('Article draft schema is incomplete');
  if (!db.inTransaction || db.pragma('foreign_keys', { simple: true }))
    throw new Error('Article drafts require the schema migration transaction');
  rebuild(db, 'creation_items', (sql) =>
    sql.replace("(phase = 'DRAFT' AND primary_form_id IS NULL)", "(phase = 'DRAFT')"),
  );
  db.exec(`CREATE TABLE article_legacy_sources (
    source_id TEXT PRIMARY KEY REFERENCES inspiration_stashes(id), article_id TEXT NOT NULL UNIQUE,
    migrated_at TEXT NOT NULL
  );
  CREATE TABLE article_legacy_revisions (
    revision_id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES inspiration_stashes(id),
    legacy_hash TEXT NOT NULL, article_hash TEXT NOT NULL
  );
  CREATE INDEX article_legacy_revisions_source_hash ON article_legacy_revisions(source_id,legacy_hash);`);
  // Finish each bounded read before writing on this connection. SQLite iterators keep it busy.
  const sources = db.prepare('SELECT * FROM inspiration_stashes WHERE id>? ORDER BY id LIMIT 32');
  const revisions = db.prepare(
    'SELECT * FROM inspiration_stash_revisions WHERE stash_id=? AND revision_no>? ORDER BY revision_no LIMIT 32',
  );
  const insertArticle = db.prepare(
    `INSERT INTO articles(id,album_id,source_inspiration_stash_id,current_revision_id,status,created_at,updated_at,archived_at,deleted_at) VALUES(?,?,NULL,NULL,?,?,?,?,?)`,
  );
  const insertRevision = db.prepare(
    'INSERT INTO article_revisions(id,article_id,revision_no,content_json,content_hash,created_at) VALUES(?,?,?,?,?,?)',
  );
  let sourceCursor = '';
  for (;;) {
    const page = sources.all(sourceCursor) as Row[];
    if (!page.length) break;
    for (const source of page) {
      sourceCursor = String(source.id);
      if (db.prepare('SELECT 1 FROM articles WHERE id=?').get(source.id))
        throw new Error('Legacy article identity collision');
      insertArticle.run(
        source.id,
        source.album_id,
        source.status,
        source.created_at,
        source.updated_at,
        source.archived_at,
        source.deleted_at,
      );
      let latest: Row | undefined;
      const migrateRevision = (revision: Row) => {
        const content = articleDraftContent(
          inspirationStashContentSchema.parse(JSON.parse(String(revision.content_json))),
        );
        const json = canonicalArticleContentJson(content);
        const hash = createHash('sha256').update(json).digest('hex');
        insertRevision.run(revision.id, source.id, revision.revision_no, json, hash, revision.created_at);
        db.prepare('INSERT INTO article_legacy_revisions VALUES(?,?,?,?)').run(
          revision.id,
          source.id,
          revision.content_hash,
          hash,
        );
        latest = revision;
      };
      let revisionCursor = 0;
      for (;;) {
        const revisionPage = revisions.all(source.id, revisionCursor) as Row[];
        if (!revisionPage.length) break;
        for (const revision of revisionPage) {
          migrateRevision(revision);
          revisionCursor = Number(revision.revision_no);
        }
      }
      const purged = String(source.content_hash).startsWith('purged:') && source.deleted_at !== null;
      if (!purged && (!latest || latest.content_hash !== source.content_hash))
        migrateRevision({
          id: ulid(),
          content_json: source.input_json,
          content_hash: source.content_hash,
          revision_no: Number(latest?.revision_no ?? 0) + 1,
          created_at: source.updated_at,
        });
      if (latest) db.prepare('UPDATE articles SET current_revision_id=? WHERE id=?').run(latest.id, source.id);
      db.prepare('INSERT INTO article_legacy_sources VALUES(?,?,?)').run(
        source.id,
        source.id,
        new Date().toISOString(),
      );
    }
  }
  db.exec(`INSERT INTO article_elements(id,article_id,created_at,updated_at)
    SELECT element.element_id, form.entity_id, MIN(revision.created_at), MAX(revision.created_at)
    FROM content_revision_elements element JOIN creation_forms form ON form.id=element.form_id
    JOIN article_revisions revision ON revision.id=element.revision_id
    WHERE form.entity_type='INSPIRATION_STASH' GROUP BY form.entity_id,element.element_id;
  INSERT INTO article_revision_elements(revision_id,article_id,element_id,block_index,node_type,text_fingerprint,preview)
    SELECT element.revision_id, form.entity_id, element.element_id, element.block_index, element.node_type, element.text_fingerprint, element.preview
    FROM content_revision_elements element JOIN creation_forms form ON form.id=element.form_id
    JOIN article_revisions revision ON revision.id=element.revision_id WHERE form.entity_type='INSPIRATION_STASH';`);
  const commentColumns = [
    'id',
    'created_revision_id',
    'status',
    'anchor_kind',
    'start_element_id',
    'start_offset',
    'end_element_id',
    'end_offset',
    'start_block_index',
    'end_block_index',
    'exact_quote',
    'prefix',
    'suffix',
    'created_preview',
    'body',
    'author_id',
    'created_at',
    'updated_at',
    'resolved_at',
  ];
  db.exec(`INSERT INTO article_comments(article_id,${commentColumns.join(',')}) SELECT form.entity_id,${commentColumns.map((column) => `comment.${column}`).join(',')}
    FROM content_comments comment JOIN creation_forms form ON form.id=comment.form_id WHERE form.entity_type='INSPIRATION_STASH';
    INSERT INTO article_comment_replies SELECT reply.* FROM content_comment_replies reply JOIN article_comments comment ON comment.id=reply.comment_id;
    UPDATE creation_forms SET role='ARTICLE', entity_type='ARTICLE' WHERE entity_type='INSPIRATION_STASH';
    UPDATE creation_items SET primary_form_id=(SELECT form.id FROM creation_forms form WHERE form.creation_item_id=creation_items.id AND form.deleted_at IS NULL AND form.role='ARTICLE' ORDER BY form.created_at,form.id LIMIT 1)
      WHERE phase='DRAFT' AND primary_form_id IS NULL;
    UPDATE desktop_note_drafts SET base_hash=COALESCE((SELECT revision.article_hash FROM article_legacy_revisions revision JOIN desktop_note_instances instance ON instance.stash_id=revision.source_id WHERE instance.id=desktop_note_drafts.instance_id AND revision.legacy_hash=desktop_note_drafts.base_hash ORDER BY revision.rowid DESC LIMIT 1),base_hash);
    UPDATE content_editor_drafts SET draft_json=json_set(draft_json,'$.expectedContentHash',COALESCE((SELECT revision.article_hash FROM article_legacy_revisions revision WHERE revision.source_id=content_editor_drafts.source_id AND revision.legacy_hash=json_extract(content_editor_drafts.draft_json,'$.expectedContentHash') ORDER BY revision.rowid DESC LIMIT 1),json_extract(draft_json,'$.expectedContentHash')));`);
  for (const table of [
    'articles',
    'social_post_drafts',
    'desktop_note_instances',
    'content_editor_drafts',
    'codex_content_preferences',
    'codex_content_tasks',
  ]) {
    rebuild(db, table, (sql) => sql.replace(/REFERENCES\s+inspiration_stashes\s*\(/gi, 'REFERENCES articles('));
  }
  db.exec(`INSERT INTO desktop_note_instances(id,stash_id,color,icon,created_at,updated_at)
    SELECT 'article:' || substr(id,5),source_id,color,icon,datetime('now'),datetime('now') FROM desktop_content_pins WHERE source_kind='ARTICLE';
    UPDATE desktop_petal_memberships SET instance_id='article:' || substr(instance_id,5)
      WHERE instance_id IN (SELECT id FROM desktop_content_pins WHERE source_kind='ARTICLE');
    DELETE FROM desktop_content_pins WHERE source_kind='ARTICLE';`);
  db.exec(`UPDATE content_lifecycle_batches SET root_entity_type='ARTICLE' WHERE root_entity_type='INSPIRATION_STASH';
    UPDATE content_lifecycle_batches SET root_subtype='ARTICLE' WHERE root_subtype='INSPIRATION_STASH';
    UPDATE content_lifecycle_batch_members SET entity_type='ARTICLE' WHERE entity_type='INSPIRATION_STASH';
    UPDATE content_lifecycle_batch_members SET parent_entity_type='ARTICLE' WHERE parent_entity_type='INSPIRATION_STASH';
    UPDATE content_lifecycle_batch_members SET subtype='ARTICLE' WHERE subtype='INSPIRATION_STASH';
    UPDATE inspiration_stashes SET deleted_at=COALESCE(deleted_at,datetime('now'));`);
  migrateArticleReadableContent(db);
  migrateArticleNoteDrafts(db);
  const broken = db.pragma('foreign_key_check') as unknown[];
  if (broken.length) throw new Error('Article draft migration would break existing references');
  db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run(marker, 'complete');
}
