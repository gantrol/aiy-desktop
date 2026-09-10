import type Database from 'better-sqlite3';
import sql from '@/main/database/sql/v03-revision-006-petal-board.sql?raw';
import { columnNames, tableNames } from '@/main/database/core/schema-inspection';
const columns = {
  desktop_petal_layers: ['id', 'name', 'color'],
  desktop_content_pins: ['id', 'source_kind', 'source_id', 'color', 'icon'],
  desktop_petal_memberships: ['instance_id', 'layer_id'],
};
export function petalBoardShape(db: Database.Database) {
  const tables = tableNames(db);
  const present = Object.keys(columns).filter((table) => tables.has(table));
  if (!present.length) return 'ABSENT';
  if (
    present.length !== 3 ||
    !Object.entries(columns).every(([table, required]) => {
      const actual = columnNames(db, table);
      return required.every((column) => actual.has(column));
    })
  )
    return 'PARTIAL';
  const definition = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='desktop_content_pins'")
    .pluck()
    .get() as string;
  const kinds = definition
    .match(/CHECK\s*\(\s*source_kind\s+IN\s*\(([^)]+)\)\s*\)/i)?.[1]
    .replace(/\s/g, '')
    .split(',')
    .sort()
    .join(',');
  if (kinds === "'ALBUM','ARTICLE','IMAGE','MATERIAL_ALBUM','SOCIAL_POST'") return 'COMPLETE';
  if (kinds === "'ARTICLE','IMAGE','SOCIAL_POST'") return 'LEGACY';
  return 'PARTIAL';
}
export function ensurePetalBoardSchema(db: Database.Database) {
  const shape = petalBoardShape(db);
  if (shape === 'COMPLETE') return;
  if (shape === 'PARTIAL') throw new Error('Petal board schema is incomplete');
  db.transaction(() => {
    if (shape === 'LEGACY') db.exec('ALTER TABLE desktop_content_pins RENAME TO desktop_content_pins_legacy');
    db.exec(sql);
    if (shape === 'LEGACY')
      db.exec(`
      INSERT INTO desktop_content_pins(id,source_kind,source_id,color,icon)
      SELECT id,source_kind,source_id,color,icon FROM desktop_content_pins_legacy;
      DROP TABLE desktop_content_pins_legacy;
    `);
    if (petalBoardShape(db) !== 'COMPLETE') throw new Error('Petal board migration did not complete');
  })();
}
