import { createAssistantApi } from '@/main/database/library-database/assistant-api';
import { createAssetLibraryApi } from '@/main/database/library-database/asset-library-api';
import { createCreationImportApi } from '@/main/database/library-database/creation-import-api';
import { createDictionaryApi } from '@/main/database/library-database/dictionary-api';
import { createExtensionPackApi } from '@/main/database/library-database/extension-pack-api';
import { createGenerationApi } from '@/main/database/library-database/generation-api';
import { createIntakeApi } from '@/main/database/library-database/intake-api';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { createVideoDocumentApi } from '@/main/database/library-database/video-document-api';

export function createLibraryDatabaseApi(repositories: LibraryDatabaseRepositories) {
  return {
    ...createExtensionPackApi(repositories),
    ...createDictionaryApi(repositories),
    ...createIntakeApi(repositories),
    ...createVideoDocumentApi(repositories),
    ...createAssistantApi(repositories),
    ...createCreationImportApi(repositories),
    ...createAssetLibraryApi(repositories),
    ...createGenerationApi(repositories),
  };
}

export type LibraryDatabaseApi = ReturnType<typeof createLibraryDatabaseApi>;
