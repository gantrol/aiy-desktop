import { app, protocol, session } from 'electron';
import path from 'node:path';
import type { ArticleEditorRecoveryStore } from '@/main/app/article-editor-recovery-store';
import type { DesktopApplicationShell } from '@/main/app/application-shell';
import { installCodexVisualizationPreviewProtocol } from '@/main/app/codex-visualization-preview-protocol';
import { installMediaProtocol } from '@/main/app/media-protocol';
import { installRendererProtocol } from '@/main/app/renderer-protocol';
import type { TransitionPreviewCache } from '@/main/app/transition-preview-cache';
import { installSessionSecurityPolicy } from '@/main/app/window-security';
import type { WorkspaceLayoutStore } from '@/main/app/workspace-layout-store';
import { registerApplicationIpc, type RegisterIpcRuntimeOptions } from '@/main/ipc/register-ipc';
import type { IpcHandlerRegistrar, TrustedIpcInvocationRunner } from '@/main/ipc/trusted-handlers';
import type { LibraryRegistry } from '@/main/libraries/library-registry';

type BootstrapHandler = (rawLocale: unknown) => unknown;

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
  let bootstrapHandler: BootstrapHandler | null = null;
  let bootstrapFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let initialBootstrapSettled = false;
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
  };
  const installBootstrapHandler = (handler: BootstrapHandler) => {
    bootstrapHandler = handler;
    resolveBootstrapHandler(handler);
    bootstrapFallbackTimer = setTimeout(resumeBackgroundServices, 5_000);
  };

  registerApplicationIpc(() => options.shell.mainWindow, options.workspaceLayouts, options.articleEditorRecovery);
  options.ipcMain.handle('app:request-quit', () => options.shell.requestAppQuit());
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

  installRendererProtocol(protocol, path.join(app.getAppPath(), 'out', 'renderer'));
  installCodexVisualizationPreviewProtocol(protocol, () => options.shell.activeLibraryContext);
  installMediaProtocol(protocol, {
    activeLibraryContext: () => options.shell.activeLibraryContext,
    libraryRegistry: options.libraryRegistry,
    transitionPreviews: options.transitionPreviews,
  });
  installSessionSecurityPolicy(session.defaultSession, options.shell.developmentRendererUrl());

  return {
    ipcRuntime(runInLibraryContext: TrustedIpcInvocationRunner): RegisterIpcRuntimeOptions {
      return {
        applicationIpcRegistered: true,
        startupChannelsRegistered: true,
        installBootstrapHandler: (handler) =>
          installBootstrapHandler((rawLocale) => runInLibraryContext('app:bootstrap', () => handler(rawLocale))),
        runInLibraryContext,
      };
    },
    createDeferredWindow() {
      options.shell.createWindow();
    },
  };
}
