import { AiProcessRepository } from '@/main/database/assistant/ai-process-repository';
import { AlbumRepository } from '@/main/database/albums/album-repository';
import { AssetFileRepository } from '@/main/database/assets/asset-file-repository';
import { AssetLifecycleRepository } from '@/main/database/assets/asset-lifecycle-repository';
import { AssetRelationshipRepository } from '@/main/database/assets/asset-relationship-repository';
import { AssistantRunRepository } from '@/main/database/assistant/assistant-run-repository';
import { CodexImageDiscoveryRepository } from '@/main/database/extensions/codex-image-discovery-repository';
import { ContentPackRepository } from '@/main/database/packs/content-pack-repository';
import { CreationImportRepository } from '@/main/database/creations/creation-import-repository';
import { CreationInputStashRepository } from '@/main/database/creations/creation-input-stash-repository';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import { InspirationStashRepository } from '@/main/database/creations/inspiration-stash-repository';
import { SocialPostRepository } from '@/main/database/creations/social-post-repository';
import { ArticleRepository } from '@/main/database/creations/article-repository';
import { CreationRepository } from '@/main/database/creations/creation-repository';
import { CreationOutputPresentationRepository } from '@/main/database/creations/creation-output-presentation-repository';
import { CreatorAgentRepository } from '@/main/database/assistant/creator-agent-repository';
import { DictionaryClassificationRepository } from '@/main/database/dictionary/dictionary-classification-repository';
import { DictionaryMaintenanceRepository } from '@/main/database/dictionary/dictionary-maintenance-repository';
import { DictionaryRepository } from '@/main/database/dictionary/dictionary-repository';
import { DirectionExperimentTaskRepository } from '@/main/database/assistant/direction-experiment-task-repository';
import { ExecutionSnapshotRepository } from '@/main/database/generation/execution-snapshot-repository';
import { ExtensionRepository } from '@/main/database/extensions/extension-repository';
import { FixturePackRepository } from '@/main/database/packs/fixture-pack-repository';
import { GalleryRepository } from '@/main/database/assets/gallery-repository';
import { GenerationJobRepository } from '@/main/database/generation/generation-job-repository';
import { GenerationProcessRepository } from '@/main/database/generation/generation-process-repository';
import { HistoricalTermRecommendationRepository } from '@/main/database/dictionary/historical-term-recommendation-repository';
import { ImageEditRepository } from '@/main/database/generation/image-edit-repository';
import { ImageTransformRepository } from '@/main/database/generation/image-transform-repository';
import { ImportRepository } from '@/main/database/dictionary/import-repository';
import { IntakeRepository } from '@/main/database/creations/intake-repository';
import { KnowledgeDistillationRepository } from '@/main/database/dictionary/knowledge-distillation-repository';
import { LibraryFileViewRepository } from '@/main/database/assets/library-file-view-repository';
import { MaterialAlbumRepository } from '@/main/database/albums/material-album-repository';
import { MaterialMembershipRepository } from '@/main/database/albums/material-membership-repository';
import { MaterialMetadataRepository } from '@/main/database/assets/material-metadata-repository';
import { PackRepository } from '@/main/database/packs/pack-repository';
import { ProviderDescriptionRepository } from '@/main/database/generation/provider-description-repository';
import { RatingRepository } from '@/main/database/assets/rating-repository';
import { LibraryStorage } from '@/main/database/core/storage';
import { StyleExplorationRepository } from '@/main/database/assistant/style-exploration-repository';
import { TermIllustrationRepository } from '@/main/database/dictionary/term-illustration-repository';
import { VideoDocumentRepository } from '@/main/database/video-documents/video-document-repository';
import { WorkbenchRepository } from '@/main/database/generation/workbench-repository';
import { DerivedVisualRepository } from '@/main/database/creations/derived-visual-repository';
import { RecycleBinRepository } from '@/main/database/recovery/recycle-bin-repository';
import { ContentLifecycleRepository } from '@/main/database/recovery/content-lifecycle-repository';

export function createLibraryDatabaseRepositories(storage: LibraryStorage) {
  const dictionary = new DictionaryRepository(storage);
  const termIllustrations = new TermIllustrationRepository(storage, dictionary);
  const dictionaryClassifications = new DictionaryClassificationRepository(storage);
  const imports = new ImportRepository(storage);
  const executionSnapshots = new ExecutionSnapshotRepository(storage);
  const creationImports = new CreationImportRepository(storage, executionSnapshots);
  const creationOutputPresentation = new CreationOutputPresentationRepository(storage);
  const creationItems = new CreationItemRepository(storage);
  const intake = new IntakeRepository(storage, creationImports);
  const videoDocuments = new VideoDocumentRepository(storage);
  const creationInputStashes = new CreationInputStashRepository(storage);
  const inspirationStashes = new InspirationStashRepository(storage);
  const socialPosts = new SocialPostRepository(storage);
  const articles = new ArticleRepository(storage);
  const derivedVisuals = new DerivedVisualRepository(storage, intake, articles, socialPosts, creationItems);
  const creatorAgent = new CreatorAgentRepository(storage);
  const aiProcesses = new AiProcessRepository(storage);
  const creations = new CreationRepository(storage);
  const assistantRuns = new AssistantRunRepository(storage, creations);
  const directionExperimentTasks = new DirectionExperimentTaskRepository(storage);
  const styleExplorations = new StyleExplorationRepository(storage, directionExperimentTasks);
  const extensions = new ExtensionRepository(storage);
  const providerDescriptions = new ProviderDescriptionRepository(storage);
  const imageEdits = new ImageEditRepository(storage);
  const imageTransforms = new ImageTransformRepository(storage);
  const generationJobs = new GenerationJobRepository(storage);
  const generationProcesses = new GenerationProcessRepository(storage);
  const workbench = new WorkbenchRepository(storage, executionSnapshots, generationJobs);
  const codexImageDiscoveries = new CodexImageDiscoveryRepository(storage, creationImports, workbench);
  const ratings = new RatingRepository(storage);
  const gallery = new GalleryRepository(storage);
  const assetFiles = new AssetFileRepository(storage);
  const assetLifecycle = new AssetLifecycleRepository(storage);
  const libraryFileView = new LibraryFileViewRepository(storage);
  const recycleBin = new RecycleBinRepository(storage, () => libraryFileView.synchronizeBeforeObjectPurge());
  const contentLifecycle = new ContentLifecycleRepository(storage, () =>
    libraryFileView.synchronizeBeforeObjectPurge(),
  );
  const assetRelationships = new AssetRelationshipRepository(storage);
  const materialAlbums = new MaterialAlbumRepository(storage);
  const materialMetadata = new MaterialMetadataRepository(storage);
  const knowledgeDistillations = new KnowledgeDistillationRepository(storage, dictionary);
  const historicalTermRecommendations = new HistoricalTermRecommendationRepository(storage);
  const dictionaryMaintenance = new DictionaryMaintenanceRepository(storage);
  const albums = new AlbumRepository(storage);
  const materialMemberships = new MaterialMembershipRepository(storage, albums, materialAlbums, dictionary);
  const packs = new PackRepository(storage);
  const fixturePacks = new FixturePackRepository(storage, packs);
  const contentPacks = new ContentPackRepository(storage, fixturePacks);

  return {
    aiProcesses,
    albums,
    assetFiles,
    assetLifecycle,
    assetRelationships,
    assistantRuns,
    articles,
    codexImageDiscoveries,
    contentPacks,
    contentLifecycle,
    creationImports,
    creationItems,
    creationOutputPresentation,
    creationInputStashes,
    inspirationStashes,
    socialPosts,
    creations,
    creatorAgent,
    dictionary,
    derivedVisuals,
    dictionaryClassifications,
    dictionaryMaintenance,
    db: storage.db,
    directionExperimentTasks,
    executionSnapshots,
    extensions,
    fixturePacks,
    gallery,
    generationJobs,
    generationProcesses,
    historicalTermRecommendations,
    imageEdits,
    imageTransforms,
    imports,
    intake,
    knowledgeDistillations,
    libraryFileView,
    materialAlbums,
    materialMemberships,
    materialMetadata,
    packs,
    providerDescriptions,
    ratings,
    recycleBin,
    storage,
    styleExplorations,
    termIllustrations,
    videoDocuments,
    workbench,
  };
}

export type LibraryDatabaseRepositories = ReturnType<typeof createLibraryDatabaseRepositories>;
