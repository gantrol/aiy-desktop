import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  ReadingText,
  type ReadingSelection,
  type ReadingReveal,
  type ReadingViewportPosition,
} from '@/renderer/features/creation-reading/ReadingText';
import type { ReadingPosition } from '@/shared/contracts/creation-reading';
import { ReadingPdfBinaryData } from '@/renderer/features/creation-reading/pdfBinaryData';

GlobalWorkerOptions.workerSrc = workerUrl;
export function ReadingPdf({
  active = true,
  bytes,
  onSelect,
  reveal,
  initialPosition,
  onPosition,
  onRevealFailed,
}: {
  active?: boolean;
  bytes: Uint8Array;
  onSelect(value: ReadingSelection | null): void;
  reveal?: ReadingReveal;
  initialPosition?: ReadingPosition;
  onPosition(position: ReadingViewportPosition): void;
  onRevealFailed(): void;
}) {
  const copy = useI18n().messages.creationReading;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPosition?.page ?? 1),
    [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<'PAGE' | 'TEXT'>(initialPosition?.view === 'TEXT' ? 'TEXT' : 'PAGE');
  const [text, setText] = useState(''),
    [textPage, setTextPage] = useState(0),
    [failed, setFailed] = useState(false),
    [loading, setLoading] = useState(true);
  const [dismissedReveal, setDismissedReveal] = useState<ReadingReveal>();
  const [navigated, setNavigated] = useState(false);
  const activeReveal = reveal === dismissedReveal ? undefined : reveal;
  const restorePosition = activeReveal?.position ?? (navigated ? undefined : initialPosition);
  const canvas = useRef<HTMLCanvasElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) {
      setPdf(null);
      return;
    }
    let disposed = false;
    const task = getDocument({
      data: bytes.slice(),
      useWorkerFetch: false,
      BinaryDataFactory: ReadingPdfBinaryData,
      useWasm: false,
      enableXfa: false,
      isOffscreenCanvasSupported: false,
    });
    void task.promise
      .then((document) => {
        if (!disposed) setPdf(document);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      void task.destroy();
    };
  }, [active, bytes]);
  useEffect(() => {
    if (!active || !pdf || !activeReveal) return;
    const targetPage = activeReveal.location.page ?? activeReveal.position?.page ?? 1;
    if (targetPage > pdf.numPages) {
      onRevealFailed();
      return;
    }
    setPage(targetPage);
    const view = activeReveal.position
      ? activeReveal.position.view === 'TEXT'
        ? 'TEXT'
        : 'PAGE'
      : activeReveal.quote
        ? 'TEXT'
        : 'PAGE';
    setMode(view);
    onPosition({
      page: targetPage,
      view,
      scrollTop: activeReveal.position?.scrollTop ?? 0,
      textOffset: activeReveal.position?.textOffset,
    });
  }, [active, pdf, activeReveal, onRevealFailed, onPosition]);
  useEffect(() => {
    if (!active || !pdf) return;
    let disposed = false,
      render: RenderTask | undefined;
    setLoading(true);
    setFailed(false);
    setText('');
    void (async () => {
      const documentPage = await pdf.getPage(page);
      if (disposed) return;
      const content = await documentPage.getTextContent();
      if (disposed) return;
      setText(
        content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .trim(),
      );
      setTextPage(page);
      if (mode === 'PAGE' && canvas.current && viewport.current) {
        const natural = documentPage.getViewport({ scale: 1 });
        const scale = Math.min(1.5, Math.max(240, viewport.current.clientWidth - 32) / natural.width) * zoom;
        const screen = documentPage.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (screen.width * screen.height)));
        const element = canvas.current;
        element.width = Math.max(1, Math.floor(screen.width * ratio));
        element.height = Math.max(1, Math.floor(screen.height * ratio));
        element.style.width = screen.width + 'px';
        element.style.height = screen.height + 'px';
        render = documentPage.render({ canvas: element, viewport: screen, transform: [ratio, 0, 0, ratio, 0, 0] });
        await render.promise;
        if (!disposed && viewport.current) {
          if (restorePosition?.page === page) viewport.current.scrollTop = restorePosition.scrollTop;
        }
      }
      if (!disposed) setLoading(false);
    })().catch(() => {
      if (!disposed) {
        setFailed(true);
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
      render?.cancel();
    };
  }, [active, pdf, page, zoom, mode, restorePosition]);
  const changePage = (value: number) => {
    setDismissedReveal(reveal);
    setNavigated(true);
    if (viewport.current) viewport.current.scrollTop = 0;
    onSelect(null);
    setPage(value);
    onPosition({ page: value, view: mode, scrollTop: 0 });
  };
  const changeMode = (value: 'PAGE' | 'TEXT') => {
    if (value === mode) return;
    setDismissedReveal(reveal);
    setNavigated(true);
    onSelect(null);
    setMode(value);
    onPosition({ page, view: value, scrollTop: 0 });
  };
  return (
    <>
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b px-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!pdf || page <= 1}
          aria-label={copy.previous}
          onClick={() => changePage(page - 1)}
        >
          ‹
        </Button>
        <Input
          aria-label={copy.page}
          type="number"
          min={1}
          max={pdf?.numPages ?? 1}
          value={page}
          className="h-7 w-16"
          onChange={(event) => {
            const value = Number(event.target.value);
            if (pdf && Number.isInteger(value) && value >= 1 && value <= pdf.numPages) {
              changePage(value);
            }
          }}
        />
        <span className="text-xs text-muted-foreground">/ {pdf?.numPages ?? '…'}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!pdf || page >= pdf.numPages}
          aria-label={copy.next}
          onClick={() => changePage(page + 1)}
        >
          ›
        </Button>
        <Button variant={mode === 'PAGE' ? 'secondary' : 'ghost'} size="sm" onClick={() => changeMode('PAGE')}>
          {copy.pageView}
        </Button>
        <Button variant={mode === 'TEXT' ? 'secondary' : 'ghost'} size="sm" onClick={() => changeMode('TEXT')}>
          {copy.textView}
        </Button>
        {mode === 'PAGE' && (
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-label={copy.smaller}
              disabled={zoom <= 0.5}
              onClick={() => setZoom((value) => value - 0.25)}
            >
              −
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={copy.larger}
              disabled={zoom >= 2}
              onClick={() => setZoom((value) => value + 0.25)}
            >
              ＋
            </Button>
          </>
        )}
      </div>
      {failed && (
        <div role="alert" className="p-3 text-sm text-destructive">
          {copy.fileFailed}
        </div>
      )}
      {loading && !failed && (
        <div role="status" className="px-3 text-xs text-muted-foreground">
          {copy.loading}
        </div>
      )}
      {mode === 'PAGE' ? (
        <div
          ref={viewport}
          onScroll={(event) => onPosition({ page, view: 'PAGE', scrollTop: event.currentTarget.scrollTop })}
          className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4"
        >
          <canvas key={page + ':' + zoom} ref={canvas} className="mx-auto max-w-none" aria-label={copy.page} />
        </div>
      ) : !loading && textPage === page ? (
        <ReadingText
          reveal={activeReveal}
          text={text || (!loading ? copy.noText : '')}
          location={{ page }}
          onSelect={text ? onSelect : () => undefined}
          initialPosition={restorePosition}
          onPosition={onPosition}
          onRevealFailed={onRevealFailed}
        />
      ) : null}
    </>
  );
}
