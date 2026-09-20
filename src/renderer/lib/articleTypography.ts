import { articleContentTypography } from '@/renderer/features/content-editor/contentEditorTypography';

export const articleDocumentWidthClassName = 'max-w-[43rem]';

export const articleWideDocumentWidthClassName = 'max-w-[64rem]';

export type ArticleDocumentWidth = 'STANDARD' | 'WIDE';

export function articleEditorDocumentWidthClassName(width: ArticleDocumentWidth) {
  return width === 'WIDE' ? articleWideDocumentWidthClassName : articleDocumentWidthClassName;
}

export const articleTextMeasureClassName = 'max-w-[40rem]';

export const articleTitleClassName =
  'text-[2rem] leading-[1.25] font-semibold tracking-[-0.012em] text-[var(--button-primary)]';

export const articleReferenceTitleClassName =
  'text-[1.75rem] leading-[1.3] font-semibold tracking-[-0.01em] text-[var(--button-primary)]';

export const articleRichTextClassName = articleContentTypography;
