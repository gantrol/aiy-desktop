import path from 'node:path';
import type { DesktopApplicationShell } from '@/main/app/application-shell';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { LibraryDescriptor, LibraryRegistry } from '@/main/libraries/library-registry';
import type { LocalSpaceTransferService } from '@/main/libraries/local-space-transfer';
import { isTransferAbortError, LocalSpaceTransferFailure } from '@/main/libraries/local-space-transfer-error';
import type {
  LocalSpaceExportResult,
  LocalSpaceImportResult,
  LocalSpaceSwitchResult,
  LocalSpaceTransferProgressEvent,
} from '@/shared/contracts/local-space';

type TransferPhase = 'PREPARING' | 'TRANSFERRING' | 'REGISTERING';

function transferErrorCode(error: unknown, phase: TransferPhase) {
  if (error instanceof LocalSpaceTransferFailure) return error.code;
  if (phase === 'PREPARING') return 'TRANSFER_BUSY' as const;
  if (phase === 'REGISTERING') return 'VERIFY_FAILED' as const;
  return 'WRITE_FAILED' as const;
}

export function createLocalSpaceTransferActions(options: {
  appShell: DesktopApplicationShell;
  registry: LibraryRegistry;
  service: LocalSpaceTransferService;
  assertLibrarySwitchable(): void;
  transitionTo(library: LibraryDescriptor, operation: string): Promise<LocalSpaceSwitchResult>;
  sendProgress(event: LocalSpaceTransferProgressEvent): void;
}) {
  const { appShell, registry, service, assertLibrarySwitchable, transitionTo, sendProgress } = options;
  const registeredSpaceIds = () => new Set(registry.list().libraries.map((library) => library.id));

  const exportCurrent = async (destinationPath: string): Promise<LocalSpaceExportResult> => {
    let pausedContext: ActiveLibraryContext | null = null;
    let phase: TransferPhase = 'PREPARING';
    try {
      assertLibrarySwitchable();
      pausedContext = appShell.activeLibraryContext;
      if (!pausedContext) return { status: 'failed', errorCode: 'TRANSFER_BUSY' };
      const sourceLibrary = pausedContext.library;
      appShell.libraryTransitionPending = true;
      await pausedContext.drain();
      phase = 'TRANSFERRING';
      const exported = await service.exportSpace({
        database: pausedContext.database,
        library: sourceLibrary,
        destinationPath,
        report: sendProgress,
      });
      return {
        status: 'exported',
        fileName: path.basename(exported.destinationPath),
        byteSize: exported.byteSize,
      };
    } catch (error) {
      if (isTransferAbortError(error)) return { status: 'cancelled' };
      const errorCode = transferErrorCode(error, phase);
      console.error('[local-space-transfer] export failed', { errorCode, error });
      return { status: 'failed', errorCode };
    } finally {
      if (appShell.activeLibraryContext === pausedContext) pausedContext?.resume();
      appShell.libraryTransitionPending = false;
    }
  };

  const importArchive = async (archivePath: string, destinationParent: string): Promise<LocalSpaceImportResult> => {
    let pausedContext: ActiveLibraryContext | null = null;
    let phase: TransferPhase = 'PREPARING';
    const latest = { processedBytes: 0, totalBytes: 0, processedFiles: 0, totalFiles: 0 };
    const report = (event: LocalSpaceTransferProgressEvent) => {
      latest.processedBytes = event.processedBytes;
      latest.totalBytes = event.totalBytes;
      latest.processedFiles = event.processedFiles;
      latest.totalFiles = event.totalFiles;
      sendProgress(event);
    };
    try {
      assertLibrarySwitchable();
      pausedContext = appShell.activeLibraryContext;
      if (!pausedContext) return { status: 'failed', errorCode: 'TRANSFER_BUSY' };
      appShell.libraryTransitionPending = true;
      await pausedContext.drain();
      phase = 'TRANSFERRING';
      const imported = await service.importSpace({
        archivePath,
        destinationParent,
        registeredSpaceIds: registeredSpaceIds(),
        report,
      });

      pausedContext.resume();
      appShell.libraryTransitionPending = false;
      phase = 'REGISTERING';
      const registering: LocalSpaceTransferProgressEvent = {
        operation: 'IMPORT',
        stage: 'REGISTERING',
        progress: 96,
        processedBytes: latest.processedBytes || imported.totalBytes,
        totalBytes: latest.totalBytes || imported.totalBytes,
        processedFiles: latest.processedFiles || imported.totalFiles,
        totalFiles: latest.totalFiles || imported.totalFiles,
      };
      sendProgress(registering);
      const idsBeforeRegistration = registeredSpaceIds();
      const importedLibrary = registry.registerExisting(imported.rootPath);
      try {
        const result = await transitionTo(importedLibrary, 'space-import');
        if (result.status === 'switched') {
          sendProgress({ ...registering, stage: 'COMPLETED', progress: 100 });
        }
        return result;
      } catch (error) {
        if (!idsBeforeRegistration.has(importedLibrary.id)) registry.unregisterCandidate(importedLibrary.id);
        throw error;
      }
    } catch (error) {
      if (isTransferAbortError(error)) return { status: 'cancelled' };
      const errorCode = transferErrorCode(error, phase);
      console.error('[local-space-transfer] import failed', { errorCode, error });
      return { status: 'failed', errorCode };
    } finally {
      if (appShell.activeLibraryContext === pausedContext) pausedContext?.resume();
      appShell.libraryTransitionPending = false;
    }
  };

  return {
    exportCurrent,
    importArchive,
    cancelTransfer: () => service.cancel(),
  };
}
