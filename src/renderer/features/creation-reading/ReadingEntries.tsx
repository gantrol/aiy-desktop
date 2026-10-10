import { X } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { CreationReading, ReadingEntry } from '@/shared/contracts/creation-reading';
import { readingLocationText, readingNoteText } from '@/renderer/features/creation-reading/readingEntryText';

export function ReadingEntries({
  reading,
  onUpdate,
  onDelete,
  onSource,
  onAdd,
}: {
  reading: CreationReading;
  onUpdate(id: string, change: Partial<ReadingEntry>): void;
  onDelete(id: string): void;
  onSource(id: string, location: ReadingEntry['location'], quote: string): void;
  onAdd(): void;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.creationReading;
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={copy.notes}>
      <header className="flex min-h-9 shrink-0 items-center gap-1 border-b px-2">
        <span className="mr-auto text-xs font-medium">{copy.notes}</span>
        <Button size="sm" variant="ghost" onClick={onAdd}>
          ＋ {copy.note}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3">
        {reading.entries.map((entry) => {
          const source = reading.sources.find((item) => item.id === entry.sourceId);
          const location = readingLocationText(entry, copy.page, locale);
          return (
            <div key={entry.id} className="border-b py-3 last:border-b-0">
              <div className="mb-2 flex min-w-0 items-center gap-2">
                {source && (
                  <Button
                    size="sm"
                    variant="link"
                    className="h-auto min-w-0 flex-1 justify-start truncate p-0 text-xs"
                    title={[source.title, location].filter(Boolean).join(' · ')}
                    onClick={() => onSource(source.id, entry.location, entry.quote)}
                  >
                    <span className="truncate">
                      {source.title}
                      {location && ' · ' + location}
                    </span>
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto shrink-0"
                  title={copy.remove}
                  aria-label={copy.remove}
                  onClick={() => onDelete(entry.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              {entry.quote && (
                <blockquote className="mb-2 max-h-24 overflow-y-auto whitespace-pre-wrap border-l-2 pl-2 text-xs leading-relaxed text-muted-foreground">
                  {entry.quote}
                </blockquote>
              )}
              <Textarea
                aria-label={copy.notes}
                placeholder={copy.notePlaceholder}
                value={readingNoteText(entry)}
                maxLength={40_004}
                className="min-h-16 resize-y rounded-sm"
                onChange={(event) =>
                  onUpdate(entry.id, { text: event.target.value, cue: undefined, summary: undefined })
                }
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
