import { existsSync } from 'node:fs';
import path from 'node:path';
import type { LibraryDatabase } from '@/main/database';

export function installStarterContentPack(database: LibraryDatabase, contentPackPath: string) {
  if (!database.isLibraryEmpty()) {
    throw new Error('The starter content pack can only be imported into an empty library');
  }
  if (!existsSync(path.join(contentPackPath, 'manifest.json'))) {
    throw new Error('The starter content pack is unavailable');
  }
  return database.importContentPack(contentPackPath);
}
