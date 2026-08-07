import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDatabase } from '../../src/main/database';
import { importSyntheticLibrary } from './synthetic-library';

interface FixtureLibraryTemplateOptions {
  prefix: string;
}

export function createFixtureLibraryTemplate(options: FixtureLibraryTemplateOptions) {
  let templateRoot = '';
  let templateDatabasePath = '';
  let sequence = 0;
  const cases: Array<{ database: LibraryDatabase; root: string }> = [];

  return {
    initialize() {
      if (templateRoot) return;
      templateRoot = mkdtempSync(path.join(os.tmpdir(), `${options.prefix}template-`));
      templateDatabasePath = path.join(templateRoot, 'library.sqlite3');
      const database = new LibraryDatabase(templateDatabasePath, templateRoot);
      try {
        database.initialize();
        importSyntheticLibrary(database);
      } finally {
        database.close();
      }
    },

    open() {
      if (!templateRoot) throw new Error('Fixture library template has not been initialized');
      const root = path.join(templateRoot, `case-${++sequence}`);
      mkdirSync(root, { recursive: true });
      const templateObjects = path.join(templateRoot, 'objects');
      if (existsSync(templateObjects)) {
        symlinkSync(templateObjects, path.join(root, 'objects'), 'junction');
      }
      const databasePath = path.join(root, 'library.sqlite3');
      copyFileSync(templateDatabasePath, databasePath);
      const database = new LibraryDatabase(databasePath, root);
      cases.push({ database, root });
      return database;
    },

    reset() {
      for (const entry of cases.splice(0)) {
        try {
          entry.database.close();
        } catch {
          // Individual tests may already have closed the handle.
        }
        rmSync(entry.root, { recursive: true, force: true });
      }
    },

    dispose() {
      this.reset();
      if (templateRoot) rmSync(templateRoot, { recursive: true, force: true });
      templateRoot = '';
      templateDatabasePath = '';
    },
  };
}
