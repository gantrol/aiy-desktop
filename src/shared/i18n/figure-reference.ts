import type { Locale } from '@/shared/contracts';

const messages = {
  en: {
    insert: 'Reference this image',
    open: 'View referenced image',
    missing: 'Image removed',
    unavailable: 'The referenced image is unavailable',
    insertionFailed: 'Place the cursor in the text, then reference the image',
    opening: '(',
    closing: ')',
  },
  zh: {
    insert: '引用这张图',
    open: '查看引用图片',
    missing: '图片已移除',
    unavailable: '引用的图片不可用',
    insertionFailed: '请先把光标放到正文，再引用图片',
    opening: '（',
    closing: '）',
  },
} satisfies Record<Locale, Record<string, string>>;

export function figureReferenceMessages(locale: Locale) {
  return messages[locale];
}
