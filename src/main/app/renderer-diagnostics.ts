import { app, type BrowserWindow } from 'electron';
import path from 'node:path';
import { RendererDiagnosticLog } from '@/main/app/renderer-diagnostic-log';
import { createTrustedIpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { RENDERER_DIAGNOSTIC_CHANNEL, rendererDiagnosticRecordSchema } from '@/shared/contracts/renderer-diagnostics';
import { rendererDiagnosticError } from '@/shared/renderer-diagnostic-error';

let log: RendererDiagnosticLog | null = null;

function diagnosticLog() {
  return (log ??= new RendererDiagnosticLog(path.join(app.getPath('userData'), 'diagnostics', 'renderer')));
}

export function registerRendererDiagnostics(getWindow: () => BrowserWindow | null) {
  createTrustedIpcHandlerRegistrar(getWindow).on(RENDERER_DIAGNOSTIC_CHANNEL, (_event, value) => {
    const parsed = rendererDiagnosticRecordSchema.safeParse(value);
    if (parsed.success) diagnosticLog().write({ source: 'renderer', ...parsed.data });
  });
}

export async function flushRendererDiagnostics() {
  await log?.flush();
}

export function attachRendererDiagnostics(window: BrowserWindow) {
  const contents = window.webContents;
  const webContentsId = contents.id;
  const write = (event: string, details: object = {}) =>
    diagnosticLog().write({ source: 'main', event, webContentsId, details });
  write('window-created', { version: app.getVersion(), packaged: app.isPackaged });
  contents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) write('navigation-start');
  });
  contents.on('dom-ready', () => write('dom-ready'));
  contents.on('did-finish-load', () => write('load-finished'));
  contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame) write('load-failed', { errorCode });
  });
  contents.on('preload-error', (_event, _preloadPath, error) => write('preload-error', rendererDiagnosticError(error)));
  contents.on('console-message', (details) => {
    if (details.level !== 'error') return;
    write('console-error', {
      ...rendererDiagnosticError(details.message),
      lineNumber: details.lineNumber,
      sourceFile: details.sourceId.split(/[?#]/, 1)[0].replaceAll('\\', '/').split('/').pop()?.slice(0, 200),
    });
  });
  contents.on('render-process-gone', (_event, details) =>
    write('render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    }),
  );
  window.on('unresponsive', () => write('window-unresponsive'));
  window.on('responsive', () => write('window-responsive'));
  window.on('closed', () => write('window-closed'));
}
