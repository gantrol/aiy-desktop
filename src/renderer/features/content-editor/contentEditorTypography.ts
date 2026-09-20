import './content-typography.css';

/** Each host supplies layout; content formatting stays shared across editor and preview DOM. */
export const compactContentTypography =
  'aiy-compact-typography min-w-0 text-[15px] leading-[1.65] tracking-normal text-foreground [overflow-wrap:anywhere]';

export const articleContentTypography =
  'aiy-article-typography min-w-0 text-[16px] leading-[1.875] tracking-[0.012em] text-foreground-secondary [overflow-wrap:anywhere]';

export type ContentTypography = 'compact' | 'article';

export function contentTypographyClassName(typography: ContentTypography) {
  return typography === 'compact' ? compactContentTypography : articleContentTypography;
}
