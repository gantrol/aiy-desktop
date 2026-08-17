import type { DesktopApplicationShell } from '@/main/app/application-shell';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { LegacySpaceMigrationService } from '@/main/libraries/legacy-space-migration';
import { isAbortError, LocalSpaceMigrationFailure } from '@/main/libraries/local-space-migration-error';
import type { LibraryDescriptor, LibraryRegistry } from '@/main/libraries/library-registry';
import type {
  LocalSpaceMigrationProgressEvent,
  LocalSpaceMigrationResult,
  LocalSpaceSwitchResult,
} from '@/shared/contracts/local-space';

export function createLegacySpaceMigrationActions(options: {
  appShell: DesktopApplicationShell;
  registry: LibraryRegistry;
  service: LegacySpaceMigrationService;
  assertLibrarySwitchable(): void;
  transitionTo(library: LibraryDescriptor, operation: string): Promise<LocalSpaceSwitchResult>;
  sendProgress(event: LocalSpaceMigrationProgressEvent): void;
}) {
  const { appShell, registry, service, assertLibrarySwitchable, transitionTo, sendProgress } = options;
  const registeredSpaceIds = () => new Set(registry.list().libraries.map((library) => library.id));
  const discoverLegacy = () => service.discover(registeredSpaceIds());

  const migrateLegacy = async (
    candidateId: string,
    destinationParent: string | null,
  ): Promise<LocalSpaceMigrationResult> => {
    let pausedContext: ActiveLibraryContext | null = null;
    let phase: 'PREPARING' | 'COPYING' | 'REGISTERING' = 'PREPARING';
    try {
      assertLibrarySwitchable();
      pausedContext = appShell.activeLibraryContext;
      if (!pausedContext) return { status: 'failed', errorCode: 'MIGRATION_BUSY' };
      appShell.libraryTransitionPending = true;
      await pausedContext.drain();
      phase = 'COPYING';
      const migrated = await service.migrate(candidateId, destinationParent, sendProgress);

      pausedContext.resume();
      appShell.libraryTransitionPending = false;
      phase = 'REGISTERING';
      const registering: LocalSpaceMigrationProgressEvent = {
        candidateId,
        stage: 'REGISTERING',
        progress: 96,
        copiedBytes: migrated.totalBytes,
        totalBytes: migrated.totalBytes,
        copiedFiles: migrated.totalFiles,
        totalFiles: migrated.totalFiles,
      };
      sendProgress(registering);
      const idsBeforeRegistration = registeredSpaceIds();
      const migratedLibrary = registry.registerExisting(migrated.rootPath);
      try {
        const result = await transitionTo(migratedLibrary, 'legacy-migration');
        if (result.status === 'switched') {
          sendProgress({ ...registering, stage: 'COMPLETED', progress: 100 });
        }
        return result;
      } catch (error) {
        if (!idsBeforeRegistration.has(migratedLibrary.id)) registry.unregisterCandidate(migratedLibrary.id);
        throw error;
      }
    } catch (error) {
      if (isAbortError(error)) return { status: 'cancelled' };
      const errorCode =
        error instanceof LocalSpaceMigrationFailure
          ? error.code
          : phase === 'PREPARING'
            ? 'MIGRATION_BUSY'
            : phase === 'REGISTERING'
              ? 'VERIFY_FAILED'
              : 'COPY_FAILED';
      console.error('[local-space-migration] migration failed', { candidateId, errorCode, error });
      return { status: 'failed', errorCode };
    } finally {
      if (appShell.activeLibraryContext === pausedContext) pausedContext?.resume();
      appShell.libraryTransitionPending = false;
    }
  };

  return {
    discoverLegacy,
    migrateLegacy,
    cancelLegacyMigration: () => service.cancel(),
  };
}
