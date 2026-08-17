import { net, type Protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rendererContentSecurityPolicy } from '@/main/app/window-security';

export const RENDERER_SCHEME = 'aiy-app';
export const PACKAGED_RENDERER_URL = `${RENDERER_SCHEME}://renderer/index.html`;

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

    try {
      const response = await net.fetch(pathToFileURL(filePath).href);
      if (!response.ok) return new Response('Not found', { status: 404 });
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', rendererContentSecurityPolicy());
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
