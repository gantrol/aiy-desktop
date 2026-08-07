import { ipcMain, type BrowserWindow, type IpcMain } from 'electron';

export type IpcHandlerRegistrar = Pick<IpcMain, 'handle'>;
export type TrustedIpcInvocationRunner = (channel: string, invoke: () => unknown) => unknown;

export function createTrustedIpcHandlerRegistrar(
  getWindow: () => BrowserWindow | null,
  run: TrustedIpcInvocationRunner = (_channel, invoke) => invoke(),
): IpcHandlerRegistrar {
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event, ...args) => {
        const window = getWindow();
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
          throw new Error(`Rejected untrusted IPC sender for ${channel}`);
        }
        return run(channel, () => listener(event, ...args));
      });
    },
  };
}
