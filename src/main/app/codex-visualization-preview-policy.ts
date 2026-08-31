export const CODEX_VISUALIZATION_PREVIEW_SCHEME = 'aiy-visualization-preview';

export function codexVisualizationPreviewContentSecurityPolicy() {
  return [
    `default-src 'none'`,
    `img-src ${CODEX_VISUALIZATION_PREVIEW_SCHEME}:`,
    `style-src ${CODEX_VISUALIZATION_PREVIEW_SCHEME}: 'unsafe-inline'`,
    `font-src 'none'`,
    `script-src 'none'`,
    `connect-src 'none'`,
    `media-src 'none'`,
    `frame-src 'none'`,
    `worker-src 'none'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `navigate-to 'none'`,
    `sandbox`,
  ].join('; ');
}
