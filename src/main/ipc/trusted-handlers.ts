import { ipcMain, type BrowserWindow, type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';

export interface IpcHandlerRegistrar {
  handle: IpcMain['handle'];
  on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void;
}
export type TrustedIpcInvocationRunner = (channel: string, invoke: () => unknown) => unknown;

function trustedSender(event: IpcMainEvent | IpcMainInvokeEvent, window: BrowserWindow | null) {
  return Boolean(window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame);
}

export function createTrustedIpcHandlerRegistrar(
  getWindow: () => BrowserWindow | null,
  run: TrustedIpcInvocationRunner = (_channel, invoke) => invoke(),
): IpcHandlerRegistrar {
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event, ...args) => {
        const window = getWindow();
        if (!trustedSender(event, window)) {
          throw new Error(`Rejected untrusted IPC sender for ${channel}`);
        }
        return run(channel, () => listener(event, ...args));
      });
    },
    on(channel, listener) {
      ipcMain.on(channel, (event, ...args) => {
        const window = getWindow();
        if (!trustedSender(event, window)) {
          console.warn(`[ipc] Rejected untrusted sender for ${channel}`);
          return;
        }
        try {
          void Promise.resolve(run(channel, () => listener(event, ...args))).catch((reason) => {
            console.error(`[ipc] ${channel} failed`, reason);
          });
        } catch (reason) {
          console.error(`[ipc] ${channel} failed`, reason);
        }
      });
    },
  };
}
