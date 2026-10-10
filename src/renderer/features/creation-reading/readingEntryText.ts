import type { ReadingEntry } from '@/shared/contracts/creation-reading';

export function readingLocationText(entry: Pick<ReadingEntry, 'location'>, pageLabel: string, locale?: string) {
  const { page, chapter } = entry.location;
  return [page ? pageLabel + ' ' + new Intl.NumberFormat(locale).format(page) : '', chapter ?? '']
    .filter(Boolean)
    .join(' · ');
}
export function readingNoteText(entry: ReadingEntry) {
  return [entry.cue, entry.text, entry.summary].filter(Boolean).join('\n\n');
}
