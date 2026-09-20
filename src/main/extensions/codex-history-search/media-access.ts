import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const mediaAccessSecret = randomBytes(32);
const MAX_MEDIA_PATH_CHARACTERS = 32_768;
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const imageExtensions = new Set(['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

function signature(payload: string) {
  return createHmac('sha256', mediaAccessSecret).update(payload).digest('base64url');
}

function hasForbiddenSegment(candidate: string) {
  return path
    .resolve(candidate)
    .split(path.sep)
    .some((segment) => segment.toLowerCase().includes('trash'));
}

export function codexHistoryMediaUrl(filePath: string) {
  const payload = Buffer.from(filePath, 'utf8').toString('base64url');
  return `aiy-media://codex-history/${payload}?token=${signature(payload)}`;
}

export async function resolveCodexHistoryMediaPath(payload: string, token: string | null) {
  if (!payload || !token || payload.length > MAX_MEDIA_PATH_CHARACTERS * 2 || token.length > 128) return null;
  const expected = Buffer.from(signature(payload));
  const candidateToken = Buffer.from(token);
  if (expected.length !== candidateToken.length || !timingSafeEqual(expected, candidateToken)) return null;
  let decoded = '';
  try {
    decoded = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (
    !decoded ||
    decoded.length > MAX_MEDIA_PATH_CHARACTERS ||
    Buffer.from(decoded, 'utf8').toString('base64url') !== payload ||
    !path.isAbsolute(decoded) ||
    hasForbiddenSegment(decoded) ||
    !imageExtensions.has(path.extname(decoded).toLowerCase())
  )
    return null;
  try {
    const [metadata, resolved] = await Promise.all([lstat(decoded), realpath(decoded)]);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > MAX_MEDIA_BYTES ||
      hasForbiddenSegment(resolved) ||
      !imageExtensions.has(path.extname(resolved).toLowerCase())
    )
      return null;
    return resolved;
  } catch {
    return null;
  }
}
