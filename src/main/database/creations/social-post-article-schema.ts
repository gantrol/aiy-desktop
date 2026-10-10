import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { socialPostArticleContent } from '@/shared/social-post-article';
import { canonicalArticleContentJson } from '@/shared/contracts/article';
import { migrateSocialPostRelations } from '@/main/database/creations/social-post-article-relations';

const marker = 'social-post-articles.v1';
type Row = Record<string, string | number | null>;

export function socialPostArticleShape(db: Database.Database) {
  return db.prepare('SELECT value FROM app_meta WHERE key=?').pluck().get(marker) === 'complete';
}

/** Additive data upgrade within 0.5.10. Previously executed migration steps remain unchanged. */
export function ensureSocialPostArticles(db: Database.Database) {
  if (socialPostArticleShape(db)) return;
  if (!db.inTransaction || db.pragma('foreign_keys', { simple: true }))
    throw new Error('Social post migration requires the schema migration transaction');
  db.exec(`CREATE TABLE article_legacy_posts (
    post_id TEXT PRIMARY KEY REFERENCES social_post_drafts(id),
    article_id TEXT NOT NULL UNIQUE REFERENCES articles(id)
  );`);
  const sources = db.prepare('SELECT * FROM social_post_drafts WHERE id>? ORDER BY id LIMIT 16');
  const revisions = db.prepare(
    'SELECT * FROM social_post_revisions WHERE draft_id=? AND revision_no>? ORDER BY revision_no LIMIT 16',
  );
  const insertArticle = db.prepare(`INSERT INTO articles
    (id,album_id,source_inspiration_stash_id,current_revision_id,status,created_at,updated_at,archived_at,deleted_at)
    VALUES(?,?,?,NULL,?,?,?,?,?)`);
  const insertRevision = db.prepare(`INSERT INTO article_revisions
    (id,article_id,revision_no,content_json,content_hash,created_at) VALUES(?,?,?,?,?,?)`);
  let cursor = '';
  for (;;) {
    const page = sources.all(cursor) as Row[];
    if (!page.length) break;
    for (const source of page) {
      cursor = String(source.id);
      // Identity collisions abort the whole upgrade; never merge unrelated works.
      insertArticle.run(
        source.id,
        source.album_id,
        source.source_inspiration_stash_id,
        source.status,
        source.created_at,
        source.updated_at,
        source.archived_at,
        source.deleted_at,
      );
      let revisionCursor = 0;
      let currentFound = source.current_revision_id === null;
      for (;;) {
        const page = revisions.all(source.id, revisionCursor) as Row[];
        if (!page.length) break;
        const assets = db
          .prepare(
            `SELECT id,mime_type AS mimeType FROM image_assets WHERE id IN (
          SELECT media.value FROM social_post_revisions revision,json_each(revision.content_json,'$.mediaAssetIds') media
          WHERE revision.id IN (SELECT value FROM json_each(?)))`,
          )
          .all(JSON.stringify(page.map((revision) => revision.id))) as { id: string; mimeType: string }[];
        for (const revision of page) {
          const purged = source.deleted_at !== null && String(revision.content_hash).startsWith('purged:');
          const json = purged
            ? '{}'
            : canonicalArticleContentJson(socialPostArticleContent(JSON.parse(String(revision.content_json)), assets));
          insertRevision.run(
            revision.id,
            source.id,
            revision.revision_no,
            json,
            purged ? revision.content_hash : createHash('sha256').update(json).digest('hex'),
            revision.created_at,
          );
          revisionCursor = Number(revision.revision_no);
          currentFound ||= revision.id === source.current_revision_id;
        }
      }
      if (!currentFound || (!source.deleted_at && source.current_revision_id === null))
        throw new Error('Social post current revision is missing');
      db.prepare('UPDATE articles SET current_revision_id=? WHERE id=?').run(source.current_revision_id, source.id);
      db.prepare('INSERT INTO article_legacy_posts VALUES(?,?)').run(source.id, source.id);
    }
  }
  migrateSocialPostRelations(db);
  // Keep immutable legacy revision payloads for old delivery receipts and fixed snapshots.
  // They no longer appear as independently editable works.
  db.exec(`UPDATE social_post_drafts SET deleted_at=COALESCE(deleted_at,datetime('now'));
    CREATE TRIGGER social_post_drafts_retired_insert BEFORE INSERT ON social_post_drafts
      BEGIN SELECT RAISE(ABORT,'SOCIAL_POST_FORMAT_RETIRED'); END;
    CREATE TRIGGER social_post_revisions_retired_insert BEFORE INSERT ON social_post_revisions
      BEGIN SELECT RAISE(ABORT,'SOCIAL_POST_FORMAT_RETIRED'); END;`);
  if (db.prepare('PRAGMA foreign_key_check').get())
    throw new Error('Social post migration would break existing references');
  db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run(marker, 'complete');
}
