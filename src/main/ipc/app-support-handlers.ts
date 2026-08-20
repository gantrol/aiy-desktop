import { shell } from 'electron';
import { appSupportDestinationSchema, type AppSupportDestination } from '@/shared/contracts/app-support';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';

const destinations: Record<AppSupportDestination, string> = {
  PRIVACY_POLICY: 'https://www.aicando.xyz/aiy/privacy',
  AI_CONTENT_REPORT: 'mailto:501963347@qq.com?subject=AIY%20Content%20Report',
};

export function registerAppSupportIpc(ipcMain: IpcHandlerRegistrar) {
  ipcMain.handle('app-support:open', (_event, value) =>
    shell.openExternal(destinations[appSupportDestinationSchema.parse(value)]),
  );
}
