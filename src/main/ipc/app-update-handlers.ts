import type { AppUpdateStateDto } from '@/shared/contracts/app-update';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';

export interface AppUpdateActions {
  getState(): AppUpdateStateDto;
  check(): Promise<AppUpdateStateDto>;
  download(): Promise<AppUpdateStateDto>;
  install(): Promise<AppUpdateStateDto>;
}

export function registerAppUpdateIpc(ipcMain: IpcHandlerRegistrar, updates: AppUpdateActions) {
  ipcMain.handle('app-update:get-state', () => updates.getState());
  ipcMain.handle('app-update:check', () => updates.check());
  ipcMain.handle('app-update:download', () => updates.download());
  ipcMain.handle('app-update:install', () => updates.install());
}
