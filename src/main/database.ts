import type {
  AddTermMediaInput,
  AddMaterialsToDestinationsInput,
  AlbumCreationDefaultsUpdateInput,
  AlbumCreateFromMaterialsInput,
  AnnotationInput,
  AnnotationDto,
  AnnotationStatusInput,
  AnnotationUpdateInput,
  AssistantActivityPhase,
  AssistantCapabilityReceiptDto,
  AssistantProposalAdoptionInput,
  AssistantReasoningEffort,
  CreateMaterialCollectionFromSourceInput,
  CreateWordPaletteInput,
  CreatorImageImportContext,
  CreatorImageImportInput,
  CreatorAgentAssistInput,
  CreatorAgentChatInput,
  CreationDraftSaveInput,
  CreationDraftStartInput,
  CreationDraftCommitInput,
  CreationInputStashCreateInput,
  CodexAssistResult,
  CodexImageDiscoveryFilter,
  CodexTaskReferenceDto,
  CreatorAgentScope,
  DeletePromptSeriesInput,
  DictionaryMaintenanceCreateInput,
  DictionaryMaintenanceListInput,
  DictionaryClassificationCreateInput,
  DictionaryClassificationMergeInput,
  DictionaryClassificationMoveInput,
  DictionaryClassificationReorderInput,
  DictionaryClassificationRestoreSourceInput,
  DictionaryClassificationSetStateInput,
  DictionaryClassificationTermsInput,
  DictionaryClassificationUpdateInput,
  DictionaryPageInput,
  DictionarySearchInput,
  DictionaryScopeResolveInput,
  GenerationInput,
  GenerationErrorDetailsDto,
  ImageGenerationRouteDto,
  ExtensionManifestDto,
  ExternalMaterialMetadataUpdateInput,
  FacetSystemRole,
  GalleryListInput,
  HistoricalTermRecommendationCreateInput,
  HistoricalTermRecommendationListInput,
  ImageRatingDimension,
  IntakeCommitInput,
  ImportedCreationOutputUpdateInput,
  KnowledgeDistillationAcceptInput,
  KnowledgeDistillationCreateInput,
  Locale,
  NewExternalCreationImportInput,
  MaterialAlbumAddManyInput,
  MaterialAlbumCreateInput,
  MaterialAlbumListInput,
  MaterialAlbumRemoveInput,
  MaterialAlbumRenameInput,
  MaterialSelectionTargetInput,
  NewTermInput,
  AlbumAddMembersInput,
  AlbumCreateInput,
  AlbumMoveInput,
  AlbumMoveSeriesInput,
  AlbumRemoveMembersInput,
  AlbumRenameInput,
  AlbumReorderMembersInput,
  SidebarRootReorderInput,
  AlbumSetPinnedInput,
  AlbumSetArchivedInput,
  AssetFileRevealContext,
  AssetFileRevealTargetContext,
  PromptCommonInputDto,
  ProviderReturnedDescriptionInput,
  RenameCreationGroupInput,
  RenamePromptSeriesInput,
  ReorderTermMediaInput,
  StyleExplorationStartInput,
  TermDraftInput,
  TermListItem,
  UpdateWordPaletteInput,
} from '@/shared/contracts';
import { emptyAlbumCreationDefaults } from '@/shared/album-creation-defaults';
import { AssistantRunRepository } from '@/main/database/assistant-run-repository';
import { DictionaryRepository } from '@/main/database/dictionary-repository';
import { DictionaryClassificationRepository } from '@/main/database/dictionary-classification-repository';
import { AssetRelationshipRepository } from '@/main/database/asset-relationship-repository';
import { AssetFileRepository } from '@/main/database/asset-file-repository';
import { AssetLifecycleRepository } from '@/main/database/asset-lifecycle-repository';
import { LibraryFileViewRepository } from '@/main/database/library-file-view-repository';
import { ExecutionSnapshotRepository } from '@/main/database/execution-snapshot-repository';
import {
  ExtensionRepository,
  type ExtensionReconcileEntry,
  type ExtensionThreadScopeKind,
} from '@/main/database/extension-repository';
import { ProviderDescriptionRepository } from '@/main/database/provider-description-repository';
import { ImageEditRepository, type PersistedImageEditMode } from '@/main/database/image-edit-repository';
import { ImageTransformRepository, type ImageCropStoredCommitInput } from '@/main/database/image-transform-repository';
import { CreationImportRepository, type StoredCreatorImage } from '@/main/database/creation-import-repository';
import { CreationRepository } from '@/main/database/creation-repository';
import { CreationInputStashRepository } from '@/main/database/creation-input-stash-repository';
import {
  CodexImageDiscoveryRepository,
  type CodexImageDiscoveryScanSnapshot,
  type CodexImageScanEntry,
} from '@/main/database/codex-image-discovery-repository';
import { CreatorAgentRepository } from '@/main/database/creator-agent-repository';
import { ContentPackRepository } from '@/main/database/content-pack-repository';
import { FixturePackRepository } from '@/main/database/fixture-pack-repository';
import type { FixturePackProfile } from '@/main/database/fixture-pack-profile';
import type { FixturePackSourcePaths } from '@/main/database/fixture-pack-source';
import { assignFacetSystemRoles } from '@/main/database/facet-system-roles';
import { reconcileFixture } from '@/main/database/fixture-loader';
import { ImportRepository } from '@/main/database/import-repository';
import { IntakeRepository } from '@/main/database/intake-repository';
import { GalleryRepository } from '@/main/database/gallery-repository';
import { GenerationJobRepository, type GenerationProviderAcceptance } from '@/main/database/generation-job-repository';
import { MaterialAlbumRepository } from '@/main/database/material-album-repository';
import { MaterialMetadataRepository } from '@/main/database/material-metadata-repository';
import { KnowledgeDistillationRepository } from '@/main/database/knowledge-distillation-repository';
import { HistoricalTermRecommendationRepository } from '@/main/database/historical-term-recommendation-repository';
import { DictionaryMaintenanceRepository } from '@/main/database/dictionary-maintenance-repository';
import { DirectionExperimentTaskRepository } from '@/main/database/direction-experiment-task-repository';
import { AlbumRepository } from '@/main/database/album-repository';
import { MaterialMembershipRepository } from '@/main/database/material-membership-repository';
import {
  StyleExplorationRepository,
  type CreateStyleExplorationFromRunsInput,
} from '@/main/database/style-exploration-repository';
import {
  assertDatabaseSchemaCompatible,
  initializeDatabaseSchema,
  markDatabaseCleanShutdown,
} from '@/main/database/schema';
import {
  type BeginPackInstallAttemptInput,
  type InstallExactPackReleaseInput,
  type LinkPackReleaseItemInput,
  PackRepository,
  type RegisterPackInput,
  type RegisterPackReleaseInput,
  type SynchronizeLocalSpaceIdentityInput,
  type UpsertContextPackActivationInput,
  type UpsertLocalOverrideInput,
} from '@/main/database/pack-repository';
import { LibraryStorage } from '@/main/database/storage';
import { RatingRepository } from '@/main/database/rating-repository';
import markInterruptedRunsSql from './database/sql/mark-interrupted-runs.sql?raw';
import { type JsonMap } from '@/main/database/values';
import { WorkbenchRepository } from '@/main/database/workbench-repository';
import type { GenerationExecutionRequestSnapshot } from '@/main/generation-models';

export interface LibraryDatabaseInitializeOptions {
  /** The detached generation worker owns this recovery boundary in desktop runtime. */
  recoverGenerationRuns?: boolean;
  /** Long-running assistant jobs are also owned by the detached model worker. */
  recoverAssistantRuns?: boolean;
}

export interface FixtureImportOptions {
  assetsRoot?: string;
  dictionaryPath?: string;
  palettePath?: string;
  profile?: FixturePackProfile;
  facetRoles?: Partial<Record<FacetSystemRole, string>>;
}

/**
 * Stable facade used by Electron services and IPC handlers.
 *
 * Storage mechanics and domain queries live in focused modules under
 * `main/database/`; this class only owns connection lifecycle and delegation.
 */
export class LibraryDatabase {
  readonly db: LibraryStorage['db'];
  private readonly storage: LibraryStorage;
  private readonly dictionary: DictionaryRepository;
  private readonly dictionaryClassifications: DictionaryClassificationRepository;
  private readonly imports: ImportRepository;
  private readonly intake: IntakeRepository;
  private readonly creationImports: CreationImportRepository;
  private readonly creationInputStashes: CreationInputStashRepository;
  private readonly codexImageDiscoveries: CodexImageDiscoveryRepository;
  private readonly creatorAgent: CreatorAgentRepository;
  private readonly creations: CreationRepository;
  private readonly assistantRuns: AssistantRunRepository;
  private readonly directionExperimentTasks: DirectionExperimentTaskRepository;
  private readonly styleExplorations: StyleExplorationRepository;
  private readonly executionSnapshots: ExecutionSnapshotRepository;
  private readonly extensions: ExtensionRepository;
  private readonly providerDescriptions: ProviderDescriptionRepository;
  private readonly imageEdits: ImageEditRepository;
  private readonly imageTransforms: ImageTransformRepository;
  private readonly generationJobs: GenerationJobRepository;
  private readonly workbench: WorkbenchRepository;
  private readonly ratings: RatingRepository;
  private readonly gallery: GalleryRepository;
  private readonly assetFiles: AssetFileRepository;
  private readonly assetLifecycle: AssetLifecycleRepository;
  private readonly libraryFileView: LibraryFileViewRepository;
  private readonly assetRelationships: AssetRelationshipRepository;
  private readonly materialAlbums: MaterialAlbumRepository;
  private readonly materialMetadata: MaterialMetadataRepository;
  private readonly knowledgeDistillations: KnowledgeDistillationRepository;
  private readonly historicalTermRecommendations: HistoricalTermRecommendationRepository;
  private readonly dictionaryMaintenance: DictionaryMaintenanceRepository;
  private readonly albums: AlbumRepository;
  private readonly materialMemberships: MaterialMembershipRepository;
  private readonly packs: PackRepository;
  private readonly fixturePacks: FixturePackRepository;
  private readonly contentPacks: ContentPackRepository;
  private initialized = false;
  private closed = false;

  constructor(
    dbPath: string,
    readonly libraryRoot: string,
    options: { openMode?: 'create' | 'must-exist' } = {},
  ) {
    this.storage = new LibraryStorage(dbPath, libraryRoot, options);
    this.db = this.storage.db;
    this.dictionary = new DictionaryRepository(this.storage);
    this.dictionaryClassifications = new DictionaryClassificationRepository(this.storage);
    this.imports = new ImportRepository(this.storage);
    this.executionSnapshots = new ExecutionSnapshotRepository(this.storage);
    this.creationImports = new CreationImportRepository(this.storage, this.executionSnapshots);
    this.intake = new IntakeRepository(this.storage, this.creationImports);
    this.creationInputStashes = new CreationInputStashRepository(this.storage);
    this.codexImageDiscoveries = new CodexImageDiscoveryRepository(this.storage, this.creationImports);
    this.creatorAgent = new CreatorAgentRepository(this.storage);
    this.creations = new CreationRepository(this.storage);
    this.assistantRuns = new AssistantRunRepository(this.storage, this.creations);
    this.directionExperimentTasks = new DirectionExperimentTaskRepository(this.storage);
    this.styleExplorations = new StyleExplorationRepository(this.storage, this.directionExperimentTasks);
    this.extensions = new ExtensionRepository(this.storage);
    this.providerDescriptions = new ProviderDescriptionRepository(this.storage);
    this.imageEdits = new ImageEditRepository(this.storage);
    this.imageTransforms = new ImageTransformRepository(this.storage);
    this.generationJobs = new GenerationJobRepository(this.storage);
    this.workbench = new WorkbenchRepository(this.storage, this.executionSnapshots, this.generationJobs);
    this.ratings = new RatingRepository(this.storage);
    this.gallery = new GalleryRepository(this.storage);
    this.assetFiles = new AssetFileRepository(this.storage);
    this.assetLifecycle = new AssetLifecycleRepository(this.storage);
    this.libraryFileView = new LibraryFileViewRepository(this.storage);
    this.assetRelationships = new AssetRelationshipRepository(this.storage);
    this.materialAlbums = new MaterialAlbumRepository(this.storage);
    this.materialMetadata = new MaterialMetadataRepository(this.storage);
    this.knowledgeDistillations = new KnowledgeDistillationRepository(this.storage, this.dictionary);
    this.historicalTermRecommendations = new HistoricalTermRecommendationRepository(this.storage);
    this.dictionaryMaintenance = new DictionaryMaintenanceRepository(this.storage);
    this.albums = new AlbumRepository(this.storage);
    this.materialMemberships = new MaterialMembershipRepository(
      this.storage,
      this.albums,
      this.materialAlbums,
      this.dictionary,
    );
    this.packs = new PackRepository(this.storage);
    this.fixturePacks = new FixturePackRepository(this.storage, this.packs);
    this.contentPacks = new ContentPackRepository(this.storage, this.fixturePacks);
  }

  initialize(
    defaultLibraryName?: string,
    localSpaceIdentity?: SynchronizeLocalSpaceIdentityInput,
    options: LibraryDatabaseInitializeOptions = {},
  ) {
    initializeDatabaseSchema(this.db);
    if (options.recoverAssistantRuns !== false) {
      this.assistantRuns.interruptRunningAtStartup();
      this.creations.reconcileInterruptedAssistantRuns();
    }
    if (localSpaceIdentity) this.packs.synchronizeLocalSpaceIdentity(localSpaceIdentity);
    this.packs.reconcileInterruptedPackInstallAttempts();
    if (options.recoverGenerationRuns !== false) {
      this.db.transaction(() => this.db.exec(markInterruptedRunsSql))();
    }
    this.generationJobs.attachMissingRuns();
    if (defaultLibraryName?.trim()) {
      this.db
        .prepare("INSERT OR IGNORE INTO app_meta(key, value) VALUES ('library_name', ?)")
        .run(defaultLibraryName.trim());
    }
    if (localSpaceIdentity) this.packs.renameLocalSpace(this.getLibraryName());
    this.initialized = true;
  }

  /**
   * Explicitly imports a content fixture. This operation is intentionally kept
   * outside initialize() so external content can never become a boot dependency.
   */
  importFixture(fixturePath: string, options: FixtureImportOptions = {}) {
    if (options.profile && !options.dictionaryPath) {
      throw new Error('A content package import requires an explicit dictionary path');
    }
    const sourcePaths: FixturePackSourcePaths | null = options.dictionaryPath
      ? {
          fixturePath,
          dictionaryPath: options.dictionaryPath,
          ...(options.palettePath ? { palettePath: options.palettePath } : {}),
        }
      : null;
    const fixturePackSource = options.profile ? this.fixturePacks.prepare(options.profile, sourcePaths!) : null;
    reconcileFixture(this.storage, fixturePath, {
      assetsRoot: options.assetsRoot,
      dictionaryPath: options.dictionaryPath,
      palettePath: options.palettePath,
    });
    if (options.facetRoles) assignFacetSystemRoles(this.db, options.facetRoles);
    if (fixturePackSource && !this.fixturePacks.isCurrent(fixturePackSource)) {
      this.fixturePacks.ensure(fixturePackSource);
    }
    if (fixturePackSource) {
      if (!this.fixturePacks.isCurrent(fixturePackSource)) {
        throw new Error(`Content package did not converge: ${fixturePackSource.profile.id}`);
      }
    }
  }

  importContentPack(packagePath: string) {
    return this.contentPacks.importPackage(packagePath);
  }

  /**
   * Called only after the background process has acquired its singleton IPC
   * endpoint. This prevents a duplicate worker from interrupting live jobs.
   */
  initializeModelWorker() {
    assertDatabaseSchemaCompatible(this.db);
    this.assistantRuns.interruptRunningAtStartup();
    this.creations.reconcileInterruptedAssistantRuns();
    this.db.transaction(() => this.db.exec(markInterruptedRunsSql))();
    this.generationJobs.attachMissingRuns();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.libraryFileView.stopSynchronization();
    try {
      if (this.initialized) markDatabaseCleanShutdown(this.db);
    } finally {
      this.initialized = false;
      this.storage.close();
    }
  }

  startLibraryFileViewSynchronization() {
    return this.libraryFileView.startSynchronization();
  }

  drainLibraryFileViewSynchronization() {
    return this.libraryFileView.drainSynchronization();
  }

  setLibraryFileViewBackgroundSynchronizer(synchronizer: (() => Promise<void>) | null) {
    this.libraryFileView.setBackgroundSynchronizer(synchronizer);
  }

  scheduleLibraryFileViewSynchronization() {
    this.libraryFileView.scheduleSynchronization();
  }

  synchronizeLibraryFileView() {
    return this.libraryFileView.synchronize();
  }

  refreshLibraryFileView() {
    return this.libraryFileView.refresh();
  }

  reconcileBuiltInExtensions(manifests: readonly ExtensionManifestDto[]) {
    return this.extensions.reconcileBuiltIns(manifests);
  }

  reconcileExtensions(entries: readonly ExtensionReconcileEntry[]) {
    return this.extensions.reconcile(entries);
  }

  listExtensionInstallations() {
    return this.extensions.listInstallations();
  }

  setExtensionEnabled(extensionId: string, enabled: boolean) {
    return this.extensions.setEnabled(extensionId, enabled);
  }

  setExtensionPermission(extensionId: string, permission: string, granted: boolean) {
    return this.extensions.setPermission(extensionId, permission, granted);
  }

  getExtensionThreadBinding(extensionId: string, scopeKind: ExtensionThreadScopeKind, scopeId: string) {
    return this.extensions.getThreadBinding(extensionId, scopeKind, scopeId);
  }

  bindExtensionThread(input: {
    extensionId: string;
    scopeKind: ExtensionThreadScopeKind;
    scopeId: string;
    threadId: string;
    threadName: string;
  }) {
    return this.extensions.bindThread(input);
  }

  getLocalSpace() {
    return this.packs.getLocalSpace();
  }

  synchronizeLocalSpaceIdentity(input: SynchronizeLocalSpaceIdentityInput) {
    return this.packs.synchronizeLocalSpaceIdentity(input);
  }

  renameLocalSpace(name: string) {
    return this.packs.renameLocalSpace(name);
  }

  listPackCatalog() {
    return this.packs.listPackCatalog();
  }

  registerPack(input: RegisterPackInput) {
    return this.packs.registerPack(input);
  }

  registerPackRelease(input: RegisterPackReleaseInput) {
    return this.packs.registerPackRelease(input);
  }

  getPackRelease(releaseId: string) {
    return this.packs.getPackRelease(releaseId);
  }

  beginPackInstallAttempt(input: BeginPackInstallAttemptInput) {
    return this.packs.beginPackInstallAttempt(input);
  }

  installExactPackRelease(input: InstallExactPackReleaseInput) {
    return this.packs.installExactPackRelease(input);
  }

  completePackInstallAttempt(attemptId: string, verification: JsonMap = {}) {
    return this.packs.completePackInstallAttempt(attemptId, verification);
  }

  failPackInstallAttempt(attemptId: string, error: JsonMap) {
    return this.packs.failPackInstallAttempt(attemptId, error);
  }

  cancelPackInstallAttempt(attemptId: string, reason: JsonMap = {}) {
    return this.packs.cancelPackInstallAttempt(attemptId, reason);
  }

  getPackInstallAttempt(attemptId: string) {
    return this.packs.getPackInstallAttempt(attemptId);
  }

  listPackInstallations(includeRemoved = false) {
    return this.packs.listPackInstallations(includeRemoved);
  }

  setPackInstallationDisabled(packId: string, disabled: boolean) {
    return this.packs.setPackInstallationDisabled(packId, disabled);
  }

  upsertContextPackActivation(input: UpsertContextPackActivationInput) {
    return this.packs.upsertContextPackActivation(input);
  }

  listContextPackActivations(targetType: 'ALBUM' | 'CONVERSATION', targetId: string) {
    return this.packs.listContextPackActivations(targetType, targetId);
  }

  deleteContextPackActivation(activationId: string) {
    return this.packs.deleteContextPackActivation(activationId);
  }

  upsertLocalOverride(input: UpsertLocalOverrideInput) {
    return this.packs.upsertLocalOverride(input);
  }

  listLocalOverrides(includeDeleted = false) {
    return this.packs.listLocalOverrides(includeDeleted);
  }

  deleteLocalOverride(overrideId: string) {
    return this.packs.deleteLocalOverride(overrideId);
  }

  linkPackReleaseItem(input: LinkPackReleaseItemInput) {
    return this.packs.linkPackReleaseItem(input);
  }

  deletePackObjectLink(linkId: string) {
    return this.packs.deletePackObjectLink(linkId);
  }

  getFacets(locale: Locale) {
    return this.dictionary.getFacets(locale);
  }

  getCategories(locale: Locale) {
    return this.dictionary.getCategories(locale);
  }

  getWordPalettes(locale: Locale, sourceTerms?: TermListItem[]) {
    return this.dictionary.getWordPalettes(locale, sourceTerms);
  }

  createWordPalette(input: CreateWordPaletteInput) {
    return this.dictionary.createWordPalette(input);
  }

  updateWordPalette(input: UpdateWordPaletteInput) {
    return this.dictionary.updateWordPalette(input);
  }

  setWordPaletteArchived(paletteId: string, archived: boolean) {
    return this.dictionary.setWordPaletteArchived(paletteId, archived);
  }

  deleteWordPalette(paletteId: string) {
    return this.dictionary.deleteWordPalette(paletteId);
  }

  searchTerms(
    locale: Locale,
    query = '',
    facetValueIds: string[] = [],
    filters?: Pick<DictionarySearchInput, 'excludeDrafts' | 'excludeUncited'> &
      Partial<
        Pick<DictionarySearchInput, 'includeArchived' | 'termIds' | 'classificationIds' | 'missingClassification'>
      >,
  ) {
    return this.dictionary.searchTerms(locale, query, facetValueIds, filters);
  }

  searchTermsPage(input: DictionaryPageInput) {
    return this.dictionary.searchTermsPage(input);
  }

  getTerm(termId: string, locale: Locale) {
    return this.dictionary.getTerm(termId, locale);
  }

  saveTermDraft(input: TermDraftInput, locale: Locale) {
    return this.dictionary.saveTermDraft(input, locale);
  }

  createTerm(input: NewTermInput) {
    return this.dictionary.createTerm(input);
  }

  approveTerm(termId: string, locale: Locale) {
    return this.dictionary.approveTerm(termId, locale);
  }

  withdrawTermApproval(termId: string, locale: Locale) {
    return this.dictionary.withdrawTermApproval(termId, locale);
  }

  setTermArchived(termId: string, archived: boolean, locale: Locale) {
    return this.dictionary.setTermArchived(termId, archived, locale);
  }

  addTermMedia(input: AddTermMediaInput) {
    return this.dictionary.addTermMedia(input);
  }

  setTermMediaCover(mediaId: string) {
    return this.dictionary.setTermMediaCover(mediaId);
  }

  removeTermMedia(mediaId: string) {
    return this.dictionary.removeTermMedia(mediaId);
  }

  reorderTermMedia(input: ReorderTermMediaInput) {
    return this.dictionary.reorderTermMedia(input);
  }

  listDictionaryClassifications(locale: Locale) {
    return this.dictionaryClassifications.list(locale);
  }

  listDictionaryClassificationTerms(input: DictionaryClassificationTermsInput) {
    return this.dictionaryClassifications.listTerms(input);
  }

  createDictionaryClassification(input: DictionaryClassificationCreateInput) {
    return this.dictionaryClassifications.create(input);
  }

  updateDictionaryClassification(input: DictionaryClassificationUpdateInput) {
    return this.dictionaryClassifications.update(input);
  }

  restoreDictionaryClassificationSource(input: DictionaryClassificationRestoreSourceInput) {
    return this.dictionaryClassifications.restoreSource(input);
  }

  previewDictionaryClassificationMove(input: DictionaryClassificationMoveInput) {
    return this.dictionaryClassifications.previewMove(input);
  }

  moveDictionaryClassification(input: DictionaryClassificationMoveInput) {
    return this.dictionaryClassifications.move(input);
  }

  reorderDictionaryClassifications(input: DictionaryClassificationReorderInput) {
    return this.dictionaryClassifications.reorder(input);
  }

  setDictionaryClassificationState(input: DictionaryClassificationSetStateInput) {
    return this.dictionaryClassifications.setState(input);
  }

  previewDictionaryClassificationMerge(input: DictionaryClassificationMergeInput) {
    return this.dictionaryClassifications.previewMerge(input);
  }

  mergeDictionaryClassification(input: DictionaryClassificationMergeInput) {
    return this.dictionaryClassifications.merge(input);
  }

  stageImport(fileName: string, rows: JsonMap[]) {
    return this.imports.stageImport(fileName, rows);
  }

  commitImport(batchId: string) {
    return this.imports.commitImport(batchId);
  }

  getWorkbench(locale: Locale = 'zh') {
    return { ...this.workbench.getWorkbench(locale), albums: this.albums.list() };
  }

  isLibraryEmpty() {
    return this.intake.isLibraryEmpty();
  }

  getCreationDraft() {
    return this.intake.latestDraft();
  }

  startCreationDraft(input: CreationDraftStartInput) {
    const album = input.albumId ? this.albums.getActive(input.albumId) : null;
    const defaults = album?.creationDefaults ?? emptyAlbumCreationDefaults();
    if (defaults.dictionaryScope.mode === 'SELECTED') {
      const activeSources = this.packs
        .listContextPackActivations('ALBUM', album!.id)
        .filter((activation) => activation.state === 'EXPLICIT_ACTIVE');
      const installations = this.packs.listPackInstallations();
      for (const source of defaults.dictionaryScope.sources) {
        if (
          !activeSources.some(
            (activation) => activation.packId === source.packId && activation.packReleaseId === source.packReleaseId,
          )
        ) {
          throw new Error('An album dictionary source is unavailable');
        }
        if (
          !installations.some(
            (installation) =>
              installation.packId === source.packId &&
              installation.selectedReleaseId === source.packReleaseId &&
              installation.state === 'INSTALLED' &&
              installation.deletedAt === null,
          )
        ) {
          throw new Error('An album dictionary source is disabled');
        }
      }
    }
    return this.intake.startDraft(input, defaults);
  }

  commitIntake(input: IntakeCommitInput) {
    return this.intake.commit(input);
  }

  saveCreationDraft(input: CreationDraftSaveInput) {
    return this.intake.saveDraft(input);
  }

  commitCreationDraft(input: CreationDraftCommitInput) {
    const generationInput: GenerationInput = {
      seriesId: null,
      creationDraftId: input.creationDraftId,
      title: input.title,
      manualPrompt: input.manualPrompt,
      promptNodes: input.promptNodes,
      prompt: input.prompt,
      resolvedPrompt: input.resolvedPrompt,
      changeSummary: input.changeSummary,
      referenceAssetIds: input.referenceAssetIds,
      termPromptLocale: input.termPromptLocale,
      termIds: input.termIds,
      wordPaletteReferences: input.wordPaletteReferences,
      modelKey: 'gpt-image-2',
      canvasPresetKey: null,
      width: null,
      height: null,
      quality: 'low',
    };
    const promptInput = this.executionSnapshots.captureCommonInput(generationInput);
    return this.workbench.saveCreationDraftAsV01(generationInput, promptInput);
  }

  listCreationInputStashes(scope: CreatorAgentScope) {
    return this.creationInputStashes.list(scope);
  }

  createCreationInputStash(input: CreationInputStashCreateInput) {
    return this.creationInputStashes.create(input);
  }

  resolveDictionaryScope(input: DictionaryScopeResolveInput) {
    return this.dictionary.resolveScope(input);
  }

  listCreatorAgentTurns(scope: CreatorAgentScope) {
    return this.creatorAgent.list(scope);
  }

  addCreatorAgentTurn(scope: CreatorAgentScope, input: CreatorAgentChatInput, result: CodexAssistResult) {
    return this.creatorAgent.add(scope, input, result);
  }

  startAssistantRun(
    input: CreatorAgentAssistInput,
    contextHash: string,
    capabilityReceipt: AssistantCapabilityReceiptDto,
    execution?: { providerKey: string; modelKey: string; reasoningEffort?: AssistantReasoningEffort | null },
  ) {
    return this.db.transaction(() => {
      const usesCreation = input.mode === 'directions' && !input.sourceExperimentSlotId;
      const requestedCreation = usesCreation && input.creationId ? this.creations.get(input.creationId) : null;
      if (usesCreation && input.creationId && !requestedCreation) throw new Error('Creation not found');
      const creation = usesCreation
        ? (requestedCreation ??
          this.creations.startForDirections({
            scope: input.scope,
            contextKey: input.contextKey,
            briefText: input.prompt,
            locale: input.locale,
          }))
        : null;
      const run = this.assistantRuns.start(input, contextHash, capabilityReceipt, execution);
      if (!creation) return run;
      this.creations.attachAssistantRun(creation.id, run.id);
      return this.assistantRuns.get(run.id)!;
    })();
  }

  succeedAssistantRun(runId: string, result: CodexAssistResult) {
    return this.db.transaction(() => {
      const run = this.assistantRuns.succeed(runId, result);
      if (run.proposal) this.creations.completeAssistantRun(runId, run.proposal.id, result.directions.length);
      return this.assistantRuns.get(runId)!;
    })();
  }

  getAssistantRun(runId: string) {
    return this.assistantRuns.get(runId);
  }

  failAssistantRun(runId: string, errorMessage: string) {
    return this.db.transaction(() => {
      this.assistantRuns.fail(runId, errorMessage);
      this.creations.failAssistantRun(runId, errorMessage);
      return this.assistantRuns.get(runId)!;
    })();
  }

  interruptAssistantRun(runId: string, errorMessage: string) {
    return this.db.transaction(() => {
      this.assistantRuns.interrupt(runId, errorMessage);
      this.creations.failAssistantRun(runId, errorMessage, true);
      return this.assistantRuns.get(runId)!;
    })();
  }

  recordAssistantActivity(
    runId: string,
    phase: AssistantActivityPhase,
    details: {
      providerKey?: string | null;
      modelKey?: string | null;
      message?: string;
      payload?: Record<string, unknown>;
    } = {},
  ) {
    return this.creations.recordForAssistantRun(runId, phase, details);
  }

  expireAssistantProposal(runId: string, currentContextKey: string) {
    return this.assistantRuns.expireProposal(runId, currentContextKey);
  }

  revalidateAssistantProposal(runId: string, currentContextKey: string) {
    return this.assistantRuns.revalidateProposal(runId, currentContextKey);
  }

  adoptAssistantProposal(input: AssistantProposalAdoptionInput) {
    return this.db
      .transaction(() => {
        const run = this.assistantRuns.get(input.runId);
        if (!run) throw new Error(`Assistant run not found: ${input.runId}`);
        if (input.persistence?.kind === 'DRAFT') {
          if (run.scope.kind !== 'DRAFT' || input.persistence.draft.id !== run.scope.id) {
            throw new Error('Assistant proposal draft persistence does not match its creation scope');
          }
          this.intake.saveDraft(input.persistence.draft);
        } else if (input.persistence?.kind === 'SERIES') {
          if (run.scope.kind !== 'SERIES' || input.persistence.version.seriesId !== run.scope.id) {
            throw new Error('Assistant proposal version persistence does not match its creation scope');
          }
          const promptInput = this.executionSnapshots.captureCommonInput(input.persistence.version);
          this.workbench.savePromptVersion(input.persistence.version, promptInput);
        }
        return this.assistantRuns.adoptProposal(input);
      })
      .immediate();
  }

  closeAssistantProposal(runId: string) {
    return this.assistantRuns.closeProposal(runId);
  }

  dismissAssistantRun(runId: string) {
    return this.assistantRuns.dismiss(runId);
  }

  listAssistantRuns(scope?: CreatorAgentScope) {
    return scope ? this.assistantRuns.list(scope) : this.assistantRuns.listRecent();
  }

  listCreations() {
    return this.creations.list();
  }

  deleteCreation(id: string) {
    this.creations.delete(id);
  }

  createStyleExplorationBatch(input: CreateStyleExplorationFromRunsInput) {
    return this.styleExplorations.createFromPreparedRuns(input);
  }

  validateStyleExplorationStart(input: StyleExplorationStartInput) {
    const promptSnapshots = input.slots.map((slot) => this.executionSnapshots.captureCommonInput(slot.input));
    this.styleExplorations.validateStart(input, promptSnapshots);
  }

  listStyleExplorationBatches(scope?: CreatorAgentScope) {
    return scope ? this.styleExplorations.list(scope) : this.styleExplorations.listAll();
  }

  listDirectionExperimentDirectorTasks() {
    return this.directionExperimentTasks.list();
  }

  getStyleExplorationBatch(batchId: string) {
    return this.styleExplorations.get(batchId);
  }

  getStyleExplorationSlot(slotId: string) {
    return this.styleExplorations.getSlot(slotId);
  }

  styleExplorationRunIds(batchId: string) {
    return this.styleExplorations.runIdsForBatch(batchId);
  }

  retryableStyleExplorationRunIds(slotId: string) {
    return this.styleExplorations.retryableRunIdsForSlot(slotId);
  }

  styleExplorationSlotIdForRun(runId: string) {
    return this.styleExplorations.slotIdForRun(runId);
  }

  linkStyleExplorationRetry(slotId: string, runId: string) {
    return this.styleExplorations.linkRetryRun(slotId, runId);
  }

  importCreatorReferences(input: CreatorImageImportInput) {
    return this.creationImports.importReferences(input);
  }

  importStoredCreatorReferences(source: CreatorImageImportContext['source'], images: StoredCreatorImage[]) {
    return this.creationImports.importStoredReferences(source, images);
  }

  importCreatorOutputs(input: CreatorImageImportInput) {
    return this.creationImports.importOutputs(input);
  }

  async storeVerifiedCreatorImportFile(
    sourcePath: string,
    extension: string,
    metadata: Parameters<LibraryStorage['storeVerifiedFile']>[2],
  ) {
    return this.storage.storeVerifiedFile(sourcePath, extension, metadata);
  }

  importStoredCreatorOutputs(context: CreatorImageImportContext, images: StoredCreatorImage[]) {
    return this.creationImports.importStoredOutputs(context, images);
  }

  importNewExternalCreation(input: NewExternalCreationImportInput) {
    return this.creationImports.importNewExternalCreation(input);
  }

  importStoredNewExternalCreation(
    input: NewExternalCreationImportInput,
    images: StoredCreatorImage[],
    duplicateCount = 0,
  ) {
    return this.creationImports.importStoredNewExternalCreation(input, images, duplicateCount);
  }

  importStoredCodexDiscoveredImages(
    input: NewExternalCreationImportInput,
    images: StoredCreatorImage[],
    bindings: readonly { discoveryId: string; contentHash: string }[],
    codexTask: CodexTaskReferenceDto,
  ) {
    return this.codexImageDiscoveries.importStoredImages(input, images, bindings, codexTask);
  }

  reconcileCodexImageDiscoveries(
    scanId: string,
    entries: readonly CodexImageScanEntry[],
    complete = true,
    scanSnapshot?: CodexImageDiscoveryScanSnapshot,
  ) {
    return this.codexImageDiscoveries.reconcileScan(scanId, entries, complete, scanSnapshot);
  }

  getCodexImageDiscoveryScanSnapshot() {
    return this.codexImageDiscoveries.scanSnapshot();
  }

  getCodexImageDiscoveryHashCache() {
    return this.codexImageDiscoveries.hashCache();
  }

  listCodexImageDiscoveries(
    page?: number,
    pageSize?: number,
    filter?: CodexImageDiscoveryFilter,
    includeUntitled?: boolean,
  ) {
    return this.codexImageDiscoveries.list(page, pageSize, filter, includeUntitled);
  }

  getCodexImageDiscoveries(discoveryIds: readonly string[]) {
    return this.codexImageDiscoveries.get(discoveryIds);
  }

  updateImportedCreationOutput(input: ImportedCreationOutputUpdateInput) {
    return this.creationImports.updateOutput(input);
  }

  listFavoriteTexts() {
    return this.intake.listFavoriteTexts();
  }

  addFavorite(target: MaterialSelectionTargetInput) {
    return this.intake.addFavorite(target);
  }

  removeFavorite(materialId: string) {
    return this.intake.removeFavorite(materialId);
  }

  listImageRatings() {
    return this.ratings.list();
  }

  listGallery(input: GalleryListInput) {
    return this.gallery.list(input);
  }

  getAssetRelationship(assetId: string) {
    return this.assetRelationships.get(assetId);
  }

  listKnowledgeDistillationProposals(sourceAssetId: string) {
    return this.knowledgeDistillations.list(sourceAssetId);
  }

  createKnowledgeDistillationProposal(input: KnowledgeDistillationCreateInput) {
    return this.knowledgeDistillations.create(input);
  }

  acceptKnowledgeDistillationProposal(input: KnowledgeDistillationAcceptInput) {
    return this.knowledgeDistillations.accept(input);
  }

  listHistoricalTermRecommendationRuns(input: HistoricalTermRecommendationListInput) {
    return this.historicalTermRecommendations.list(input);
  }

  createHistoricalTermRecommendationRun(input: HistoricalTermRecommendationCreateInput) {
    return this.historicalTermRecommendations.create(input);
  }

  listDictionaryMaintenanceReports(input: DictionaryMaintenanceListInput) {
    return this.dictionaryMaintenance.list(input.locale, input.limit);
  }

  createDictionaryMaintenanceReport(input: DictionaryMaintenanceCreateInput) {
    return this.dictionaryMaintenance.create(input.locale);
  }

  resolveAssetFile(assetId: string) {
    return this.assetFiles.resolve(assetId);
  }

  deleteAsset(assetId: string) {
    return this.assetLifecycle.delete(assetId);
  }

  resolveAssetRevealPath(assetId: string, context?: AssetFileRevealContext) {
    const asset = this.assetFiles.resolve(assetId);
    return asset ? this.libraryFileView.resolveRevealPath(asset, context) : null;
  }

  async resolveAssetRevealPathAsync(assetId: string, context?: AssetFileRevealContext) {
    const asset = this.assetFiles.resolve(assetId);
    return asset ? this.libraryFileView.resolveRevealPathAsync(asset, context) : null;
  }

  listAssetRevealTargets(assetId: string, context?: AssetFileRevealTargetContext) {
    const asset = this.assetFiles.resolve(assetId);
    return asset ? this.libraryFileView.listRevealTargets(asset, context) : [];
  }

  createMaterialCollectionFromSource(input: CreateMaterialCollectionFromSourceInput) {
    let imageAssetIds: string[];
    if (input.snapshot.kind === 'GALLERY_QUERY') {
      if (input.source.kind !== 'MATERIAL_VIEW') {
        throw new Error('Gallery query snapshots require a material view source');
      }
      if (input.snapshot.query.albumId !== input.source.viewId) {
        throw new Error('Gallery query does not match the material view source');
      }
      imageAssetIds = [];
      let cursor: string | null = null;
      do {
        const page = this.gallery.list({
          ...input.snapshot.query,
          locale: input.locale,
          cursor,
          limit: 60,
        });
        imageAssetIds.push(...page.items.map((item) => item.asset.id));
        if (imageAssetIds.length > 100_000) throw new Error('Material collection snapshot is too large');
        cursor = page.nextCursor;
      } while (cursor);
    } else {
      if (input.source.kind === 'MATERIAL_VIEW') {
        throw new Error('Material views require a gallery query snapshot');
      }
      imageAssetIds = [...new Set(input.snapshot.imageAssetIds)];
    }
    // Gallery pagination is intentionally outside the write transaction. Holding a
    // deferred read transaction while the projection worker commits can otherwise
    // fail the later read-to-write upgrade with SQLITE_BUSY.
    return this.materialAlbums.createCollectionFromSource(input, imageAssetIds);
  }

  renameCreationGroup(input: RenameCreationGroupInput) {
    return this.materialAlbums.renameCreationGroup(input);
  }

  listMaterialAlbums(input: MaterialAlbumListInput) {
    return this.materialAlbums.list(input);
  }

  createMaterialAlbum(input: MaterialAlbumCreateInput) {
    return this.materialAlbums.create(input);
  }

  renameMaterialAlbum(input: MaterialAlbumRenameInput) {
    return this.materialAlbums.rename(input);
  }

  deleteMaterialAlbum(albumId: string) {
    return this.materialAlbums.delete(albumId);
  }

  addMaterialAlbumMembers(input: MaterialAlbumAddManyInput) {
    return this.materialAlbums.addMany(input);
  }

  removeMaterialAlbumMembers(input: MaterialAlbumRemoveInput) {
    return this.materialAlbums.remove(input);
  }

  listAlbums() {
    return this.albums.list();
  }

  listAlbumTextMaterials(albumId: string) {
    return this.albums.listTextMaterials(albumId);
  }

  createAlbum(input: AlbumCreateInput) {
    return this.albums.create(input);
  }

  renameAlbum(input: AlbumRenameInput) {
    return this.albums.rename(input);
  }

  updateAlbumCreationDefaults(input: AlbumCreationDefaultsUpdateInput) {
    return this.db.transaction(() => {
      const sources = input.defaults.dictionaryScope.mode === 'SELECTED' ? input.defaults.dictionaryScope.sources : [];
      const installations = this.packs.listPackInstallations();
      for (const source of sources) {
        if (
          !installations.some(
            (installation) =>
              installation.packId === source.packId &&
              installation.selectedReleaseId === source.packReleaseId &&
              installation.state === 'INSTALLED' &&
              installation.deletedAt === null,
          )
        ) {
          throw new Error('A selected album dictionary source is unavailable');
        }
      }
      this.packs.syncAlbumDictionarySources(input.albumId, sources);
      return this.albums.updateCreationDefaults(input);
    })();
  }

  deleteAlbum(albumId: string) {
    return this.db.transaction(() => {
      this.packs.clearAlbumDictionarySources(albumId);
      return this.albums.delete(albumId);
    })();
  }

  setAlbumPinned(input: AlbumSetPinnedInput) {
    return this.albums.setPinned(input);
  }

  archiveAlbum(albumId: string) {
    return this.albums.archive(albumId);
  }

  setAlbumArchived(input: AlbumSetArchivedInput) {
    return this.albums.setArchived(input);
  }

  moveAlbum(input: AlbumMoveInput) {
    return this.albums.move(input);
  }

  moveAlbumSeries(input: AlbumMoveSeriesInput) {
    return this.albums.moveSeries(input);
  }

  addAlbumMembers(input: AlbumAddMembersInput) {
    return this.albums.addMembers(input);
  }

  removeAlbumMembers(input: AlbumRemoveMembersInput) {
    return this.albums.removeMembers(input);
  }

  reorderAlbumMembers(input: AlbumReorderMembersInput) {
    return this.albums.reorderMembers(input);
  }

  reorderSidebarRoot(input: SidebarRootReorderInput) {
    return this.albums.reorderRoot(input);
  }

  ensureImageMaterial(imageAssetId: string) {
    return this.albums.ensureImageMaterial(imageAssetId);
  }

  addMaterialsToDestinations(input: AddMaterialsToDestinationsInput) {
    return this.materialMemberships.addToDestinations(input);
  }

  createAlbumFromMaterials(input: AlbumCreateFromMaterialsInput) {
    return this.materialMemberships.createAlbumFromMaterials(input);
  }

  updateMaterialMetadata(input: ExternalMaterialMetadataUpdateInput) {
    return this.materialMetadata.update(input);
  }

  materialProvenanceSuggestions() {
    return this.materialMetadata.suggestions();
  }

  setImageRating(imageAssetId: string, dimension: ImageRatingDimension, score: number | null) {
    return this.ratings.set(imageAssetId, dimension, score);
  }

  renamePromptSeries(input: RenamePromptSeriesInput) {
    return this.workbench.renameSeries(input);
  }

  deletePromptSeries(input: DeletePromptSeriesInput) {
    return this.workbench.deleteSeries(input);
  }

  getAssetPath(assetId: string) {
    return this.workbench.getAssetPath(assetId);
  }

  resolveImageCropSource(seriesId: string, assetId: string) {
    return this.imageTransforms.resolveCropSource(seriesId, assetId);
  }

  persistGenerationEditSpec(
    runId: string,
    sourceAssetId: string,
    mode: PersistedImageEditMode,
    annotations: readonly AnnotationDto[],
  ) {
    return this.imageEdits.persistForRun(runId, sourceAssetId, mode, annotations);
  }

  getGenerationEditSpec(runId: string) {
    return this.imageEdits.forRun(runId);
  }

  reuseAnnotationHistory(promptVersionId: string) {
    return this.imageEdits.reuseAnnotationsForVersion(promptVersionId);
  }

  storeImageTransformBuffer(bytes: Uint8Array) {
    return this.storage.storeBufferAsync(bytes, '.png');
  }

  commitStoredImageCrop(input: ImageCropStoredCommitInput) {
    return this.imageTransforms.createStoredCrop(input);
  }

  listGenerationReplaySources() {
    return this.workbench.listGenerationReplaySources();
  }

  hasGenerationReplaySources() {
    return this.workbench.hasGenerationReplaySources();
  }

  importReference(sourcePath: string) {
    return this.workbench.importReference(sourcePath);
  }

  importReferenceAsync(sourcePath: string) {
    return this.workbench.importReferenceAsync(sourcePath);
  }

  capturePromptCommonInput(
    input: Pick<
      GenerationInput,
      'manualPrompt' | 'promptNodes' | 'termPromptLocale' | 'termIds' | 'wordPaletteReferences' | 'referenceAssetIds'
    >,
  ) {
    return this.executionSnapshots.captureCommonInput(input);
  }

  getPromptCommonInput(versionId: string) {
    return this.executionSnapshots.getCommonInput(versionId);
  }

  resolveGenerationInput(input: GenerationInput, promptInput: PromptCommonInputDto) {
    return this.executionSnapshots.resolveGenerationInput(input, promptInput);
  }

  freezeGenerationExecution(
    runId: string,
    generationInput: GenerationInput,
    promptInput: PromptCommonInputDto,
    route: ImageGenerationRouteDto,
    request: GenerationExecutionRequestSnapshot,
  ) {
    return this.executionSnapshots.freezeGenerationExecution({
      runId,
      generationInput,
      promptInput,
      route,
      request,
    });
  }

  recordProviderReturnedDescriptions(runId: string, inputs: readonly ProviderReturnedDescriptionInput[]) {
    return this.providerDescriptions.record(runId, inputs);
  }

  prepareGeneration(
    input: GenerationInput,
    promptInput?: PromptCommonInputDto,
    options?: { forceNewVersion?: boolean },
  ) {
    return this.workbench.prepareGeneration(
      input,
      promptInput ?? this.executionSnapshots.captureCommonInput(input),
      options,
    );
  }

  prepareGenerationRetry(runId: string) {
    return this.workbench.prepareGenerationRetry(runId);
  }

  prepareGenerationFromVersion(versionId: string, modelKey: string) {
    return this.workbench.prepareGenerationFromVersion(versionId, modelKey);
  }

  markRun(
    runId: string,
    status: string,
    errorMessage?: string,
    errorCode?: string,
    errorDetails?: GenerationErrorDetailsDto,
  ) {
    return this.workbench.markRun(runId, status, errorMessage, errorCode, errorDetails);
  }

  setGenerationOutputFailed(runId: string, failed: boolean) {
    return this.workbench.setGenerationOutputFailed(runId, failed);
  }

  markGenerationPhase(runId: string, phase: string, progress?: number | null, statusMessage?: string | null) {
    return this.generationJobs.markPhase(runId, phase, progress, statusMessage);
  }

  recordGenerationProviderAccepted(runId: string, input: GenerationProviderAcceptance) {
    return this.generationJobs.recordProviderAccepted(runId, input);
  }

  saveGenerationCheckpoint(runId: string, checkpoint: unknown, progress?: number | null) {
    return this.generationJobs.saveCheckpoint(runId, checkpoint, progress);
  }

  heartbeatGeneration(runId: string, progress?: number | null) {
    return this.generationJobs.heartbeat(runId, progress);
  }

  getGenerationJob(runId: string) {
    return this.generationJobs.getForRun(runId);
  }

  listRecoverableGenerationRuns() {
    return this.generationJobs.listRecoverable();
  }

  listGenerationRunIdsForTempCleanup() {
    return this.workbench.listGenerationRunIdsForTempCleanup();
  }

  getGenerationRunModelKey(runId: string) {
    return this.workbench.getGenerationRunModelKey(runId);
  }

  finishGeneration(runId: string, outputPath: string, sourceAssetId: string | null = null) {
    return this.workbench.finishGeneration(runId, outputPath, sourceAssetId);
  }

  finishGenerationFromAsset(runId: string, sourceAssetId: string, relationType: 'MODEL_REPLAY') {
    return this.workbench.finishGenerationFromAsset(runId, sourceAssetId, relationType);
  }

  listAnnotations(assetId: string) {
    return this.workbench.listAnnotations(assetId);
  }

  addAnnotation(input: AnnotationInput) {
    return this.workbench.addAnnotation(input);
  }

  updateAnnotation(input: AnnotationUpdateInput) {
    return this.workbench.updateAnnotation(input);
  }

  setAnnotationStatus(input: AnnotationStatusInput) {
    return this.workbench.setAnnotationStatus(input);
  }

  getReferencePaths(assetIds: string[]) {
    return this.workbench.getReferencePaths(assetIds);
  }

  getLibraryName() {
    return this.workbench.getLibraryName();
  }
}
