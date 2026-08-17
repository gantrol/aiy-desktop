import type { LegacyLocalSpaceCandidateDto, LocalSpaceMigrationProgressEvent } from '@/shared/contracts/local-space';
import { copyLocalSpace } from '@/main/libraries/local-space-copy';
import { assertDatabaseUnchanged, verifyLocalSpaceDatabase } from '@/main/libraries/local-space-migration-database';
import { discoverLegacyLocalSpaces, type LegacyLocalSpaceSource } from '@/main/libraries/legacy-space-discovery';
import { LocalSpaceMigrationFailure } from '@/main/libraries/local-space-migration-error';

export interface LegacySpaceMigrationResult {
  rootPath: string;
  totalBytes: number;
  totalFiles: number;
}

export class LegacySpaceMigrationService {
  private candidates = new Map<string, LegacyLocalSpaceSource>();
  private active: { candidateId: string; controller: AbortController } | null = null;
  private activeCompletion: Promise<void> | null = null;

  constructor(
    private readonly options: {
      legacyUserDataRoots: readonly string[];
      currentUserDataRoot: string;
      forbiddenDestinationRoots: readonly string[];
    },
  ) {}

  async discover(registeredSpaceIds: ReadonlySet<string>): Promise<LegacyLocalSpaceCandidateDto[]> {
    const sources: LegacyLocalSpaceSource[] = [];
    const seenRoots = new Set<string>();
    const seenSpaceIds = new Set<string>();
    for (const legacyUserDataRoot of this.options.legacyUserDataRoots) {
      const discovered = await discoverLegacyLocalSpaces({
        legacyUserDataRoot,
        currentUserDataRoot: this.options.currentUserDataRoot,
        copyRequiredRoots: this.options.forbiddenDestinationRoots,
        registeredSpaceIds,
      });
      for (const source of discovered) {
        const rootKey = process.platform === 'win32' ? source.rootPath.toLocaleLowerCase('en-US') : source.rootPath;
        if (seenRoots.has(rootKey) || seenSpaceIds.has(source.spaceId)) continue;
        seenRoots.add(rootKey);
        seenSpaceIds.add(source.spaceId);
        sources.push(source);
      }
    }
    sources.sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt));
    const visibleSources = sources.slice(0, 200);
    this.candidates = new Map(visibleSources.map((source) => [source.candidateId, source]));
    return visibleSources.map(({ rootPath: _rootPath, ...candidate }) => candidate);
  }

  candidate(candidateId: string) {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new LocalSpaceMigrationFailure('SOURCE_UNAVAILABLE', 'Legacy local space is unavailable');
    return candidate;
  }

  cancel() {
    this.active?.controller.abort();
  }

  async dispose() {
    this.cancel();
    await this.activeCompletion;
  }

  async migrate(
    candidateId: string,
    destinationParent: string | null,
    report: (event: LocalSpaceMigrationProgressEvent) => void,
  ): Promise<LegacySpaceMigrationResult> {
    if (this.active)
      throw new LocalSpaceMigrationFailure('MIGRATION_BUSY', 'A local-space migration is already running');
    const source = this.candidate(candidateId);
    const controller = new AbortController();
    const { signal } = controller;
    this.active = { candidateId, controller };
    let complete!: () => void;
    this.activeCompletion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const emit = (
      stage: LocalSpaceMigrationProgressEvent['stage'],
      progress: number,
      copiedBytes = 0,
      totalBytes = 0,
      copiedFiles = 0,
      totalFiles = 0,
    ) =>
      report({
        candidateId,
        stage,
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        copiedBytes,
        totalBytes,
        copiedFiles,
        totalFiles,
      });

    try {
      emit('PREPARING', 2);
      const sourceFingerprint = await verifyLocalSpaceDatabase(source.rootPath, 'SOURCE', signal);
      if (!source.requiresCopy) {
        emit('VERIFYING', 92);
        return { rootPath: source.rootPath, totalBytes: 0, totalFiles: 0 };
      }
      if (!destinationParent) {
        throw new LocalSpaceMigrationFailure('DESTINATION_INVALID', 'A migration destination is required');
      }

      let latestCopyProgress = { copiedBytes: 0, totalBytes: 0, copiedFiles: 0, totalFiles: 0 };
      const copied = await copyLocalSpace({
        sourceRoot: source.rootPath,
        spaceName: source.name,
        destinationParent,
        forbiddenDestinationRoots: this.options.forbiddenDestinationRoots,
        signal,
        report: ({ copiedBytes, totalBytes, copiedFiles, totalFiles }) => {
          latestCopyProgress = { copiedBytes, totalBytes, copiedFiles, totalFiles };
          const byteRatio = totalBytes ? copiedBytes / totalBytes : 1;
          const fileRatio = totalFiles ? copiedFiles / totalFiles : 1;
          emit(
            'COPYING',
            5 + (byteRatio * 0.95 + fileRatio * 0.05) * 82,
            copiedBytes,
            totalBytes,
            copiedFiles,
            totalFiles,
          );
        },
        verify: async (stagingRoot) => {
          emit(
            'VERIFYING',
            90,
            latestCopyProgress.copiedBytes,
            latestCopyProgress.totalBytes,
            latestCopyProgress.copiedFiles,
            latestCopyProgress.totalFiles,
          );
          const sourceAfterCopy = await verifyLocalSpaceDatabase(source.rootPath, 'SOURCE', signal);
          assertDatabaseUnchanged(sourceFingerprint, sourceAfterCopy, 'SOURCE');
          const destinationFingerprint = await verifyLocalSpaceDatabase(stagingRoot, 'DESTINATION', signal);
          assertDatabaseUnchanged(sourceFingerprint, destinationFingerprint, 'DESTINATION');
        },
      });
      return copied;
    } catch (error) {
      if (error instanceof LocalSpaceMigrationFailure || signal.aborted) throw error;
      throw new LocalSpaceMigrationFailure('COPY_FAILED', 'The local-space copy failed', { cause: error });
    } finally {
      if (this.active?.controller === controller) this.active = null;
      complete();
      this.activeCompletion = null;
    }
  }
}
