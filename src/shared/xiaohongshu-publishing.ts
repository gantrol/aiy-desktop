export const XIAOHONGSHU_STAGE_ERROR_CODES = [
  'XIAOHONGSHU_TITLE_TOO_LONG',
  'XIAOHONGSHU_BODY_TOO_LONG',
  'XIAOHONGSHU_MEDIA_REQUIRED',
  'XIAOHONGSHU_MEDIA_LIMIT',
  'XIAOHONGSHU_MEDIA_UNSUPPORTED',
  'XIAOHONGSHU_MEDIA_TOO_LARGE',
] as const;

export const XIAOHONGSHU_IMAGE_LIMIT = 18;
export const XIAOHONGSHU_IMAGE_MAX_BYTES = 32 * 1024 * 1024;
export const XIAOHONGSHU_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function xiaohongshuHandoffError(input: { title?: string; text: string; mediaCount: number }) {
  // The creator's title counter gives Latin characters half the width of CJK characters.
  const titleWidth = [...(input.title ?? '').trim()].reduce(
    (width, character) => width + (character.codePointAt(0)! <= 0xff ? 1 : 2),
    0,
  );
  if (titleWidth > 40) return 'XIAOHONGSHU_TITLE_TOO_LONG' as const;
  if ([...input.text.replace(/\r\n/g, '\n').trim()].length > 1_000) return 'XIAOHONGSHU_BODY_TOO_LONG' as const;
  if (input.mediaCount === 0) return 'XIAOHONGSHU_MEDIA_REQUIRED' as const;
  if (input.mediaCount > XIAOHONGSHU_IMAGE_LIMIT) return 'XIAOHONGSHU_MEDIA_LIMIT' as const;
  return null;
}
