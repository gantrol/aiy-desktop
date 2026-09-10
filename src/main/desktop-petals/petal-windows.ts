import { app, BrowserWindow, screen, type Point, type Rectangle } from 'electron';
import path from 'node:path';
import { PACKAGED_RENDERER_URL } from '@/main/app/renderer-protocol';
import { isPackagedApplication } from '@/main/app/runtime-mode';
import { installWindowNavigationPolicy } from '@/main/app/window-security';
import { PetalLayoutStore } from '@/main/desktop-petals/petal-layout-store';
import { PETAL_WINDOW_SIZES, type PetalHubView } from '@/shared/contracts/petal-hub';
import { desktopPetalMessages } from '@/shared/i18n/desktop-petals';
import { petalError } from '@/shared/petal-errors';
import { PetalHubPresentation, setPetalBounds } from '@/main/desktop-petals/petal-hub-presentation';
import { clampFlowerBounds, clampPetalBounds } from '@/main/desktop-petals/petal-window-geometry';
import { PetalInputMonitor } from '@/main/desktop-petals/petal-input-monitor';
import type { PetalLanguage } from '@/shared/contracts/petal-language';
import { PetalCollectionHistory } from '@/main/desktop-petals/petal-collection-history';
import { PetalPluckMonitor } from '@/main/desktop-petals/petal-pluck-monitor';

export interface PetalWindow {
  previewToken?: string;
  drawer?: boolean;
  window: BrowserWindow;
  libraryId: string;
  instanceId: string | null;
  expanded: boolean;
  editEpoch: number;
  hubView: PetalHubView;
}
export class PetalWindows {
  readonly collectionHistory = new PetalCollectionHistory(
    () => {
      for (const entry of this.entries.values())
        if (!entry.instanceId && !entry.drawer && !entry.window.isDestroyed())
          entry.window.webContents.send('desktop-petals:changed');
    },
    (entry) => this.canRestoreVisibility?.(entry) ?? false,
  );
  readonly input = new PetalInputMonitor(
    () => this.toggleTitles(),
    () => this.restorePinnedAfterDesktop(),
  );
  readonly pluck = new PetalPluckMonitor(this.input);
  canRestoreVisibility?: (entry: PetalWindow) => boolean;
  private desktopTimers: ReturnType<typeof setTimeout>[] = [];
  private restorePinnedAfterDesktop() {
    for (const timer of this.desktopTimers) clearTimeout(timer);
    // Shell Show Desktop changes visibility independently of the topmost flag.
    // Wait for its transition, then restore only windows still intended to be shown.
    this.desktopTimers = [80, 350].map((delay) =>
      setTimeout(() => {
        if (!this.allowPresentation || this.allowClose) return;
        for (const entry of this.entries.values()) {
          const window = entry.window;
          if (
            entry.drawer ||
            window.isDestroyed() ||
            !this.wantsAlwaysOnTop(entry.libraryId, entry.instanceId) ||
            this.pendingPaints.has(window.webContents.id) ||
            !this.canRestoreVisibility?.(entry) ||
            this.layouts.get(entry.libraryId, entry.instanceId ?? 'hub')?.visible !== true
          )
            continue;
          window.showInactive();
          window.setAlwaysOnTop(true);
          window.moveTop();
        }
      }, delay),
    );
  }
  startInput() {
    if (this.allowPresentation) this.input.start();
    app.once('will-quit', () => {
      for (const timer of this.desktopTimers) clearTimeout(timer);
      this.pluck.clear();
      this.input.dispose();
    });
  }
  async toggleTitles() {
    await this.layouts.toggleTitles();
    for (const entry of this.entries.values())
      if (!entry.window.isDestroyed())
        entry.window.webContents.send('desktop-petals:titles-changed', this.layouts.titlesVisible);
  }
  setLanguage(language: PetalLanguage) {
    for (const entry of this.entries.values()) {
      if (entry.window.isDestroyed()) continue;
      entry.window.setTitle(
        entry.drawer
          ? this.layouts.drawer(entry.libraryId).name || language.messages.drawer.title
          : entry.instanceId
            ? language.messages.note.windowTitle
            : language.messages.flower.title,
      );
      entry.window.webContents.send('desktop-petals:language-changed', language);
    }
  }
  onDragMove?: (entry: PetalWindow, point: Point) => void;
  onDragEnd?: (entry: PetalWindow, point: Point) => Promise<boolean>;
  onDragCancel?: () => void;
  readonly presentation = new PetalHubPresentation(
    (entry) => this.remember(entry),
    () => this.layouts.hubSettings.flowerSize,
  );
  readonly entries = new Map<number, PetalWindow>();
  private readonly unpinned = new Map<string, Set<string>>();
  allowClose = false;
  private readonly pendingPaints = new Map<number, (painted: boolean) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    readonly layouts: PetalLayoutStore,
    private readonly allowPresentation: boolean,
    private readonly beforeHide: (entry: PetalWindow) => Promise<boolean>,
    private readonly onContextMenu?: (entry: PetalWindow) => void,
    private readonly title = (isNote: boolean) =>
      isNote ? desktopPetalMessages.note.windowTitle : desktopPetalMessages.flower.title,
  ) {}

  find(libraryId: string, instanceId: string | null) {
    return [...this.entries.values()].find(
      (entry) => !entry.drawer && entry.libraryId === libraryId && entry.instanceId === instanceId,
    );
  }
  async createDrawer(
    libraryId: string,
    bounds: Electron.Rectangle,
    title: string,
    onBlur: () => void,
    onHide: () => void,
  ) {
    const url = new URL(
      !isPackagedApplication(app) && process.env.ELECTRON_RENDERER_URL
        ? process.env.ELECTRON_RENDERER_URL
        : PACKAGED_RENDERER_URL,
    );
    url.pathname = '/petals.html';
    const window = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: false,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      title,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'out/preload/desktop-petals.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const entry: PetalWindow = {
      window,
      libraryId,
      instanceId: null,
      expanded: false,
      editEpoch: 0,
      hubView: 'flower',
      drawer: true,
    };
    this.entries.set(window.webContents.id, entry);
    installWindowNavigationPolicy(window, url);
    window.on('blur', onBlur);
    window.on('close', (event) => {
      if (!this.allowClose) {
        event.preventDefault();
        onHide();
      }
    });
    window.on('closed', () => this.entries.delete(window.webContents.id));
    try {
      await window.loadURL(url.href);
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
    if (this.allowPresentation && !window.isDestroyed()) window.showInactive();
    return entry;
  }
  async show(libraryId: string, instanceId: string | null, point?: Point, expanded?: boolean, waitForPaint = false) {
    return this.open(libraryId, instanceId, point, expanded, waitForPaint, false);
  }
  async pin(libraryId: string, instanceId: string, point?: Point, expanded?: boolean, waitForPaint = false) {
    this.unpinned.get(libraryId)?.delete(instanceId);
    return this.show(libraryId, instanceId, point, expanded, waitForPaint);
  }
  async restore(libraryId: string, instanceId: string | null) {
    return this.open(libraryId, instanceId, undefined, undefined, false, true);
  }
  private async open(
    libraryId: string,
    instanceId: string | null,
    point: Point | undefined,
    expanded: boolean | undefined,
    waitForPaint: boolean,
    restoring: boolean,
  ) {
    const existing = this.find(libraryId, instanceId);
    if (existing) {
      this.collectionHistory.clear(existing);
      existing.editEpoch++;
      existing.window.setIgnoreMouseEvents(false);
      if (expanded !== undefined) this.expand(existing, expanded);
      this.present(existing, restoring);
      this.remember(existing, true);
      existing.window.webContents.send('desktop-petals:changed');
      return existing;
    }
    const previous = this.layouts.get(libraryId, instanceId ?? 'hub');
    const isExpanded = instanceId ? (expanded ?? previous?.expanded ?? false) : false;
    let size =
      instanceId && isExpanded ? (previous?.noteSize ?? PETAL_WINDOW_SIZES.note) : this.size(instanceId, isExpanded);
    const area = screen.getPrimaryDisplay().workArea;
    const position = point ?? previous ?? { x: area.x + area.width - size.width - 30, y: area.y + 100 };
    const targetArea = screen.getDisplayNearestPoint(
      instanceId
        ? position
        : {
            x: position.x + size.width / 2,
            y: position.y + size.height / 2,
          },
    ).workArea;
    size = { width: Math.min(size.width, targetArea.width), height: Math.min(size.height, targetArea.height) };
    const url = new URL(
      !isPackagedApplication(app) && process.env.ELECTRON_RENDERER_URL
        ? process.env.ELECTRON_RENDERER_URL
        : PACKAGED_RENDERER_URL,
    );
    url.pathname = '/petals.html';
    const window = new BrowserWindow({
      ...size,
      ...(instanceId
        ? this.clamp(position, size)
        : clampFlowerBounds({ ...position, ...size }, this.layouts.hubSettings.flowerSize, targetArea)),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: false,
      resizable: false,
      movable: true,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      alwaysOnTop: this.wantsAlwaysOnTop(libraryId, instanceId),
      hasShadow: false,
      title: this.title(Boolean(instanceId)),
      webPreferences: {
        preload: path.join(app.getAppPath(), 'out/preload/desktop-petals.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const entry: PetalWindow = { window, libraryId, instanceId, expanded: isExpanded, editEpoch: 0, hubView: 'flower' };
    window.setIgnoreMouseEvents(false);
    const senderId = window.webContents.id;
    this.entries.set(senderId, entry);
    installWindowNavigationPolicy(window, url);
    if (this.onContextMenu) {
      window.on('system-context-menu', (event) => {
        if (entry.instanceId && entry.expanded) return;
        event.preventDefault();
        this.onContextMenu?.(entry);
      });
    }
    window.on('blur', () => this.presentation.preview(entry, false, 'menu'));
    window.on('move', () => {
      this.remember(entry);
      if (nativeMove) this.onDragMove?.(entry, screen.getCursorScreenPoint());
    });
    // Programmatic bounds changes also emit move events. Only an OS gesture
    // emits will-move; renderer gestures explicitly snap when released.
    let nativeMove = false;
    window.on('will-move', () => {
      this.presentation.clearDock(entry);
      nativeMove = true;
    });
    window.on('moved', () => {
      if (!nativeMove) return;
      nativeMove = false;
      void Promise.resolve(this.onDragEnd?.(entry, screen.getCursorScreenPoint()))
        .then((handled) => {
          if (!handled && !window.isDestroyed()) this.presentation.snap(entry);
        })
        .catch((error) => console.error('[desktop-petals] drop failed', error));
    });
    window.on('close', (event) => {
      if (this.allowClose) return;
      event.preventDefault();
      void this.hide(entry).catch((error) => console.error('[desktop-petals] close failed', error));
    });
    window.on('closed', () => {
      this.entries.delete(senderId);
      this.pendingPaints.get(senderId)?.(false);
      this.pendingPaints.delete(senderId);
    });
    const paint = this.initialPaint(entry, waitForPaint);
    try {
      await window.loadURL(url.href);
      if (!(await paint.ready)) throw petalError('sourceUnavailable');
      if (window.isDestroyed()) throw petalError('sourceUnavailable');
      if (!instanceId && previous?.dockEdge) this.presentation.restoreDock(entry, previous.dockEdge);
      this.present(entry, restoring, waitForPaint);
      this.remember(entry, true);
      return entry;
    } catch (error) {
      this.entries.delete(senderId);
      if (!window.isDestroyed()) window.destroy();
      throw error;
    } finally {
      paint.dispose();
    }
  }
  rendered(entry: PetalWindow) {
    this.pendingPaints.get(entry.window.webContents.id)?.(true);
  }
  private wantsAlwaysOnTop(libraryId: string, instanceId: string | null) {
    return !instanceId || !this.unpinned.get(libraryId)?.has(instanceId);
  }
  private present(entry: PetalWindow, restoring = false, handoff = false) {
    if (!this.allowPresentation) return;
    // An explicit open of an editor must activate it even when another app is
    // foreground. A paint handoff stays inactive only for collapsed petals.
    if (restoring || (handoff && entry.instanceId !== null && !entry.expanded)) entry.window.showInactive();
    else entry.window.show();
    // Reapply the user's choice after showing; the native flag alone is not the preference.
    const alwaysOnTop = this.wantsAlwaysOnTop(entry.libraryId, entry.instanceId);
    entry.window.setAlwaysOnTop(alwaysOnTop);
    if (alwaysOnTop) entry.window.moveTop();
  }
  private initialPaint(entry: PetalWindow, requested: boolean) {
    if (!requested || !this.allowPresentation) return { ready: Promise.resolve(true), dispose: () => undefined };
    const contents = entry.window.webContents;
    const senderId = contents.id;
    const backgroundThrottling = contents.getBackgroundThrottling();
    // This hidden window must paint before it can be presented. Keep it rendering
    // while another app is foreground, then restore throttling after presentation.
    contents.setBackgroundThrottling(false);
    let timer: ReturnType<typeof setTimeout>;
    let onPaint: () => void;
    const ready = new Promise<boolean>((resolve) => {
      let painted = false;
      let contentReady = false;
      onPaint = () => {
        painted = true;
        if (contentReady) resolve(true);
      };
      entry.window.once('ready-to-show', onPaint);
      this.pendingPaints.set(senderId, (rendered) => {
        contentReady = rendered;
        if (!rendered || painted) resolve(rendered);
      });
      timer = setTimeout(() => resolve(false), 10_000);
    });
    return {
      ready,
      dispose: () => {
        clearTimeout(timer);
        entry.window.removeListener('ready-to-show', onPaint);
        this.pendingPaints.delete(senderId);
        if (!contents.isDestroyed()) contents.setBackgroundThrottling(backgroundThrottling);
      },
    };
  }
  expand(entry: PetalWindow, expanded: boolean) {
    if (expanded) this.collectionHistory.clear(entry);
    this.presentation.endPreview(entry);
    const size =
      entry.instanceId && expanded
        ? (this.layouts.get(entry.libraryId, entry.instanceId)?.noteSize ?? PETAL_WINDOW_SIZES.note)
        : this.size(entry.instanceId, expanded);
    entry.expanded = expanded;
    this.resize(entry, size);
    this.remember(entry);
    entry.window.webContents.send('desktop-petals:changed');
  }
  async collect(entry: PetalWindow, origin: Rectangle) {
    if (!entry.instanceId || entry.expanded || entry.window.isDestroyed() || !entry.window.isVisible()) return;
    if (await this.hide(entry)) this.collectionHistory.record(entry, origin);
  }
  async undoCollection(libraryId: string, token: string) {
    const previous = this.collectionHistory.current(libraryId);
    if (!previous || previous.token !== token) throw petalError('sourceUnavailable');
    this.move(previous.entry, previous.bounds, undefined, previous.bounds);
    const entry = await this.show(libraryId, previous.entry.instanceId, undefined, false);
    this.remember(entry, true);
    await this.flush();
  }
  setAlwaysOnTop(entry: PetalWindow, alwaysOnTop: boolean) {
    if (!entry.instanceId || entry.window.isDestroyed()) throw petalError('sourceUnavailable');
    // Keep the choice through window recreation and library switches, but never persist it across app restarts.
    entry.window.setAlwaysOnTop(alwaysOnTop);
    if (alwaysOnTop && this.allowPresentation && entry.window.isVisible()) entry.window.moveTop();
    if (alwaysOnTop) this.unpinned.get(entry.libraryId)?.delete(entry.instanceId);
    else {
      const ids = this.unpinned.get(entry.libraryId) ?? new Set<string>();
      ids.add(entry.instanceId);
      this.unpinned.set(entry.libraryId, ids);
    }
    entry.window.webContents.send('desktop-petals:changed');
  }
  resizeNote(entry: PetalWindow, size: { width: number; height: number }) {
    if (!entry.instanceId || !entry.expanded) throw petalError('sourceUnavailable');
    this.resize(entry, size);
    this.remember(entry);
  }
  showHubView(entry: PetalWindow, view: PetalHubView) {
    if (entry.instanceId) throw petalError('hubOnly');
    this.presentation.leaveFlower(entry);
    this.resize(entry, PETAL_WINDOW_SIZES[view]);
    entry.hubView = view;
    this.remember(entry);
    entry.window.webContents.send('desktop-petals:changed');
  }
  private resize(entry: PetalWindow, size: { width: number; height: number }) {
    const area = screen.getDisplayMatching(entry.window.getBounds()).workArea;
    size = { width: Math.min(size.width, area.width), height: Math.min(size.height, area.height) };
    // Remove the previous state's constraints before shrinking an expanded note.
    setPetalBounds(entry, { ...this.clamp(entry.window.getBounds(), size), ...size });
  }
  move(entry: PetalWindow, point: Point, pointer?: Point, size?: { width: number; height: number }) {
    const current = entry.window.getBounds();
    const bounds = { ...current, ...size };
    const area = screen.getDisplayNearestPoint(pointer ?? point).workArea;
    const position =
      !entry.instanceId && entry.hubView === 'flower'
        ? clampFlowerBounds({ ...bounds, ...point }, this.layouts.hubSettings.flowerSize, area)
        : clampPetalBounds(point, bounds, area);
    // Reusing setPosition's rounded getBounds size grows transparent Windows
    // windows on fractional DPI. Keep the gesture's starting size unchanged.
    if (current.x !== position.x || current.y !== position.y) entry.window.setBounds({ ...bounds, ...position });
  }
  async hide(entry: PetalWindow) {
    if (!(await this.beforeHide(entry)) || entry.window.isDestroyed()) return false;
    this.presentation.endPreview(entry);
    const previous = this.layouts.get(entry.libraryId, entry.instanceId ?? 'hub');
    this.remember(entry, false);
    try {
      await this.flush();
    } catch (error) {
      if (previous) this.layouts.set(entry.libraryId, entry.instanceId ?? 'hub', previous);
      throw error;
    }
    if (entry.window.isDestroyed()) return false;
    entry.window.hide();
    this.collectionHistory.clear(entry);
    return true;
  }
  async hideAllSaved({ keepHub = false }: { keepHub?: boolean } = {}) {
    const entries = [...this.entries.values()].filter((entry) => !keepHub || entry.instanceId !== null);
    for (const entry of entries) {
      this.presentation.endPreview(entry);
      this.remember(entry, false);
    }
    await this.flush();
    for (const entry of entries) if (!entry.window.isDestroyed()) entry.window.hide();
    this.collectionHistory.clear();
  }
  remember(entry: PetalWindow, visible?: boolean) {
    if (entry.drawer || entry.window.isDestroyed()) return;
    const previous = this.layouts.get(entry.libraryId, entry.instanceId ?? 'hub');
    const { x, y } = this.presentation.placement(entry);
    const previousSize = this.layouts.get(entry.libraryId, entry.instanceId ?? 'hub')?.noteSize;
    const bounds = entry.window.getBounds();
    const noteSize =
      entry.instanceId && entry.expanded
        ? { width: Math.max(280, Math.min(640, bounds.width)), height: Math.max(300, Math.min(800, bounds.height)) }
        : previousSize;
    this.layouts.set(entry.libraryId, entry.instanceId ?? 'hub', {
      ...previous,
      x,
      y,
      visible: visible ?? previous?.visible ?? entry.window.isVisible(),
      home: previous?.home ?? 'desktop',
      expanded: entry.expanded,
      noteSize,
      dockEdge: this.presentation.dock(entry)?.edge,
    });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.layouts.flush().catch((error) => console.error('[desktop-petals] layout save failed', error));
    }, 300);
  }
  async flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.layouts.flush();
  }
  destroyAll() {
    this.pluck.clear();
    this.collectionHistory.clear();
    for (const entry of [...this.entries.values()]) {
      this.entries.delete(entry.window.webContents.id);
      entry.window.destroy();
    }
  }
  remove(libraryId: string, instanceId: string) {
    this.unpinned.get(libraryId)?.delete(instanceId);
    this.layouts.remove(libraryId, instanceId);
    const entry = this.find(libraryId, instanceId);
    if (entry) {
      this.collectionHistory.clear(entry);
      this.entries.delete(entry.window.webContents.id);
      entry.window.destroy();
    }
  }
  private size(instanceId: string | null, expanded: boolean) {
    return !instanceId ? PETAL_WINDOW_SIZES.flower : expanded ? PETAL_WINDOW_SIZES.note : PETAL_WINDOW_SIZES.collapsed;
  }
  private clamp(point: Point, size: { width: number; height: number }) {
    const area = screen.getDisplayNearestPoint(point).workArea;
    return clampPetalBounds(point, size, area);
  }
}
