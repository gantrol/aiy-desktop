import { CODEX_VISUALIZATION_PREVIEW_SCHEME } from '@/main/app/codex-visualization-preview-policy';

/** The origin is an unguessable host-issued lease, never an HTML-provided URL. */
export function embeddedWebContentSecurityPolicy(previewId: string) {
  if (!/^[a-f0-9]{48}$/.test(previewId)) throw new Error('Invalid embedded web preview');
  const source = `${CODEX_VISUALIZATION_PREVIEW_SCHEME}://${previewId}`;
  return [
    `default-src 'none'`,
    `script-src ${source} 'unsafe-inline'`,
    `style-src ${source} 'unsafe-inline'`,
    `img-src ${source} data: blob:`,
    `font-src 'none'`,
    `connect-src 'none'`,
    `media-src 'none'`,
    `frame-src 'none'`,
    `worker-src 'none'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `sandbox allow-scripts`,
  ].join('; ');
}

export function isEmbeddedWebResource(url: string, previewId: string) {
  try {
    const target = new URL(url);
    return (
      target.protocol === `${CODEX_VISUALIZATION_PREVIEW_SCHEME}:` &&
      target.hostname === previewId &&
      !target.port &&
      !target.username &&
      !target.password &&
      !target.search
    );
  } catch {
    return false;
  }
}
