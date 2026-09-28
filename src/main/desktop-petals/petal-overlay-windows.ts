import { screen, type BrowserWindow, type Rectangle } from 'electron';
import { installWindowNavigationPolicy } from '@/main/app/window-security';
import { parsePetalOverlayName, type PetalOverlayKind, type PetalOverlayReady } from '@/shared/contracts/petal-overlay';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import { PETAL_WINDOW_SIZES } from '@/shared/contracts/petal-hub';

interface Overlay {
  kind: PetalOverlayKind;
  token: string;
  window: BrowserWindow;
  timeout: ReturnType<typeof setTimeout>;
  features: string;
}

function overlayBounds(kind: PetalOverlayKind, features: string, contentHeight = 200): Rectangle {
  if (kind === 'pluck') {
    return { ...screen.getCursorScreenPoint(), ...PETAL_WINDOW_SIZES.collapsed };
  }
  const values = new Map(features.split(',').map((feature) => feature.trim().split('=') as [string, string]));
  const cursor = screen.getCursorScreenPoint();
  const coordinate = (key: string, fallback: number) => {
    const value = Number(values.get(key));
    return Number.isFinite(value) ? Math.round(value) : fallback;
  };
  const point = { x: coordinate('left', cursor.x), y: coordinate('top', cursor.y) };
  const area = screen.getDisplayNearestPoint(point).workArea;
  const width = Math.min(kind === 'menu' ? 480 : 256, area.width);
  const height = Math.min(kind === 'menu' ? 640 : contentHeight, area.height);
  const y =
    kind === 'menu'
      ? point.y - 8
      : point.y + 8 + height <= area.y + area.height
        ? point.y + 8
        : coordinate('anchorTop', point.y) - height - 8;
  return {
    x: Math.round(Math.max(area.x, Math.min(point.x - (kind === 'menu' ? 8 : width / 2), area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
    width,
    height,
  };
}

/** Only transient child windows change geometry. The originating widget never does. */
export class PetalOverlayWindows {
  private readonly owners = new WeakMap<BrowserWindow, Map<PetalOverlayKind, Overlay>>();

  install(entry: PetalWindow, rendererUrl: URL) {
    const owner = entry.window;
    const url = new URL('petal-overlay.html', rendererUrl);
    const overlays = new Map<PetalOverlayKind, Overlay>();
    const pending = new Map<PetalOverlayKind, { token: string; features: string }>();
    this.owners.set(owner, overlays);
    const setWindowOpenHandler = owner.webContents.setWindowOpenHandler;
    if (typeof setWindowOpenHandler !== 'function') return;
    setWindowOpenHandler.call(owner.webContents, (details) => {
      const request = parsePetalOverlayName(details.frameName);
      if (!request || details.url !== url.href || entry.expanded || entry.hubView !== 'flower')
        return { action: 'deny' };
      if (request.kind !== 'hover') overlays.get('hover')?.window.close();
      overlays.get(request.kind)?.window.close();
      pending.set(request.kind, { token: request.token, features: details.features });
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: owner,
          ...overlayBounds(request.kind, details.features),
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          hasShadow: false,
          focusable: request.kind === 'menu',
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        },
      };
    });
    owner.webContents.on('did-create-window', (window, details) => {
      const request = parsePetalOverlayName(details.frameName);
      if (!request || details.url !== url.href) return window.destroy();
      const opening = pending.get(request.kind);
      if (opening?.token !== request.token) return window.destroy();
      pending.delete(request.kind);
      installWindowNavigationPolicy(window, url);
      window.setAlwaysOnTop(owner.isAlwaysOnTop(), process.platform === 'win32' ? 'normal' : 'floating');
      if (request.kind === 'pluck') window.setIgnoreMouseEvents(true);
      const overlay: Overlay = {
        ...request,
        window,
        features: opening.features,
        timeout: setTimeout(() => window.close(), 8_000),
      };
      overlays.set(request.kind, overlay);
      window.on('closed', () => {
        clearTimeout(overlay.timeout);
        if (overlays.get(request.kind) === overlay) overlays.delete(request.kind);
        if (!owner.isDestroyed()) owner.webContents.send('desktop-petals:overlay-closed', request.token);
      });
      if (request.kind === 'menu') window.on('blur', () => window.close());
      window.webContents.on('render-process-gone', () => window.destroy());
    });
    const close = () => {
      pending.clear();
      for (const overlay of overlays.values()) overlay.window.close();
    };
    owner.on('hide', close);
    owner.on('move', close);
    owner.on('resize', close);
    owner.on('closed', close);
    owner.on('blur', () => overlays.get('hover')?.window.close());
  }

  present(entry: PetalWindow, { token, point, height }: PetalOverlayReady) {
    const overlay = [...(this.owners.get(entry.window)?.values() ?? [])].find((item) => item.token === token);
    if (!overlay || overlay.window.isDestroyed() || !entry.window.isVisible()) return;
    clearTimeout(overlay.timeout);
    if (overlay.kind === 'pluck' && point)
      overlay.window.setBounds({ x: Math.round(point.x), y: Math.round(point.y), ...PETAL_WINDOW_SIZES.collapsed });
    if (overlay.kind === 'hover' && height) overlay.window.setBounds(overlayBounds('hover', overlay.features, height));
    if (overlay.window.isVisible()) return;
    if (overlay.kind === 'menu') {
      overlay.window.show();
      overlay.window.focus();
    } else overlay.window.showInactive();
  }

  hasMenu(entry: PetalWindow) {
    return this.owners.get(entry.window)?.has('menu') ?? false;
  }
}
