import { app, BrowserWindow, screen, type Point } from 'electron';
import path from 'node:path';
import { createTrustedIpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { installWindowNavigationPolicy } from '@/main/app/window-security';
import { trayMenuActionSchema, type TrayMenuAction, type TrayMenuState } from '@/shared/contracts/tray-menu';

/** A lazily created, reusable menu renderer with only tray-specific IPC. */
export class TrayMenuWindow {
  private window: BrowserWindow | null = null;
  private ready = false;
  private pendingPoint: Point | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly rendererUrl: () => URL,
    private readonly state: () => TrayMenuState,
    private readonly select: (action: TrayMenuAction) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {
    const ipc = createTrustedIpcHandlerRegistrar(() => this.window);
    ipc.handle('tray-menu:state', () => this.state());
    ipc.on('tray-menu:ready', () => {
      this.clearLoadTimer();
      this.ready = true;
      if (this.pendingPoint) this.present(this.pendingPoint);
    });
    ipc.handle('tray-menu:action', async (_event, rawAction) => {
      const action = trayMenuActionSchema.parse(rawAction);
      this.hide();
      await this.select(action);
    });
  }

  show(point: Point) {
    if (this.window?.isVisible()) {
      this.hide();
      return;
    }
    this.pendingPoint = point;
    if (!this.window || this.window.isDestroyed()) this.create();
    if (this.ready) this.present(point);
  }

  hide() {
    this.pendingPoint = null;
    this.window?.hide();
  }

  update() {
    if (!this.window || this.window.isDestroyed() || !this.ready) return;
    if (this.window.isVisible() && this.pendingPoint) this.position(this.window, this.pendingPoint);
    this.window.webContents.send('tray-menu:state-changed', this.state());
  }

  dispose() {
    this.clearLoadTimer();
    this.pendingPoint = null;
    this.window?.destroy();
    this.window = null;
    this.ready = false;
  }

  private present(point: Point) {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    this.position(window, point);
    this.update();
    window.show();
    window.focus();
  }

  private position(window: BrowserWindow, point: Point) {
    const area = screen.getDisplayNearestPoint(point).workArea;
    const width = Math.min(300, area.width);
    const height = Math.min(this.state().taskCount > 0 ? 178 : 144, area.height);
    window.setBounds({
      x: Math.round(Math.max(area.x, Math.min(point.x - width, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(point.y - height, area.y + area.height - height))),
      width,
      height,
    });
  }

  private clearLoadTimer() {
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  private create() {
    this.ready = false;
    const url = new URL('tray-menu.html', this.rendererUrl());
    const window = new BrowserWindow({
      width: 300,
      height: 144,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'out/preload/tray-menu.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window = window;
    this.loadTimer = setTimeout(() => {
      if (this.ready || this.window !== window) return;
      const requested = this.pendingPoint !== null;
      this.dispose();
      if (requested) this.onError(new Error('Tray menu did not become ready'));
    }, 8_000);
    installWindowNavigationPolicy(window, url);
    window.on('blur', () => this.hide());
    window.on('closed', () => {
      if (this.window !== window) return;
      this.window = null;
      this.ready = false;
      this.clearLoadTimer();
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      this.dispose();
      this.onError(new Error(`Tray menu renderer exited: ${details.reason}`));
    });
    void window.loadURL(url.href).catch((error) => {
      if (window.isDestroyed()) return;
      this.dispose();
      this.onError(error);
    });
  }
}
