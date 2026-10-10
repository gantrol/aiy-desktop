import type { ImageSearchItem } from '@/shared/contracts/image-search';
import type { imageSearchMessages } from '@/shared/i18n/image-search';

export function imageSearchTitle(item: ImageSearchItem, copy: typeof imageSearchMessages, locale: string) {
  if (item.titleKind === 'NAME' && item.title) return item.title;
  const title =
    item.titleKind === 'CREATION'
      ? copy.creationImage(item.title)
      : item.titleKind === 'DICTIONARY'
        ? copy.dictionaryImage(item.title)
        : copy.untitledImage;
  const date = new Date(item.createdAt);
  return Number.isNaN(date.getTime())
    ? title
    : `${title} · ${new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)}`;
}
