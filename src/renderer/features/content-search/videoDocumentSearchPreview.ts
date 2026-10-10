import { contentSearchSnippet } from '@/shared/content-search-query';
import { formatVideoSearchTime } from '@/renderer/features/content-search/videoSearchTime';

/** Read the millisecond prefixes emitted by the video document search projection. */
export function videoDocumentSearchPreview(
  text: string,
  role: string | null,
  locale: string,
  terms: readonly string[],
) {
  const timed = role === 'CLEAN_TRANSCRIPT';
  const preview = timed
    ? text.replace(/(^|\s)\[(\d+)[–-](\d+)\]\s*/g, (original, boundary: string, start: string, end: string) => {
        const startMs = Number(start);
        const endMs = Number(end);
        if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs < startMs) return original;
        const range = `–${formatVideoSearchTime(endMs, locale)}`;
        return `${boundary}${formatVideoSearchTime(startMs, locale)}${range} · `;
      })
    : text;
  return contentSearchSnippet(preview, terms, 24);
}
