import type { Locale } from '@/shared/contracts';

/**
 * `Intl.DateTimeFormat` construction is expensive and was happening once per
 * card per render. The set of (locale, options) pairs is tiny and fixed, so
 * cache the formatters and keep re-renders cheap.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

export function dateFormatter(locale: Locale, options: Intl.DateTimeFormatOptions) {
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  const key = `${tag}:${JSON.stringify(options)}`;
  const existing = formatters.get(key);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat(tag, options);
  formatters.set(key, created);
  return created;
}

export function formatDateTime(value: string, locale: Locale, options: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return dateFormatter(locale, options).format(date);
}
