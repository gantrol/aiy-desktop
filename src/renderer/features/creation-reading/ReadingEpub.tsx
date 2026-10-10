import { ChevronDown, ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useEpubReader, type EpubReaderProps } from '@/renderer/features/creation-reading/epub/useEpubReader';

export function ReadingEpub(props: EpubReaderProps) {
  const { locale, messages } = useI18n();
  const copy = messages.creationReading;
  const reader = useEpubReader(props);
  const { state } = reader;
  const failure =
    reader.error === 'EPUB_ENCRYPTED'
      ? copy.epubEncrypted
      : reader.error === 'EPUB_FIXED_LAYOUT'
        ? copy.epubFixedLayout
        : reader.error === 'EPUB_LIMIT'
          ? copy.epubLimit
          : copy.fileFailed;
  return (
    <>
      <div className="flex min-h-10 shrink-0 items-center gap-1 border-b px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={!reader.ready}
              className="min-w-0 flex-1 justify-between"
              aria-label={copy.contents}
            >
              <span className="truncate">{state.chapter || copy.contents}</span>
              <ChevronDown className="size-3.5 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-80 max-w-80 overflow-y-auto rounded-sm"
            aria-label={copy.contents}
          >
            {state.chapters.map((chapter, index) => (
              <DropdownMenuItem
                key={chapter.href + ':' + index}
                onSelect={() => reader.navigate(chapter.href)}
                style={{ paddingLeft: 8 + Math.min(chapter.depth, 6) * 12 }}
              >
                <span className="whitespace-normal break-words">{chapter.label || copy.chapter}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!reader.ready || state.fontSize <= 12}
          aria-label={copy.smaller}
          title={copy.smaller}
          onClick={() => reader.fontSize(state.fontSize - 2)}
        >
          <Minus className="size-3.5" />
        </Button>
        <span className="w-6 text-center text-xs tabular-nums" aria-label={copy.fontSize}>
          {new Intl.NumberFormat(locale).format(state.fontSize)}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!reader.ready || state.fontSize >= 32}
          aria-label={copy.larger}
          title={copy.larger}
          onClick={() => reader.fontSize(state.fontSize + 2)}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
      {reader.error ? (
        <div role="alert" className="flex shrink-0 items-center gap-2 p-3 text-sm text-destructive">
          {failure}
          <Button size="sm" variant="outline" onClick={reader.retry}>
            {copy.retry}
          </Button>
        </div>
      ) : !reader.ready ? (
        <div role="status" className="shrink-0 px-3 py-1 text-xs text-muted-foreground">
          {copy.loading}
        </div>
      ) : reader.missing ? (
        <div role="status" className="shrink-0 px-3 py-1 text-xs text-muted-foreground">
          {copy.epubResourceMissing}
        </div>
      ) : null}
      <div
        ref={reader.root}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-media-checker-a text-media-surround-dark"
        aria-label={copy.epubReader}
      />
      <div className="flex shrink-0 items-center justify-between border-t px-2 py-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={!reader.ready}
          onClick={() => reader.page(-1)}
          aria-label={copy.previous}
        >
          <ChevronLeft className="size-4" />
          {copy.previous}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!reader.ready}
          onClick={() => reader.page(1)}
          aria-label={copy.next}
        >
          {copy.next}
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </>
  );
}
