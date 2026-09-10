import { useEffect, useRef, useState } from 'react';
import { Link2, ChevronLeft, LoaderCircle } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentDocument, ContentReference, ContentSource } from '@/shared/contracts/content-library';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export function contentLibraryApi() {
  return window.desktopApi?.contentLibrary ?? window.desktopPetals.contentLibrary;
}

export function ContentReferencePicker({
  source,
  label,
  onInsert,
}: {
  source?: ContentSource;
  label?: string;
  onInsert(reference: ContentReference): void;
}) {
  const copy = useI18n().messages.desktopPetals.document;
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [items, setItems] = useState<{ source: ContentSource; title: string; preview: string }[]>([]),
    [nextOffset, setNextOffset] = useState<number | null>(null);
  const [document, setDocument] = useState<ContentDocument | null>(null);
  const generation = useRef(0);
  const invalidate = useStableCallback(() => {
    generation.current++;
  });
  const load = useStableCallback(async (selected: ContentSource) => {
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const value = await contentLibraryApi().read({ ...selected, revisionId: undefined });
      if (request === generation.current) setDocument(value);
    } catch {
      if (request === generation.current) setError(copy.unavailable);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  });
  useEffect(() => {
    if (!open) {
      generation.current++;
      return;
    }
    if (source) {
      void load(source);
      return () => {
        invalidate();
      };
    }
    const request = ++generation.current;
    const timer = setTimeout(() => {
      setBusy(true);
      setError('');
      setDocument(null);
      void contentLibraryApi()
        .search(query)
        .then((result) => {
          if (request === generation.current) {
            setItems(result.items);
            setNextOffset(result.nextOffset);
          }
        })
        .catch(() => {
          if (request === generation.current) setError(copy.failure);
        })
        .finally(() => {
          if (request === generation.current) setBusy(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      invalidate();
    };
  }, [open, query, source, copy.failure, load, invalidate]);
  const capture = async (start: number, end: number) => {
    if (!document || busy) return;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const reference = await contentLibraryApi().capture({
        source: document.source,
        revisionId: document.revisionId,
        contentHash: document.contentHash,
        start,
        end,
      });
      if (request === generation.current) {
        onInsert(reference);
        setOpen(false);
      }
    } catch {
      if (request === generation.current) setError(copy.failure);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const more = async () => {
    if (busy || nextOffset === null) return;
    const request = ++generation.current;
    setBusy(true);
    try {
      const result = await contentLibraryApi().search(query, nextOffset);
      if (request === generation.current) {
        setItems((current) => [...current, ...result.items]);
        setNextOffset(result.nextOffset);
      }
    } catch {
      if (request === generation.current) setError(copy.failure);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={label ?? copy.reference}
          aria-label={label ?? copy.reference}
        >
          <Link2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 p-2" align="start">
        {!source && (
          <Input
            aria-label={copy.search}
            placeholder={copy.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        {document && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => setDocument(null)} aria-label={copy.search}>
              <ChevronLeft />
            </Button>
            <span className="truncate text-sm">{document.displayTitle || copy.empty}</span>
          </div>
        )}
        <div className="max-h-72 overflow-y-auto">
          {busy && <LoaderCircle className="mx-auto size-4 animate-spin" />}
          {error && (
            <span role="alert" className="text-xs text-destructive">
              {error}
            </span>
          )}
          {document
            ? document.blocks.map((block) => (
                <Button
                  key={block.start}
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left font-normal"
                  disabled={busy}
                  onClick={() => void capture(block.start, block.end)}
                >
                  {block.preview || copy.reference}
                </Button>
              ))
            : items.map((item) => (
                <Button
                  key={JSON.stringify(item.source)}
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left font-normal"
                  disabled={busy}
                  onClick={() => void load(item.source)}
                >
                  {item.title || copy.empty}
                </Button>
              ))}
          {!document && nextOffset !== null && (
            <Button variant="ghost" className="w-full" disabled={busy} onClick={() => void more()}>
              {copy.more}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
