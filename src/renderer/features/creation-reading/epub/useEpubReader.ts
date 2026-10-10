import { useEffect, useRef, useState } from 'react';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type { ReadingPosition } from '@/shared/contracts/creation-reading';
import type {
  ReadingReveal,
  ReadingSelection,
  ReadingViewportPosition,
} from '@/renderer/features/creation-reading/ReadingText';
import { EpubReaderSession, type EpubReaderState } from '@/renderer/features/creation-reading/epub/EpubReaderSession';

export interface EpubReaderProps {
  active?: boolean;
  bytes: Uint8Array;
  reveal?: ReadingReveal;
  initialPosition?: ReadingPosition;
  onSelect(value: ReadingSelection | null): void;
  onPosition(value: ReadingViewportPosition): void;
  onRevealFailed(): void;
}

export function useEpubReader(props: EpubReaderProps) {
  const active = props.active !== false;
  const root = useRef<HTMLDivElement>(null);
  const session = useRef<EpubReaderSession | null>(null);
  const initial = useRef(props.initialPosition).current;
  const resumePosition = useRef(props.initialPosition);
  const [state, setState] = useState<EpubReaderState>({ chapters: [], chapter: '', fontSize: initial?.fontSize ?? 18 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [retry, setRetry] = useState(0);
  const select = useStableCallback(props.onSelect);
  const position = useStableCallback((value: ReadingViewportPosition) => {
    resumePosition.current = { ...value, sourceId: resumePosition.current?.sourceId ?? '' };
    props.onPosition(value);
  });
  const locationMissing = useStableCallback(props.onRevealFailed);

  useEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    const container = root.current;
    if (!container) return;
    let disposed = false;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let previousWidth = 0,
      previousHeight = 0;
    setReady(false);
    setError('');
    setMissing(false);
    const reader = new EpubReaderSession(
      container,
      {
        state: (value) => {
          if (!disposed) setState(value);
        },
        select,
        position,
        locationMissing,
        resourceMissing: () => {
          if (!disposed) setMissing(true);
        },
        failed: (reason) => {
          if (!disposed) setError(reason instanceof Error ? reason.message : 'EPUB_INVALID');
        },
      },
      resumePosition.current,
    );
    session.current = reader;
    const observer = new ResizeObserver(([entry]) => {
      if (
        !entry ||
        Math.abs(previousWidth - entry.contentRect.width) + Math.abs(previousHeight - entry.contentRect.height) < 2
      )
        return;
      previousWidth = entry.contentRect.width;
      previousHeight = entry.contentRect.height;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!disposed) reader.resize(previousWidth, previousHeight);
      }, 120);
    });
    void reader
      .open(props.bytes, resumePosition.current)
      .then(() => {
        if (!disposed) {
          setReady(true);
          observer.observe(container);
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'EPUB_INVALID');
      });
    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      observer.disconnect();
      reader.destroy();
      if (session.current === reader) session.current = null;
      container.replaceChildren();
    };
  }, [active, props.bytes, retry, select, position, locationMissing]);

  useEffect(() => {
    if (active && ready && props.reveal) void session.current?.reveal(props.reveal);
  }, [active, ready, props.reveal]);

  const navigate = useStableCallback((href: string) => session.current?.navigate(href));
  const page = useStableCallback((direction: number) => session.current?.page(direction));
  const fontSize = useStableCallback((value: number) => session.current?.fontSize(value));
  return { root, state, ready, error, missing, navigate, page, fontSize, retry: () => setRetry((value) => value + 1) };
}
