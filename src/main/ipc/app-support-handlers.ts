import { shell } from 'electron';
import { appSupportDestinationSchema, type AppSupportDestination } from '@/shared/contracts/app-support';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';

const destinations: Record<AppSupportDestination, string> = {
  PRIVACY_POLICY: 'https://www.aicando.xyz/aiy/privacy',
  FONT_SOURCE_SANS: 'https://github.com/adobe-fonts/source-han-sans/releases',
  FONT_SOURCE_SERIF: 'https://github.com/adobe-fonts/source-han-serif/releases',
  FONT_WENKAI: 'https://github.com/lxgw/LxgwWenKai/releases',
  FONT_INTER: 'https://rsms.me/inter/download/',
  FONT_JETBRAINS: 'https://www.jetbrains.com/lp/mono/',
};

export function registerAppSupportIpc(ipcMain: IpcHandlerRegistrar) {
  ipcMain.handle('app-support:open', (_event, value) =>
    shell.openExternal(destinations[appSupportDestinationSchema.parse(value)]),
  );
}
