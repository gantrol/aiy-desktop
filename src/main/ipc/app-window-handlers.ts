import type { BrowserWindow } from 'electron';
import { appWindowStateSchema, type AppWindowStateDto } from '@/shared/contracts/app-window';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';

const completedFullScreenStates = new WeakMap<BrowserWindow, boolean>();

function requireWindow(getWindow: () => BrowserWindow | null) {
  const window = getWindow();
  if (!window || window.isDestroyed()) throw new Error('Application window is unavailable');
  return window;
}

function windowState(window: BrowserWindow) {
  return appWindowStateSchema.parse({
    maximized: window.isMaximized(),
    fullScreen: completedFullScreenStates.get(window) ?? window.isFullScreen(),
  });
}

export function bindAppWindowState(window: BrowserWindow, changed: (state: AppWindowStateDto) => void) {
  const sendState = () => changed(windowState(window));
  const fullScreenChanged = (fullScreen: boolean) => {
    // Native transition events are authoritative even while Cocoa's getter still lags.
    completedFullScreenStates.set(window, fullScreen);
    sendState();
  };
  window.on('maximize', sendState);
  window.on('unmaximize', sendState);
  window.on('enter-full-screen', () => fullScreenChanged(true));
  window.on('leave-full-screen', () => fullScreenChanged(false));
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
