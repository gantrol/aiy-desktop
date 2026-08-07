import { z } from 'zod';
import type {
  LocalSpaceCoverUpdateResult,
  LocalSpaceDescriptorDto,
  LocalSpaceRegistryDto,
  LocalSpaceSwitchResult,
  PackImportLocalResult,
} from '@/shared/contracts';
import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';

export interface LocalSpaceActions {
  listSpaces(): LocalSpaceRegistryDto;
  currentCoverUrl(): string | null;
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

const id = z.string().min(1).max(200);
const packInstallExactSchema = z.object({ packId: id, releaseId: id });

export function registerStorageIpc(
  database: LibraryDatabase,
  localSpaces: LocalSpaceActions,
  chooseDirectory: () => Promise<DirectorySelection>,
  chooseCover: () => Promise<DirectorySelection>,
  importStarterPack: () => string,
  ipcMain: IpcHandlerRegistrar,
) {
  ipcMain.handle('local-spaces:list', () => localSpaces.listSpaces());
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
      return { status: 'cancelled', packId: null } satisfies PackImportLocalResult;
    }
    return {
      status: 'imported',
      packId: database.importContentPack(result.filePaths[0]),
    } satisfies PackImportLocalResult;
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
