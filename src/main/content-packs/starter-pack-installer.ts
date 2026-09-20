import type { LibraryDatabase } from '@/main/database';

export async function installStarterContentPack(database: LibraryDatabase, contentPackPath: string) {
  if (!database.isLibraryEmpty()) {
    throw new Error('The starter content pack can only be imported into an empty library');
  }
  const [packId] = await database.importBuiltinContentPacks([contentPackPath]);
  return packId!;
}
