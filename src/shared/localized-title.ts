import type { ContentLocale, LocalizedTitleDto } from '@/shared/contracts';

export interface LocalizedTitleSource {
  title: string;
  titleLocale: ContentLocale;
  localizations: readonly LocalizedTitleDto[];
}

const normalizeLocale = (locale: ContentLocale) => locale.trim().toLowerCase();

export function contentLocaleMatches(candidate: ContentLocale, requested: ContentLocale) {
  const left = normalizeLocale(candidate);
  const right = normalizeLocale(requested);
  return left === right || left.split('-')[0] === right.split('-')[0];
}

export function resolveLocalizedTitle(source: LocalizedTitleSource, locale: ContentLocale) {
  if (contentLocaleMatches(source.titleLocale, locale)) return source.title;
  return source.localizations.find((item) => contentLocaleMatches(item.locale, locale))?.title || source.title;
}
