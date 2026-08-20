import type { BrowserWindow } from 'electron';
import { appWindowStateSchema } from '@/shared/contracts/app-window';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';

function requireWindow(getWindow: () => BrowserWindow | null) {
  const window = getWindow();
  if (!window || window.isDestroyed()) throw new Error('Application window is unavailable');
  return window;
}

function windowState(window: BrowserWindow) {
  return appWindowStateSchema.parse({ maximized: window.isMaximized() });
}

export function registerAppWindowIpc(ipcMain: IpcHandlerRegistrar, getWindow: () => BrowserWindow | null) {
  ipcMain.handle('app-window:get-state', () => windowState(requireWindow(getWindow)));
  ipcMain.handle('app-window:minimize', () => requireWindow(getWindow).minimize());
  ipcMain.handle('app-window:toggle-maximized', () => {
    const window = requireWindow(getWindow);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return windowState(window);
  });
  ipcMain.handle('app-window:close', () => requireWindow(getWindow).close());
}
