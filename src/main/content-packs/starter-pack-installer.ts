import type { LibraryDatabase } from '@/main/database';

export function installStarterContentPack(database: LibraryDatabase, contentPackPath: string) {
  if (!database.isLibraryEmpty()) {
    throw new Error('The starter content pack can only be imported into an empty library');
  }
  return database.importContentPack(contentPackPath);
}
