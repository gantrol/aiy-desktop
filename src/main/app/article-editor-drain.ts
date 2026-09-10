import { ipcMain, type BrowserWindow, type IpcMainEvent, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  ARTICLE_EDITOR_DRAIN_CANCEL,
  ARTICLE_EDITOR_DRAIN_REQUEST,
  ARTICLE_EDITOR_DRAIN_RESULT,
} from '@/shared/article-editor-drain';

const activeRequests = new WeakMap<WebContents, string>();

/** Resume editing if a later shutdown stage cannot finish. */
export function cancelArticleEditorDrain(window: BrowserWindow | null) {
  if (!window || window.isDestroyed()) return;
  const contents = window.webContents;
  const requestId = activeRequests.get(contents);
  if (!requestId) return;
  activeRequests.delete(contents);
  try {
    if (!contents.isDestroyed()) contents.send(ARTICLE_EDITOR_DRAIN_CANCEL, requestId);
  } catch {
    // A renderer that disappeared during the handshake cannot be resumed.
  }
}

/** The database stays available until the renderer has finished its write lane. */
export function drainArticleEditors(window: BrowserWindow | null): Promise<boolean> {
  if (!window || window.isDestroyed()) return Promise.resolve(true);
  const contents = window.webContents;
  if (contents.isDestroyed() || contents.isCrashed() || contents.isLoadingMainFrame()) return Promise.resolve(true);
  const requestId = randomUUID();
  activeRequests.set(contents, requestId);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (saved: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener(ARTICLE_EDITOR_DRAIN_RESULT, receive);
      if (!saved && activeRequests.get(contents) === requestId) {
        cancelArticleEditorDrain(window);
      }
      resolve(saved);
    };
    const receive = (event: IpcMainEvent, result: unknown) => {
      if (
        event.sender !== contents ||
        event.senderFrame !== contents.mainFrame ||
        !result ||
        typeof result !== 'object'
      )
        return;
      if (
        !('requestId' in result) ||
        result.requestId !== requestId ||
        !('saved' in result) ||
        typeof result.saved !== 'boolean'
      )
        return;
      finish(result.saved);
    };
    const timer = setTimeout(() => finish(false), 15_000);
    ipcMain.on(ARTICLE_EDITOR_DRAIN_RESULT, receive);
    try {
      contents.send(ARTICLE_EDITOR_DRAIN_REQUEST, requestId);
    } catch {
      finish(false);
    }
  });
}
