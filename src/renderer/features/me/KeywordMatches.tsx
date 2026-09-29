import { XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ContentSearchHighlight } from '@/renderer/features/content-search/ContentSearchHighlight';
import { useContentSearchOpen } from '@/renderer/features/content-search/useContentSearchOpen';
import type { ContentSource } from '@/shared/contracts/content-source';
import type { KeywordResult } from '@/shared/contracts/me';

export function KeywordMatches({
  term,
  result,
  failed,
  offset,
  onClose,
  onNext,
  onPrevious,
  onOpen,
}: {
  term: string;
  result: KeywordResult | null;
  failed: boolean;
  offset: number;
  onClose(): void;
  onNext(): void;
  onPrevious(): void;
  onOpen(source: ContentSource): void;
}) {
  const { messages } = useI18n();
  const copy = messages.me;
  const open = useContentSearchOpen(true, term, copy.openFailed, onOpen);
  return (
    <section className="min-w-0 space-y-3 lg:border-l lg:pl-6" aria-label={term}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">{term}</h2>
        <Button variant="ghost" size="icon-sm" aria-label={copy.close} onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </header>
      {open.error && (
        <p role="alert" className="text-sm text-destructive">
          {open.error}
        </p>
      )}
      {!result && !failed && (
        <span role="status" className="text-sm text-muted-foreground">
          {copy.loading}
        </span>
      )}
      {result?.matches.map((item) => (
        <Button
          key={JSON.stringify(item.source)}
          variant="ghost"
          disabled={open.busy}
          className="h-auto w-full flex-col items-start gap-2 rounded-sm border-b px-0 py-3 text-left whitespace-normal"
          onClick={() => void open.open(item.source)}
        >
          <span className="text-sm font-medium">{item.title || messages.referenceOutline.lookup.untitled}</span>
          <span className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            <ContentSearchHighlight text={item.preview} terms={[term]} />
          </span>
        </Button>
      ))}
      {result && !result.matches.length && <span className="text-sm text-muted-foreground">{copy.noMatches}</span>}
      {result && (offset > 0 || result.nextOffset != null) && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!offset} onClick={onPrevious}>
            {copy.previous}
          </Button>
          <Button variant="ghost" disabled={result.nextOffset == null} onClick={onNext}>
            {copy.more}
          </Button>
        </div>
      )}
    </section>
  );
}
