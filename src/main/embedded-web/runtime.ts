import { session, WebContentsView, type BrowserWindow, type Session } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { installCodexVisualizationPreviewProtocol } from '@/main/app/codex-visualization-preview-protocol';
import { isEmbeddedWebResource } from '@/main/embedded-web/policy';
import { htmlFilePreviews } from '@/main/embedded-web/html-file-previews';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';
import {
  EMBEDDED_WEB_EXTENSION_ID,
  type EmbeddedWebBounds,
  type EmbeddedWebClosed,
  type EmbeddedWebShowInput,
} from '@/shared/contracts/embedded-web';

interface RunningPage {
  previewId: string;
  context: ActiveLibraryContext;
  owner: BrowserWindow;
  view: WebContentsView;
  disposeListeners(): void;
  ready: Promise<void>;
  fromLibrary: boolean;
}

/** One visible, disposable page. No preload, shared cookies, disk storage or host bridge. */
export class EmbeddedWebRuntime {
  private isolatedSession: Session | null = null;
  private running: RunningPage | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly getContext: () => ActiveLibraryContext | null,
  ) {}

  private authorized(page: RunningPage) {
    return (
      page === this.running &&
      page.context === this.getContext() &&
      page.context.state === 'ACTIVE' &&
      page.context.extensions.isActivated(EMBEDDED_WEB_EXTENSION_ID) &&
      (page.fromLibrary
        ? Boolean(htmlFilePreviews(page.context).executable(page.previewId))
        : page.context.extensions.isActivated(CODEX_EXTENSION_ID))
    );
  }

  private getSession() {
    if (this.isolatedSession) return this.isolatedSession;
    // Without the persist: prefix Electron keeps this session in memory.
    const isolated = session.fromPartition('aiy-embedded-web', { cache: false });
    isolated.setPermissionCheckHandler(() => false);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setDevicePermissionHandler(() => false);
    isolated.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    isolated.on('will-download', (event) => event.preventDefault());
    isolated.enableNetworkEmulation({ offline: true });
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const page = this.running;
      const allowed =
        page &&
        this.authorized(page) &&
        details.webContentsId === page.view.webContents.id &&
        (details.method === 'GET' || details.method === 'HEAD') &&
        isEmbeddedWebResource(details.url, page.previewId);
      callback({ cancel: !allowed });
    });
    installCodexVisualizationPreviewProtocol(isolated.protocol, this.getContext, (previewId) => {
      const page = this.running;
      return Boolean(page && page.previewId === previewId && this.authorized(page));
    });
    this.isolatedSession = isolated;
    return isolated;
  }

  async show(input: EmbeddedWebShowInput) {
    const previous = this.running;
    if (previous?.previewId === input.previewId) {
      if (!this.authorized(previous)) {
        this.stop('STOPPED');
        throw new Error('Embedded web runtime is unavailable');
      }
      this.setBounds(previous, input.bounds);
      return previous.ready;
    }
    const context = this.getContext();
    const owner = this.getWindow();
    if (
      !context ||
      context.state !== 'ACTIVE' ||
      !owner ||
      owner.isDestroyed() ||
      !context.extensions.isActivated(EMBEDDED_WEB_EXTENSION_ID)
    ) {
      throw new Error('Embedded web runtime is unavailable');
    }
    const imported = htmlFilePreviews(context);
    const libraryAccess = imported.executable(input.previewId);
    if (!libraryAccess && !context.extensions.isActivated(CODEX_EXTENSION_ID)) throw new Error('Preview unavailable');
    const access = libraryAccess ?? context.visualizationDiscovery.executableHtmlPreview(input.previewId);
    if (previous && !input.replaceExisting) throw new Error('EMBEDDED_WEB_BUSY');
    this.stop('STOPPED');
    const isolated = this.getSession();
    const view = new WebContentsView({
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        plugins: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
        devTools: false,
        spellcheck: false,
        backgroundThrottling: true,
      },
    });
    view.setBackgroundColor('#ffffff');
    const contents = view.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // CSP does not cover every WebRTC transport. Forbid direct UDP and put TCP
    // behind a fixed loopback discard proxy, in addition to offline mode.
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-frame-navigate', (event) => event.preventDefault());
    contents.on('will-redirect', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.on('select-bluetooth-device', (event, _devices, callback) => {
      event.preventDefault();
      callback('');
    });
    const stop = () => this.running?.view === view && this.stop('STOPPED');
    const failed = () => this.running?.view === view && this.stop('FAILED');
    const changed = () => {
      if (this.running?.view === view && !this.authorized(this.running)) stop();
    };
    const released = (previewId: string) => {
      if (previewId === input.previewId) stop();
    };
    const unsubscribe = context.extensions.onChanged(changed);
    const revoked = () => {
      if (!libraryAccess || context.state !== 'ACTIVE') stop();
    };
    context.visualizationDiscovery.on('html-previews-revoked', revoked);
    context.visualizationDiscovery.on('html-preview-released', released);
    imported.on('html-preview-released', released);
    owner.once('closed', stop);
    owner.webContents.on('render-process-gone', stop);
    const ownerNavigation = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) stop();
    };
    owner.webContents.on('did-start-navigation', ownerNavigation);
    contents.on('render-process-gone', failed);
    contents.on('unresponsive', failed);
    contents.on('before-input-event', (event, inputEvent) => {
      if (inputEvent.type === 'keyDown' && inputEvent.key === 'Escape') {
        event.preventDefault();
        stop();
      }
    });
    const expiry = setTimeout(stop, Math.max(0, access.expiresAtMs - Date.now()));
    const page: RunningPage = {
      previewId: input.previewId,
      context,
      owner,
      view,
      ready: Promise.resolve(),
      fromLibrary: Boolean(libraryAccess),
      disposeListeners: () => {
        clearTimeout(expiry);
        unsubscribe();
        context.visualizationDiscovery.off('html-previews-revoked', revoked);
        context.visualizationDiscovery.off('html-preview-released', released);
        imported.off('html-preview-released', released);
        owner.off('closed', stop);
        if (!owner.webContents.isDestroyed()) {
          owner.webContents.off('render-process-gone', stop);
          owner.webContents.off('did-start-navigation', ownerNavigation);
        }
      },
    };
    this.running = page;
    owner.contentView.addChildView(view);
    this.setBounds(page, input.bounds);
    page.ready = (async () => {
      await isolated.setProxy({ proxyRules: 'http://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
      if (!this.authorized(page)) return;
      await contents.loadURL(access.url);
    })().catch(() => {
      if (this.running === page) {
        this.stop('FAILED');
        throw new Error('Embedded web page could not be loaded');
      }
    });
    return page.ready;
  }

  private setBounds(page: RunningPage, bounds: EmbeddedWebBounds) {
    const [width, height] = page.owner.getContentSize();
    const zoom = page.owner.webContents.getZoomFactor();
    const x = Math.min(width, Math.round(bounds.x * zoom));
    const y = Math.min(height, Math.round(bounds.y * zoom));
    const availableWidth = Math.max(0, Math.min(width - x, Math.round(bounds.width * zoom)));
    const availableHeight = Math.max(0, Math.min(height - y, Math.round(bounds.height * zoom)));
    page.view.setBounds({ x, y, width: availableWidth, height: availableHeight });
    page.view.setVisible(availableWidth > 0 && availableHeight > 0);
  }

  hide(previewId: string) {
    if (this.running?.previewId === previewId) this.stop();
  }

  private stop(reason?: EmbeddedWebClosed['reason']) {
    const page = this.running;
    if (!page) return;
    this.running = null;
    page.disposeListeners();
    if (!page.owner.isDestroyed()) page.owner.contentView.removeChildView(page.view);
    if (!page.view.webContents.isDestroyed()) page.view.webContents.close({ waitForBeforeUnload: false });
    if (reason && !page.owner.webContents.isDestroyed()) {
      page.owner.webContents.focus();
      page.owner.webContents.send('embedded-web:closed', {
        previewId: page.previewId,
        reason,
      } satisfies EmbeddedWebClosed);
    }
  }
}
