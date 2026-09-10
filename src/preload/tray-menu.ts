import { contextBridge, ipcRenderer } from 'electron';
import { trayMenuActionSchema, trayMenuStateSchema, type TrayMenuApi } from '@/shared/contracts/tray-menu';

const api: TrayMenuApi = {
  state: async () => trayMenuStateSchema.parse(await ipcRenderer.invoke('tray-menu:state')),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(trayMenuStateSchema.parse(value));
    ipcRenderer.on('tray-menu:state-changed', listener);
    return () => ipcRenderer.removeListener('tray-menu:state-changed', listener);
  },
  ready: () => ipcRenderer.send('tray-menu:ready'),
  action: (action) => ipcRenderer.invoke('tray-menu:action', trayMenuActionSchema.parse(action)),
};
contextBridge.exposeInMainWorld('trayMenu', api);
