import { app, BrowserWindow, powerMonitor, screen, type Point, type Rectangle } from 'electron';
import { PACKAGED_RENDERER_URL } from '@/main/app/renderer-protocol';
import { isPackagedApplication } from '@/main/app/runtime-mode';
import { rendererRuntimePath } from '@/main/app/renderer-runtime-paths';
import { installWindowNavigationPolicy } from '@/main/app/window-security';
import { PetalLayoutStore } from '@/main/desktop-petals/petal-layout-store';
import { PETAL_WINDOW_SIZES, type PetalHubView } from '@/shared/contracts/petal-hub';
import { desktopPetalMessages } from '@/shared/i18n/desktop-petals';
import { petalError } from '@/shared/petal-errors';
import { PetalHubPresentation, setPetalBounds } from '@/main/desktop-petals/petal-hub-presentation';
import { clampFlowerBounds, clampImagePinBounds, clampPetalBounds } from '@/main/desktop-petals/petal-window-geometry';
import { PetalInputMonitor } from '@/main/desktop-petals/petal-input-monitor';
import type { PetalLanguage } from '@/shared/contracts/petal-language';
import { PetalCollectionHistory } from '@/main/desktop-petals/petal-collection-history';
import { PetalCollectionPreview } from '@/main/desktop-petals/petal-collection-preview';
import { PetalPluckMonitor } from '@/main/desktop-petals/petal-pluck-monitor';
import { loadPetalWindow, type PetalWindowLoad } from '@/main/desktop-petals/petal-window-loading';
import { PetalOverlayWindows } from '@/main/desktop-petals/petal-overlay-windows';
import { nativePetalWindows, type PetalWindowFactory } from '@/main/desktop-petals/petal-window-factory';
import { PetalWindowResidency } from '@/main/desktop-petals/petal-window-residency';
import { PetalRuntimeDiagnostics } from '@/main/desktop-petals/petal-runtime-diagnostics';
import { PetalDesktopRecovery } from '@/main/desktop-petals/petal-desktop-recovery';
import { PetalNotePanel } from '@/main/desktop-petals/petal-note-panel';
import { PetalWindowTools } from '@/main/desktop-petals/petal-window-tools';
import { PetalImageEditorWindow } from '@/main/desktop-petals/petal-image-editor-window';

// WS_EX_TOOLWINDOW keeps desktop widgets out of Explorer's taskbar previews even
// when the shell rebuilds its task list; skipTaskbar alone is not persistent.
const windowsPetalWindowType = process.platform === 'win32' ? ('toolbar' as const) : undefined;

function applyPetalAlwaysOnTop(window: BrowserWindow, alwaysOnTop: boolean) {
  // On Windows, Electron's default floating level follows the taskbar's Z-order on activation.
  // The normal level keeps HWND_TOPMOST from the flag without following a temporarily lowered taskbar.
  window.setAlwaysOnTop(alwaysOnTop, process.platform === 'win32' ? 'normal' : 'floating');
}

export interface PetalWindow {
  previewToken?: string;
  drawer?: boolean;
  window: BrowserWindow;
  libraryId: string;
  instanceId: string | null;
  expanded: boolean;
  editEpoch: number;
  imageEditRequest?: string;
  hubView: PetalHubView;
}
export class PetalWindows {
  readonly imageEditor = new PetalImageEditorWindow();
  readonly collectionPreview = new PetalCollectionPreview();
  readonly tools = new PetalWindowTools();
  readonly notePanel = new PetalNotePanel();
  readonly overlays = new PetalOverlayWindows();
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
    () => this.desktopRecovery.request('show-desktop'),
  );
  readonly pluck = new PetalPluckMonitor(this.input);
  canRestoreVisibility?: (entry: PetalWindow) => boolean;
  private readonly desktopRecovery = new PetalDesktopRecovery(
    () =>
      !this.allowPresentation || this.allowClose
        ? []
        : [...this.entries.values()].filter(
            (entry) =>
              !entry.drawer &&
              !entry.window.isDestroyed() &&
              !this.opening.has(entry.window.webContents.id) &&
              this.wantsAlwaysOnTop(entry.libraryId, entry.instanceId) &&
              this.shouldRestore(entry),
          ),
    (handles) => this.input.sampleVisibility(handles),
    (details) => this.diagnostics?.record('desktop-recovery', details),
  );
  startInput() {
    this.diagnostics ??= new PetalRuntimeDiagnostics(() => this.entries.values());
    if (this.allowPresentation) this.input.start();
    const resume = () => this.desktopRecovery.request('resume');
    const displays = () => this.desktopRecovery.request('displays');
    if (process.platform === 'win32') {
      powerMonitor.on('resume', resume);
      screen.on('display-added', displays);
      screen.on('display-removed', displays);
      screen.on('display-metrics-changed', displays);
    }
    app.once('will-quit', () => {
      this.diagnostics?.dispose();
      this.residency.dispose();
      this.desktopRecovery.dispose();
      powerMonitor.removeListener('resume', resume);
      screen.removeListener('display-added', displays);
      screen.removeListener('display-removed', displays);
      screen.removeListener('display-metrics-changed', displays);
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
  private readonly opening = new Map<number, PetalWindowLoad>();
  private readonly deferredRestores = new Set<PetalWindow>();
  private readonly creating = new Map<string, Promise<PetalWindow>>();
  private readonly transitions = new Map<PetalWindow, Promise<PetalWindow>>();
  private diagnostics?: PetalRuntimeDiagnostics;
  private generation = 0;
  private rendererRecovery = 0;
  private lastRendererFailure = -Infinity;
  beforeReplace?: (entry: PetalWindow) => Promise<boolean>;
  private readonly residency = new PetalWindowResidency(
    (entry) => !entry.drawer && !this.opening.has(entry.window.webContents.id) && !this.shouldRestore(entry),
    async (entry) => {
      try {
        return await (this.beforeReplace?.(entry) ?? this.beforeHide(entry));
      } finally {
        if (!entry.window.isDestroyed()) {
          entry.editEpoch++;
          entry.window.webContents.send('desktop-petals:changed');
        }
      }
    },
  );
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    readonly layouts: PetalLayoutStore,
    private readonly allowPresentation: boolean,
    private readonly beforeHide: (entry: PetalWindow) => Promise<boolean>,
    private readonly onContextMenu?: (entry: PetalWindow) => void,
    private readonly title = (isNote: boolean) =>
      isNote ? desktopPetalMessages.note.windowTitle : desktopPetalMessages.flower.title,
    private readonly factory: PetalWindowFactory = nativePetalWindows,
  ) {
    factory.onRendererGone = (windows) => {
      const generation = this.generation;
      const recovery = ++this.rendererRecovery;
      const entries = windows.flatMap((window) => {
        if (window.isDestroyed()) return [];
        const entry = this.entries.get(window.webContents.id);
        return entry && !entry.expanded && !this.opening.has(window.webContents.id) && this.shouldRestore(entry)
          ? [entry]
          : [];
      });
      const now = performance.now();
      const retry = now - this.lastRendererFailure >= 60_000;
      this.lastRendererFailure = now;
      this.diagnostics?.record('shared-renderer-lost', {
        windows: windows.length,
        restoring: retry ? entries.length : 0,
      });
      if (!retry) return;
      // Run after the failed host has closed its children. A second failure
      // cancels this batch rather than starting an automatic crash loop.
      void Promise.resolve()
        .then(async () => {
          for (const entry of entries) {
            if (generation !== this.generation || recovery !== this.rendererRecovery) return;
            if (this.shouldRestore(entry)) await this.restore(entry.libraryId, entry.instanceId);
          }
        })
        .catch((error) => console.error('[desktop-petals] shared renderer recovery failed', error));
    };
  }

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
      ...(windowsPetalWindowType ? { type: windowsPetalWindowType } : {}),
      alwaysOnTop: true,
      acceptFirstMouse: process.platform === 'darwin',
      hasShadow: false,
      title,
      webPreferences: {
        preload: rendererRuntimePath('preload', 'desktop-petals.js'),
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
    const senderId = window.webContents.id;
    this.entries.set(senderId, entry);
    installWindowNavigationPolicy(window, url);
    this.overlays.install(entry, url);
    window.on('blur', () => {
      if (!this.overlays.hasMenu(entry)) onBlur();
    });
    window.on('close', (event) => {
      if (!this.allowClose) {
        event.preventDefault();
        onHide();
      }
    });
    window.on('closed', () => this.entries.delete(senderId));
    return this.finishOpening(
      entry,
      url,
      () => {
        if (this.allowPresentation && !this.allowClose) window.showInactive();
      },
      false,
    );
  }
  async show(libraryId: string, instanceId: string | null, point?: Point, expanded?: boolean, handoff = false) {
    return this.open(libraryId, instanceId, point, expanded, handoff, false);
  }
  async pin(libraryId: string, instanceId: string, point?: Point, expanded?: boolean, handoff = false) {
    this.unpinned.get(libraryId)?.delete(instanceId);
    return this.show(libraryId, instanceId, point, expanded, handoff);
  }
  async restore(libraryId: string, instanceId: string | null) {
    if (!this.hasVisiblePlacement(libraryId, instanceId)) return null;
    try {
      return await this.open(libraryId, instanceId, undefined, undefined, false, true);
    } catch (error) {
      // A failed view keeps its saved placement and must not stop the remaining batch.
      console.error('[desktop-petals] window restore failed', { libraryId, instanceId }, error);
      return null;
    }
  }
  async resumeRestores() {
    for (const entry of [...this.deferredRestores]) {
      if (entry.window.isDestroyed() || !this.hasVisiblePlacement(entry.libraryId, entry.instanceId)) {
        this.deferredRestores.delete(entry);
        continue;
      }
      await this.restore(entry.libraryId, entry.instanceId);
    }
  }
  private async reopen(entry: PetalWindow, expanded: boolean | undefined, restoring: boolean, handoff: boolean) {
    await this.opening.get(entry.window.webContents.id)?.ready;
    if (entry.window.isDestroyed()) throw petalError('sourceUnavailable');
    if (restoring && !this.prepareRestore(entry)) return entry;
    this.collectionHistory.clear(entry);
    entry.editEpoch++;
    entry.window.setIgnoreMouseEvents(false);
    if (expanded !== undefined && expanded !== entry.expanded) {
      // An explicit open may originate in the drawer or a hidden placement.
      // Record that intent before the asynchronous renderer handoff begins.
      if (!restoring) this.remember(entry, true);
      return this.expand(entry, expanded);
    }
    this.present(entry, restoring, handoff);
    this.remember(entry, true);
    entry.window.webContents.send('desktop-petals:changed');
    return entry;
  }
  private async open(
    libraryId: string,
    instanceId: string | null,
    point: Point | undefined,
    expanded: boolean | undefined,
    handoff: boolean,
    restoring: boolean,
  ) {
    const key = `${libraryId}:${instanceId ?? 'hub'}`;
    const pending = this.creating.get(key);
    if (pending) {
      const entry = await pending;
      return this.reopen(entry, expanded, restoring, handoff);
    }
    const request = this.openInstance(libraryId, instanceId, point, expanded, handoff, restoring);
    this.creating.set(key, request);
    try {
      return await request;
    } finally {
      if (this.creating.get(key) === request) this.creating.delete(key);
    }
  }
  private async openInstance(
    libraryId: string,
    instanceId: string | null,
    point: Point | undefined,
    expanded: boolean | undefined,
    handoff: boolean,
    restoring: boolean,
    replacing?: PetalWindow,
  ) {
    const existing = this.find(libraryId, instanceId);
    if (existing && !replacing) return this.reopen(existing, expanded, restoring, handoff);
    const generation = this.generation;
    const previous = this.layouts.get(libraryId, instanceId ?? 'hub');
    const isExpanded = instanceId ? (expanded ?? previous?.expanded ?? false) : false;
    let size =
      instanceId && isExpanded
        ? (previous?.imageSize ?? previous?.noteSize ?? PETAL_WINDOW_SIZES.note)
        : this.size(instanceId, isExpanded);
    const area = screen.getPrimaryDisplay().workArea;
    const position = point ?? previous ?? { x: area.x + area.width - size.width - 30, y: area.y + 100 };
    const imagePin = Boolean(instanceId && isExpanded && previous?.imageSize);
    const targetArea = imagePin
      ? screen.getDisplayMatching({ ...position, ...size }).workArea
      : screen.getDisplayNearestPoint(
          instanceId ? position : { x: position.x + size.width / 2, y: position.y + size.height / 2 },
        ).workArea;
    if (!imagePin)
      size = { width: Math.min(size.width, targetArea.width), height: Math.min(size.height, targetArea.height) };
    const url = new URL(
      !isPackagedApplication(app) && process.env.ELECTRON_RENDERER_URL
        ? process.env.ELECTRON_RENDERER_URL
        : PACKAGED_RENDERER_URL,
    );
    url.pathname = '/petals.html';
    return this.factory.create(
      {
        ...size,
        ...(instanceId
          ? imagePin
            ? clampImagePinBounds(position, size, targetArea)
            : this.clamp(position, size)
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
        ...(windowsPetalWindowType ? { type: windowsPetalWindowType } : {}),
        alwaysOnTop: this.wantsAlwaysOnTop(libraryId, instanceId),
        acceptFirstMouse: process.platform === 'darwin',
        hasShadow: false,
        title: this.title(Boolean(instanceId)),
        webPreferences: {
          preload: rendererRuntimePath('preload', 'desktop-petals.js'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      },
      url,
      Boolean(instanceId && !isExpanded),
      (window, navigating) => {
        if (generation !== this.generation || (replacing && replacing.window.isDestroyed())) {
          window.destroy();
          return Promise.reject(petalError('sourceUnavailable'));
        }
        const entry: PetalWindow = {
          window,
          libraryId,
          instanceId,
          expanded: isExpanded,
          editEpoch: 0,
          hubView: 'flower',
        };
        window.setIgnoreMouseEvents(false);
        applyPetalAlwaysOnTop(window, this.wantsAlwaysOnTop(libraryId, instanceId));
        const senderId = window.webContents.id;
        this.entries.set(senderId, entry);
        this.residency.track(entry);
        this.diagnostics?.attach(entry);
        installWindowNavigationPolicy(window, url);
        this.overlays.install(entry, url);
        if (this.onContextMenu) {
          window.on('system-context-menu', (event) => {
            if (entry.instanceId && entry.expanded) return;
            event.preventDefault();
            this.onContextMenu?.(entry);
          });
        }
        window.on('move', () => {
          this.remember(entry);
          if (nativeMove) this.onDragMove?.(entry, screen.getCursorScreenPoint());
        });
        window.on('hide', () => {
          if (!entry.instanceId && entry.hubView === 'settings') this.presentation.showView(entry, 'flower');
        });
        // Programmatic bounds changes also emit move events. Only an OS gesture
        // emits will-move; renderer gestures explicitly snap when released.
        let nativeMove = false;
        window.on('will-move', () => {
          this.notePanel.moved(entry);
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
          this.deferredRestores.delete(entry);
        });
        return this.finishOpening(
          entry,
          url,
          () => {
            if (
              replacing &&
              (replacing.window.isDestroyed() ||
                this.allowClose ||
                !(this.canRestoreVisibility?.(entry) ?? true) ||
                !this.layouts.get(libraryId, instanceId ?? 'hub')?.visible)
            )
              throw petalError('saving');
            if (restoring && !this.prepareRestore(entry)) return;
            if (!instanceId && previous?.dockEdge) this.presentation.restoreDock(entry, previous.dockEdge);
            this.present(entry, restoring, handoff);
            this.remember(entry, true);
            if (replacing && !replacing.window.isDestroyed()) replacing.window.destroy();
          },
          this.allowPresentation,
          navigating,
        );
      },
    );
  }
  private async finishOpening(
    entry: PetalWindow,
    url: URL,
    present: () => void,
    waitForPaint = this.allowPresentation,
    navigating = false,
  ) {
    const { window } = entry;
    const startedAt = performance.now();
    const senderId = window.webContents.id;
    const loading = loadPetalWindow(window, url.href, waitForPaint, navigating);
    this.opening.set(senderId, loading);
    try {
      await loading.ready;
      if (window.isDestroyed()) throw petalError('sourceUnavailable');
      present();
      this.diagnostics?.record('window-ready', {
        webContentsId: senderId,
        durationMs: Math.round(performance.now() - startedAt),
        expanded: entry.expanded,
      });
      return entry;
    } catch (error) {
      this.entries.delete(senderId);
      if (!window.isDestroyed()) window.destroy();
      throw error;
    } finally {
      this.opening.delete(senderId);
      loading.dispose();
    }
  }
  rendered(entry: PetalWindow) {
    this.opening.get(entry.window.webContents.id)?.rendered();
  }
  private hasVisiblePlacement(libraryId: string, instanceId: string | null) {
    const placement = this.layouts.get(libraryId, instanceId ?? 'hub');
    // A library's first activation shows its flower; an explicit hide remains a saved preference.
    const visible = placement ? placement.visible && placement.home !== 'drawer' : instanceId === null;
    return !this.allowClose && visible;
  }
  private shouldRestore(entry: PetalWindow) {
    return this.hasVisiblePlacement(entry.libraryId, entry.instanceId) && (this.canRestoreVisibility?.(entry) ?? true);
  }
  private prepareRestore(entry: PetalWindow) {
    if (this.shouldRestore(entry)) return true;
    // A canceled library drain can resume this already-loaded window without recreating its editor.
    if (this.hasVisiblePlacement(entry.libraryId, entry.instanceId)) this.deferredRestores.add(entry);
    return false;
  }
  private wantsAlwaysOnTop(libraryId: string, instanceId: string | null) {
    return !instanceId || !this.unpinned.get(libraryId)?.has(instanceId);
  }
  private present(entry: PetalWindow, restoring = false, handoff = false) {
    this.deferredRestores.delete(entry);
    if (!this.allowPresentation) return;
    if (!restoring) this.tools.restorePointer(entry);
    // An explicit open of an editor must activate it even when another app is
    // foreground. A paint handoff stays inactive only for collapsed petals.
    if (restoring || (handoff && entry.instanceId !== null && !entry.expanded)) entry.window.showInactive();
    else entry.window.show();
    // Reapply the user's choice after showing; the native flag alone is not the preference.
    const alwaysOnTop = this.wantsAlwaysOnTop(entry.libraryId, entry.instanceId);
    applyPetalAlwaysOnTop(entry.window, alwaysOnTop);
    if (alwaysOnTop) entry.window.moveTop();
  }
  async expand(entry: PetalWindow, expanded: boolean): Promise<PetalWindow> {
    const pending = this.transitions.get(entry);
    if (pending) return this.expand(await pending, expanded);
    const request = this.replace(entry, expanded);
    this.transitions.set(entry, request);
    try {
      return await request;
    } finally {
      if (this.transitions.get(entry) === request) this.transitions.delete(entry);
    }
  }
  async settle() {
    await Promise.allSettled([...this.creating.values(), ...this.transitions.values()]);
  }
  private async replace(entry: PetalWindow, expanded: boolean): Promise<PetalWindow> {
    if (entry.expanded === expanded) return entry;
    if (entry.expanded && this.beforeReplace && !(await this.beforeReplace(entry))) throw petalError('unsaved');
    if (entry.window.isDestroyed()) throw petalError('sourceUnavailable');
    this.notePanel.set(entry, 0);
    if (expanded) this.collectionHistory.clear(entry);
    this.presentation.endPreview(entry);
    this.remember(entry);
    this.imageEditor.set(entry, false);
    try {
      return await this.openInstance(entry.libraryId, entry.instanceId, undefined, expanded, true, false, entry);
    } finally {
      if (!entry.window.isDestroyed()) {
        entry.editEpoch++;
        entry.window.webContents.send('desktop-petals:changed');
      }
    }
  }
  async collect(entry: PetalWindow, origin: Rectangle, collectionLibraryId = entry.libraryId) {
    if (!entry.instanceId || entry.window.isDestroyed() || !entry.window.isVisible()) return;
    const placement = this.imageEditor.placement(entry);
    const bounds = entry.window.getBounds();
    const restore = { ...placement, x: origin.x + placement.x - bounds.x, y: origin.y + placement.y - bounds.y };
    if (!(await this.hide(entry))) throw petalError('unsaved');
    this.collectionHistory.record(entry, restore, collectionLibraryId);
  }
  async undoCollection(libraryId: string, token: string) {
    const previous = this.collectionHistory.current(libraryId);
    if (!previous || previous.token !== token) throw petalError('sourceUnavailable');
    this.move(previous.entry, previous.bounds, undefined, previous.bounds);
    const entry = await this.show(previous.entry.libraryId, previous.entry.instanceId, undefined, previous.expanded);
    this.remember(entry, true);
    await this.flush();
  }
  setAlwaysOnTop(entry: PetalWindow, alwaysOnTop: boolean) {
    if (!entry.instanceId || entry.window.isDestroyed()) throw petalError('sourceUnavailable');
    // Keep the choice through window recreation and library switches, but never persist it across app restarts.
    applyPetalAlwaysOnTop(entry.window, alwaysOnTop);
    if (alwaysOnTop && this.allowPresentation && entry.window.isVisible()) entry.window.moveTop();
    if (alwaysOnTop) this.unpinned.get(entry.libraryId)?.delete(entry.instanceId);
    else {
      const ids = this.unpinned.get(entry.libraryId) ?? new Set<string>();
      ids.add(entry.instanceId);
      this.unpinned.set(entry.libraryId, ids);
    }
    entry.window.webContents.send('desktop-petals:changed');
  }
  retarget(entry: PetalWindow, libraryId: string, instanceId: string) {
    const alwaysOnTop = entry.window.isAlwaysOnTop();
    if (entry.instanceId) this.unpinned.get(entry.libraryId)?.delete(entry.instanceId);
    const previous = this.find(libraryId, instanceId);
    if (previous && previous !== entry) previous.window.destroy();
    this.collectionHistory.clear(entry);
    entry.libraryId = libraryId;
    entry.instanceId = instanceId;
    entry.editEpoch++;
    this.setAlwaysOnTop(entry, alwaysOnTop);
  }
  async setContentScale(entry: PetalWindow | undefined, scale: number) {
    if (!entry?.instanceId || !entry.expanded || entry.window.isDestroyed()) throw petalError('sourceUnavailable');
    this.remember(entry);
    await this.layouts.saveContentScale(entry.libraryId, entry.instanceId, scale);
    if (!entry.window.isDestroyed()) entry.window.webContents.send('desktop-petals:changed');
  }

  resizeNote(entry: PetalWindow, size: { width: number; height: number }) {
    if (!entry.instanceId || !entry.expanded) throw petalError('sourceUnavailable');
    if (this.tools.locked(entry)) return;
    this.notePanel.moved(entry);
    this.resize(entry, { ...size, height: size.height + this.notePanel.height(entry) });
    this.remember(entry);
  }
  showHubView(entry: PetalWindow, view: PetalHubView) {
    if (entry.instanceId) throw petalError('hubOnly');
    this.presentation.showView(entry, view);
  }
  private resize(entry: PetalWindow, size: { width: number; height: number }) {
    const area = screen.getDisplayMatching(entry.window.getBounds()).workArea;
    size = { width: Math.min(size.width, area.width), height: Math.min(size.height, area.height) };
    // Remove the previous state's constraints before shrinking an expanded note.
    setPetalBounds(entry, { ...this.clamp(entry.window.getBounds(), size), ...size });
  }
  move(entry: PetalWindow, point: Point, pointer?: Point, size?: { width: number; height: number }) {
    if (this.tools.locked(entry)) return;
    const current = entry.window.getBounds();
    const bounds = { ...current, ...size };
    const area = screen.getDisplayNearestPoint(pointer ?? point).workArea;
    const position =
      !entry.instanceId && entry.hubView === 'flower'
        ? clampFlowerBounds({ ...bounds, ...point }, this.layouts.hubSettings.flowerSize, area)
        : entry.instanceId && this.layouts.get(entry.libraryId, entry.instanceId)?.imageSize
          ? clampImagePinBounds(point, bounds, area)
          : clampPetalBounds(point, bounds, area);
    // Reusing setPosition's rounded getBounds size grows transparent Windows
    // windows on fractional DPI. Keep the gesture's starting size unchanged.
    if (current.x !== position.x || current.y !== position.y) {
      this.presentation.moveView(entry, position.x - current.x, position.y - current.y);
      entry.window.setBounds({ ...bounds, ...position });
    }
  }
  async hide(entry: PetalWindow) {
    if (!(await this.beforeHide(entry)) || entry.window.isDestroyed()) return false;
    this.imageEditor.set(entry, false);
    this.notePanel.set(entry, 0);
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
      this.imageEditor.set(entry, false);
      this.remember(entry, false);
    }
    await this.flush();
    for (const entry of entries) if (!entry.window.isDestroyed()) entry.window.hide();
    this.collectionHistory.clear();
  }
  remember(entry: PetalWindow, visible?: boolean) {
    if (entry.drawer || entry.window.isDestroyed()) return;
    const previous = this.layouts.get(entry.libraryId, entry.instanceId ?? 'hub');
    const { x, y } = this.layouts.get(entry.libraryId, entry.instanceId ?? 'hub')?.imageSize
      ? this.imageEditor.placement(entry)
      : this.notePanel.height(entry)
        ? this.notePanel.placement(entry)
        : this.presentation.placement(entry);
    const previousSize = this.layouts.get(entry.libraryId, entry.instanceId ?? 'hub')?.noteSize;
    const bounds = previous?.imageSize ? this.imageEditor.placement(entry) : this.notePanel.placement(entry);
    const noteSize =
      entry.instanceId && entry.expanded
        ? { width: Math.max(280, Math.min(640, bounds.width)), height: Math.max(300, Math.min(800, bounds.height)) }
        : previousSize;
    this.layouts.set(entry.libraryId, entry.instanceId ?? 'hub', {
      ...previous,
      x,
      y,
      visible: visible ?? previous?.visible ?? entry.window.isVisible(),
      hiddenByHub: visible !== undefined ? false : previous?.hiddenByHub,
      home: previous?.home ?? 'desktop',
      expanded: entry.expanded,
      noteSize,
      ...(previous?.imageSize && entry.expanded ? { imageSize: { width: bounds.width, height: bounds.height } } : {}),
      dockEdge: this.presentation.dockEdge(entry),
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
  destroyAll(keepLibraryId?: string) {
    this.generation++;
    if (!keepLibraryId) {
      this.desktopRecovery.dispose();
      this.residency.dispose();
    }
    this.pluck.clear();
    this.collectionHistory.clear();
    for (const entry of [...this.entries.values()]) {
      if (entry.libraryId === keepLibraryId) continue;
      this.entries.delete(entry.window.webContents.id);
      entry.window.destroy();
    }
    if (!keepLibraryId) this.factory.dispose();
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
