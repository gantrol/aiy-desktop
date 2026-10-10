import { protocol, session } from 'electron';
import type { ArticleEditorRecoveryStore } from '@/main/app/article-editor-recovery-store';
import type { DesktopApplicationShell } from '@/main/app/application-shell';
import { installCodexVisualizationPreviewProtocol } from '@/main/app/codex-visualization-preview-protocol';
import { installMediaProtocol } from '@/main/app/media-protocol';
import { installRendererProtocol } from '@/main/app/renderer-protocol';
import { rendererRuntimePath } from '@/main/app/renderer-runtime-paths';
import type { TransitionPreviewCache } from '@/main/app/transition-preview-cache';
import { installSessionSecurityPolicy } from '@/main/app/window-security';
import type { WorkspaceLayoutStore } from '@/main/app/workspace-layout-store';
import { registerApplicationIpc, type RegisterIpcRuntimeOptions } from '@/main/ipc/register-ipc';
import {
  createTrustedIpcHandlerRegistrar,
  type IpcHandlerRegistrar,
  type TrustedIpcInvocationRunner,
} from '@/main/ipc/trusted-handlers';
import type { LibraryRegistry } from '@/main/libraries/library-registry';
import { appShellLanguageSchema } from '@/shared/contracts/tray-menu';
import { EmbeddedWebRuntime } from '@/main/embedded-web/runtime';
import { registerHtmlFileIpc } from '@/main/embedded-web/html-file-ipc';
import { registerReadingFileIpc } from '@/main/embedded-web/reading-file-ipc';
import { embeddedWebHideSchema, embeddedWebShowSchema } from '@/shared/contracts/embedded-web';

type BootstrapHandler = (rawLocale: unknown) => unknown;
type StartupRequestHandler = Parameters<IpcHandlerRegistrar['handle']>[1];

interface StartupShellOptions {
  articleEditorRecovery: ArticleEditorRecoveryStore;
  currentSpaceId(): string;
  ipcMain: IpcHandlerRegistrar;
  libraryRegistry(): LibraryRegistry | null;
  shell: DesktopApplicationShell;
  transitionPreviews: TransitionPreviewCache;
  workspaceLayouts: WorkspaceLayoutStore;
}

export function prepareStartupShell(options: StartupShellOptions) {
  options.shell.deferBackgroundServicesStart();
  // These requests are made on first render, before library services exist.
  const pendingHandlers = new Map<string, (handler: StartupRequestHandler) => void>();
  for (const channel of [
    'extension-language-packs:list',
    'image-visibility:list',
    'video-document:transcript-background-tasks-get',
  ]) {
    const handlerReady = new Promise<StartupRequestHandler>((resolve) => pendingHandlers.set(channel, resolve));
    options.ipcMain.handle(channel, (event, ...args) => handlerReady.then((handler) => handler(event, ...args)));
  }
  let bootstrapHandler: BootstrapHandler | null = null;
  let bootstrapFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let initialBootstrapSettled = false;
  let firstWindowReady = false;
  let resolveFirstBootstrap: () => void = () => undefined;
  const afterFirstBootstrap = new Promise<void>((resolve) => {
    resolveFirstBootstrap = resolve;
  });
  const resumeAuxiliaryWindows = () => {
    // Reply to bootstrap and show the main window before creating more renderers.
    if (initialBootstrapSettled && firstWindowReady) setImmediate(resolveFirstBootstrap);
  };
  let resolveBootstrapHandler: (handler: BootstrapHandler) => void = () => undefined;
  const bootstrapHandlerReady = new Promise<BootstrapHandler>((resolve) => {
    resolveBootstrapHandler = resolve;
  });
  const resumeBackgroundServices = () => {
    if (initialBootstrapSettled) return;
    initialBootstrapSettled = true;
    if (bootstrapFallbackTimer) clearTimeout(bootstrapFallbackTimer);
    bootstrapFallbackTimer = null;
    options.shell.resumeBackgroundServicesStart();
    resumeAuxiliaryWindows();
  };
  const installBootstrapHandler = (handler: BootstrapHandler) => {
    bootstrapHandler = handler;
    resolveBootstrapHandler(handler);
    bootstrapFallbackTimer = setTimeout(resumeBackgroundServices, 5_000);
  };

  registerApplicationIpc(() => options.shell.mainWindow, options.workspaceLayouts, options.articleEditorRecovery);
  options.ipcMain.handle('app:request-quit', () => options.shell.requestAppQuit());
  options.ipcMain.handle('app-shell:set-language', (_event, language) =>
    options.shell.setLanguage(appShellLanguageSchema.parse(language)),
  );
  options.ipcMain.handle('app:loading-previews', () =>
    options.transitionPreviews.previewsFor(options.currentSpaceId()),
  );
  options.ipcMain.handle('app:bootstrap', (_event, rawLocale) => {
    const invoke = async (handler: BootstrapHandler) => {
      try {
        return await handler(rawLocale);
      } finally {
        resumeBackgroundServices();
      }
    };
    return bootstrapHandler ? invoke(bootstrapHandler) : bootstrapHandlerReady.then(invoke);
  });

  installRendererProtocol(protocol, rendererRuntimePath('renderer'));
  installCodexVisualizationPreviewProtocol(protocol, () => options.shell.activeLibraryContext);
  registerHtmlFileIpc(options.ipcMain, () => options.shell.activeLibraryContext);
  registerReadingFileIpc(options.ipcMain, () => options.shell.activeLibraryContext);
  const embeddedWeb = new EmbeddedWebRuntime(
    () => options.shell.mainWindow,
    () => options.shell.activeLibraryContext,
  );
  options.ipcMain.handle('embedded-web:show', (_event, raw) => embeddedWeb.show(embeddedWebShowSchema.parse(raw)));
  options.ipcMain.handle('embedded-web:hide', (_event, raw) =>
    embeddedWeb.hide(embeddedWebHideSchema.parse(raw).previewId),
  );
  installMediaProtocol(protocol, {
    activeLibraryContext: () => options.shell.activeLibraryContext,
    libraryRegistry: options.libraryRegistry,
    transitionPreviews: options.transitionPreviews,
    rendererUrl: options.shell.developmentRendererUrl() ?? undefined,
  });
  installSessionSecurityPolicy(session.defaultSession, options.shell.developmentRendererUrl());

  return {
    afterFirstBootstrap,
    ipcRuntime(runInLibraryContext: TrustedIpcInvocationRunner): RegisterIpcRuntimeOptions {
      const runtimeIpc = createTrustedIpcHandlerRegistrar(() => options.shell.mainWindow, runInLibraryContext);
      return {
        ipcMain: {
          handle(channel, handler) {
            const install = pendingHandlers.get(channel);
            if (!install) return runtimeIpc.handle(channel, handler);
            install((event, ...args) => runInLibraryContext(channel, () => handler(event, ...args)));
            pendingHandlers.delete(channel);
          },
          on: runtimeIpc.on,
        },
        applicationIpcRegistered: true,
        startupChannelsRegistered: true,
        installBootstrapHandler: (handler) =>
          installBootstrapHandler((rawLocale) => runInLibraryContext('app:bootstrap', () => handler(rawLocale))),
        runInLibraryContext,
      };
    },
    createWindow() {
      options.shell.createWindow();
      options.shell.mainWindow?.once('ready-to-show', () => {
        firstWindowReady = true;
        resumeAuxiliaryWindows();
      });
    },
  };
}
