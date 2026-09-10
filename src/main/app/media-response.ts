import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { net } from 'electron';

interface HttpByteRange {
  start: number;
  end: number;
}

export const CONTEXT_INDEPENDENT_MEDIA_HOSTS = new Set(['space-preview', 'space-cover']);
const immutableMediaHosts = new Set(['asset', 'asset-thumbnail', 'space-preview', 'space-cover', 'video-evidence']);
const spaceCoverMimeTypeByExtension: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const codexVisualizationMimeTypeByExtension: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function parseHttpByteRange(value: string, totalSize: number): HttpByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, totalSize - suffixLength), end: Math.max(0, totalSize - 1) };
  }
  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : totalSize - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= totalSize ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, totalSize - 1) };
}

export async function fetchLocalFile(filePath: string, requestedRange: string | null): Promise<Response> {
  if (!requestedRange) return net.fetch(pathToFileURL(filePath).toString());
  let totalSize = 0;
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return new Response('Not found', { status: 404 });
    totalSize = stats.size;
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const range = parseHttpByteRange(requestedRange, totalSize);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes */${totalSize}` },
    });
  }
  const response = await net.fetch(pathToFileURL(filePath).toString(), {
    headers: { range: `bytes=${range.start}-${range.end}` },
  });
  const headers = new Headers(response.headers);
  headers.set('accept-ranges', 'bytes');
  headers.set('content-range', `bytes ${range.start}-${range.end}/${totalSize}`);
  headers.set('content-length', String(range.end - range.start + 1));
  return new Response(response.body, { status: 206, statusText: 'Partial Content', headers });
}

function urlPathExtension(filePath: string) {
  return path.extname(filePath).toLowerCase();
}

export function applyMediaResponseHeaders(headers: Headers, hostname: string, filePath: string, thumbnail: boolean) {
  if (thumbnail) headers.set('content-type', 'image/png');
  if (hostname === 'space-cover') {
    headers.set(
      'content-type',
      spaceCoverMimeTypeByExtension[urlPathExtension(filePath)] ?? 'application/octet-stream',
    );
  }
  if (hostname === 'codex-visualization') {
    headers.set(
      'content-type',
      codexVisualizationMimeTypeByExtension[urlPathExtension(filePath)] ?? 'application/octet-stream',
    );
  }
  headers.set(
    'cache-control',
    immutableMediaHosts.has(hostname) ? 'private, max-age=31536000, immutable' : 'private, no-store',
  );
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('content-security-policy', "default-src 'none'; sandbox");
}
