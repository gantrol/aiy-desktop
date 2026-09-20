import type { BrowserWindow } from 'electron';
import { petalError } from '@/shared/petal-errors';

export interface PetalWindowLoad {
  ready: Promise<void>;
  rendered(): void;
  dispose(): void;
}

/** One deadline covers navigation and both first-frame acknowledgements, in any order. */
export function loadPetalWindow(window: BrowserWindow, url: string, waitForPaint: boolean): PetalWindowLoad {
  const contents = window.webContents;
  const backgroundThrottling = waitForPaint ? contents.getBackgroundThrottling() : undefined;
  let loaded = false;
  let painted = !waitForPaint;
  let rendered = !waitForPaint;
  let finished = false;
  let resolveReady: () => void;
  let rejectReady: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const complete = () => {
    if (finished || !loaded || !painted || !rendered) return;
    finished = true;
    resolveReady();
  };
  const fail = (error: unknown) => {
    if (finished) return;
    finished = true;
    rejectReady(error);
  };
  const closed = () => fail(petalError('sourceUnavailable'));
  const paint = () => {
    painted = true;
    complete();
  };
  window.once('closed', closed);
  if (waitForPaint) {
    contents.setBackgroundThrottling(false);
    window.once('ready-to-show', paint);
  }
  const timer = setTimeout(() => fail(petalError('sourceUnavailable')), 10_000);
  // Start after the caller registers this load, including when loadURL throws synchronously.
  void Promise.resolve()
    .then(() => {
      if (window.isDestroyed()) throw petalError('sourceUnavailable');
      return window.loadURL(url);
    })
    .then(() => {
      loaded = true;
      complete();
    }, fail);
  return {
    ready,
    rendered() {
      rendered = true;
      complete();
    },
    dispose() {
      clearTimeout(timer);
      window.removeListener('closed', closed);
      window.removeListener('ready-to-show', paint);
      if (backgroundThrottling !== undefined && !contents.isDestroyed())
        contents.setBackgroundThrottling(backgroundThrottling);
    },
  };
}
