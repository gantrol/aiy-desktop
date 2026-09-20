import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  LegacyLocalSpaceCandidateDto,
  LocalSpaceCoverUpdateResult,
  LocalSpaceDescriptorDto,
  LocalSpaceExportResult,
  LocalSpaceImportResult,
  LocalSpaceMigrationResult,
  LocalSpaceRegistryDto,
  LocalSpaceSwitchResult,
  PackImportPreviewDto,
  PackImportLocalResult,
  TransitionPreviewDto,
} from '@/shared/contracts';
import type { LibraryDatabase } from '@/main/database';
import { applyContentPackCommand, previewContentPackCommand } from '@/main/content-packs/commands';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';

export interface LocalSpaceActions {
  listSpaces(): LocalSpaceRegistryDto;
  discoverLegacy(): Promise<LegacyLocalSpaceCandidateDto[]>;
  migrateLegacy(candidateId: string, destinationParent: string | null): Promise<LocalSpaceMigrationResult>;
  cancelLegacyMigration(): void;
  currentSpaceId(): string;
  currentSpaceName(): string;
  exportCurrent(destinationPath: string): Promise<LocalSpaceExportResult>;
  importArchive(archivePath: string, destinationParent: string): Promise<LocalSpaceImportResult>;
  cancelTransfer(): void;
  currentCoverUrl(): string | null;
  currentPreviews(): TransitionPreviewDto[];
  refreshCurrentPreviews(): void;
  open(rootPath: string): LocalSpaceSwitchResult | Promise<LocalSpaceSwitchResult>;
  switchTo(spaceId: string): LocalSpaceSwitchResult | Promise<LocalSpaceSwitchResult>;
  create(name: string): LocalSpaceSwitchResult | Promise<LocalSpaceSwitchResult>;
  setCover(spaceId: string, sourcePath: string): LocalSpaceDescriptorDto | Promise<LocalSpaceDescriptorDto>;
  removeCover(spaceId: string): LocalSpaceDescriptorDto | Promise<LocalSpaceDescriptorDto>;
}

interface DirectorySelection {
  canceled: boolean;
  filePaths: string[];
}

interface SaveSelection {
  canceled: boolean;
  filePath?: string;
}

const id = z.string().min(1).max(200);
const packInstallExactSchema = z.object({ packId: id, releaseId: id });
const pendingPackImportId = z.string().uuid();

export function registerStorageIpc(
  database: LibraryDatabase,
  localSpaces: LocalSpaceActions,
  chooseDirectory: () => Promise<DirectorySelection>,
  chooseMigrationDestination: () => Promise<DirectorySelection>,
  chooseExportDestination: (suggestedName: string) => Promise<SaveSelection>,
  chooseImportArchive: () => Promise<DirectorySelection>,
  chooseImportDestination: () => Promise<DirectorySelection>,
  chooseCover: () => Promise<DirectorySelection>,
  importStarterPack: () => Promise<string>,
  ipcMain: IpcHandlerRegistrar,
) {
  const pendingPackImports = new Map<
    string,
    {
      packagePath: string;
      packageFingerprint: string;
      spaceId: string;
      preview: PackImportPreviewDto;
      createdAt: number;
    }
  >();
  const prunePendingPackImports = () => {
    const expiresBefore = Date.now() - 30 * 60 * 1000;
    for (const [requestId, pending] of pendingPackImports) {
      if (pending.createdAt < expiresBefore) pendingPackImports.delete(requestId);
    }
    while (pendingPackImports.size > 8) {
      const oldestRequestId = pendingPackImports.keys().next().value;
      if (!oldestRequestId) break;
      pendingPackImports.delete(oldestRequestId);
    }
  };
  ipcMain.handle('local-spaces:list', () => localSpaces.listSpaces());
  ipcMain.handle('local-spaces:discover-legacy', () => localSpaces.discoverLegacy());
  ipcMain.handle('local-spaces:migrate-legacy', async (event, rawCandidateId) => {
    const candidateId = id.parse(rawCandidateId);
    const candidate = (await localSpaces.discoverLegacy()).find((item) => item.candidateId === candidateId);
    if (!candidate) {
      return { status: 'failed', errorCode: 'SOURCE_UNAVAILABLE' } satisfies LocalSpaceMigrationResult;
    }
    let destinationParent: string | null = null;
    if (candidate.requiresCopy) {
      const result = await chooseMigrationDestination();
      if (result.canceled || !result.filePaths[0]) {
        return { status: 'cancelled' } satisfies LocalSpaceMigrationResult;
      }
      destinationParent = result.filePaths[0];
    }
    if (event.sender.isDestroyed()) return { status: 'cancelled' } satisfies LocalSpaceMigrationResult;
    const cancel = () => localSpaces.cancelLegacyMigration();
    event.sender.once('destroyed', cancel);
    try {
      return await localSpaces.migrateLegacy(candidateId, destinationParent);
    } finally {
      event.sender.removeListener('destroyed', cancel);
    }
  });
  ipcMain.handle('local-spaces:cancel-legacy-migration', () => localSpaces.cancelLegacyMigration());
  ipcMain.handle('local-spaces:export-current', async (event) => {
    const result = await chooseExportDestination(localSpaces.currentSpaceName());
    if (result.canceled || !result.filePath) return { status: 'cancelled' } satisfies LocalSpaceExportResult;
    if (event.sender.isDestroyed()) return { status: 'cancelled' } satisfies LocalSpaceExportResult;
    const cancel = () => localSpaces.cancelTransfer();
    event.sender.once('destroyed', cancel);
    try {
      return await localSpaces.exportCurrent(result.filePath);
    } finally {
      event.sender.removeListener('destroyed', cancel);
    }
  });
  ipcMain.handle('local-spaces:import-archive', async (event) => {
    const archive = await chooseImportArchive();
    if (archive.canceled || !archive.filePaths[0]) {
      return { status: 'cancelled' } satisfies LocalSpaceImportResult;
    }
    const destination = await chooseImportDestination();
    if (destination.canceled || !destination.filePaths[0] || event.sender.isDestroyed()) {
      return { status: 'cancelled' } satisfies LocalSpaceImportResult;
    }
    const cancel = () => localSpaces.cancelTransfer();
    event.sender.once('destroyed', cancel);
    try {
      return await localSpaces.importArchive(archive.filePaths[0], destination.filePaths[0]);
    } finally {
      event.sender.removeListener('destroyed', cancel);
    }
  });
  ipcMain.handle('local-spaces:cancel-transfer', () => localSpaces.cancelTransfer());
  ipcMain.handle('local-spaces:open', async () => {
    const result = await chooseDirectory();
    if (result.canceled || !result.filePaths[0]) {
      return { status: 'cancelled' } satisfies LocalSpaceSwitchResult;
    }
    return localSpaces.open(result.filePaths[0]);
  });
  ipcMain.handle('local-spaces:switch', (_event, rawId) => localSpaces.switchTo(id.parse(rawId)));
  ipcMain.handle('local-spaces:create', (_event, rawName) => localSpaces.create(z.string().max(200).parse(rawName)));
  ipcMain.handle('local-spaces:choose-cover', async (_event, rawId) => {
    const spaceId = id.parse(rawId);
    const result = await chooseCover();
    if (result.canceled || !result.filePaths[0]) {
      return { status: 'cancelled' } satisfies LocalSpaceCoverUpdateResult;
    }
    return {
      status: 'updated',
      space: await localSpaces.setCover(spaceId, result.filePaths[0]),
    } satisfies LocalSpaceCoverUpdateResult;
  });
  ipcMain.handle('local-spaces:remove-cover', (_event, rawId) => localSpaces.removeCover(id.parse(rawId)));

  ipcMain.handle('packs:list', () => database.listPackCatalog());
  ipcMain.handle('content-pack:import-local', async () => {
    const result = await chooseDirectory();
    if (result.canceled || !result.filePaths[0]) {
      return { status: 'cancelled', preview: null } satisfies PackImportLocalResult;
    }
    prunePendingPackImports();
    const requestId = randomUUID();
    const { packageFingerprint, ...plannedPreview } = await previewContentPackCommand(database, {
      protocolVersion: 1,
      spaceId: database.getLocalSpace().id,
      path: result.filePaths[0],
    });
    const preview = { ...plannedPreview, requestId };
    pendingPackImports.set(requestId, {
      packagePath: result.filePaths[0],
      packageFingerprint,
      spaceId: database.getLocalSpace().id,
      preview,
      createdAt: Date.now(),
    });
    prunePendingPackImports();
    return {
      status: 'preview',
      preview,
    } satisfies PackImportLocalResult;
  });
  ipcMain.handle('content-pack:apply-local', async (_event, rawRequestId) => {
    prunePendingPackImports();
    const requestId = pendingPackImportId.parse(rawRequestId);
    const pending = pendingPackImports.get(requestId);
    if (!pending) throw new Error('Content pack update preview expired');
    pendingPackImports.delete(requestId);
    if (database.getLocalSpace().id !== pending.spaceId) {
      throw new Error('The active local space changed after the content pack preview');
    }
    return applyContentPackCommand(database, {
      protocolVersion: 1,
      spaceId: pending.spaceId,
      path: pending.packagePath,
      expectedContentHash: pending.preview.targetContentHash,
      expectedPackageFingerprint: pending.packageFingerprint,
    });
  });
  ipcMain.handle('content-pack:discard-local', (_event, rawRequestId) => {
    pendingPackImports.delete(pendingPackImportId.parse(rawRequestId));
  });
  ipcMain.handle('content-pack:import-starter', () => importStarterPack());
  ipcMain.handle('pack-release:get', (_event, rawReleaseId) => {
    const release = database.getPackRelease(id.parse(rawReleaseId));
    return { ...release, itemCount: release.items.length, dependencyCount: release.dependencies.length };
  });
  ipcMain.handle('pack:install-exact', (_event, raw) => {
    const input = packInstallExactSchema.parse(raw);
    const release = database.getPackRelease(input.releaseId);
    if (release.packId !== input.packId) throw new Error('Pack release does not belong to pack');
    return database.installExactPackRelease({
      packId: input.packId,
      releaseId: input.releaseId,
      source: { source: 'USER' },
      verification: { contentHash: release.contentHash, itemCount: release.items.length },
    });
  });
  ipcMain.handle('pack:set-disabled', (_event, rawPackId, rawDisabled) =>
    database.setPackInstallationDisabled(id.parse(rawPackId), z.boolean().parse(rawDisabled)),
  );
  ipcMain.handle('pack:remove', (_event, rawPackId) => {
    const packId = id.parse(rawPackId);
    const installation = database.listPackInstallations().find((item) => item.packId === packId);
    if (!installation?.selectedReleaseId) throw new Error('Pack is not installed');
    const attempt = database.beginPackInstallAttempt({
      packId,
      targetReleaseId: installation.selectedReleaseId,
      operation: 'REMOVE',
      source: { source: 'USER' },
    });
    try {
      return database.completePackInstallAttempt(attempt.id, { retainedUserData: true });
    } catch (error) {
      database.failPackInstallAttempt(attempt.id, {
        code: 'PACK_REMOVE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
}
