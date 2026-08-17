export interface VideoDocumentCursor {
  updatedAt: string;
  id: string;
}

export function encodeVideoDocumentCursor(cursor: VideoDocumentCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeVideoDocumentCursor(value: string | null | undefined): VideoDocumentCursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !('updatedAt' in parsed) || !('id' in parsed)) {
      throw new Error('Invalid document cursor');
    }
    if (typeof parsed.updatedAt !== 'string' || !parsed.updatedAt || typeof parsed.id !== 'string' || !parsed.id) {
      throw new Error('Invalid document cursor');
    }
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new Error('Invalid document cursor');
  }
}

export function escapeVideoDocumentLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function videoDocumentFileStem(value: string) {
  const name = value.trim().split(/[\\/]/).at(-1) ?? '';
  return name.replace(/\.[^.]+$/, '').trim();
}
