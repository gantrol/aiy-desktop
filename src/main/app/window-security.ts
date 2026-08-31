import type { BrowserWindow, Session } from 'electron';
import {
  CODEX_VISUALIZATION_PREVIEW_SCHEME,
  codexVisualizationPreviewContentSecurityPolicy,
} from '@/main/app/codex-visualization-preview-policy';

/** Allows only the fixed, pre-paint loading-variant selector embedded in renderer/index.html. */
export const APP_LOADING_VARIANT_SCRIPT_HASH = "'sha256-Mo44jsGpct1oYLi0onfsfLHNUJfT/14wvc2A+Z2U4AI='";

export function installWindowNavigationPolicy(window: BrowserWindow, expectedRendererUrl: URL) {
  window.webContents.on('will-navigate', (event, targetUrl) => {
    let target: URL;
    try {
      target = new URL(targetUrl);
    } catch {
      event.preventDefault();
      return;
    }
    const trusted =
      target.protocol === expectedRendererUrl.protocol &&
      target.host === expectedRendererUrl.host &&
      target.pathname === expectedRendererUrl.pathname &&
      target.search === expectedRendererUrl.search;
    if (!trusted) event.preventDefault();
  });
  window.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return;
    let target: URL;
    try {
      target = new URL(details.url);
    } catch {
      details.preventDefault();
      return;
    }
    if (target.protocol !== `${CODEX_VISUALIZATION_PREVIEW_SCHEME}:`) details.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function trustedDevelopmentSources(rendererUrl?: URL | null) {
  if (!rendererUrl) return '';
  const loopbackHost = rendererUrl.hostname === 'localhost' || rendererUrl.hostname === '127.0.0.1';
  const trustedProtocol = rendererUrl.protocol === 'http:' || rendererUrl.protocol === 'https:';
  if (!loopbackHost || !trustedProtocol) return '';
  const socketProtocol = rendererUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return ` ${rendererUrl.origin} ${socketProtocol}//${rendererUrl.host}`;
}

export function rendererContentSecurityPolicy(developmentRendererUrl?: URL | null) {
  const developmentSources = trustedDevelopmentSources(developmentRendererUrl);
  const inlineScriptPolicy = developmentSources ? " 'unsafe-inline'" : ` ${APP_LOADING_VARIANT_SCRIPT_HASH}`;
  return [
    `default-src 'self'${developmentSources}`,
    `img-src 'self' data: blob: aiy-media:`,
    `media-src 'self' blob: aiy-media:`,
    `style-src 'self' 'unsafe-inline'`,
    `script-src 'self'${inlineScriptPolicy}${developmentSources}`,
    `connect-src 'self'${developmentSources}`,
    `object-src 'none'`,
    `frame-src ${CODEX_VISUALIZATION_PREVIEW_SCHEME}:`,
    `frame-ancestors 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join('; ');
}

export function installSessionSecurityPolicy(targetSession: Session, developmentRendererUrl?: URL | null) {
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const previewResponse = details.url.startsWith(`${CODEX_VISUALIZATION_PREVIEW_SCHEME}://`);
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          previewResponse
            ? codexVisualizationPreviewContentSecurityPolicy()
            : rendererContentSecurityPolicy(developmentRendererUrl),
        ],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}
