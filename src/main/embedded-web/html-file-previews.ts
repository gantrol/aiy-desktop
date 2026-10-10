import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { readHtmlFile } from '@/main/embedded-web/html-file-store';
import { CODEX_VISUALIZATION_PREVIEW_SCHEME } from '@/main/app/codex-visualization-preview-policy';
import { EMBEDDED_WEB_EXTENSION_ID } from '@/shared/contracts/embedded-web';
import type { HtmlFileAttributes, HtmlFilePreviewAccess } from '@/shared/contracts/html-file';

interface Grant {
  access: HtmlFilePreviewAccess;
  bytes: Buffer<ArrayBuffer>;
  expiresAtMs: number;
  timer: ReturnType<typeof setTimeout>;
  requests: number;
}
class HtmlFilePreviews extends EventEmitter {
  private grants = new Map<string, Grant>();
  private preparing = false;
  constructor(private readonly context: ActiveLibraryContext) {
    super();
  }

  async prepare(input: HtmlFileAttributes) {
    if (this.preparing) throw new Error('HTML_PREVIEW_BUSY');
    this.preparing = true;
    try {
      const bytes = await readHtmlFile(this.context.database.libraryRoot, input.objectHash);
      if (this.context.state !== 'ACTIVE') throw new Error('HTML_FILE_UNAVAILABLE');
      const scriptsAllowed = this.context.extensions.isActivated(EMBEDDED_WEB_EXTENSION_ID);
      const previewId = randomBytes(24).toString('hex');
      const expiresAtMs = Date.now() + (scriptsAllowed ? 60 : 5) * 60_000;
      const access: HtmlFilePreviewAccess = {
        previewId,
        scriptsAllowed,
        url: `${CODEX_VISUALIZATION_PREVIEW_SCHEME}://${previewId}/index.html`,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
      while (this.grants.size >= 3) this.release(this.grants.keys().next().value!);
      const timer = setTimeout(() => this.release(previewId), expiresAtMs - Date.now());
      timer.unref?.();
      this.grants.set(previewId, { access, bytes, expiresAtMs, timer, requests: 0 });
      return access;
    } finally {
      this.preparing = false;
    }
  }
  private get(id: string) {
    const grant = this.grants.get(id);
    if (!grant || grant.expiresAtMs <= Date.now() || this.context.state !== 'ACTIVE') return null;
    return grant;
  }
  executable(id: string) {
    const grant = this.get(id);
    return grant?.access.scriptsAllowed ? { url: grant.access.url, expiresAtMs: grant.expiresAtMs } : null;
  }
  has(id: string) {
    return Boolean(this.get(id));
  }
  resource(id: string, relativePath: string) {
    const grant = this.get(id);
    if (!grant || relativePath !== 'index.html' || ++grant.requests > 8) throw new Error('HTML_FILE_UNAVAILABLE');
    return {
      bytes: grant.bytes,
      filePath: 'index.html',
      byteSize: grant.bytes.length,
      entryDocument: true,
      contentType: 'text/html; charset=utf-8',
      scriptsAllowed: grant.access.scriptsAllowed,
    };
  }
  release(id: string) {
    const grant = this.grants.get(id);
    if (!grant) return;
    clearTimeout(grant.timer);
    this.grants.delete(id);
    this.emit('html-preview-released', id);
  }
  dispose() {
    for (const id of this.grants.keys()) this.release(id);
  }
}
const services = new WeakMap<ActiveLibraryContext, HtmlFilePreviews>();
function bindHtmlFilePreviewLifecycle(context: ActiveLibraryContext) {
  for (const method of ['drain', 'dispose'] as const) {
    const previous = context[method].bind(context);
    context[method] = () => {
      services.get(context)?.dispose();
      return previous();
    };
  }
}
export function htmlFilePreviews(context: ActiveLibraryContext) {
  let service = services.get(context);
  if (!service) {
    service = new HtmlFilePreviews(context);
    services.set(context, service);
    bindHtmlFilePreviewLifecycle(context);
  }
  return service;
}
