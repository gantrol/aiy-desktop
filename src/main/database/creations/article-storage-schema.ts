import type Database from 'better-sqlite3';
import revision4ArticlesSql from '@/main/database/sql/v03-revision-004-articles.sql?raw';

export type ArticleStorageShape =
  'ABSENT' | 'UNPACKED' | 'PACKED' | 'LEGACY_FLAGS' | 'LEGACY_COMMENT_STATUS' | 'COMPLETE';

function unsupportedSchema(): never {
  throw new Error('Unsupported database schema: AIY 0.3.0 requires its first public release baseline');
}

function tableNames(db: Database.Database) {
  return new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
}

function columnNames(db: Database.Database, table: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
  );
}

function hasPackIndexes(db: Database.Database) {
  const indexes = new Set(
    (
      db
        .prepare(
          `SELECT name FROM sqlite_master
          WHERE type = 'index' AND name IN (?, ?)`,
        )
        .all('idx_article_revision_pack_entry', 'idx_article_revision_packs_article_range') as Array<{
        name: string;
      }>
    ).map((index) => index.name),
  );
  return indexes.has('idx_article_revision_pack_entry') && indexes.has('idx_article_revision_packs_article_range');
}

function hasIndexes(db: Database.Database, names: readonly string[]) {
  const indexes = new Set(
    (
      db
        .prepare(
          `SELECT name FROM sqlite_master
          WHERE type = 'index' AND name IN (${names.map(() => '?').join(', ')})`,
        )
        .all(...names) as Array<{
        name: string;
      }>
    ).map((index) => index.name),
  );
  return names.every((name) => indexes.has(name));
}

function articleCommentStatusShape(db: Database.Database) {
  const definition = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'article_comments'")
    .pluck()
    .get();
  if (typeof definition !== 'string') unsupportedSchema();
  const compactDefinition = definition.replace(/\s+/gu, '').toUpperCase();
  if (compactDefinition.includes("CHECK(STATUSIN('OPEN','RESOLVED','REJECTED'))")) return 'COMPLETE' as const;
  if (compactDefinition.includes("CHECK(STATUSIN('OPEN','RESOLVED'))")) return 'LEGACY_COMMENT_STATUS' as const;
  unsupportedSchema();
}

function elementStorageShape(db: Database.Database, tables: ReadonlySet<string>) {
  const baseTables = ['article_elements', 'article_revision_elements'];
  const basePresent = baseTables.map((table) => tables.has(table));
  const flagsPresent = tables.has('article_element_flags');
  const commentsPresent = tables.has('article_comments');
  const repliesPresent = tables.has('article_comment_replies');
  if (basePresent.every((value) => !value) && !flagsPresent && !commentsPresent && !repliesPresent) return 'ABSENT';
  if (!basePresent.every(Boolean) || commentsPresent !== repliesPresent || (flagsPresent && commentsPresent)) {
    unsupportedSchema();
  }

  const elementColumns = columnNames(db, 'article_elements');
  const placementColumns = columnNames(db, 'article_revision_elements');
  const elementsComplete = ['id', 'article_id', 'created_at', 'updated_at'].every((column) =>
    elementColumns.has(column),
  );
  const placementsComplete = [
    'revision_id',
    'article_id',
    'element_id',
    'block_index',
    'node_type',
    'text_fingerprint',
    'preview',
  ].every((column) => placementColumns.has(column));
  if (!elementsComplete || !placementsComplete || !hasIndexes(db, ['idx_article_revision_elements_element'])) {
    unsupportedSchema();
  }
  if (flagsPresent) {
    const flagColumns = columnNames(db, 'article_element_flags');
    const flagsComplete = [
      'id',
      'article_id',
      'element_id',
      'kind',
      'status',
      'created_revision_id',
      'created_preview',
      'created_at',
      'updated_at',
    ].every((column) => flagColumns.has(column));
    if (flagsComplete && hasIndexes(db, ['idx_article_element_flags_article_status'])) return 'LEGACY_FLAGS';
    unsupportedSchema();
  }
  if (commentsPresent) {
    const commentColumns = columnNames(db, 'article_comments');
    const replyColumns = columnNames(db, 'article_comment_replies');
    const commentsComplete = [
      'id',
      'article_id',
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
    ].every((column) => commentColumns.has(column));
    const repliesComplete = ['id', 'comment_id', 'body', 'author_id', 'created_at', 'updated_at'].every((column) =>
      replyColumns.has(column),
    );
    if (
      commentsComplete &&
      repliesComplete &&
      hasIndexes(db, ['idx_article_comments_article_status', 'idx_article_comment_replies_comment'])
    ) {
      return articleCommentStatusShape(db);
    }
    unsupportedSchema();
  }
  unsupportedSchema();
}

export function articleStorageShape(db: Database.Database): ArticleStorageShape {
  const tables = tableNames(db);
  const articlePresent = tables.has('articles');
  const revisionPresent = tables.has('article_revisions');
  const packPresent = tables.has('article_revision_packs');
  const elementStorage = elementStorageShape(db, tables);
  const elementStoragePresent = elementStorage !== 'ABSENT';
  if (!articlePresent && !revisionPresent && !packPresent && !elementStoragePresent) return 'ABSENT';
  if (!articlePresent || !revisionPresent) unsupportedSchema();

  const articleColumns = columnNames(db, 'articles');
  const revisionColumns = columnNames(db, 'article_revisions');
  const articleRequired = [
    'id',
    'album_id',
    'source_inspiration_stash_id',
    'current_revision_id',
    'status',
    'created_at',
    'updated_at',
    'archived_at',
    'deleted_at',
  ];
  const revisionRequired = ['id', 'article_id', 'revision_no', 'content_json', 'content_hash', 'created_at'];
  if (!articleRequired.every((column) => articleColumns.has(column))) unsupportedSchema();
  if (!revisionRequired.every((column) => revisionColumns.has(column))) unsupportedSchema();

  const hasPackId = revisionColumns.has('content_pack_id');
  const hasPackEntryIndex = revisionColumns.has('content_pack_entry_index');
  if (!packPresent && !hasPackId && !hasPackEntryIndex) {
    if (elementStoragePresent) unsupportedSchema();
    return 'UNPACKED';
  }
  if (!packPresent || !hasPackId || !hasPackEntryIndex) unsupportedSchema();

  const packColumns = columnNames(db, 'article_revision_packs');
  const packRequired = [
    'id',
    'article_id',
    'codec',
    'payload',
    'payload_hash',
    'entry_count',
    'first_revision_no',
    'last_revision_no',
    'uncompressed_bytes',
    'compressed_bytes',
    'created_at',
  ];
  if (!packRequired.every((column) => packColumns.has(column)) || !hasPackIndexes(db)) unsupportedSchema();
  if (elementStorage === 'ABSENT') return 'PACKED';
  return elementStorage;
}

export function ensureArticles(db: Database.Database) {
  if (articleStorageShape(db) === 'ABSENT') db.exec(revision4ArticlesSql);
}
