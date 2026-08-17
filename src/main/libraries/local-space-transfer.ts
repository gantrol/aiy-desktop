import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryDatabase } from '@/main/database';
import { LOCAL_SPACE_ARCHIVE_EXTENSION } from '@/main/libraries/local-space-archive-format';
import { readLocalSpaceArchive } from '@/main/libraries/local-space-archive-reader';
import { writeLocalSpaceArchive, type LocalSpaceArchiveProgress } from '@/main/libraries/local-space-archive-writer';
import { createLocalSpaceDatabaseSnapshot } from '@/main/libraries/local-space-transfer-database';
import { LocalSpaceTransferFailure } from '@/main/libraries/local-space-transfer-error';
import type { LibraryDescriptor } from '@/main/libraries/library-registry';
import type { LocalSpaceTransferProgressEvent } from '@/shared/contracts/local-space';

function pathKey(value: string) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function normalizedArchivePath(destinationPath: string) {
  const resolved = path.resolve(destinationPath);
  return resolved.toLocaleLowerCase('en-US').endsWith(LOCAL_SPACE_ARCHIVE_EXTENSION)
    ? resolved
    : `${resolved}${LOCAL_SPACE_ARCHIVE_EXTENSION}`;
}

export class LocalSpaceTransferService {
  private active: { operation: 'EXPORT' | 'IMPORT'; controller: AbortController } | null = null;
  private activeCompletion: Promise<void> | null = null;

  constructor(
    private readonly options: {
      applicationVersion: string;
      temporaryRoot: string;
      forbiddenDestinationRoots: readonly string[];
    },
  ) {}

  cancel() {
    this.active?.controller.abort();
  }

  async dispose() {
    this.cancel();
    await this.activeCompletion;
  }

  async exportSpace(options: {
    database: LibraryDatabase;
    library: LibraryDescriptor;
    destinationPath: string;
    report(event: LocalSpaceTransferProgressEvent): void;
  }) {
    const operation = this.begin('EXPORT');
    const { signal } = operation.controller;
    let temporaryDirectory: string | null = null;
    let latest: LocalSpaceArchiveProgress = { processedBytes: 0, totalBytes: 0, processedFiles: 0, totalFiles: 0 };
    const emit = (stage: LocalSpaceTransferProgressEvent['stage'], progress: number) =>
      options.report({
        operation: 'EXPORT',
        stage,
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        ...latest,
      });

    try {
      emit('PREPARING', 2);
      await mkdir(this.options.temporaryRoot, { recursive: true });
      temporaryDirectory = await mkdtemp(path.join(this.options.temporaryRoot, 'aiy-space-export-'));
      const snapshotPath = path.join(temporaryDirectory, 'library.sqlite3');
      const snapshot = await createLocalSpaceDatabaseSnapshot({
        database: options.database.db,
        destinationPath: snapshotPath,
        signal,
        report: (progress) => emit('SNAPSHOTTING', 3 + progress * 9),
      });
      const destinationPath = normalizedArchivePath(options.destinationPath);
      const written = await writeLocalSpaceArchive({
        sourceRoot: options.library.rootPath,
        databaseSnapshotPath: snapshotPath,
        destinationPath,
        header: {
          format: 'AIYSPACE',
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          applicationVersion: this.options.applicationVersion,
          databaseSchemaRevision: snapshot.schemaRevision,
          space: {
            id: options.library.id,
            name: options.library.name,
            createdAt: options.library.createdAt,
          },
        },
        signal,
        report: (progress) => {
          latest = progress;
          const byteRatio = progress.totalBytes ? progress.processedBytes / progress.totalBytes : 1;
          const fileRatio = progress.totalFiles ? progress.processedFiles / progress.totalFiles : 1;
          emit('WRITING', 12 + (byteRatio * 0.95 + fileRatio * 0.05) * 84);
        },
      });
      latest = {
        processedBytes: written.totalBytes,
        totalBytes: written.totalBytes,
        processedFiles: written.totalFiles,
        totalFiles: written.totalFiles,
      };
      emit('COMPLETED', 100);
      return { destinationPath, byteSize: written.byteSize };
    } catch (error) {
      if (error instanceof LocalSpaceTransferFailure || signal.aborted) throw error;
      throw new LocalSpaceTransferFailure('WRITE_FAILED', 'Local-space export failed', { cause: error });
    } finally {
      if (temporaryDirectory) {
        await this.cleanupTemporaryDirectory(temporaryDirectory).catch((error) => {
          console.error('[local-space-transfer] failed to clean export snapshot directory', error);
        });
      }
      operation.complete();
    }
  }

  async importSpace(options: {
    archivePath: string;
    destinationParent: string;
    registeredSpaceIds: ReadonlySet<string>;
    report(event: LocalSpaceTransferProgressEvent): void;
  }) {
    const operation = this.begin('IMPORT');
    const { signal } = operation.controller;
    let latest: LocalSpaceArchiveProgress = { processedBytes: 0, totalBytes: 0, processedFiles: 0, totalFiles: 0 };
    const emit = (stage: LocalSpaceTransferProgressEvent['stage'], progress: number) =>
      options.report({
        operation: 'IMPORT',
        stage,
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        ...latest,
      });

    try {
      emit('PREPARING', 2);
      return await readLocalSpaceArchive({
        archivePath: options.archivePath,
        destinationParent: options.destinationParent,
        forbiddenDestinationRoots: this.options.forbiddenDestinationRoots,
        registeredSpaceIds: options.registeredSpaceIds,
        signal,
        report: (progress) => {
          latest = progress;
          const byteRatio = progress.totalBytes ? progress.processedBytes / progress.totalBytes : 1;
          const fileRatio = progress.totalFiles ? progress.processedFiles / progress.totalFiles : 1;
          emit('READING', 5 + (byteRatio * 0.95 + fileRatio * 0.05) * 83);
        },
        onVerifying: () => emit('VERIFYING', 91),
      });
    } catch (error) {
      if (error instanceof LocalSpaceTransferFailure || signal.aborted) throw error;
      throw new LocalSpaceTransferFailure('ARCHIVE_INVALID', 'Local-space import failed', { cause: error });
    } finally {
      operation.complete();
    }
  }

  private begin(operation: 'EXPORT' | 'IMPORT') {
    if (this.active) throw new LocalSpaceTransferFailure('TRANSFER_BUSY', 'A local-space transfer is already running');
    const controller = new AbortController();
    this.active = { operation, controller };
    let resolveCompletion!: () => void;
    this.activeCompletion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    let completed = false;
    return {
      controller,
      complete: () => {
        if (completed) return;
        completed = true;
        if (this.active?.controller === controller) this.active = null;
        resolveCompletion();
        this.activeCompletion = null;
      },
    };
  }

  private async cleanupTemporaryDirectory(directoryPath: string) {
    const resolved = path.resolve(directoryPath);
    if (
      pathKey(path.dirname(resolved)) !== pathKey(this.options.temporaryRoot) ||
      !path.basename(resolved).startsWith('aiy-space-export-')
    ) {
      throw new Error('Refusing to clean an unexpected export path');
    }
    try {
      const stats = await lstat(resolved);
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Refusing to clean a replaced export path');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await rm(resolved, { recursive: true, force: true });
  }
}
