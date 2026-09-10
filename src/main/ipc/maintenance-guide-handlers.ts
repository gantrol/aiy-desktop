import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  shell,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
} from 'electron';
import { ZodError } from 'zod';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import { writeJsonAtomicallyAsync } from '@/main/app/atomic-json-file';
import {
  MaintenanceGuideError,
  MaintenanceGuideStore,
  readMaintenanceGuide,
} from '@/main/extensions/maintenance-guide/store';
import {
  maintenanceMutationSchema,
  maintenanceOpenInputSchema,
  maintenanceProjectInputSchema,
  maintenanceReadInputSchema,
  maintenanceRevisionInputSchema,
  maintenanceWebUrlSchema,
  type MaintenanceResult,
} from '@/shared/contracts/maintenance-guide';
import { MAINTENANCE_GUIDE_EXTENSION_ID } from '@/shared/extension-ids';
import { maintenanceToolUrl } from '@/shared/maintenance-tools';

interface Options {
  ipcMain: IpcHandlerRegistrar;
  extensions: ExtensionRegistry;
  dataDirectory: string;
  chooseFile(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
  chooseSaveFile(options: SaveDialogOptions): Promise<SaveDialogReturnValue>;
}

export function registerMaintenanceGuideIpc({
  ipcMain,
  extensions,
  dataDirectory,
  chooseFile,
  chooseSaveFile,
}: Options) {
  const store = new MaintenanceGuideStore(path.join(dataDirectory, 'projects.json'));
  const checkActive = () => {
    if (!extensions.isActivated(MAINTENANCE_GUIDE_EXTENSION_ID)) throw new MaintenanceGuideError('disabled');
  };
  const invoke = async <T>(operation: () => Promise<T>): Promise<MaintenanceResult<T>> => {
    try {
      checkActive();
      const value = await operation();
      checkActive();
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof MaintenanceGuideError
            ? error.code
            : error instanceof ZodError || error instanceof SyntaxError
              ? 'invalidInput'
              : 'fileUnavailable',
      };
    }
  };
  ipcMain.handle('maintenance-guide:list', () => invoke(() => store.list()));
  ipcMain.handle('maintenance-guide:mutate', (_event, raw) =>
    invoke(() => store.mutate(maintenanceMutationSchema.parse(raw), checkActive)),
  );
  ipcMain.handle('maintenance-guide:attach', (_event, raw) =>
    invoke(async () => {
      const input = maintenanceProjectInputSchema.parse(raw);
      store.project(await store.list(), input.projectId);
      const selection = await chooseFile({
        properties: ['openFile'],
        filters: [{ name: 'Markdown / Text', extensions: ['md', 'markdown', 'txt'] }],
      });
      checkActive();
      if (selection.canceled || !selection.filePaths[0]) return store.list();
      const document = await readMaintenanceGuide(selection.filePaths[0]);
      return store.change(input.revision, checkActive, (state) => {
        const project = store.project(state, input.projectId);
        if (!project.guides.some((guide) => guide.path === document.path)) {
          project.guides.push({ id: randomUUID(), name: path.basename(document.path), path: document.path });
        }
      });
    }),
  );
  ipcMain.handle('maintenance-guide:read', (_event, raw) =>
    invoke(async () => {
      const input = maintenanceReadInputSchema.parse(raw);
      const guide = store.project(await store.list(), input.projectId).guides.find((item) => item.id === input.guideId);
      if (!guide) throw new MaintenanceGuideError('fileUnavailable');
      return readMaintenanceGuide(guide.path);
    }),
  );
  ipcMain.handle('maintenance-guide:open', (_event, raw) =>
    invoke(async () => {
      const input = maintenanceOpenInputSchema.parse(raw);
      const project = store.project(await store.list(), input.projectId);
      const url = maintenanceToolUrl(project, input.toolId);
      if (!url) throw new MaintenanceGuideError('invalidInput');
      const parsed = maintenanceWebUrlSchema.parse(url);
      checkActive();
      try {
        await shell.openExternal(parsed);
      } catch {
        throw new MaintenanceGuideError('openFailed');
      }
      return null;
    }),
  );
  ipcMain.handle('maintenance-guide:import', (_event, raw) =>
    invoke(async () => {
      const input = maintenanceRevisionInputSchema.parse(raw);
      const selection = await chooseFile({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      checkActive();
      if (selection.canceled || !selection.filePaths[0]) return store.list();
      return store.importFile(selection.filePaths[0], input.revision, checkActive);
    }),
  );
  ipcMain.handle('maintenance-guide:export', () =>
    invoke(async () => {
      const selection = await chooseSaveFile({
        defaultPath: 'maintenance-projects.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      checkActive();
      if (selection.canceled || !selection.filePath) return false;
      if (
        !path.isAbsolute(selection.filePath) ||
        /trash/i.test(selection.filePath) ||
        path.extname(selection.filePath).toLowerCase() !== '.json'
      ) {
        throw new MaintenanceGuideError('invalidInput');
      }
      const state = await store.list();
      checkActive();
      await writeJsonAtomicallyAsync(selection.filePath, state);
      return true;
    }),
  );
}
