import type { BrowserWindow } from 'electron';

const rendererLifecycleErrorPattern =
  /render frame was disposed|webframemain.*(?:disposed|destroyed)|object has been destroyed|webcontents.*destroyed/i;

function isRendererLifecycleError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return rendererLifecycleErrorPattern.test(message);
}

/**
 * Owns the readiness boundary between long-lived main-process services and the
 * replaceable renderer frame. Transient events are intentionally dropped while
 * the renderer is navigating or restarting; the renderer reloads authoritative
 * state through its initial snapshot once it is ready again.
 */
export class RendererEventDispatcher {
  private window: BrowserWindow | null = null;
  private ready = false;

  attach(window: BrowserWindow) {
    this.window = window;
    this.ready = false;
    const contents = window.webContents;

    contents.on('did-start-navigation', (details) => {
      if (this.window !== window || !details.isMainFrame || details.isSameDocument) return;
      this.ready = false;
    });
    contents.on('dom-ready', () => {
      if (this.window !== window || window.isDestroyed() || contents.isDestroyed()) return;
      this.ready = true;
    });
    contents.on('render-process-gone', () => {
      if (this.window === window) this.ready = false;
    });
    contents.on('destroyed', () => this.detach(window));
    window.on('closed', () => this.detach(window));
  }

  detach(window: BrowserWindow) {
    if (this.window !== window) return;
    this.window = null;
    this.ready = false;
  }

  send(channel: string, ...args: unknown[]) {
    const window = this.window;
    if (!this.ready || !window) return false;

    try {
      if (window.isDestroyed()) {
        this.ready = false;
        return false;
      }
      const contents = window.webContents;
      if (contents.isDestroyed() || contents.isCrashed()) {
        this.ready = false;
        return false;
      }
      const frame = contents.mainFrame;
      if (frame.isDestroyed() || frame.detached) {
        this.ready = false;
        return false;
      }
      frame.send(channel, ...args);
      return true;
    } catch (error) {
      // The frame can be disposed after the checks above and before send().
      if (this.window !== window || isRendererLifecycleError(error)) {
        this.ready = false;
        return false;
      }
      throw error;
    }
  }
}
