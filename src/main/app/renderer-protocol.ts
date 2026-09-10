import type { Protocol } from 'electron';
import { open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { rendererContentSecurityPolicy } from '@/main/app/window-security';
import { RENDERER_SCHEME } from '@/main/app/renderer-location';

export { RENDERER_SCHEME, PACKAGED_RENDERER_URL } from '@/main/app/renderer-location';

const rendererMimeTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
};

function isPathInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveRendererFile(rendererRoot: string, requestUrl: string) {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== `${RENDERER_SCHEME}:` ||
    url.hostname !== 'renderer' ||
    url.port ||
    url.username ||
    url.password
  ) {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (!decodedPath || decodedPath.includes('\0') || decodedPath.includes('\\')) return null;

  const segments = decodedPath.split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) return null;
  const candidate = path.resolve(rendererRoot, ...segments);
  return isPathInside(rendererRoot, candidate) ? candidate : null;
}

export function installRendererProtocol(targetProtocol: Protocol, rendererRoot: string) {
  targetProtocol.handle(RENDERER_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const filePath = resolveRendererFile(rendererRoot, request.url);
    if (!filePath) return new Response('Not found', { status: 404 });

    let file: FileHandle | undefined;
    try {
      file = await open(filePath, 'r');
      const stats = await file.stat();
      if (!stats.isFile()) {
        await file.close();
        return new Response('Not found', { status: 404 });
      }
      const headers = new Headers({
        'Content-Type': rendererMimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': String(stats.size),
        'Cache-Control': 'no-cache',
      });
      headers.set('Content-Security-Policy', rendererContentSecurityPolicy(null, request.url));
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      if (request.method === 'HEAD') {
        await file.close();
        return new Response(null, { headers });
      }
      // Stream local assets without a second trip through Chromium's network
      // service or platform-dependent MIME inference. Cancellation closes the fd.
      const stream = file.createReadStream({ highWaterMark: 64 * 1024 });
      const abort = () => stream.destroy();
      request.signal.addEventListener('abort', abort, { once: true });
      stream.once('close', () => request.signal.removeEventListener('abort', abort));
      if (request.signal.aborted) stream.destroy();
      const body = Readable.toWeb(stream, {
        strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
      }) as ReadableStream<Uint8Array>;
      return new Response(body, { headers });
    } catch {
      await file?.close().catch(() => undefined);
      return new Response('Not found', { status: 404 });
    }
  });
}
