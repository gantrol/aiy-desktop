import { app, BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import path from 'node:path';

const documentUrl =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src blob:; base-uri 'none'; form-action 'none'\">",
  );
let active = false;

/** Dedicated sandbox process: batch exports never occupy the thumbnail decoder queue. */
export async function runGifSandbox<T>(
  request: { runId: string },
  signal: AbortSignal,
  channels: { request: string; response: string },
  receiveResponse: (raw: unknown) => { value: T } | null,
): Promise<T> {
  if (active) throw new Error('GIF_BUSY');
  signal.throwIfAborted();
  active = true;
  let window: BrowserWindow | null = null;
  try {
    window = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'out', 'preload', 'gif-renderer.js'),
        partition: 'aiy-gif-renderer',
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        webviewTag: false,
        disableDialogs: true,
        navigateOnDragDrop: false,
        spellcheck: false,
      },
    });
    const renderer = window;
    renderer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    renderer.webContents.session.setPermissionCheckHandler(() => false);
    renderer.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    renderer.webContents.session.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: details.url !== documentUrl && !details.url.startsWith('blob:') }),
    );
    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, bytes?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ipcMain.removeListener(channels.response, receive);
        signal.removeEventListener('abort', abort);
        renderer.removeListener('closed', closed);
        renderer.webContents.removeListener('render-process-gone', gone);
        if (error) reject(error);
        else resolve(bytes!);
      };
      const abort = () => finish(new Error('GIF_CANCELLED'));
      const closed = () => finish(new Error('GIF_FAILED'));
      const gone = () => finish(new Error('GIF_FAILED'));
      const timeout = setTimeout(() => finish(new Error('GIF_LIMIT')), 180_000);
      const receive = (event: IpcMainEvent, raw: unknown) => {
        if (
          event.sender !== renderer.webContents ||
          event.senderFrame !== renderer.webContents.mainFrame ||
          event.senderFrame.url !== documentUrl
        )
          return;
        try {
          if (!raw || typeof raw !== 'object' || !('runId' in raw) || raw.runId !== request.runId)
            throw new Error('GIF_INVALID');
          const result = receiveResponse(raw);
          if (result) finish(undefined, result.value);
        } catch (error) {
          finish(error instanceof Error ? error : new Error('GIF_FAILED'));
        }
      };
      ipcMain.on(channels.response, receive);
      renderer.once('closed', closed);
      renderer.webContents.once('render-process-gone', gone);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      void renderer
        .loadURL(documentUrl)
        .then(() => {
          if (settled) return;
          renderer.webContents.on('will-navigate', (event) => event.preventDefault());
          renderer.webContents.on('will-redirect', (event) => event.preventDefault());
          renderer.webContents.send(channels.request, request);
        })
        .catch(() => finish(new Error('GIF_FAILED')));
    });
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    active = false;
  }
}
