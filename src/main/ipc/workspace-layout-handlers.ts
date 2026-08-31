import type { WorkspaceLayoutStore } from '@/main/app/workspace-layout-store';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { workspaceLayoutSaveInputSchema } from '@/shared/contracts/workspace-layout';

export function registerWorkspaceLayoutIpc(ipcMain: IpcHandlerRegistrar, layouts: WorkspaceLayoutStore) {
  ipcMain.handle('workspace-layout:save', (_event, raw) => layouts.save(workspaceLayoutSaveInputSchema.parse(raw)));
}
