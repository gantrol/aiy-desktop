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
    const { assistantRuns, creations, db, generationJobs, packs, videoDocuments } = this.repositories;
    initializeDatabaseSchema(db);
    if (options.recoverAssistantRuns !== false) {
      assistantRuns.interruptRunningAtStartup();
      creations.reconcileInterruptedAssistantRuns();
    }
    if (localSpaceIdentity) packs.synchronizeLocalSpaceIdentity(localSpaceIdentity);
    packs.reconcileInterruptedPackInstallAttempts();
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
  }

  /**
   * Explicitly imports a content fixture. This operation is intentionally kept
   * outside initialize() so external content can never become a boot dependency.
   */
  importFixture(fixturePath: string, options: FixtureImportOptions = {}) {
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
    reconcileFixture(storage, fixturePath, {
      assetsRoot: options.assetsRoot,
      dictionaryPath: options.dictionaryPath,
      palettePath: options.palettePath,
    });
    if (options.facetRoles) assignFacetSystemRoles(db, options.facetRoles);
    if (fixturePackSource && !fixturePacks.isCurrent(fixturePackSource)) {
      fixturePacks.ensure(fixturePackSource);
    }
    if (fixturePackSource && !fixturePacks.isCurrent(fixturePackSource)) {
      throw new Error(`Content package did not converge: ${fixturePackSource.profile.id}`);
    }
  }

  importContentPack(packagePath: string) {
    return this.repositories.contentPacks.importPackage(packagePath);
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
