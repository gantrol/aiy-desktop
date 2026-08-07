import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeDatabaseSchema } from '../src/main/database/schema';
import baselineSql from '../src/main/database/sql/v03-baseline.sql?raw';

function temporaryDatabase(prefix: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const database = new Database(path.join(root, 'library.sqlite3'));
  return { root, database };
}

describe('database baseline', () => {
  it('loads the first public 0.3.0 baseline directly and remains idempotent', () => {
    const { root, database } = temporaryDatabase('aiy-v030-baseline-');
    try {
      initializeDatabaseSchema(database);
      initializeDatabaseSchema(database);

      expect(database.prepare("SELECT value FROM app_meta WHERE key = 'product_data_baseline'").get()).toEqual({
        value: '0.3.0',
      });
      expect(database.prepare("SELECT value FROM app_meta WHERE key = 'database_schema_revision'").get()).toEqual({
        value: '1',
      });
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get(),
      ).toBeUndefined();
      expect(database.prepare("SELECT key FROM app_meta WHERE key LIKE 'schema_migration_%' LIMIT 1").get()).toBeUndefined();

      for (const table of [
        'term_revision_categories',
        'term_context_profiles',
        'term_context_profile_revisions',
        'word_palette_revision_content_nodes',
        'word_palette_revision_option_contents',
        'word_palette_revision_localizations',
      ]) {
        expect(database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)).toEqual({
          name: table,
        });
      }

      const paletteRevisionColumns = (
        database.prepare('PRAGMA table_info(word_palette_revisions)').all() as Array<{ name: string }>
      ).map((column) => column.name);
      expect(paletteRevisionColumns).toContain('name_locale');
      expect(paletteRevisionColumns).not.toContain('prompt_join_mode');
      expect(paletteRevisionColumns).not.toContain('name_zh');
      expect(database.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      expect(database.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a non-baseline database without modifying it', () => {
    const { root, database } = temporaryDatabase('aiy-unsupported-schema-');
    try {
      database.exec('CREATE TABLE previous_product_data(id TEXT PRIMARY KEY)');

      expect(() => initializeDatabaseSchema(database)).toThrow(
        'Unsupported database schema: AIY 0.3.0 requires its first public release baseline',
      );
      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'previous_product_data'")
          .get(),
      ).toEqual({ name: 'previous_product_data' });
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'").get(),
      ).toBeUndefined();
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects the pre-release baseline without migrating or rewriting it', () => {
    const { root, database } = temporaryDatabase('aiy-pre-release-baseline-');
    try {
      database.exec(baselineSql);
      database.prepare("UPDATE app_meta SET value = '0.3' WHERE key = 'product_data_baseline'").run();

      expect(() => initializeDatabaseSchema(database)).toThrow(
        'Unsupported database schema: AIY 0.3.0 requires its first public release baseline',
      );
      expect(database.prepare("SELECT value FROM app_meta WHERE key = 'product_data_baseline'").get()).toEqual({
        value: '0.3',
      });
      expect(database.prepare("SELECT key FROM app_meta WHERE key LIKE 'schema_migration_%' LIMIT 1").get()).toBeUndefined();
      expect(
        database.prepare("SELECT value FROM app_meta WHERE key = 'database_shutdown_state'").get(),
      ).toBeUndefined();
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
