import { createAssistantApi } from '@/main/database/library-database/assistant-api';
import { createArticleApi } from '@/main/database/library-database/article-api';
import { createAssetLibraryApi } from '@/main/database/library-database/asset-library-api';
import { createCreationImportApi } from '@/main/database/library-database/creation-import-api';
import { createCreationItemApi } from '@/main/database/library-database/creation-item-api';
import { createDictionaryApi } from '@/main/database/library-database/dictionary-api';
import { createExtensionPackApi } from '@/main/database/library-database/extension-pack-api';
import { createGenerationApi } from '@/main/database/library-database/generation-api';
import { createIntakeApi } from '@/main/database/library-database/intake-api';
import { createInspirationApi } from '@/main/database/library-database/inspiration-api';
import { createSocialPostApi } from '@/main/database/library-database/social-post-api';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { createVideoDocumentApi } from '@/main/database/library-database/video-document-api';
import { createDerivedVisualApi } from '@/main/database/library-database/derived-visual-api';

export function createLibraryDatabaseApi(repositories: LibraryDatabaseRepositories) {
  return {
    ...createArticleApi(repositories),
    ...createDerivedVisualApi(repositories),
    ...createExtensionPackApi(repositories),
    ...createDictionaryApi(repositories),
    ...createIntakeApi(repositories),
    ...createInspirationApi(repositories),
    ...createSocialPostApi(repositories),
    ...createVideoDocumentApi(repositories),
    ...createAssistantApi(repositories),
    ...createCreationItemApi(repositories),
    ...createCreationImportApi(repositories),
    ...createAssetLibraryApi(repositories),
    ...createGenerationApi(repositories),
  };
}

export type LibraryDatabaseApi = ReturnType<typeof createLibraryDatabaseApi>;
