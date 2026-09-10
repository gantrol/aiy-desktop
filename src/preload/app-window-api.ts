import { ipcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import { appWindowStateSchema } from '@/shared/contracts/app-window';

export function createAppWindowApi(): Pick<
  DesktopApi,
  'appWindowGetState' | 'appWindowMinimize' | 'appWindowToggleMaximized' | 'appWindowClose' | 'onAppWindowStateChanged'
> {
  return {
    appWindowGetState: async () => appWindowStateSchema.parse(await ipcRenderer.invoke('app-window:get-state')),
    appWindowMinimize: () => ipcRenderer.invoke('app-window:minimize'),
    appWindowToggleMaximized: async () =>
      appWindowStateSchema.parse(await ipcRenderer.invoke('app-window:toggle-maximized')),
    appWindowClose: () => ipcRenderer.invoke('app-window:close'),
    onAppWindowStateChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) =>
        callback(appWindowStateSchema.parse(value));
      ipcRenderer.on('app-window:state-changed', listener);
      return () => ipcRenderer.removeListener('app-window:state-changed', listener);
    },
  };
}
