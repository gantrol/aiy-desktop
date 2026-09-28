import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { randomUUID } from 'node:crypto';
import { installWindowNavigationPolicy } from '@/main/app/window-security';
import { petalError } from '@/shared/petal-errors';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import {
  nativePetalWindows,
  type InitializePetalWindow,
  type PetalWindowFactory,
} from '@/main/desktop-petals/petal-window-factory';

interface Request {
  url: string;
  options: BrowserWindowConstructorOptions;
  initialize: InitializePetalWindow;
  resolve(value: PetalWindow): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Trusted, same-origin child windows share one presentation process, never an editor. */
export class PetalRendererHost implements PetalWindowFactory {
  onRendererGone?: (windows: readonly BrowserWindow[]) => void;
  private children = new Set<BrowserWindow>();
  private idle?: ReturnType<typeof setTimeout>;
  private host?: BrowserWindow;
  private ready?: Promise<BrowserWindow>;
  private generation = 0;
  private pending = new Map<string, Request>();

  async create(options: BrowserWindowConstructorOptions, url: URL, shared: boolean, initialize: InitializePetalWindow) {
    if (!shared) return nativePetalWindows.create(options, url, false, initialize);
    const generation = this.generation;
    const host = await this.ensureHost(url);
    if (generation !== this.generation || host.isDestroyed()) throw petalError('sourceUnavailable');
    // Restores are serial; explicit opens are deduplicated by their instance in PetalWindows.
    if (this.pending.size >= 8) throw petalError('saving');
    return new Promise<PetalWindow>((resolve, reject) => {
      const token = `aiy-petal:${randomUUID()}`;
      const fail = (error: unknown) => {
        const request = this.pending.get(token);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(token);
        reject(error);
      };
      const timer = setTimeout(() => fail(petalError('sourceUnavailable')), 10_000);
      this.pending.set(token, { url: url.href, options, initialize, resolve, reject, timer });
      void host.webContents
        .executeJavaScript(`window.open(${JSON.stringify(url.href)}, ${JSON.stringify(token)}) !== null`)
        .then((opened) => {
          if (!opened) fail(petalError('sourceUnavailable'));
        }, fail);
    });
  }

  private ensureHost(renderer: URL): Promise<BrowserWindow> {
    clearTimeout(this.idle);
    if (this.ready) return this.ready;
    const url = new URL('petal-host.html', renderer);
    const host = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      focusable: false,
      skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true },
    });
    this.host = host;
    installWindowNavigationPolicy(host, url);
    host.webContents.setWindowOpenHandler((details) => {
      const request = this.pending.get(details.frameName);
      return request && details.url === request.url
        ? { action: 'allow', overrideBrowserWindowOptions: request.options }
        : { action: 'deny' };
    });
    host.webContents.on('did-create-window', (window, details) => {
      const request = this.pending.get(details.frameName);
      if (!request || request.url !== details.url) return window.destroy();
      clearTimeout(request.timer);
      this.pending.delete(details.frameName);
      // Register the content identity and first-paint listeners in this event,
      // before the child can request any application data.
      this.children.add(window);
      window.once('closed', () => {
        this.children.delete(window);
        if (this.children.size || this.pending.size || this.host !== host) return;
        this.idle = setTimeout(() => {
          if (this.host === host && !this.children.size && !this.pending.size) this.dispose();
        }, 15_000);
        this.idle.unref();
      });
      try {
        void request.initialize(window, true).then(request.resolve, (error) => {
          if (!window.isDestroyed()) window.destroy();
          request.reject(error);
        });
      } catch (error) {
        if (!window.isDestroyed()) window.destroy();
        request.reject(error);
      }
    });
    host.webContents.on('render-process-gone', () => {
      if (this.host !== host) return;
      try {
        this.onRendererGone?.([...this.children]);
      } catch (error) {
        console.error('[desktop-petals] shared renderer recovery unavailable', error);
      } finally {
        this.dispose();
      }
    });
    host.once('closed', () => {
      if (this.host === host) this.dispose();
    });
    const generation = this.generation;
    this.ready = new Promise<BrowserWindow>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(petalError('sourceUnavailable'));
        if (this.host === host) this.dispose();
      }, 10_000);
      void host.loadURL(url.href).then(
        () => {
          clearTimeout(timer);
          if (generation !== this.generation || host.isDestroyed()) reject(petalError('sourceUnavailable'));
          else resolve(host);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
          if (this.host === host) this.dispose();
        },
      );
    });
    return this.ready;
  }

  dispose() {
    clearTimeout(this.idle);
    this.generation++;
    const host = this.host;
    this.host = undefined;
    this.ready = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(petalError('sourceUnavailable'));
    }
    this.pending.clear();
    for (const child of this.children) if (!child.isDestroyed()) child.destroy();
    this.children.clear();
    if (host && !host.isDestroyed()) host.destroy();
  }
}
