import type { LibraryDatabase } from '@/main/database';
import type { LibraryDescriptor } from '@/main/libraries/library-registry';
import { backupContentAuthorshipUpgrade } from '@/main/database/me/content-authorship-schema';
import { upgradeSocialPostLibrary } from '@/main/libraries/upgrade-social-post-library';

export async function initializeDesktopLibrary(database: LibraryDatabase, library: LibraryDescriptor) {
  await backupContentAuthorshipUpgrade(database.db);
  const upgrade = await upgradeSocialPostLibrary(database.db);
  const result = database.initialize(library.name, library, {
    recoverGenerationRuns: false,
    recoverAssistantRuns: false,
    recoverGifRuns: true,
  });
  return upgrade ?? result;
}
