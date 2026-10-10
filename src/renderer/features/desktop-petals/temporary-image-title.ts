import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';

/** Older automatic clipboard names remain readable without renaming user content on disk. */
export function temporaryImageTitle(
  title: string,
  updatedAt: string,
  locale: string,
  copy: DesktopPetalMessages['temporary'],
) {
  if (title !== 'Clipboard.png') return title;
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return copy.imageNames.clipboard;
  return `${copy.imageNames.clipboard} · ${new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date)}`;
}
