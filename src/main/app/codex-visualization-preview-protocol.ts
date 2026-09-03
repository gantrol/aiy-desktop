import { open, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Protocol } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import {
  CODEX_VISUALIZATION_PREVIEW_SCHEME,
  codexVisualizationPreviewContentSecurityPolicy,
} from '@/main/app/codex-visualization-preview-policy';
import { imageDimensions } from '@/main/media/image-dimensions';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';

const previewIdPattern = /^[a-f0-9]{48}$/;
const maximumPreviewImageDimension = 8_192;
const maximumPreviewImagePixels = 40_000_000;
const staticPreviewStyle = `<style data-aiy-static-preview>*,:before,:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}a,button,input,select,textarea,form{pointer-events:none!important}audio,video,iframe,object,embed{display:none!important}</style>`;

function isSameFile(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readVerifiedPreviewFile(filePath: string, expectedBytes: number) {
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== expectedBytes) {
    throw new Error('HTML preview resource changed before it could be read');
  }
  const handle = await open(filePath, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !isSameFile(before, opened) || opened.size !== expectedBytes) {
      throw new Error('HTML preview resource changed before it could be read');
    }
    const bytes = await handle.readFile();
    const [afterRead, afterPath] = await Promise.all([handle.stat(), lstat(filePath)]);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      !isSameFile(opened, afterRead) ||
      !isSameFile(opened, afterPath) ||
      afterRead.size !== opened.size ||
      afterRead.mtimeMs !== opened.mtimeMs ||
      afterRead.ctimeMs !== opened.ctimeMs ||
      bytes.byteLength !== expectedBytes
    ) {
      throw new Error('HTML preview resource changed while it was being read');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function decodedRelativePath(url: URL) {
  const rawSegments = url.pathname.split('/').filter(Boolean);
  if (!rawSegments.length) return null;
  try {
    const segments = rawSegments.map((segment) => decodeURIComponent(segment));
    if (
      segments.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          segment.includes('/') ||
          segment.includes('\\') ||
          segment.includes('\0'),
      )
    ) {
      return null;
    }
    return segments.join('/');
  } catch {
    return null;
  }
}

function pngIsAnimated(bytes: Buffer) {
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const chunkLength = bytes.readUInt32BE(offset);
    const nextOffset = offset + 12 + chunkLength;
    if (!Number.isSafeInteger(nextOffset) || nextOffset > bytes.byteLength) return true;
    const chunkType = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (chunkType === 'acTL') return true;
    if (chunkType === 'IDAT' || chunkType === 'IEND') return false;
    offset = nextOffset;
  }
  return true;
}

function webpIsAnimated(bytes: Buffer) {
  return bytes.byteLength >= 21 && bytes.subarray(12, 16).toString('ascii') === 'VP8X' && (bytes[20]! & 0x02) !== 0;
}

function validatePreviewImage(bytes: Buffer, extension: string) {
  if (extension === '.png' && pngIsAnimated(bytes)) throw new Error('Animated PNG is blocked in static preview');
  if (extension === '.webp' && webpIsAnimated(bytes)) throw new Error('Animated WebP is blocked in static preview');
  const dimensions = imageDimensions(bytes, extension);
  if (
    !dimensions ||
    dimensions.width > maximumPreviewImageDimension ||
    dimensions.height > maximumPreviewImageDimension ||
    dimensions.width * dimensions.height > maximumPreviewImagePixels
  ) {
    throw new Error('HTML preview image exceeds its decode limit');
  }
}

function staticHtml(bytes: Buffer) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (source.includes('\0')) throw new Error('HTML preview is not valid UTF-8');
  return `${source}\n${staticPreviewStyle}`;
}

function previewHeaders(contentType: string, contentLength: number) {
  return {
    'access-control-allow-origin': '*',
    'cache-control': 'private, no-store',
    'content-length': String(contentLength),
    'content-security-policy': codexVisualizationPreviewContentSecurityPolicy(),
    'content-type': contentType,
    'cross-origin-resource-policy': 'cross-origin',
    'permissions-policy':
      'camera=(), microphone=(), geolocation=(), fullscreen=(), clipboard-read=(), clipboard-write=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };
}

export function installCodexVisualizationPreviewProtocol(
  targetProtocol: Protocol,
  getContext: () => ActiveLibraryContext | null,
) {
  targetProtocol.handle(CODEX_VISUALIZATION_PREVIEW_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const relativePath = decodedRelativePath(url);
    if (
      url.protocol !== `${CODEX_VISUALIZATION_PREVIEW_SCHEME}:` ||
      !previewIdPattern.test(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      !relativePath
    ) {
      return new Response('Not found', { status: 404 });
    }

    const context = getContext();
    if (!context?.extensions.isActivated(CODEX_EXTENSION_ID)) {
      return new Response('Not found', { status: 404 });
    }
    const release = context.acquireOperation();
    try {
      const resource = await context.visualizationDiscovery.resolveHtmlPreviewResource(
        url.hostname,
        relativePath,
        request.method === 'GET',
      );
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers: previewHeaders(resource.contentType, resource.byteSize) });
      }
      const bytes = await readVerifiedPreviewFile(resource.filePath, resource.byteSize);
      const extension = path.extname(resource.filePath).toLowerCase();
      if (extension === '.png' || extension === '.jpg' || extension === '.jpeg' || extension === '.webp') {
        validatePreviewImage(bytes, extension);
      }
      const body = resource.entryDocument ? Buffer.from(staticHtml(bytes), 'utf8') : bytes;
      return new Response(body, { status: 200, headers: previewHeaders(resource.contentType, body.byteLength) });
    } catch {
      return new Response('Preview unavailable', { status: 404, headers: { 'cache-control': 'private, no-store' } });
    } finally {
      release();
    }
  });
}
