import type Database from 'better-sqlite3';
import sql from '@/main/database/sql/v03-revision-006-article-visual-positions.sql?raw';

export function articleVisualPositionShape(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(article_visual_positions)').all() as { name: string }[];
  const visuals = db.prepare('PRAGMA table_info(derived_visuals)').all() as { name: string }[];
  const hasPosition = visuals.some((column) => column.name === 'position_id');
  if (!columns.length && !hasPosition) return 'ABSENT';
  const definitions = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index'
    AND name IN ('idx_article_visual_positions_article', 'idx_derived_visuals_position')`,
    )
    .all();
  const foreignKeys = db.prepare('PRAGMA foreign_key_list(derived_visuals)').all() as { from: string; table: string }[];
  return hasPosition &&
    ['id', 'article_id', 'source_revision_id', 'anchor_json', 'ever_adopted', 'created_at'].every((name) =>
      columns.some((column) => column.name === name),
    ) &&
    definitions.length === 2 &&
    foreignKeys.some((key) => key.from === 'position_id' && key.table === 'article_visual_positions')
    ? 'COMPLETE'
    : 'PARTIAL';
}

export function ensureArticleVisualPositions(db: Database.Database) {
  const shape = articleVisualPositionShape(db);
  if (shape === 'PARTIAL') throw new Error('Article visual position schema is incomplete');
  if (shape === 'ABSENT') db.exec(sql);
}
