import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDatabase } from '../../src/main/database';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export function createTestLibrary(prefix = 'aibd-test-library-') {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
  database.initialize();
  let closed = false;

  return {
    root,
    database,
    importReference(name: string, variant: number) {
      const sourcePath = path.join(root, name);
      writeFileSync(sourcePath, Buffer.concat([onePixelPng, Buffer.from([variant & 0xff])]));
      return database.importReference(sourcePath);
    },
    cleanup() {
      if (closed) return;
      closed = true;
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
