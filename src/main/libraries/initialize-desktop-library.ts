import type { LibraryDatabase } from '@/main/database';
import type { LibraryDescriptor } from '@/main/libraries/library-registry';
import { backupContentAuthorshipUpgrade } from '@/main/database/me/content-authorship-schema';

export async function initializeDesktopLibrary(database: LibraryDatabase, library: LibraryDescriptor) {
  await backupContentAuthorshipUpgrade(database.db);
  return database.initialize(library.name, library, {
    recoverGenerationRuns: false,
    recoverAssistantRuns: false,
    recoverGifRuns: true,
  });
}
