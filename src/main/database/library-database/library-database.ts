import { assignFacetSystemRoles } from '@/main/database/dictionary/facet-system-roles';
import { reconcileFixture } from '@/main/database/packs/fixture-loader';
import type { FixturePackProfile } from '@/main/database/packs/fixture-pack-profile';
import type { FixturePackSourcePaths } from '@/main/database/packs/fixture-pack-source';
import { createLibraryDatabaseApi, type LibraryDatabaseApi } from '@/main/database/library-database/api';
import { createLibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { SynchronizeLocalSpaceIdentityInput } from '@/main/database/packs/pack-repository';
import {
  assertDatabaseSchemaCompatible,
  initializeDatabaseSchema,
  markDatabaseCleanShutdown,
} from '@/main/database/core/schema';
import markInterruptedRunsSql from '@/main/database/sql/mark-interrupted-runs.sql?raw';
import { LibraryStorage } from '@/main/database/core/storage';
import type { FacetSystemRole } from '@/shared/contracts';
import { PackSyncRepository } from '@/main/database/packs/pack-sync-repository';
import type { PackSyncSummary } from '@/shared/pack-sync';

export interface LibraryDatabaseInitializeOptions {
  /** The detached generation worker owns this recovery boundary in desktop runtime. */
  recoverGenerationRuns?: boolean;
  /** Long-running assistant jobs are also owned by the detached model worker. */
  recoverAssistantRuns?: boolean;
  /** GIF exports belong to the desktop main process, never the detached model worker. */
  recoverGifRuns?: boolean;
}

export interface FixtureImportOptions {
  assetsRoot?: string;
  dictionaryPath?: string;
  palettePath?: string;
  profile?: FixturePackProfile;
  facetRoles?: Partial<Record<FacetSystemRole, string>>;
}

/**
 * Connection lifecycle for the stable database facade. Repository construction
 * and domain behavior are composed from focused modules in this directory.
 */
class LibraryDatabaseCore {
  readonly db: LibraryStorage['db'];
  private readonly repositories;
  private readonly storage: LibraryStorage;
  private initialized = false;
  private closed = false;

  constructor(
    dbPath: string,
    readonly libraryRoot: string,
    options: { openMode?: 'create' | 'must-exist' } = {},
  ) {
    this.storage = new LibraryStorage(dbPath, libraryRoot, options);
    this.db = this.storage.db;
    this.repositories = createLibraryDatabaseRepositories(this.storage);
    Object.assign(this, createLibraryDatabaseApi(this.repositories));
  }

  initialize(
    defaultLibraryName?: string,
    localSpaceIdentity?: SynchronizeLocalSpaceIdentityInput,
    options: LibraryDatabaseInitializeOptions = {},
  ) {
    const { articleChecks, articleDeliveryJobs, assistantRuns, creations, db, generationJobs, packs, videoDocuments } =
      this.repositories;
    const startupCheck = initializeDatabaseSchema(db);
    if (options.recoverGifRuns) {
      db.prepare("UPDATE gif_export_runs SET state='FAILED',error_code='GIF_FAILED' WHERE state='RUNNING'").run();
      db.prepare(
        "UPDATE gif_generation_runs SET state='FAILED',error_code='GIF_GENERATION_FAILED' WHERE state IN ('PREPARING','GENERATING','COMPOSITING')",
      ).run();
    }
    articleChecks.interruptRunningAtStartup();
    articleDeliveryJobs.recoverRunning();
    if (options.recoverAssistantRuns !== false) {
      assistantRuns.interruptRunningAtStartup();
      creations.reconcileInterruptedAssistantRuns();
    }
    if (localSpaceIdentity) packs.synchronizeLocalSpaceIdentity(localSpaceIdentity);
    packs.reconcileInterruptedPackInstallAttempts();
    new PackSyncRepository(this.storage).interruptRunning();
    if (options.recoverGenerationRuns !== false) {
      db.transaction(() => db.exec(markInterruptedRunsSql))();
    }
    videoDocuments.interruptRunningTranscriptions();
    generationJobs.attachMissingRuns();
    if (defaultLibraryName?.trim()) {
      db.prepare("INSERT OR IGNORE INTO app_meta(key, value) VALUES ('library_name', ?)").run(
        defaultLibraryName.trim(),
      );
    }
    if (localSpaceIdentity) packs.renameLocalSpace(this.repositories.workbench.getLibraryName());
    this.initialized = true;
    return startupCheck;
  }

  /**
   * Explicitly imports a content fixture. This operation is intentionally kept
   * outside initialize() so external content can never become a boot dependency.
   */
  importFixture(fixturePath: string, options: FixtureImportOptions = {}) {
    return this.importFixtures([{ fixturePath, options }]);
  }

  importFixtures(
    fixtures: readonly { fixturePath: string; options?: FixtureImportOptions }[],
    kind: PackSyncSummary['kind'] = 'CONTENT_PACK',
  ) {
    if (!fixtures.length || fixtures.length > 100) throw new Error('Pack sync requires 1 to 100 fixtures');
    return new PackSyncRepository(this.storage).run(kind, (syncRunId) => {
      for (const fixture of fixtures) this.importFixtureInSync(fixture.fixturePath, fixture.options ?? {}, syncRunId);
    });
  }

  private importFixtureInSync(fixturePath: string, options: FixtureImportOptions, syncRunId: string) {
    const { db, fixturePacks, storage } = this.repositories;
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
    const fixturePackSource = options.profile ? fixturePacks.prepare(options.profile, sourcePaths!) : null;
    const syncs = new PackSyncRepository(storage);
    const syncItem = fixturePackSource
      ? {
          packId: fixturePackSource.profile.id,
          title: fixturePackSource.profile.displayName.slice(0, 300),
          version: fixturePackSource.releaseVersion,
        }
      : null;
    if (fixturePackSource && syncItem && !fixturePacks.isCurrent(fixturePackSource)) {
      syncs.recordItem(syncRunId, { ...syncItem, status: 'RUNNING' });
    }
    reconcileFixture(storage, fixturePath, {
      assetsRoot: options.assetsRoot,
      dictionaryPath: options.dictionaryPath,
      palettePath: options.palettePath,
    });
    if (options.facetRoles) assignFacetSystemRoles(db, options.facetRoles);
    if (fixturePackSource && !fixturePacks.isCurrent(fixturePackSource)) {
      if (syncItem) syncs.recordItem(syncRunId, { ...syncItem, status: 'RUNNING' });
      fixturePacks.ensure(fixturePackSource, syncRunId);
      if (!fixturePacks.isCurrent(fixturePackSource)) {
        throw new Error(`Content package did not converge: ${fixturePackSource.profile.id}`);
      }
      if (syncItem) syncs.recordItem(syncRunId, { ...syncItem, status: 'SUCCEEDED' });
    }
  }

  importContentPack(packagePath: string) {
    return this.repositories.contentPacks.importPackage(packagePath);
  }

  importBuiltinContentPacks(packagePaths: readonly string[]) {
    return this.repositories.contentPacks.importPackages(packagePaths, 'BUILTIN');
  }

  previewContentPack(packagePath: string) {
    return this.repositories.contentPacks.previewPackage(packagePath);
  }

  importPreviewedContentPack(
    packagePath: string,
    expectedContentHash: string,
    expectedPackageFingerprint: string,
    signal?: AbortSignal,
  ) {
    return this.repositories.contentPacks.importPreviewedPackage(
      packagePath,
      expectedContentHash,
      expectedPackageFingerprint,
      signal,
    );
  }

  /**
   * Called only after the background process has acquired its singleton IPC
   * endpoint. This prevents a duplicate worker from interrupting live jobs.
   */
  initializeModelWorker() {
    const { aiProcesses, assistantRuns, creations, db, generationJobs, videoDocuments } = this.repositories;
    assertDatabaseSchemaCompatible(db);
    // The singleton endpoint is the recovery lease for all detached model work.
    // Foreground database opens and host reconnects must never interrupt work
    // that is still owned by the surviving worker.
    aiProcesses.interruptRunningAtWorkerStartup();
    assistantRuns.interruptRunningAtStartup();
    creations.reconcileInterruptedAssistantRuns();
    db.transaction(() => db.exec(markInterruptedRunsSql))();
    videoDocuments.interruptRunningTranslations();
    generationJobs.attachMissingRuns();
  }

  close() {
    if (this.closed) return;
    this.repositories.articleRevisionPacks.stopScheduling();
    this.repositories.articleRevisionPacks.assertDrained();
    this.closed = true;
    this.repositories.libraryFileView.stopSynchronization();
    try {
      if (this.initialized) markDatabaseCleanShutdown(this.db);
    } finally {
      this.initialized = false;
      this.storage.close();
    }
  }

  startLibraryFileViewSynchronization() {
    return this.repositories.libraryFileView.startSynchronization();
  }

  drainLibraryFileViewSynchronization() {
    return this.repositories.libraryFileView.drainSynchronization();
  }

  setLibraryFileViewBackgroundSynchronizer(synchronizer: (() => Promise<void>) | null) {
    this.repositories.libraryFileView.setBackgroundSynchronizer(synchronizer);
  }

  scheduleLibraryFileViewSynchronization() {
    this.repositories.libraryFileView.scheduleSynchronization();
  }

  startRecycleBinCleanup() {
    this.repositories.contentLifecycle.startAutomaticCleanup();
  }

  startBackgroundStorage() {
    this.repositories.articleRevisionPacks.start();
    this.startLibraryFileViewSynchronization();
    this.startRecycleBinCleanup();
  }

  drainRecycleBinCleanup() {
    return Promise.all([
      this.repositories.contentLifecycle.stopAndDrain(),
      this.repositories.recycleBin.stopAndDrain(),
    ]).then(() => undefined);
  }

  async drainBackgroundStorage() {
    await this.repositories.articleRevisionPacks.stopAndDrain();
    await this.drainRecycleBinCleanup();
    await this.drainLibraryFileViewSynchronization();
  }

  synchronizeLibraryFileView() {
    return this.repositories.libraryFileView.synchronize();
  }

  refreshLibraryFileView() {
    return this.repositories.libraryFileView.refresh();
  }
}

/** Stable facade used by Electron services and IPC handlers. */
export type LibraryDatabase = LibraryDatabaseCore & LibraryDatabaseApi;

type LibraryDatabaseConstructor = {
  new (...args: ConstructorParameters<typeof LibraryDatabaseCore>): LibraryDatabase;
  readonly prototype: LibraryDatabase;
};

export const LibraryDatabase = LibraryDatabaseCore as LibraryDatabaseConstructor;
